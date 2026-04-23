/**
 * Unit tests for inngest/functions/run-schedules.ts — the Fase 11 cron
 * worker. We invoke the pure `runSchedulesHandler` directly (bypassing
 * the Inngest wrapper) with a fake `step`, a stubbed `dueSchedulesNow`,
 * and a mocked supabase for the dedup-check.
 *
 * Coverage:
 *   - enqueues a `summary.requested` event for each due schedule
 *   - sets `autoApprove: true` when approval_mode === 'auto'
 *   - skips when a summary for that window already exists
 *   - returns accurate `{ due, enqueued, skipped }` counters
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ScheduleView } from "@/lib/schedules/service";

// ──────────────────────────────────────────────────────────────────────────
//  Mocks — installed before importing the worker module
// ──────────────────────────────────────────────────────────────────────────

type SummaryRow = {
  id: string;
  tenant_id: string;
  group_id: string;
  period_start: string;
  period_end: string;
};

const existingSummaries: SummaryRow[] = [];

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (_table: string) => {
      const filters: Array<{ kind: string; col: string; val: string }> = [];
      let limit: number | null = null;
      const api: Record<string, (...args: unknown[]) => unknown> = {};
      api.select = () => api;
      api.eq = (col: unknown, val: unknown) => {
        filters.push({ kind: "eq", col: col as string, val: val as string });
        return api;
      };
      api.lte = (col: unknown, val: unknown) => {
        filters.push({ kind: "lte", col: col as string, val: val as string });
        return api;
      };
      api.gte = (col: unknown, val: unknown) => {
        filters.push({ kind: "gte", col: col as string, val: val as string });
        return api;
      };
      api.limit = (n: unknown) => {
        limit = n as number;
        return api;
      };
      (
        api as unknown as { then: PromiseLike<unknown>["then"] }
      ).then = function (onfulfilled, onrejected) {
        const rows = existingSummaries.filter((r) => {
          for (const f of filters) {
            const v = (r as unknown as Record<string, string>)[f.col];
            if (f.kind === "eq" && v !== f.val) return false;
            if (f.kind === "lte" && !(v <= f.val)) return false;
            if (f.kind === "gte" && !(v >= f.val)) return false;
          }
          return true;
        });
        const data = limit ? rows.slice(0, limit) : rows;
        return Promise.resolve({ data, error: null }).then(
          onfulfilled as never,
          onrejected as never,
        );
      };
      return api;
    },
  }),
}));

// Stub out dueSchedulesNow directly so tests don't have to seed a fake
// schedules table — we already cover that service elsewhere.
const dueFixture: ScheduleView[] = [];
vi.mock("@/lib/schedules/service", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/schedules/service")
  >("@/lib/schedules/service");
  return {
    ...actual,
    dueSchedulesNow: vi.fn(async () => dueFixture),
  };
});

// Capture inngest.send calls.
type SendArg = {
  name: string;
  data: Record<string, unknown>;
};
const sendCalls: SendArg[] = [];
vi.mock("../inngest/client", () => ({
  inngest: {
    send: vi.fn(async (payload: SendArg | SendArg[]) => {
      if (Array.isArray(payload)) sendCalls.push(...payload);
      else sendCalls.push(payload);
    }),
    createFunction: vi.fn((_cfg: unknown, handler: unknown) => ({
      fn: handler,
    })),
  },
}));

// ──────────────────────────────────────────────────────────────────────────
//  Import subject under test AFTER the mocks
// ──────────────────────────────────────────────────────────────────────────

import { runSchedulesHandler } from "../inngest/functions/run-schedules";

// ──────────────────────────────────────────────────────────────────────────
//  Helpers
// ──────────────────────────────────────────────────────────────────────────

const step = {
  run: async <T>(_id: string, fn: () => Promise<T> | T): Promise<T> => fn(),
};

const logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

function mkSchedule(partial: Partial<ScheduleView> = {}): ScheduleView {
  return {
    id: "sched-1",
    tenantId: "tenant-a",
    groupId: "group-a",
    frequency: "daily",
    timeOfDay: "18:00:00",
    dayOfWeek: null,
    triggerType: "fixed_time",
    approvalMode: "required",
    voice: null,
    tone: "fun",
    isActive: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...partial,
  };
}

beforeEach(() => {
  dueFixture.length = 0;
  existingSummaries.length = 0;
  sendCalls.length = 0;
});

// ──────────────────────────────────────────────────────────────────────────
//  Cases
// ──────────────────────────────────────────────────────────────────────────

describe("runSchedulesHandler", () => {
  it("enqueues summary.requested for each due schedule", async () => {
    dueFixture.push(
      mkSchedule({ id: "s1", groupId: "g1", approvalMode: "required" }),
      mkSchedule({ id: "s2", groupId: "g2", approvalMode: "auto" }),
    );

    const result = await runSchedulesHandler({
      step,
      logger,
      now: () => new Date("2026-04-22T21:05:00.000Z"),
    });

    expect(result).toEqual({ due: 2, enqueued: 2, skipped: 0 });
    expect(sendCalls).toHaveLength(2);
    const s1 = sendCalls.find(
      (c) => (c.data as { groupId: string }).groupId === "g1",
    );
    const s2 = sendCalls.find(
      (c) => (c.data as { groupId: string }).groupId === "g2",
    );
    expect(s1!.name).toBe("summary.requested");
    expect((s1!.data as { autoApprove?: boolean }).autoApprove).toBe(false);
    expect((s2!.data as { autoApprove?: boolean }).autoApprove).toBe(true);
  });

  it("skips schedules when a summary for the window already exists", async () => {
    dueFixture.push(mkSchedule({ id: "s1", groupId: "g1" }));
    // Seed an overlapping summary.
    existingSummaries.push({
      id: "sum-1",
      tenant_id: "tenant-a",
      group_id: "g1",
      period_start: "2026-04-21T21:00:00.000Z",
      period_end: "2026-04-22T21:00:00.000Z",
    });

    const result = await runSchedulesHandler({
      step,
      logger,
      now: () => new Date("2026-04-22T21:05:00.000Z"),
    });

    expect(result).toEqual({ due: 1, enqueued: 0, skipped: 1 });
    expect(sendCalls).toHaveLength(0);
  });

  it("uses a 7-day window for weekly schedules", async () => {
    dueFixture.push(
      mkSchedule({
        id: "s1",
        groupId: "g1",
        frequency: "weekly",
        dayOfWeek: 3,
      }),
    );

    await runSchedulesHandler({
      step,
      logger,
      now: () => new Date("2026-04-22T21:05:00.000Z"),
    });

    const sent = sendCalls[0];
    const start = new Date(
      (sent.data as { periodStart: string }).periodStart,
    );
    const end = new Date((sent.data as { periodEnd: string }).periodEnd);
    const diffMs = end.getTime() - start.getTime();
    expect(diffMs).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it("returns zeros when nothing is due", async () => {
    const result = await runSchedulesHandler({
      step,
      logger,
      now: () => new Date("2026-04-22T21:05:00.000Z"),
    });
    expect(result).toEqual({ due: 0, enqueued: 0, skipped: 0 });
  });
});
