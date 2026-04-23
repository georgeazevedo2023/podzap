/**
 * Typed event registry for the podZAP Inngest workers.
 *
 * In Inngest 4.x the event type map pattern (`EventSchemas().fromRecord()`)
 * is gone — typed events are now declared individually via `eventType()`,
 * which returns an `EventType` object that can be used as:
 *
 *   - a trigger in `inngest.createFunction(..., events.messageCaptured, ...)`
 *   - a sender via `events.messageCaptured.create({ messageId, ... })`
 *
 * Both uses carry the declared data type so both ends of the pipe get full
 * IntelliSense / compile-time checking.
 *
 * Design notes:
 *
 *   - Event *name strings* follow Inngest's `subject.action[.modifier]`
 *     convention. Subjects: `message`, `media`, `test`.
 *
 *   - `staticSchema<T>()` gives us types-only validation. We don't ship a
 *     runtime schema library for these events because the payloads are
 *     trivially shaped (just `messageId`, etc.) and the producers are
 *     internal — this isn't a public API ingestion point.
 *
 *   - Data shapes are intentionally minimal. Handlers re-fetch the full
 *     row from the DB via `messageId`. Copying the row into the event
 *     would rot fast and leak PII into Inngest's debug storage.
 *
 * Parallel agents add function handlers under `inngest/functions/*` that
 * trigger on these. If you add a new event, also register it in
 * `app/api/inngest/route.ts` via the function that consumes it.
 */

import { eventType, staticSchema } from "inngest";

/**
 * Fired by `lib/webhooks/persist.ts` right after a `messages` row is
 * inserted. Downstream workers (transcribe-audio, describe-image) fan
 * out from here by filtering on `data.type`.
 */
export const messageCaptured = eventType("message.captured", {
  schema: staticSchema<{
    messageId: string;
    tenantId: string;
    type: "text" | "audio" | "image" | "video" | "other";
  }>(),
});

/**
 * Manual re-trigger for transcription. Emitted by admin tooling when a
 * row needs to be re-processed (e.g. Groq released a better model and
 * we want to rebuild historical transcripts). `force: true` bypasses
 * the "already has transcript" short-circuit.
 */
export const messageTranscriptionRequested = eventType(
  "message.transcription.requested",
  {
    schema: staticSchema<{
      messageId: string;
      force?: boolean;
    }>(),
  },
);

/**
 * Emitted by the pending-media scheduler (Fase 5 Agente 4) when a row
 * has been stuck in `media_download_status='pending'` past TTL. The
 * handler re-invokes `downloadAndStore` with fresh backoff.
 */
export const mediaDownloadRetry = eventType("media.download.retry", {
  schema: staticSchema<{
    messageId: string;
  }>(),
});

/**
 * Manual trigger for summary generation. Emitted by
 * `POST /api/summaries/generate` (and, later, by the schedule runner in
 * Fase 9) when a user asks for a fresh narrative summary of a group over
 * a given period. The handler (`inngest/functions/generate-summary.ts`)
 * delegates to `lib/summary/generator.ts#generateSummary`.
 *
 * Keeping this out-of-band is intentional: Gemini 2.5 Pro calls can take
 * 10-30s and we don't want to hold the HTTP request open that long.
 */
export const summaryRequested = eventType("summary.requested", {
  schema: staticSchema<{
    tenantId: string;
    groupId: string;
    /** ISO-8601 string; rehydrated to `Date` inside the worker. */
    periodStart: string;
    /** ISO-8601 string; rehydrated to `Date` inside the worker. */
    periodEnd: string;
    /** Optional — omit to use the generator's default ("fun"). */
    tone?: "formal" | "fun" | "corporate";
  }>(),
});

/**
 * Emitted by `POST /api/summaries/[id]/approve` after a reviewer flips a
 * summary from `pending_review` → `approved`. This is the trigger for
 * Fase 9 (TTS): the downstream worker re-fetches the row, renders audio,
 * and persists the resulting media artefact.
 *
 * Keeping the payload minimal (ids only) mirrors `messageCaptured` —
 * the handler re-reads the summary row for the freshest text, avoiding
 * the "payload snapshot drifted from DB" failure mode if the summary
 * is edited after emission.
 */
export const summaryApproved = eventType("summary.approved", {
  schema: staticSchema<{
    summaryId: string;
    tenantId: string;
  }>(),
});

/**
 * Health-check event handled by `inngest/functions/ping.ts`. Used by
 * smoke tests to confirm the worker runtime is up and the event
 * subscription is wired. Never emitted in production traffic.
 */
export const testPing = eventType("test.ping", {
  schema: staticSchema<{
    at: string;
  }>(),
});
