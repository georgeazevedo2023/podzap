/**
 * `/api/inngest` — the endpoint Inngest (cloud or dev server) calls to
 * discover and invoke our functions. Not meant to be hit by end users.
 *
 * Flow:
 *   1. On sync (PUT), Inngest introspects the `functions` array and
 *      records each one's id + triggers.
 *   2. On invoke (POST), Inngest sends a payload naming one of those ids
 *      and we run its handler with a step runner.
 *   3. GET returns a JSON summary of the functions served — used by the
 *      dashboard and by the dev server CLI.
 *
 * Middleware: `proxy.ts` already excludes `/api/inngest` from the
 * auth matcher (see the `matcher` entry there). Don't add auth here —
 * the Inngest SDK signs requests with `INNGEST_SIGNING_KEY` in prod.
 *
 * Adding a function:
 *   1. Implement it in `inngest/functions/<name>.ts`.
 *   2. Import it here and append to the `functions` array below.
 *   3. If it consumes a new event, register the event shape in
 *      `inngest/events.ts`.
 */

import { serve } from "inngest/next";

import { inngest } from "@/inngest/client";
import { describeImage } from "@/inngest/functions/describe-image";
import { generateSummaryFunction } from "@/inngest/functions/generate-summary";
import { generateTtsFunction } from "@/inngest/functions/generate-tts";
import { mediaDownloadRetryWorker } from "@/inngest/functions/media-download-retry";
import { ping } from "@/inngest/functions/ping";
import { retryPendingDownloads } from "@/inngest/functions/retry-pending";
import { transcribeAudioFunction } from "@/inngest/functions/transcribe-audio";
import { transcriptionRetry } from "@/inngest/functions/transcription-retry";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    ping,
    describeImage,
    transcribeAudioFunction,
    retryPendingDownloads,
    mediaDownloadRetryWorker,
    transcriptionRetry,
    generateSummaryFunction,
    generateTtsFunction,
  ],
});
