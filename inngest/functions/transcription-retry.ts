/**
 * `transcription-retry` — safety net that re-emits `message.captured` for
 * audio / image rows that were downloaded but never transcribed.
 *
 * Why this exists:
 *   - The fan-out from webhook → `message.captured` → transcribe/describe
 *     worker is fire-and-forget. If Inngest was down during the webhook,
 *     if the worker crashed before writing a transcript, or if a deploy
 *     ate an in-flight step, the message stays "downloaded with no
 *     transcript" forever.
 *   - Checking "does a transcripts row exist for this message" is the
 *     most robust signal that transcription hasn't happened. We don't
 *     track a separate `transcription_status` column.
 *
 * Cadence:
 *   - Every 15 minutes is enough. Real-time missing-transcript recovery
 *     isn't important; this runs as a backstop. Cap at 50 rows / run, same
 *     batching rationale as `retry-pending-downloads`.
 *
 * Window:
 *   - Only look back 24h. Older rows would need manual intervention — the
 *     storage path may have expired, model prices may have changed, etc.
 *
 * Invariant:
 *   - We do NOT call transcribe workers directly. We re-emit
 *     `message.captured` and let the existing fan-out do its job. Keeps
 *     one code path for first-attempt + retry.
 */

import { inngest } from "../client";
import { messageCaptured } from "../events";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/types";

type MessageType = Database["public"]["Enums"]["message_type"];

type MissingRow = {
  id: string;
  tenant_id: string;
  type: MessageType;
};

const BATCH_SIZE = 50;
const LOOKBACK_MS = 24 * 60 * 60 * 1000;

export type TranscriptionRetryResult = {
  found: number;
  emitted: number;
};

export type TranscriptionRetryLogger = {
  info: (msg: string, meta?: Record<string, unknown>) => void;
  warn: (msg: string, meta?: Record<string, unknown>) => void;
  error: (msg: string, meta?: Record<string, unknown>) => void;
};

export type TranscriptionRetryHandlerCtx = {
  step: {
    run<T>(name: string, fn: () => Promise<T> | T): Promise<T>;
  };
  logger: TranscriptionRetryLogger;
};

/**
 * Pure handler — extraído do Inngest wrapper pra ser chamado também do
 * endpoint `/api/worker/tick` (n8n cron).
 */
export async function transcriptionRetryHandler(
  ctx: TranscriptionRetryHandlerCtx,
): Promise<TranscriptionRetryResult> {
  const { step, logger } = ctx;

  const missing = await step.run(
    "find-missing-transcripts",
    async (): Promise<MissingRow[]> => {
      const admin = createAdminClient();
      const lookbackAfter = new Date(Date.now() - LOOKBACK_MS).toISOString();

      const { data: candidates, error } = await admin
        .from("messages")
        .select("id, tenant_id, type")
        .in("type", ["audio", "image"])
        .eq("media_download_status", "downloaded")
        .gt("created_at", lookbackAfter)
        .order("created_at", { ascending: false })
        .limit(BATCH_SIZE * 4);

      if (error) {
        throw new Error(`transcription-retry find failed: ${error.message}`);
      }

      const rows = (candidates ?? []) as MissingRow[];
      if (rows.length === 0) return [];

      const ids = rows.map((r) => r.id);
      const { data: existingTranscripts, error: tErr } = await admin
        .from("transcripts")
        .select("message_id")
        .in("message_id", ids);

      if (tErr) {
        throw new Error(
          `transcription-retry transcripts lookup failed: ${tErr.message}`,
        );
      }

      const transcribed = new Set(
        (existingTranscripts ?? []).map((t) => t.message_id as string),
      );
      const untranscribed = rows.filter((r) => !transcribed.has(r.id));
      return untranscribed.slice(0, BATCH_SIZE);
    },
  );

  if (missing.length === 0) {
    logger.info("[transcription-retry] nothing to do");
    return { found: 0, emitted: 0 };
  }

  await step.run("emit-captured-events", async () => {
    await inngest.send(
      missing.map((row) =>
        messageCaptured.create({
          messageId: row.id,
          tenantId: row.tenant_id,
          type: row.type,
        }),
      ),
    );
  });

  const counts: TranscriptionRetryResult = {
    found: missing.length,
    emitted: missing.length,
  };
  logger.info("[transcription-retry] done", counts);
  return counts;
}

export const transcriptionRetry = inngest.createFunction(
  {
    id: "transcription-retry",
    name: "Transcription retry (safety net)",
    triggers: [{ cron: "*/15 * * * *" }],
  },
  async ({ step, logger }) => {
    return transcriptionRetryHandler({
      step: step as TranscriptionRetryHandlerCtx["step"],
      logger: logger as TranscriptionRetryLogger,
    });
  },
);
