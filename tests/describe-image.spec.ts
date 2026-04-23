/**
 * Unit tests for `inngest/functions/describe-image.ts`.
 *
 * We don't boot the Inngest runtime here — we drive `describeImageHandler`
 * directly with a fake `step.run` that executes callbacks inline. That
 * keeps these tests fast and synchronous and avoids any HTTP round-trip
 * to a dev server. The production wiring (`createFunction`) is a thin
 * adapter tested implicitly through typecheck + the route.ts registration.
 *
 * External dependencies mocked:
 *   - `@/lib/supabase/admin`    — in-memory table to simulate `messages`
 *   - `@/lib/media/signedUrl`   — deterministic URL for each call
 *   - `@/lib/ai/gemini-vision`  — returns a fixed description or throws
 *   - `@/lib/transcripts/service` — records upsert calls, supports
 *     returning an existing transcript to test the short-circuit path
 *
 * Mirror of `tests/webhooks-persist.spec.ts` conventions: `vi.mock`
 * declared BEFORE the imports that depend on them.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

// ──────────────────────────────────────────────────────────────────────────
//  In-memory state + mocks
// ──────────────────────────────────────────────────────────────────────────

type MessageFixture = {
  id: string;
  media_storage_path: string | null;
  media_download_status: string | null;
};

type TranscriptFixture = {
  id: string;
  messageId: string;
  text: string;
  language: string | null;
  confidence: number | null;
  model: string | null;
  createdAt: string;
};

const state = {
  messages: new Map<string, MessageFixture>(),
  existingTranscripts: new Map<string, TranscriptFixture>(),
  upsertCalls: [] as Array<{
    messageId: string;
    text: string;
    language?: string | null;
    confidence?: number | null;
    model: string;
  }>,
  signedUrlCalls: [] as Array<{ path: string; ttl: number }>,
  geminiCalls: [] as Array<{ url: string; prompt: string }>,
  geminiResult: {
    description: "Uma imagem contendo texto legível: 'PROMO 50% OFF'.",
    model: "gemini-2.5-flash",
  } as { description: string; model: string },
  geminiThrows: null as Error | null,
};

function reset(): void {
  state.messages.clear();
  state.existingTranscripts.clear();
  state.upsertCalls = [];
  state.signedUrlCalls = [];
  state.geminiCalls = [];
  state.geminiResult = {
    description: "Uma imagem contendo texto legível: 'PROMO 50% OFF'.",
    model: "gemini-2.5-flash",
  };
  state.geminiThrows = null;
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table !== "messages") {
        throw new Error(`Unexpected table: ${table}`);
      }
      const filters: Array<{ col: string; val: unknown }> = [];
      const api = {
        select: (_cols?: string) => api,
        eq: (col: string, val: unknown) => {
          filters.push({ col, val });
          return api;
        },
        maybeSingle: async () => {
          const idFilter = filters.find((f) => f.col === "id");
          if (!idFilter) {
            return { data: null, error: { message: "missing id filter" } };
          }
          const row = state.messages.get(idFilter.val as string);
          return { data: row ?? null, error: null };
        },
      };
      return api;
    },
  }),
}));

vi.mock("@/lib/media/signedUrl", () => ({
  getSignedUrl: vi.fn(async (path: string, ttl: number) => {
    state.signedUrlCalls.push({ path, ttl });
    return `https://signed.example/${encodeURIComponent(path)}?ttl=${ttl}`;
  }),
  SignedUrlError: class SignedUrlError extends Error {},
}));

vi.mock("@/lib/ai/gemini-vision", () => ({
  describeImage: vi.fn(async (input: { url: string }, prompt: string) => {
    state.geminiCalls.push({ url: input.url, prompt });
    if (state.geminiThrows) throw state.geminiThrows;
    return state.geminiResult;
  }),
}));

vi.mock("@/lib/transcripts/service", () => ({
  getTranscript: vi.fn(async (messageId: string) => {
    return state.existingTranscripts.get(messageId) ?? null;
  }),
  upsertTranscript: vi.fn(
    async (input: {
      messageId: string;
      text: string;
      language?: string | null;
      confidence?: number | null;
      model: string;
    }) => {
      state.upsertCalls.push(input);
      const view: TranscriptFixture = {
        id: randomUUID(),
        messageId: input.messageId,
        text: input.text,
        language: input.language ?? null,
        confidence: input.confidence ?? null,
        model: input.model,
        createdAt: new Date().toISOString(),
      };
      state.existingTranscripts.set(input.messageId, view);
      return view;
    },
  ),
}));

// ──────────────────────────────────────────────────────────────────────────
//  Imports (after mocks)
// ──────────────────────────────────────────────────────────────────────────

import {
  describeImageHandler,
  type DescribeImageHandlerArgs,
} from "@/inngest/functions/describe-image";

// ──────────────────────────────────────────────────────────────────────────
//  Test helpers
// ──────────────────────────────────────────────────────────────────────────

function makeCtx(
  overrides: Partial<DescribeImageHandlerArgs["event"]["data"]> = {},
): DescribeImageHandlerArgs {
  const data = {
    messageId: overrides.messageId ?? randomUUID(),
    tenantId: overrides.tenantId ?? randomUUID(),
    type: overrides.type ?? "image",
  };
  return {
    event: { data },
    step: {
      // Inline executor — the real Inngest runtime memoises by name;
      // for unit tests we just run the callback.
      run: async <T>(_name: string, fn: () => Promise<T> | T): Promise<T> => {
        return await fn();
      },
    },
    logger: {
      info: () => {},
      warn: () => {},
      error: () => {},
    },
  };
}

function seedMessage(overrides: Partial<MessageFixture> = {}): MessageFixture {
  // Use `in`-based defaulting (not `??`) so callers can explicitly set
  // `media_storage_path: null` to exercise the "downloaded but no path"
  // invariant-violation branch.
  const row: MessageFixture = {
    id: "id" in overrides && overrides.id ? overrides.id : randomUUID(),
    media_storage_path:
      "media_storage_path" in overrides
        ? overrides.media_storage_path ?? null
        : "tenants/t1/img.jpg",
    media_download_status:
      "media_download_status" in overrides
        ? overrides.media_download_status ?? null
        : "downloaded",
  };
  state.messages.set(row.id, row);
  return row;
}

// ──────────────────────────────────────────────────────────────────────────
//  Tests
// ──────────────────────────────────────────────────────────────────────────

beforeEach(() => {
  reset();
  vi.clearAllMocks();
});

describe("describeImageHandler — skip conditions", () => {
  it("skips non-image events (audio)", async () => {
    const ctx = makeCtx({ type: "audio" });
    const res = await describeImageHandler(ctx);
    expect(res).toMatchObject({ skipped: true });
    expect(String((res as { reason: string }).reason)).toMatch(/not image/i);
    // No side effects.
    expect(state.signedUrlCalls).toHaveLength(0);
    expect(state.geminiCalls).toHaveLength(0);
    expect(state.upsertCalls).toHaveLength(0);
  });

  it("skips non-image events (text)", async () => {
    const ctx = makeCtx({ type: "text" });
    const res = await describeImageHandler(ctx);
    expect(res).toMatchObject({ skipped: true });
    expect(state.geminiCalls).toHaveLength(0);
  });

  it("skips non-image events (video) — handled in Fase 6+, not here", async () => {
    const ctx = makeCtx({ type: "video" });
    const res = await describeImageHandler(ctx);
    expect(res).toMatchObject({ skipped: true });
    expect(state.geminiCalls).toHaveLength(0);
  });

  it("skips when message row is missing", async () => {
    const ctx = makeCtx({ type: "image" }); // nothing seeded
    const res = await describeImageHandler(ctx);
    expect(res).toMatchObject({ skipped: true });
    expect(String((res as { reason: string }).reason)).toMatch(/not found/i);
  });

  it("skips when media has not been downloaded yet", async () => {
    const msg = seedMessage({ media_download_status: "pending" });
    const ctx = makeCtx({ messageId: msg.id });
    const res = await describeImageHandler(ctx);
    expect(res).toMatchObject({
      skipped: true,
      reason: "media not downloaded yet",
    });
    expect(state.signedUrlCalls).toHaveLength(0);
    expect(state.geminiCalls).toHaveLength(0);
  });

  it("skips when storage path is missing even if status=downloaded", async () => {
    const msg = seedMessage({
      media_download_status: "downloaded",
      media_storage_path: null,
    });
    const ctx = makeCtx({ messageId: msg.id });
    const res = await describeImageHandler(ctx);
    expect(res).toMatchObject({ skipped: true });
    expect(state.geminiCalls).toHaveLength(0);
  });

  it("skips when a transcript already exists for this message", async () => {
    const msg = seedMessage();
    state.existingTranscripts.set(msg.id, {
      id: "existing-tr-id",
      messageId: msg.id,
      text: "descrição existente",
      language: "pt-BR",
      confidence: null,
      model: "gemini-2.5-flash",
      createdAt: new Date().toISOString(),
    });
    const ctx = makeCtx({ messageId: msg.id });
    const res = await describeImageHandler(ctx);
    expect(res).toMatchObject({
      skipped: true,
      reason: "transcript already exists",
      transcriptId: "existing-tr-id",
    });
    expect(state.geminiCalls).toHaveLength(0);
    expect(state.upsertCalls).toHaveLength(0);
  });
});

describe("describeImageHandler — happy path", () => {
  it("signs URL, calls Gemini, upserts transcript, returns result", async () => {
    const msg = seedMessage({
      media_storage_path: "tenants/t1/pic.png",
    });
    const ctx = makeCtx({ messageId: msg.id });

    const res = await describeImageHandler(ctx);

    // Signed URL step ran with the right path + 15-min TTL.
    expect(state.signedUrlCalls).toEqual([
      { path: "tenants/t1/pic.png", ttl: 900 },
    ]);

    // Gemini was called with the signed URL and the PT-BR prompt.
    expect(state.geminiCalls).toHaveLength(1);
    const call = state.geminiCalls[0];
    expect(call.url).toContain("signed.example");
    expect(call.prompt).toMatch(/português do Brasil/);
    expect(call.prompt).toMatch(/Texto visível/);

    // Transcript was upserted with model + pt-BR.
    expect(state.upsertCalls).toEqual([
      {
        messageId: msg.id,
        text: state.geminiResult.description,
        language: "pt-BR",
        model: "gemini-2.5-flash",
      },
    ]);

    // Return shape.
    expect(res).toMatchObject({
      described: true,
      textLength: state.geminiResult.description.length,
    });
    expect((res as { transcriptId: string }).transcriptId).toBeTruthy();
  });
});

describe("describeImageHandler — error propagation", () => {
  it("propagates Gemini errors so Inngest can retry", async () => {
    const msg = seedMessage();
    const ctx = makeCtx({ messageId: msg.id });
    state.geminiThrows = new Error("vision_failed: upstream 503");

    await expect(describeImageHandler(ctx)).rejects.toThrow(/vision_failed/);
    expect(state.upsertCalls).toHaveLength(0);
  });
});
