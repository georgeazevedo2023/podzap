/**
 * `describe-image` — Inngest worker that turns inbound image messages
 * into text descriptions in the `transcripts` table.
 *
 * Trigger: `message.captured`. We filter by `event.data.type === 'image'`
 * inside the handler rather than registering a narrower trigger, because:
 *
 *   - Inngest v4's `triggers` config doesn't do runtime-data filtering
 *     anyway — it matches on event *name*, not payload fields.
 *   - Funnelling all captures through one trigger keeps observability
 *     straightforward (one event → fan-out by type).
 *
 * Semantics (idempotent, safe to re-run):
 *
 *   1. Skip non-image events fast. Video is NOT handled here (punted to
 *      Fase 6+).
 *   2. Load the `messages` row via service-role. If the row is gone
 *      (deletion race) or media is still pending download, skip and let
 *      the retry worker (Agente 4) re-trigger once the download lands.
 *   3. If a transcript already exists for this message, skip — re-running
 *      is a no-op unless forced (force path is handled by the
 *      `message.transcription.requested` worker, not this one).
 *   4. Mint a short-lived signed URL for the private `media` bucket,
 *      hand it to Gemini Vision, upsert the description into
 *      `transcripts`.
 *
 * Every external call lives inside its own `step.run(...)` so Inngest can
 * memoise results between retries and we don't re-fetch / re-call Gemini
 * on a flaky network blip later in the chain.
 *
 * The default PT-BR prompt is tuned for *conversational context* (group
 * chat) — factual, short, callouts for visible text (memes, prints,
 * receipts, product photos) rather than generic art-description.
 */

import { inngest } from "../client";
import { messageCaptured } from "../events";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSignedUrl } from "@/lib/media/signedUrl";
import { describeImage as describeImageAi } from "@/lib/ai/gemini-vision";
import {
  getTranscript,
  upsertTranscript,
  type TranscriptView,
} from "@/lib/transcripts/service";

const DEFAULT_PROMPT = [
  "Descreva esta imagem em português do Brasil, em 1-3 frases, focando em:",
  "- Texto visível (se houver)",
  "- Elementos relevantes para uma conversa de grupo (gráficos, memes, prints, fotos de produtos, comprovantes, etc)",
  "- Pessoas/objetos identificáveis em termos genéricos",
  "Evite opinar; seja factual.",
].join("\n");

const SIGNED_URL_TTL_SECONDS = 900;

type MessageLookup =
  | { found: false }
  | {
      found: true;
      mediaStoragePath: string | null;
      mediaDownloadStatus: string | null;
    };

/**
 * Minimal shape of the Inngest handler context that our worker actually
 * touches. Exported for tests — they drive this handler directly without
 * spinning up the full Inngest executor (which would require an HTTP
 * round-trip). The real Inngest types are a superset; ours stays narrow
 * so we don't accidentally rely on behaviour the executor doesn't give us.
 */
export type DescribeImageHandlerArgs = {
  event: { data: { messageId: string; tenantId: string; type: string } };
  step: {
    run: <T>(name: string, fn: () => Promise<T> | T) => Promise<T>;
  };
  logger: {
    info: (msg: string, meta?: unknown) => void;
    warn: (msg: string, meta?: unknown) => void;
    error: (msg: string, meta?: unknown) => void;
  };
};

/**
 * Pure handler, separate from `inngest.createFunction` so unit tests can
 * drive it with a fake `step.run` that executes the callbacks inline. The
 * production wiring below just wraps this.
 */
export async function describeImageHandler(
  args: DescribeImageHandlerArgs,
): Promise<Record<string, unknown>> {
  const { event, step, logger } = args;
  const { messageId, type } = event.data;

    if (type !== "image") {
      return { skipped: true, reason: `type=${type} (not image)` };
    }

    // 1. Load message + verify media is ready.
    const lookup: MessageLookup = await step.run("load-message", async () => {
      const admin = createAdminClient();
      const { data, error } = await admin
        .from("messages")
        .select("id, media_storage_path, media_download_status")
        .eq("id", messageId)
        .maybeSingle();

      if (error) {
        throw new Error(`load-message failed: ${error.message}`);
      }
      if (!data) {
        return { found: false };
      }
      return {
        found: true,
        mediaStoragePath: data.media_storage_path,
        mediaDownloadStatus: data.media_download_status,
      };
    });

    if (!lookup.found) {
      logger.warn("[describe-image] message row not found", { messageId });
      return { skipped: true, reason: "message not found" };
    }
    if (lookup.mediaDownloadStatus !== "downloaded") {
      return {
        skipped: true,
        reason: "media not downloaded yet",
        status: lookup.mediaDownloadStatus,
      };
    }
    if (!lookup.mediaStoragePath) {
      return { skipped: true, reason: "no media_storage_path" };
    }

    // 2. Short-circuit if we already described this image.
    const existing = await step.run("check-existing-transcript", async () => {
      return await getTranscript(messageId);
    });
    if (existing) {
      return {
        skipped: true,
        reason: "transcript already exists",
        transcriptId: existing.id,
      };
    }

    // 3. Sign URL for Gemini to fetch.
    const signedUrl = await step.run("sign-media-url", async () => {
      return await getSignedUrl(
        lookup.mediaStoragePath as string,
        SIGNED_URL_TTL_SECONDS,
      );
    });

    // 4. Call Gemini Vision.
    const { description, model } = await step.run(
      "describe-with-gemini",
      async () => {
        return await describeImageAi({ url: signedUrl }, DEFAULT_PROMPT);
      },
    );

    // 5. Persist.
    const saved: TranscriptView = await step.run(
      "upsert-transcript",
      async () => {
        return await upsertTranscript({
          messageId,
          text: description,
          model,
          language: "pt-BR",
        });
      },
    );

  return {
    described: true,
    transcriptId: saved.id,
    textLength: description.length,
  };
}

/**
 * Inngest-wrapped production worker. `retries: 3` gives us exponential
 * backoff on transient Gemini / Supabase errors without us implementing
 * it by hand. After 3 failures the run is marked failed in the dashboard
 * and can be surfaced by a `transcription-retry` worker in a later phase.
 */
export const describeImage = inngest.createFunction(
  {
    id: "describe-image",
    name: "Describe image (Gemini Vision)",
    triggers: [messageCaptured],
    retries: 3,
  },
  async ({ event, step, logger }) => {
    return describeImageHandler({
      event: event as DescribeImageHandlerArgs["event"],
      step: step as DescribeImageHandlerArgs["step"],
      logger: logger as DescribeImageHandlerArgs["logger"],
    });
  },
);

