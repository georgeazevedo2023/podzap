/**
 * Unit tests for lib/ai-tracking/service.ts
 *
 * Strategy: swap `@/lib/supabase/admin` with a hand-rolled chainable
 * fake. We only implement the subset of PostgREST the service touches:
 *   - `.from(table).insert(row).select("id").maybeSingle()`
 *   - `.from(table).select("cols").eq().gte().lt()` (thenable)
 *
 * Each test wires the fake's behaviour per-call via a per-run stub
 * controller so we can simulate insert-returning-row, insert-returning-
 * error, and select-returning-rows without fighting a full in-memory
 * Postgres.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

// ──────────────────────────────────────────────────────────────────────────
//  Mock controller
// ──────────────────────────────────────────────────────────────────────────

type InsertedRow = {
  table: string;
  row: Record<string, unknown>;
};

type SelectCall = {
  table: string;
  columns: string;
  filters: Record<string, unknown>;
  gte: Record<string, string>;
  lt: Record<string, string>;
};

/** Values we flip per test to drive the mock. */
const state: {
  inserts: InsertedRow[];
  insertResult: { id: string } | null;
  insertError: { message: string } | null;
  throwOnClient: Error | null;
  selectResult: Array<Record<string, unknown>>;
  selectError: { message: string } | null;
  selectCalls: SelectCall[];
} = {
  inserts: [],
  insertResult: { id: "fixed-uuid" },
  insertError: null,
  throwOnClient: null,
  selectResult: [],
  selectError: null,
  selectCalls: [],
};

function resetState() {
  state.inserts = [];
  state.insertResult = { id: "fixed-uuid" };
  state.insertError = null;
  state.throwOnClient = null;
  state.selectResult = [];
  state.selectError = null;
  state.selectCalls = [];
}

// Build the fake chainable builder. Each `.from()` returns a fresh object
// so state between tests / chains doesn't bleed.
function makeBuilder(table: string) {
  // Intent: separate builders for insert vs select so we can keep the
  // types/assertions narrow within each branch.
  let mode: "insert" | "select" | null = null;
  let insertRow: Record<string, unknown> | null = null;
  let selectColumns = "*";
  const filters: Record<string, unknown> = {};
  const gte: Record<string, string> = {};
  const lt: Record<string, string> = {};
  let selectAfterInsert = false;

  const api: Record<string, (...args: unknown[]) => unknown> = {};

  api.insert = (row: unknown) => {
    mode = "insert";
    insertRow = row as Record<string, unknown>;
    return api;
  };
  api.select = (cols?: unknown) => {
    if (mode === "insert") {
      selectAfterInsert = true;
    } else {
      mode = "select";
      selectColumns = (cols as string) ?? "*";
    }
    return api;
  };
  api.eq = (col: unknown, val: unknown) => {
    filters[col as string] = val;
    return api;
  };
  api.gte = (col: unknown, val: unknown) => {
    gte[col as string] = val as string;
    return api;
  };
  api.lt = (col: unknown, val: unknown) => {
    lt[col as string] = val as string;
    return api;
  };

  api.maybeSingle = async () => {
    if (mode === "insert") {
      if (state.insertError) {
        return { data: null, error: state.insertError };
      }
      state.inserts.push({ table, row: insertRow ?? {} });
      const data = selectAfterInsert ? state.insertResult : null;
      return { data, error: null };
    }
    throw new Error("maybeSingle called on non-insert path");
  };

  // Thenable — awaiting the chain runs the select query.
  (api as unknown as { then: PromiseLike<unknown>["then"] }).then = function (
    onfulfilled,
    onrejected,
  ) {
    if (mode === "select") {
      state.selectCalls.push({
        table,
        columns: selectColumns,
        filters: { ...filters },
        gte: { ...gte },
        lt: { ...lt },
      });
      if (state.selectError) {
        return Promise.resolve({
          data: null,
          error: state.selectError,
        }).then(onfulfilled as never, onrejected as never);
      }
      return Promise.resolve({
        data: state.selectResult,
        error: null,
      }).then(onfulfilled as never, onrejected as never);
    }
    // Unexpected await on insert path without maybeSingle — just resolve.
    return Promise.resolve({ data: null, error: null }).then(
      onfulfilled as never,
      onrejected as never,
    );
  };

  return api;
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    if (state.throwOnClient) {
      // Simulate env-missing / init failure at client construction time.
      throw state.throwOnClient;
    }
    return {
      from: (table: string) => makeBuilder(table),
    };
  },
}));

let service: typeof import("../lib/ai-tracking/service");

beforeEach(async () => {
  resetState();
  service = await import("../lib/ai-tracking/service");
  // Silence expected error logs from the best-effort path.
  vi.spyOn(console, "error").mockImplementation(() => {});
});

// ──────────────────────────────────────────────────────────────────────────
//  Tests
// ──────────────────────────────────────────────────────────────────────────

const TENANT_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

describe("trackAiCall", () => {
  it("persists every field when all inputs are provided", async () => {
    const newId = randomUUID();
    state.insertResult = { id: newId };

    const messageId = randomUUID();
    const summaryId = randomUUID();

    const res = await service.trackAiCall({
      tenantId: TENANT_A,
      provider: "gemini",
      model: "gemini-2.5-pro",
      operation: "summarize",
      tokensIn: 12000,
      tokensOut: 800,
      costCents: 47,
      durationMs: 3421,
      messageId,
      summaryId,
      error: "rate limited",
    });

    expect(res).toEqual({ id: newId });
    expect(state.inserts).toHaveLength(1);
    expect(state.inserts[0].table).toBe("ai_calls");
    expect(state.inserts[0].row).toEqual({
      tenant_id: TENANT_A,
      provider: "gemini",
      model: "gemini-2.5-pro",
      operation: "summarize",
      tokens_in: 12000,
      tokens_out: 800,
      cost_cents: 47,
      duration_ms: 3421,
      message_id: messageId,
      summary_id: summaryId,
      error: "rate limited",
    });
  });

  it("applies defaults for optional numeric/id fields (minimal inputs)", async () => {
    const res = await service.trackAiCall({
      tenantId: TENANT_A,
      provider: "groq",
      model: "whisper-large-v3",
      operation: "transcribe",
    });

    expect(res).toEqual({ id: "fixed-uuid" });
    expect(state.inserts[0].row).toEqual({
      tenant_id: TENANT_A,
      provider: "groq",
      model: "whisper-large-v3",
      operation: "transcribe",
      tokens_in: 0,
      tokens_out: 0,
      cost_cents: 0,
      duration_ms: null,
      message_id: null,
      summary_id: null,
      error: null,
    });
  });

  it("returns null (never throws) when the DB insert errors", async () => {
    state.insertError = { message: "unique violation" };

    const res = await service.trackAiCall({
      tenantId: TENANT_A,
      provider: "openai",
      model: "tts-1",
      operation: "tts",
    });

    expect(res).toBeNull();
    // The insert was still attempted.
    expect(state.inserts).toHaveLength(0);
  });

  it("returns null (never throws) when createAdminClient itself throws", async () => {
    state.throwOnClient = new Error("ENV_MISSING");

    const res = await service.trackAiCall({
      tenantId: TENANT_A,
      provider: "gemini",
      model: "gemini-2.5-pro",
      operation: "summarize",
    });

    expect(res).toBeNull();
  });
});

describe("getAiUsageForTenant", () => {
  it("aggregates totals and groups by provider across the window", async () => {
    state.selectResult = [
      { provider: "gemini", cost_cents: 100 },
      { provider: "gemini", cost_cents: 50 },
      { provider: "groq", cost_cents: 7 },
      { provider: "openai", cost_cents: 200 },
      { provider: "openai", cost_cents: 0 },
      // Unknown provider (schema drift): counted in total but not grouped.
      { provider: "cohere", cost_cents: 999 },
    ];

    const start = new Date("2026-04-01T00:00:00Z");
    const end = new Date("2026-05-01T00:00:00Z");

    const report = await service.getAiUsageForTenant(TENANT_A, start, end);

    expect(report.totalCalls).toBe(6);
    expect(report.totalCostCents).toBe(100 + 50 + 7 + 200 + 0 + 999);
    expect(report.byProvider).toEqual({
      gemini: { calls: 2, costCents: 150 },
      groq: { calls: 1, costCents: 7 },
      openai: { calls: 2, costCents: 200 },
    });

    // And it applied the right filter/range to the underlying query.
    expect(state.selectCalls).toHaveLength(1);
    const call = state.selectCalls[0];
    expect(call.table).toBe("ai_calls");
    expect(call.filters).toEqual({ tenant_id: TENANT_A });
    expect(call.gte).toEqual({ created_at: start.toISOString() });
    expect(call.lt).toEqual({ created_at: end.toISOString() });
  });

  it("returns zeroed report when no rows match", async () => {
    state.selectResult = [];

    const report = await service.getAiUsageForTenant(
      TENANT_A,
      new Date("2026-04-01T00:00:00Z"),
      new Date("2026-04-02T00:00:00Z"),
    );

    expect(report.totalCalls).toBe(0);
    expect(report.totalCostCents).toBe(0);
    expect(report.byProvider).toEqual({
      gemini: { calls: 0, costCents: 0 },
      groq: { calls: 0, costCents: 0 },
      openai: { calls: 0, costCents: 0 },
    });
  });

  it("throws on DB error (admin/dashboard path wants a loud failure)", async () => {
    state.selectError = { message: "connection refused" };

    await expect(
      service.getAiUsageForTenant(
        TENANT_A,
        new Date("2026-04-01T00:00:00Z"),
        new Date("2026-05-01T00:00:00Z"),
      ),
    ).rejects.toThrow(/connection refused/);
  });
});
