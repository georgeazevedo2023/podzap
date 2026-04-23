/**
 * `transcribe-audio` — Fase 5 Agente 2 worker.
 *
 * Trigger: `message.captured` event, emitted by `lib/webhooks/persist.ts`
 * right after a messages row lands. The handler fans out by `data.type`;
 * anything other than `audio` short-circuits with a `skipped` result so
 * the function run is cheap (no DB hit) and visible in the Inngest
 * dashboard for debuggability.
 *
 * Pipeline (each numbered stage is wrapped in `step.run` so Inngest
 * records a durable checkpoint — a transient error in step 4 does NOT
 * replay step 1, which matters because Groq bills per transcription):
 *
 *   1. load-message   — fetch the row via service-role admin client.
 *                       Also looks up an existing transcript so we can
 *                       short-circuit when the message is already done.
 *   2. signed-url     — createSignedUrl on the private `media` bucket,
 *                       15 min TTL (more than enough for a Groq round
 *                       trip; short enough to not be a useful leaked
 *                       credential if the Inngest event log gets sniffed).
 *   3. transcribe     — Groq Whisper Large v3 via `transcribeAudio`.
 *                       Any thrown AiError bubbles up and Inngest
 *                       handles the 3-retry exponential backoff.
 *   4. save-transcript — upsertTranscript (idempotent on message_id).
 *
 * Skip conditions (all return cheap `{ skipped: true, reason }`):
 *
 *   - event.data.type !== 'audio'
 *   - message row not found (tenant deleted? race with webhook?)
 *   - media_download_status !== 'downloaded' (the retry-pending worker
 *     owns that lane; it will re-emit `message.captured` when the
 *     download lands — see docs/plans/fase-5-plan.md events section)
 *   - transcript already present (manual re-runs must pass `force` via
 *     `message.transcription.requested` instead)
 *
 * Why the handler is exported separately from the Inngest-wrapped
 * function: tests feed it a fake `step` whose `.run` just executes the
 * callback inline. That lets us exercise the real control flow without
 * booting the Inngest runtime or the dev server.
 */

import { inngest } from "../client";
import { messageCaptured } from "../events";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSignedUrl } from "@/lib/media/signedUrl";
import { transcribeAudio } from "@/lib/ai/groq";
import { upsertTranscript } from "@/lib/transcripts/service";

/**
 * Short TTL on the signed URL. Groq pulls the bytes immediately in
 * step 3; we just need the URL to outlive the single retrieve. 15 min
 * is the sweet spot that still covers Inngest's default step timeout.
 */
const SIGNED_URL_TTL_SECONDS = 900;

export type TranscribeAudioResult =
  | { skipped: true; reason: string }
  | { transcribed: true; transcriptId: string; textLength: number };

type MessageRow = {
  id: string;
  tenant_id: string;
  media_storage_path: string | null;
  media_url: string | null;
  media_download_status: string | null;
};

type ExistingTranscript = {
  id: string;
  text: string;
} | null;

/**
 * Narrowed shape of the Inngest handler context we actually use. Declaring
 * it by hand keeps the unit tests decoupled from Inngest's internal
 * handler typings (which change between minor versions) while still
 * giving the real runtime a compatible structure.
 */
export type TranscribeAudioHandlerCtx = {
  event: { data: { messageId: string; tenantId: string; type: string } };
  step: {
    run<T>(name: string, fn: () => Promise<T> | T): Promise<T>;
  };
  logger: {
    info: (msg: string, meta?: Record<string, unknown>) => void;
    warn: (msg: string, meta?: Record<string, unknown>) => void;
    error: (msg: string, meta?: Record<string, unknown>) => void;
  };
};

/**
 * Pure handler exported for unit testing. Mirrors the shape Inngest
 * passes at runtime; the wrapping `createFunction` below adapts.
 */
export async function transcribeAudioHandler(
  ctx: TranscribeAudioHandlerCtx,
): Promise<TranscribeAudioResult> {
  const { event, step, logger } = ctx;

  if (event.data.type !== "audio") {
    return { skipped: true, reason: "not audio" };
  }

  const messageId = event.data.messageId;

  // ── Step 1: load the message row + any existing transcript ──────────
  const loaded = await step.run("load-message", async () => {
    const admin = createAdminClient();

    const { data: message, error: msgErr } = await admin
      .from("messages")
      .select(
        "id, tenant_id, media_storage_path, media_url, media_download_status",
      )
      .eq("id", messageId)
      .maybeSingle();

    if (msgErr) {
      throw new Error(`load-message failed: ${msgErr.message}`);
    }

    if (!message) {
      return { message: null as MessageRow | null, transcript: null as ExistingTranscript };
    }

    const { data: transcript, error: trErr } = await admin
      .from("transcripts")
      .select("id, text")
      .eq("message_id", messageId)
      .maybeSingle();

    // A read error here is not fatal — worst case we re-transcribe.
    // But surfacing the error keeps Inngest logs useful when something
    // deeper is wrong (e.g. RLS misconfig) rather than silently wasting
    // Groq calls.
    if (trErr) {
      throw new Error(`load-transcript failed: ${trErr.message}`);
    }

    return {
      message: message as MessageRow,
      transcript: (transcript as ExistingTranscript) ?? null,
    };
  });

  if (!loaded.message) {
    logger.warn("[transcribe-audio] message not found", { messageId });
    return { skipped: true, reason: "message not found" };
  }

  if (loaded.message.media_download_status !== "downloaded") {
    // Option B (per plan): do NOT sleep+retry here. The retry-pending
    // worker (Agente 4) re-emits `message.captured` once the download
    // lands. Re-triggering ourselves risks an infinite loop if the
    // downloader is stuck; bailing cleanly is observable in Inngest.
    logger.info("[transcribe-audio] media not downloaded yet — bailing", {
      messageId,
      status: loaded.message.media_download_status,
    });
    return { skipped: true, reason: "media not downloaded yet" };
  }

  if (!loaded.message.media_storage_path) {
    // downloaded=true but no storage path is an invariant violation —
    // worth a warn so it surfaces in logs, but we can't do anything.
    logger.warn(
      "[transcribe-audio] downloaded but no storage path — bailing",
      { messageId },
    );
    return { skipped: true, reason: "missing storage path" };
  }

  if (loaded.transcript && loaded.transcript.text.trim().length > 0) {
    return { skipped: true, reason: "already transcribed" };
  }

  // ── Step 2: signed URL ─────────────────────────────────────────────
  const signedUrl = await step.run("signed-url", async () => {
    return getSignedUrl(
      loaded.message!.media_storage_path!,
      SIGNED_URL_TTL_SECONDS,
    );
  });

  // ── Step 3: transcribe via Groq Whisper ────────────────────────────
  const transcription = await step.run("transcribe", async () => {
    return transcribeAudio({ url: signedUrl }, { language: "pt" });
  });

  logger.info("[transcribe-audio] groq ok", {
    messageId,
    model: transcription.model,
    textLength: transcription.text.length,
    durationSeconds: transcription.durationSeconds,
  });

  // ── Step 4: persist ────────────────────────────────────────────────
  const saved = await step.run("save-transcript", async () => {
    return upsertTranscript({
      messageId,
      text: transcription.text,
      language: transcription.language,
      confidence: null,
      model: transcription.model,
    });
  });

  return {
    transcribed: true,
    transcriptId: saved.id,
    textLength: transcription.text.length,
  };
}

/**
 * Inngest-wrapped worker. `retries: 3` + Inngest's built-in exponential
 * backoff covers transient Groq 5xx / rate-limit errors. After 3
 * failures the function is marked failed in the dashboard; a future
 * `transcription-retry` worker (Fase 5 Agente 4) can subscribe to the
 * failure event and re-kick with longer backoff.
 */
export const transcribeAudio_ = inngest.createFunction(
  {
    id: "transcribe-audio",
    name: "Transcribe audio (Groq Whisper)",
    triggers: [messageCaptured],
    retries: 3,
  },
  async ({ event, step, logger }) => {
    return transcribeAudioHandler({
      event: event as TranscribeAudioHandlerCtx["event"],
      step: step as TranscribeAudioHandlerCtx["step"],
      logger: logger as TranscribeAudioHandlerCtx["logger"],
    });
  },
);

// Exposed under the more conventional name the serve-handler imports.
// The trailing-underscore binding above is just so the handler function
// export and the Inngest function export don't collide on the name.
export { transcribeAudio_ as transcribeAudioFunction };
