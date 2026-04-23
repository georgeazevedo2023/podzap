/**
 * Unit tests for `lib/summary/generator.ts` and the thin Inngest wrapper
 * at `inngest/functions/generate-summary.ts`.
 *
 * Strategy: every collaborator is mocked at module boundary so we exercise
 * pure orchestration (what gets called, in what order, with what args).
 *
 *   - `buildNormalizedConversation` — stubbed to return a canned conv or
 *     an empty one.
 *   - `buildSummaryPrompt` — stubbed with a pass-through; we only care that
 *     its output reaches Gemini.
 *   - `generateSummaryFromPrompt` — stubbed; success path returns a fake
 *     `SummaryResult`; failure paths throw.
 *   - `createAdminClient` — hand-rolled chainable fake that records the
 *     insert row and returns a queued `{ id, created_at }` / error.
 *   - `trackAiCall` — spy; we verify it fires on success AND on errors.
 *
 * No network, no DB, no AI.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// ──────────────────────────────────────────────────────────────────────
// Module mocks — MUST be declared before SUT import (vi.mock hoists).
// ──────────────────────────────────────────────────────────────────────

const normalizeMock = vi.fn();
vi.mock("@/lib/pipeline/normalize", () => ({
  buildNormalizedConversation: (...args: unknown[]) => normalizeMock(...args),
}));

const buildPromptMock = vi.fn();
vi.mock("@/lib/summary/prompt", () => ({
  buildSummaryPrompt: (...args: unknown[]) => buildPromptMock(...args),
}));

const geminiMock = vi.fn();
vi.mock("@/lib/ai/gemini-llm", () => ({
  generateSummaryFromPrompt: (...args: unknown[]) => geminiMock(...args),
}));

const trackAiCallMock = vi.fn();
vi.mock("@/lib/ai-tracking/service", () => ({
  trackAiCall: (...args: unknown[]) => trackAiCallMock(...args),
}));

// Admin client fake. We only need `.from("summaries").insert(row)
// .select("id, created_at").maybeSingle()` for the generator.
type InsertResult = {
  data: { id: string; created_at: string } | null;
  error: { message: string } | null;
};

const adminState: {
  insertResult: InsertResult;
  lastInsertRow: Record<string, unknown> | null;
  lastInsertTable: string | null;
} = {
  insertResult: {
    data: { id: "summary-id-1", created_at: "2026-04-22T10:00:00.000Z" },
    error: null,
  },
  lastInsertRow: null,
  lastInsertTable: null,
};

function makeAdminClient() {
  return {
    from: (table: string) => ({
      insert: (row: Record<string, unknown>) => {
        adminState.lastInsertTable = table;
        adminState.lastInsertRow = row;
        return {
          select: () => ({
            maybeSingle: async () => adminState.insertResult,
          }),
        };
      },
    }),
  };
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => makeAdminClient(),
}));

// ──────────────────────────────────────────────────────────────────────
// SUT import — after vi.mock calls.
// ──────────────────────────────────────────────────────────────────────

import {
  generateSummary,
  SummaryError,
} from "@/lib/summary/generator";
import {
  generateSummaryHandler,
  type GenerateSummaryHandlerCtx,
} from "@/inngest/functions/generate-summary";

// ──────────────────────────────────────────────────────────────────────
// Test fixtures
// ──────────────────────────────────────────────────────────────────────

const TENANT_ID = "11111111-1111-1111-1111-111111111111";
const GROUP_ID = "22222222-2222-2222-2222-222222222222";
const PERIOD_START = new Date("2026-04-21T00:00:00.000Z");
const PERIOD_END = new Date("2026-04-22T00:00:00.000Z");

function makeNonEmptyConv() {
  return {
    tenantId: TENANT_ID,
    groupId: GROUP_ID,
    groupName: "Dev Group",
    periodStart: PERIOD_START,
    periodEnd: PERIOD_END,
    topics: [
      {
        id: "t1",
        startAt: PERIOD_START,
        endAt: PERIOD_END,
        messages: [
          {
            id: "m1",
            senderName: "Ana",
            at: PERIOD_START,
            type: "text" as const,
            content: "vamos?",
            weight: 0.5,
            hasMedia: false,
          },
        ],
        participants: ["Ana"],
        dominantKeywords: ["ideia"],
      },
    ],
    discarded: 0,
    total: 1,
  };
}

function makeEmptyConv() {
  return {
    tenantId: TENANT_ID,
    groupId: GROUP_ID,
    groupName: "",
    periodStart: PERIOD_START,
    periodEnd: PERIOD_END,
    topics: [],
    discarded: 0,
    total: 0,
  };
}

const BUILT_PROMPT = {
  systemPrompt: "SYS",
  userPrompt: "USER",
  promptVersion: "podzap-summary/v1-fun",
  estimatedTokens: 123,
};

const GEMINI_RESULT = {
  text: "Hoje no grupo, Ana perguntou sobre a ideia.",
  topics: ["ideia"],
  model: "gemini-2.5-pro",
  // Wrapper echoes the version we passed; generator overrides on insert.
  promptVersion: "podzap-summary/v1-fun",
};

beforeEach(() => {
  normalizeMock.mockReset();
  buildPromptMock.mockReset();
  geminiMock.mockReset();
  trackAiCallMock.mockReset();
  trackAiCallMock.mockResolvedValue({ id: "ai-call-id-1" });

  adminState.insertResult = {
    data: { id: "summary-id-1", created_at: "2026-04-22T10:00:00.000Z" },
    error: null,
  };
  adminState.lastInsertRow = null;
  adminState.lastInsertTable = null;
});

// ──────────────────────────────────────────────────────────────────────
// generateSummary — empty conversation
// ──────────────────────────────────────────────────────────────────────

describe("generateSummary — empty conversation", () => {
  it("throws SummaryError(EMPTY_CONVERSATION) when topics are empty", async () => {
    normalizeMock.mockResolvedValueOnce(makeEmptyConv());

    let thrown: unknown;
    try {
      await generateSummary({
        tenantId: TENANT_ID,
        groupId: GROUP_ID,
        periodStart: PERIOD_START,
        periodEnd: PERIOD_END,
      });
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(SummaryError);
    expect((thrown as SummaryError).code).toBe("EMPTY_CONVERSATION");

    // Nothing downstream should have fired.
    expect(buildPromptMock).not.toHaveBeenCalled();
    expect(geminiMock).not.toHaveBeenCalled();
    expect(trackAiCallMock).not.toHaveBeenCalled();
    expect(adminState.lastInsertRow).toBeNull();
  });
});

// ──────────────────────────────────────────────────────────────────────
// generateSummary — happy path
// ──────────────────────────────────────────────────────────────────────

describe("generateSummary — happy path", () => {
  it("normalizes → prompts → calls gemini → inserts → tracks", async () => {
    normalizeMock.mockResolvedValueOnce(makeNonEmptyConv());
    buildPromptMock.mockReturnValueOnce(BUILT_PROMPT);
    geminiMock.mockResolvedValueOnce(GEMINI_RESULT);

    const record = await generateSummary({
      tenantId: TENANT_ID,
      groupId: GROUP_ID,
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
      tone: "fun",
    });

    // Normalization called with right args.
    expect(normalizeMock).toHaveBeenCalledWith(
      TENANT_ID,
      GROUP_ID,
      PERIOD_START,
      PERIOD_END,
    );

    // Prompt builder got (conv, 'fun').
    expect(buildPromptMock).toHaveBeenCalledTimes(1);
    const [convArg, toneArg] = buildPromptMock.mock.calls[0];
    expect(toneArg).toBe("fun");
    expect((convArg as { topics: unknown[] }).topics.length).toBe(1);

    // Gemini got the prompt bundle.
    expect(geminiMock).toHaveBeenCalledWith({
      systemPrompt: "SYS",
      userPrompt: "USER",
      promptVersion: "podzap-summary/v1-fun",
    });

    // DB insert shape.
    expect(adminState.lastInsertTable).toBe("summaries");
    expect(adminState.lastInsertRow).toMatchObject({
      tenant_id: TENANT_ID,
      group_id: GROUP_ID,
      period_start: PERIOD_START.toISOString(),
      period_end: PERIOD_END.toISOString(),
      text: GEMINI_RESULT.text,
      tone: "fun",
      status: "pending_review",
      model: "gemini-2.5-pro",
      prompt_version: "podzap-summary/v1-fun",
    });

    // trackAiCall fired with summaryId + durationMs.
    expect(trackAiCallMock).toHaveBeenCalledTimes(1);
    const trackInput = trackAiCallMock.mock.calls[0][0] as {
      tenantId: string;
      provider: string;
      operation: string;
      model: string;
      summaryId?: string;
      durationMs?: number;
      error?: string;
    };
    expect(trackInput.tenantId).toBe(TENANT_ID);
    expect(trackInput.provider).toBe("gemini");
    expect(trackInput.operation).toBe("summarize");
    expect(trackInput.model).toBe("gemini-2.5-pro");
    expect(trackInput.summaryId).toBe("summary-id-1");
    expect(typeof trackInput.durationMs).toBe("number");
    expect(trackInput.error).toBeUndefined();

    // Returned record.
    expect(record).toEqual({
      id: "summary-id-1",
      tenantId: TENANT_ID,
      groupId: GROUP_ID,
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
      text: GEMINI_RESULT.text,
      tone: "fun",
      status: "pending_review",
      model: "gemini-2.5-pro",
      promptVersion: "podzap-summary/v1-fun",
      createdAt: new Date("2026-04-22T10:00:00.000Z"),
    });
  });

  it("defaults tone to 'fun' when not provided", async () => {
    normalizeMock.mockResolvedValueOnce(makeNonEmptyConv());
    buildPromptMock.mockReturnValueOnce(BUILT_PROMPT);
    geminiMock.mockResolvedValueOnce(GEMINI_RESULT);

    await generateSummary({
      tenantId: TENANT_ID,
      groupId: GROUP_ID,
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
    });

    expect(buildPromptMock.mock.calls[0][1]).toBe("fun");
    expect(adminState.lastInsertRow?.tone).toBe("fun");
  });
});

// ──────────────────────────────────────────────────────────────────────
// generateSummary — AI error
// ──────────────────────────────────────────────────────────────────────

describe("generateSummary — AI error", () => {
  it("throws SummaryError(AI_ERROR) and tracks the failure", async () => {
    normalizeMock.mockResolvedValueOnce(makeNonEmptyConv());
    buildPromptMock.mockReturnValueOnce(BUILT_PROMPT);
    geminiMock.mockRejectedValueOnce(new Error("gemini 503: overloaded"));

    let thrown: unknown;
    try {
      await generateSummary({
        tenantId: TENANT_ID,
        groupId: GROUP_ID,
        periodStart: PERIOD_START,
        periodEnd: PERIOD_END,
      });
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(SummaryError);
    expect((thrown as SummaryError).code).toBe("AI_ERROR");
    expect((thrown as SummaryError).message).toMatch(/gemini 503/);

    // No insert happened.
    expect(adminState.lastInsertRow).toBeNull();

    // trackAiCall fired with an error message but no summaryId.
    expect(trackAiCallMock).toHaveBeenCalledTimes(1);
    const trackInput = trackAiCallMock.mock.calls[0][0] as {
      error?: string;
      summaryId?: string;
      operation: string;
      provider: string;
    };
    expect(trackInput.provider).toBe("gemini");
    expect(trackInput.operation).toBe("summarize");
    expect(trackInput.error).toMatch(/gemini 503/);
    expect(trackInput.summaryId).toBeUndefined();
  });
});

// ──────────────────────────────────────────────────────────────────────
// generateSummary — DB error
// ──────────────────────────────────────────────────────────────────────

describe("generateSummary — DB error", () => {
  it("throws SummaryError(DB_ERROR) and tracks the AI call with the db error", async () => {
    normalizeMock.mockResolvedValueOnce(makeNonEmptyConv());
    buildPromptMock.mockReturnValueOnce(BUILT_PROMPT);
    geminiMock.mockResolvedValueOnce(GEMINI_RESULT);
    adminState.insertResult = {
      data: null,
      error: { message: "permission denied for table summaries" },
    };

    let thrown: unknown;
    try {
      await generateSummary({
        tenantId: TENANT_ID,
        groupId: GROUP_ID,
        periodStart: PERIOD_START,
        periodEnd: PERIOD_END,
      });
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(SummaryError);
    expect((thrown as SummaryError).code).toBe("DB_ERROR");
    expect((thrown as SummaryError).message).toMatch(/permission denied/);

    // AI call still tracked (we paid for the Gemini call even though
    // persist failed).
    expect(trackAiCallMock).toHaveBeenCalledTimes(1);
    const trackInput = trackAiCallMock.mock.calls[0][0] as {
      error?: string;
      summaryId?: string;
    };
    expect(trackInput.error).toMatch(/db_insert_failed/);
    expect(trackInput.error).toMatch(/permission denied/);
    expect(trackInput.summaryId).toBeUndefined();
  });
});

// ──────────────────────────────────────────────────────────────────────
// Inngest handler
// ──────────────────────────────────────────────────────────────────────

function makeInngestCtx(data: {
  tenantId: string;
  groupId: string;
  periodStart: string;
  periodEnd: string;
  tone?: "formal" | "fun" | "corporate";
}): GenerateSummaryHandlerCtx & { stepNames: string[] } {
  const stepNames: string[] = [];
  return {
    event: { data },
    step: {
      async run<T>(name: string, fn: () => Promise<T> | T): Promise<T> {
        stepNames.push(name);
        return await fn();
      },
    },
    logger: {
      info: () => {},
      warn: () => {},
      error: () => {},
    },
    stepNames,
  };
}

describe("generateSummaryHandler — Inngest integration", () => {
  it("rehydrates ISO strings to Date and returns { summaryId }", async () => {
    normalizeMock.mockResolvedValueOnce(makeNonEmptyConv());
    buildPromptMock.mockReturnValueOnce(BUILT_PROMPT);
    geminiMock.mockResolvedValueOnce(GEMINI_RESULT);

    const ctx = makeInngestCtx({
      tenantId: TENANT_ID,
      groupId: GROUP_ID,
      periodStart: PERIOD_START.toISOString(),
      periodEnd: PERIOD_END.toISOString(),
      tone: "corporate",
    });

    const result = await generateSummaryHandler(ctx);

    expect(result).toEqual({ summaryId: "summary-id-1" });
    expect(ctx.stepNames).toEqual(["generate"]);

    // Orchestrator received Date objects, not strings.
    const [, , startArg, endArg] = normalizeMock.mock.calls[0];
    expect(startArg).toBeInstanceOf(Date);
    expect(endArg).toBeInstanceOf(Date);
    expect((startArg as Date).toISOString()).toBe(PERIOD_START.toISOString());

    // Tone forwarded.
    expect(buildPromptMock.mock.calls[0][1]).toBe("corporate");
  });

  it("throws synchronously on malformed period strings", async () => {
    const ctx = makeInngestCtx({
      tenantId: TENANT_ID,
      groupId: GROUP_ID,
      periodStart: "not-a-date",
      periodEnd: PERIOD_END.toISOString(),
    });

    await expect(generateSummaryHandler(ctx)).rejects.toThrow(
      /invalid periodStart\/periodEnd/,
    );
    // Never reached the step runner.
    expect(ctx.stepNames).toEqual([]);
    expect(normalizeMock).not.toHaveBeenCalled();
  });
});
