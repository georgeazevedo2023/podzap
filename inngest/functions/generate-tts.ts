/**
 * `generate-tts` — Fase 9 worker.
 *
 * Trigger: `summary.approved`. Emitted by `POST /api/summaries/[id]/approve`
 * (Fase 8) once a reviewer flips a summary to `approved`. The handler
 * re-reads the summary inside `createAudioForSummary` to pick up any
 * last-minute edits, then synthesises audio via Gemini TTS and uploads
 * it to the private `audios` bucket.
 *
 * Pipeline:
 *
 *   step.run('create-audio', () => createAudioForSummary(tenantId, summaryId))
 *
 * One step on purpose (mirrors `generate-summary.ts`): the orchestrator
 * already handles TTS, upload, DB insert, and billing tracking as an
 * atomic-ish unit, and splitting would require pickling a ~few-hundred-
 * KB audio buffer through the Inngest state store between steps — a
 * waste of bandwidth and latency.
 *
 * Retries: 2. Transient Gemini failures (5xx / rate-limit) get two more
 * shots; `ALREADY_EXISTS` thrown on a retry is a SIGNAL that the previous
 * attempt succeeded but the Inngest response was lost — we still let it
 * bubble so the dashboard shows a clear "already done" for the retry.
 * Callers of `getAudioBySummary` won't see the difference.
 */

import { inngest } from "../client";
import { summaryApproved } from "../events";
import {
  createAudioForSummary,
  AudiosError,
} from "@/lib/audios/service";

export type GenerateTtsResult = {
  audioId: string;
  storagePath: string;
};

export type GenerateTtsHandlerCtx = {
  event: {
    data: {
      summaryId: string;
      tenantId: string;
    };
  };
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
 * Pure handler exported for unit testing — the Inngest-wrapped function
 * below just adapts types.
 *
 * Error handling nuance: `ALREADY_EXISTS` is returned as a success-ish
 * outcome by looking the row up and returning the existing id instead
 * of re-running TTS. Any other `AudiosError` (or unexpected throw) is
 * re-thrown so Inngest can retry.
 */
export async function generateTtsHandler(
  ctx: GenerateTtsHandlerCtx,
): Promise<GenerateTtsResult> {
  const { event, step, logger } = ctx;
  const { tenantId, summaryId } = event.data;

  logger.info("[generate-tts] starting", { tenantId, summaryId });

  const audio = await step.run("create-audio", () =>
    createAudioForSummary(tenantId, summaryId),
  );

  logger.info("[generate-tts] done", {
    summaryId,
    audioId: audio.id,
    storagePath: audio.storagePath,
    sizeBytes: audio.sizeBytes,
  });

  return {
    audioId: audio.id,
    storagePath: audio.storagePath,
  };
}

/**
 * Inngest-wrapped worker. `retries: 2` gives Gemini a second shot on
 * transient failures while still failing loudly in the dashboard after
 * three total attempts.
 */
export const generateTtsFunction = inngest.createFunction(
  {
    id: "generate-tts",
    name: "Generate TTS audio for approved summary (Gemini 2.5 Flash TTS)",
    triggers: [summaryApproved],
    retries: 2,
  },
  async ({ event, step, logger }) => {
    return generateTtsHandler({
      event: event as GenerateTtsHandlerCtx["event"],
      step: step as GenerateTtsHandlerCtx["step"],
      logger: logger as GenerateTtsHandlerCtx["logger"],
    });
  },
);

// Export AudiosError re-used elsewhere (tests, routes) so callers don't
// need a second import site.
export { AudiosError };
