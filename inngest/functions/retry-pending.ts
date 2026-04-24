/**
 * `retry-pending-downloads` — cron that reaps rows stuck in
 * `media_download_status = 'pending'`.
 *
 * Why we need this:
 *   - `lib/webhooks/persist.ts` fires `downloadAndStore` as a fire-and-forget
 *     promise. If the Next.js process is killed mid-download (deploy window,
 *     container restart / OOM) the row will stay `pending` forever.
 *   - UAZAPI media URLs are signed with a short TTL (~hours). Retrying after
 *     24 hours is pointless — the upstream URL is dead. We cap the lookback
 *     at 24h to avoid burning cycles on rows we can't recover.
 *
 * Batching:
 *   - Cap at 50 per invocation. Cron re-runs every 5 minutes so a backlog
 *     of 10k rows drains in ~17 hours without blocking a single function
 *     execution for hours (Inngest functions have a 15-min wall clock on
 *     most plans).
 *
 * After a successful re-download we emit `message.captured` so downstream
 * transcription workers fan out the same way they would for a fresh webhook.
 */

import { inngest } from "../client";
import { messageCaptured } from "../events";
import { createAdminClient } from "@/lib/supabase/admin";
import { downloadAndStore } from "@/lib/media/download";
import type { Database } from "@/lib/supabase/types";

type MessageType = Database["public"]["Enums"]["message_type"];

/** Rows we pull off the queue for re-download. */
type StaleRow = {
  id: string;
  tenant_id: string;
  media_url: string | null;
  media_mime_type: string | null;
  type: MessageType;
};

const BATCH_SIZE = 50;
/** Skip rows fresher than this — `persist.ts` fires the download async,
 *  so we want to give it a fair window before declaring the row stuck. */
const STALE_AFTER_MS = 2 * 60 * 1000;
/** Don't retry rows older than this — the UAZAPI media URL is long gone. */
const LOOKBACK_MS = 24 * 60 * 60 * 1000;

export type RetryPendingResult = {
  found: number;
  retried: number;
  succeeded: number;
  failed: number;
};

export type RetryPendingLogger = {
  info: (msg: string, meta?: Record<string, unknown>) => void;
  warn: (msg: string, meta?: Record<string, unknown>) => void;
  error: (msg: string, meta?: Record<string, unknown>) => void;
};

export type RetryPendingHandlerCtx = {
  step: {
    run<T>(name: string, fn: () => Promise<T> | T): Promise<T>;
  };
  logger: RetryPendingLogger;
};

/**
 * Pure handler — extraído do Inngest wrapper pra ser chamado também do
 * endpoint `/api/worker/tick` (n8n cron). Inngest invocation continua
 * valida enquanto o worker estiver registrado.
 */
export async function retryPendingDownloadsHandler(
  ctx: RetryPendingHandlerCtx,
): Promise<RetryPendingResult> {
  const { step, logger } = ctx;

  const stale = await step.run("find-stale-pending", async (): Promise<StaleRow[]> => {
    const now = Date.now();
    const staleBefore = new Date(now - STALE_AFTER_MS).toISOString();
    const lookbackAfter = new Date(now - LOOKBACK_MS).toISOString();

    const admin = createAdminClient();
    const { data, error } = await admin
      .from("messages")
      .select("id, tenant_id, media_url, media_mime_type, type")
      .eq("media_download_status", "pending")
      .lt("created_at", staleBefore)
      .gt("created_at", lookbackAfter)
      .limit(BATCH_SIZE);

    if (error) {
      throw new Error(`retry-pending find failed: ${error.message}`);
    }

    return (data ?? []) as StaleRow[];
  });

  let succeeded = 0;
  let failed = 0;

  for (const row of stale) {
    // Skip rows with no URL — nothing we can do. Mark-as-failed will get
    // picked up by a future cleanup; the download function itself handles
    // empty-url as "skipped" without mutating state so we don't loop.
    if (!row.media_url) {
      failed += 1;
      continue;
    }

    const result = await step.run(`retry-${row.id}`, async () => {
      return downloadAndStore(row.tenant_id, row.id, row.media_url!, {
        hintedMime: row.media_mime_type ?? undefined,
      });
    });

    if (result.status === "downloaded") {
      succeeded += 1;
      // Re-emit `message.captured` so the audio/image workers fire. For
      // text/other we still skip — transcription is only for media types,
      // but `persist.ts` would have emitted this regardless so we match.
      await step.run(`emit-captured-${row.id}`, async () => {
        await inngest.send(
          messageCaptured.create({
            messageId: row.id,
            tenantId: row.tenant_id,
            type: row.type,
          }),
        );
      });
    } else {
      failed += 1;
    }
  }

  const counts: RetryPendingResult = {
    found: stale.length,
    retried: stale.length,
    succeeded,
    failed,
  };
  logger.info("[retry-pending-downloads] done", counts);
  return counts;
}

export const retryPendingDownloads = inngest.createFunction(
  {
    id: "retry-pending-downloads",
    name: "Retry pending media downloads",
    triggers: [{ cron: "*/5 * * * *" }],
  },
  async ({ step, logger }) => {
    return retryPendingDownloadsHandler({
      step: step as RetryPendingHandlerCtx["step"],
      logger: logger as RetryPendingLogger,
    });
  },
);
