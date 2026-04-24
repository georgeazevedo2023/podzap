/**
 * `run-schedules` — Fase 11 cron worker.
 *
 * Trigger: `*\/5 * * * *` (every 5 minutes). On each tick we ask
 * `dueSchedulesNow` for every active schedule whose `time_of_day` falls
 * in the last 5-minute window (America/Sao_Paulo), then for each due
 * schedule we:
 *
 *   1. Compute the period: `periodEnd = now`,
 *      `periodStart = now - 24h` (daily) or `now - 7d` (weekly).
 *   2. Dedup-check — skip if a `summaries` row already exists for the
 *      group overlapping this window (any status — pending/approved/
 *      rejected). This defends against the inevitable edge case where
 *      two 5-minute ticks land on the same schedule (cron skew, manual
 *      invocation from the Inngest dashboard, etc).
 *   3. Emit `summary.requested` with the schedule's `tone`. The
 *      generated summary always lands in `pending_review` — delivery
 *      to the WhatsApp group requires an explicit human approve on
 *      `/approval/[id]`, regardless of the schedule's `approval_mode`.
 *
 * Returns `{ due, enqueued, skipped }` counters so the dashboard shows
 * a clear signal of what each tick did.
 *
 * Why the dedup uses `period_start` / `period_end` overlap rather than
 * a strict equality: even with careful windowing, clock drift between
 * the cron fire and `new Date()` evaluation means two ticks may compute
 * slightly different period bounds. Range-overlap is the safe check.
 */

import { inngest } from "../client";
import { summaryRequested } from "../events";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  dueSchedulesNow,
  type ScheduleView,
} from "@/lib/schedules/service";

/** How far back we pull messages for daily schedules. */
const DAILY_WINDOW_MS = 24 * 60 * 60 * 1000;
/** How far back we pull messages for weekly schedules. */
const WEEKLY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export type RunSchedulesResult = {
  due: number;
  enqueued: number;
  skipped: number;
};

/**
 * Logger contract — same minimal shape as the other workers so we can
 * wire in `console`-ish fakes from unit tests.
 */
export type RunSchedulesLogger = {
  info: (msg: string, meta?: Record<string, unknown>) => void;
  warn: (msg: string, meta?: Record<string, unknown>) => void;
  error: (msg: string, meta?: Record<string, unknown>) => void;
};

export type RunSchedulesHandlerCtx = {
  step: {
    run<T>(name: string, fn: () => Promise<T> | T): Promise<T>;
  };
  logger: RunSchedulesLogger;
  /** Injectable clock so tests can pin "now" deterministically. */
  now?: () => Date;
};

function periodStartFor(
  schedule: ScheduleView,
  now: Date,
): { start: Date; end: Date } {
  const end = now;
  const windowMs =
    schedule.frequency === "weekly" ? WEEKLY_WINDOW_MS : DAILY_WINDOW_MS;
  const start = new Date(now.getTime() - windowMs);
  return { start, end };
}

/**
 * Does a summary already exist for this group with a period that
 * overlaps the requested window? Any non-empty overlap is enough to
 * skip — we don't want two summaries for the same 24h bucket just
 * because the cron happened to tick twice.
 */
async function summaryExistsForWindow(
  tenantId: string,
  groupId: string,
  periodStart: Date,
  periodEnd: Date,
): Promise<boolean> {
  const admin = createAdminClient();
  // overlap iff (A.start <= B.end AND A.end >= B.start). In PostgREST terms:
  //   period_start <= periodEnd AND period_end >= periodStart
  const { data, error } = await admin
    .from("summaries")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("group_id", groupId)
    .lte("period_start", periodEnd.toISOString())
    .gte("period_end", periodStart.toISOString())
    .limit(1);
  if (error) {
    throw new Error(`dedup check failed: ${error.message}`);
  }
  return (data ?? []).length > 0;
}

/**
 * Pure handler — exported for unit tests. The Inngest-wrapped function
 * below just adapts types.
 */
export async function runSchedulesHandler(
  ctx: RunSchedulesHandlerCtx,
): Promise<RunSchedulesResult> {
  const { step, logger } = ctx;
  const now = ctx.now ? ctx.now() : new Date();

  const due = await step.run("find-due", () => dueSchedulesNow(now, 5));

  let enqueued = 0;
  let skipped = 0;

  for (const schedule of due) {
    const { start, end } = periodStartFor(schedule, now);

    const alreadyExists = await step.run(`dedup-check-${schedule.id}`, () =>
      summaryExistsForWindow(
        schedule.tenantId,
        schedule.groupId,
        start,
        end,
      ),
    );

    if (alreadyExists) {
      skipped += 1;
      logger.info("[run-schedules] skipping — summary exists", {
        scheduleId: schedule.id,
        groupId: schedule.groupId,
      });
      continue;
    }

    await step.run(`enqueue-${schedule.id}`, async () => {
      await inngest.send(
        summaryRequested.create({
          tenantId: schedule.tenantId,
          groupId: schedule.groupId,
          periodStart: start.toISOString(),
          periodEnd: end.toISOString(),
          tone: schedule.tone,
        }),
      );
    });
    enqueued += 1;
  }

  const counts: RunSchedulesResult = { due: due.length, enqueued, skipped };
  logger.info("[run-schedules] done", counts);
  return counts;
}

/**
 * Inngest-wrapped cron worker. `retries: 1` because the handler is
 * idempotent (dedup-check) but we still don't want to spam the dashboard
 * with noisy retries on a transient DB blip.
 */
export const runSchedulesFunction = inngest.createFunction(
  {
    id: "run-schedules",
    name: "Run due schedules and emit summary.requested",
    triggers: [{ cron: "*/5 * * * *" }],
    retries: 1,
  },
  async ({ step, logger }) => {
    return runSchedulesHandler({
      step: step as RunSchedulesHandlerCtx["step"],
      logger: logger as RunSchedulesLogger,
    });
  },
);
