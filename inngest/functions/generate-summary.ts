/**
 * `generate-summary` — Fase 7 worker.
 *
 * Trigger: `summary.requested`. Emitted by `POST /api/summaries/generate`
 * (manual UI trigger) and the Fase 9 daily scheduler. Never fired from
 * the inbound webhook path — we only summarise on an explicit request so
 * Gemini 2.5 Pro costs are bounded by user intent, not message volume.
 *
 * Pipeline:
 *
 *   step.run('generate', () => generateSummary(input))
 *
 * That single step runs the whole orchestrator (normalize → prompt →
 * Gemini → persist → track). We deliberately don't fan out into smaller
 * steps:
 *
 *   - The orchestrator already owns error-path tracking (AI errors and
 *     DB errors both fire `trackAiCall`), so retries at the step level
 *     would double-bill or double-count.
 *   - The Gemini call is the expensive part. Wrapping it in its own
 *     step would mean Inngest replays normalize+prompt on retry, which
 *     is cheap but offers no upside and extra complexity.
 *   - Splitting into steps requires pickling `NormalizedConversation`
 *     into the Inngest state store; that struct contains `Date` values
 *     that would round-trip as strings and break downstream.
 *
 * Inngest's `retries: 2` gives Gemini transient-failure coverage.
 * `EMPTY_CONVERSATION` is NOT retried by the worker — the handler
 * re-throws, Inngest retries once or twice, and each attempt fails the
 * same way. That's intentional: it's cheap (no LLM call) and it leaves
 * a clear failure in the dashboard rather than silently succeeding.
 *
 * Export split mirrors `transcribe-audio.ts` — the pure handler is
 * tested directly with a fake `step`; the `inngest.createFunction`
 * wrapper just adapts types.
 */

import { inngest } from "../client";
import { summaryApproved, summaryRequested } from "../events";
import {
  generateSummary,
  type SummaryTone,
} from "@/lib/summary/generator";
import { autoApproveSummary } from "@/lib/summaries/service";

export type GenerateSummaryResult = {
  summaryId: string;
  autoApproved: boolean;
};

/**
 * Narrowed shape of the Inngest handler context we actually use. Mirrors
 * `transcribe-audio.ts` — keeps unit tests independent of Inngest's
 * internal handler typings (which change between minor versions).
 */
export type GenerateSummaryHandlerCtx = {
  event: {
    data: {
      tenantId: string;
      groupId: string;
      periodStart: string;
      periodEnd: string;
      tone?: SummaryTone;
      voiceMode?: "single" | "duo";
      autoApprove?: boolean;
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
 * Pure handler exported for unit testing. Rehydrates ISO strings from
 * the event into `Date`s, calls the generator, returns `{ summaryId }`.
 *
 * Errors (including `SummaryError`) bubble up so Inngest's retry
 * machinery can reschedule — the `retries: 2` below caps it.
 */
export async function generateSummaryHandler(
  ctx: GenerateSummaryHandlerCtx,
): Promise<GenerateSummaryResult> {
  const { event, step, logger } = ctx;

  const periodStart = new Date(event.data.periodStart);
  const periodEnd = new Date(event.data.periodEnd);

  if (Number.isNaN(periodStart.getTime()) || Number.isNaN(periodEnd.getTime())) {
    // Malformed event — fail hard and loud. Not a retryable condition.
    throw new Error(
      `generate-summary: invalid periodStart/periodEnd (${event.data.periodStart}, ${event.data.periodEnd})`,
    );
  }

  logger.info("[generate-summary] starting", {
    tenantId: event.data.tenantId,
    groupId: event.data.groupId,
    tone: event.data.tone ?? "fun",
  });

  const record = await step.run("generate", () =>
    generateSummary({
      tenantId: event.data.tenantId,
      groupId: event.data.groupId,
      periodStart,
      periodEnd,
      tone: event.data.tone,
      voiceMode: event.data.voiceMode,
    }),
  );

  logger.info("[generate-summary] done", {
    summaryId: record.id,
    promptVersion: record.promptVersion,
    model: record.model,
  });

  // Fase 11 auto-approve: when the cron runner says so, flip the freshly-
  // generated summary straight to `approved` and emit `summary.approved`
  // so the Fase 9 TTS worker picks it up without human intervention. We
  // do this as a dedicated step so Inngest can memoise it on retry (we
  // don't want to re-generate the summary if auto-approve fails
  // transiently).
  let autoApproved = false;
  if (event.data.autoApprove === true) {
    await step.run("auto-approve", async () => {
      await autoApproveSummary(event.data.tenantId, record.id);
      await inngest.send(
        summaryApproved.create({
          summaryId: record.id,
          tenantId: event.data.tenantId,
        }),
      );
    });
    autoApproved = true;
    logger.info("[generate-summary] auto-approved", { summaryId: record.id });
  }

  return { summaryId: record.id, autoApproved };
}

/**
 * Inngest-wrapped worker. `retries: 2` keeps Gemini transient-failure
 * coverage modest — summaries aren't real-time and we'd rather see a
 * failure in the dashboard than loop forever on a persistent error.
 */
export const generateSummaryFunction = inngest.createFunction(
  {
    id: "generate-summary",
    name: "Generate podcast-style summary (Gemini 2.5 Pro)",
    triggers: [summaryRequested],
    retries: 2,
  },
  async ({ event, step, logger }) => {
    return generateSummaryHandler({
      event: event as GenerateSummaryHandlerCtx["event"],
      step: step as GenerateSummaryHandlerCtx["step"],
      logger: logger as GenerateSummaryHandlerCtx["logger"],
    });
  },
);
