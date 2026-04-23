/**
 * Unit tests for `inngest/functions/transcribe-audio.ts`.
 *
 * Strategy:
 *
 *   - We exercise the exported `transcribeAudioHandler` directly rather
 *     than the Inngest-wrapped function. That keeps the tests free of
 *     the Inngest runtime (which wants a real transport, dev server,
 *     etc) while still covering 100% of the handler's control flow.
 *
 *   - `step.run(name, fn)` is faked as a pass-through: we simply invoke
 *     `fn()` inline. In production, Inngest wraps each call in a durable
 *     step, but from the handler's perspective the contract is just
 *     "await my callback, give me the result". That's what we emulate.
 *
 *   - Real Groq, Storage, and Supabase are all mocked. Zero network I/O.
 *     The tests assert the orchestration (what gets called, in what
 *     order, with what args) — NOT the vendor APIs themselves (those are
 *     covered by their own integration tests).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// ──────────────────────────────────────────────────────────────────────
// Module mocks. Must be declared before the SUT import so vi.mock
// hoists them above the `import` line below.
// ──────────────────────────────────────────────────────────────────────

const groqMock = vi.fn();
vi.mock("@/lib/ai/groq", () => ({
  transcribeAudio: (...args: unknown[]) => groqMock(...args),
}));

const signedUrlMock = vi.fn();
vi.mock("@/lib/media/signedUrl", () => ({
  getSignedUrl: (...args: unknown[]) => signedUrlMock(...args),
}));

const upsertTranscriptMock = vi.fn();
vi.mock("@/lib/transcripts/service", () => ({
  upsertTranscript: (...args: unknown[]) => upsertTranscriptMock(...args),
}));

// The admin client in this worker is used for two reads: messages row
// and the existing transcript row. Build a table-aware chain mock where
// `.maybeSingle()` resolves whatever was queued for that table.
type MockRow = Record<string, unknown> | null;
type QueuedRow = { data: MockRow; error: { message: string } | null };

const queuedReads: Record<string, QueuedRow[]> = {
  messages: [],
  transcripts: [],
};

function queueRead(
  table: "messages" | "transcripts",
  row: MockRow,
  error: { message: string } | null = null,
) {
  queuedReads[table].push({ data: row, error });
}

function makeBuilder(table: string) {
  const api = {
    select: () => api,
    eq: () => api,
    maybeSingle: async () => {
      const queue = queuedReads[table];
      if (!queue || queue.length === 0) {
        throw new Error(`no queued read for table=${table}`);
      }
      return queue.shift()!;
    },
  };
  return api;
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => makeBuilder(table),
  }),
}));

// ──────────────────────────────────────────────────────────────────────
// SUT import — must come AFTER the vi.mock calls.
// ──────────────────────────────────────────────────────────────────────

import {
  transcribeAudioHandler,
  type TranscribeAudioHandlerCtx,
} from "@/inngest/functions/transcribe-audio";

// ──────────────────────────────────────────────────────────────────────
// Fake step + logger
// ──────────────────────────────────────────────────────────────────────

function makeCtx(
  data: { messageId: string; tenantId: string; type: string },
): TranscribeAudioHandlerCtx & { stepNames: string[] } {
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

const MSG_ID = "11111111-1111-1111-1111-111111111111";
const TENANT_ID = "22222222-2222-2222-2222-222222222222";

beforeEach(() => {
  groqMock.mockReset();
  signedUrlMock.mockReset();
  upsertTranscriptMock.mockReset();
  queuedReads.messages = [];
  queuedReads.transcripts = [];
});

// ──────────────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────────────

describe("transcribeAudioHandler — skip branches", () => {
  it("skips when event type is not audio", async () => {
    const ctx = makeCtx({ messageId: MSG_ID, tenantId: TENANT_ID, type: "text" });
    const res = await transcribeAudioHandler(ctx);
    expect(res).toEqual({ skipped: true, reason: "not audio" });
    // No steps ran — we short-circuit before `load-message`.
    expect(ctx.stepNames).toEqual([]);
    expect(groqMock).not.toHaveBeenCalled();
    expect(signedUrlMock).not.toHaveBeenCalled();
    expect(upsertTranscriptMock).not.toHaveBeenCalled();
  });

  it("skips when media_download_status !== 'downloaded'", async () => {
    queueRead("messages", {
      id: MSG_ID,
      tenant_id: TENANT_ID,
      media_storage_path: null,
      media_url: "https://example.com/pending",
      media_download_status: "pending",
    });
    queueRead("transcripts", null);

    const ctx = makeCtx({
      messageId: MSG_ID,
      tenantId: TENANT_ID,
      type: "audio",
    });
    const res = await transcribeAudioHandler(ctx);

    expect(res).toEqual({
      skipped: true,
      reason: "media not downloaded yet",
    });
    // Loaded but bailed — never minted a URL, never hit Groq.
    expect(ctx.stepNames).toEqual(["load-message"]);
    expect(signedUrlMock).not.toHaveBeenCalled();
    expect(groqMock).not.toHaveBeenCalled();
    expect(upsertTranscriptMock).not.toHaveBeenCalled();
  });

  it("skips when a transcript already exists with non-empty text", async () => {
    queueRead("messages", {
      id: MSG_ID,
      tenant_id: TENANT_ID,
      media_storage_path: `${TENANT_ID}/2026/04/${MSG_ID}.ogg`,
      media_url: null,
      media_download_status: "downloaded",
    });
    queueRead("transcripts", {
      id: "ffffffff-ffff-ffff-ffff-ffffffffffff",
      text: "already there",
    });

    const ctx = makeCtx({
      messageId: MSG_ID,
      tenantId: TENANT_ID,
      type: "audio",
    });
    const res = await transcribeAudioHandler(ctx);

    expect(res).toEqual({ skipped: true, reason: "already transcribed" });
    expect(ctx.stepNames).toEqual(["load-message"]);
    expect(signedUrlMock).not.toHaveBeenCalled();
    expect(groqMock).not.toHaveBeenCalled();
    expect(upsertTranscriptMock).not.toHaveBeenCalled();
  });

  it("skips when the message row cannot be found", async () => {
    queueRead("messages", null);
    // No transcripts read queued — load-message short-circuits before
    // that second query runs.

    const ctx = makeCtx({
      messageId: MSG_ID,
      tenantId: TENANT_ID,
      type: "audio",
    });
    const res = await transcribeAudioHandler(ctx);

    expect(res).toEqual({ skipped: true, reason: "message not found" });
    expect(signedUrlMock).not.toHaveBeenCalled();
    expect(groqMock).not.toHaveBeenCalled();
  });

  it("skips when downloaded but media_storage_path is null", async () => {
    queueRead("messages", {
      id: MSG_ID,
      tenant_id: TENANT_ID,
      media_storage_path: null,
      media_url: null,
      media_download_status: "downloaded",
    });
    queueRead("transcripts", null);

    const ctx = makeCtx({
      messageId: MSG_ID,
      tenantId: TENANT_ID,
      type: "audio",
    });
    const res = await transcribeAudioHandler(ctx);

    expect(res).toEqual({ skipped: true, reason: "missing storage path" });
    expect(signedUrlMock).not.toHaveBeenCalled();
  });
});

describe("transcribeAudioHandler — happy path", () => {
  it("signs URL, transcribes via Groq, and upserts the transcript", async () => {
    const STORAGE_PATH = `${TENANT_ID}/2026/04/${MSG_ID}.ogg`;
    queueRead("messages", {
      id: MSG_ID,
      tenant_id: TENANT_ID,
      media_storage_path: STORAGE_PATH,
      media_url: null,
      media_download_status: "downloaded",
    });
    queueRead("transcripts", null);

    signedUrlMock.mockResolvedValueOnce("https://signed.example/x.ogg");
    groqMock.mockResolvedValueOnce({
      text: "olá mundo, isso é um teste",
      language: "pt",
      durationSeconds: 5.12,
      model: "whisper-large-v3",
    });
    upsertTranscriptMock.mockResolvedValueOnce({
      id: "aaaaaaaa-1111-2222-3333-444444444444",
      messageId: MSG_ID,
      text: "olá mundo, isso é um teste",
      language: "pt",
      confidence: null,
      model: "whisper-large-v3",
      createdAt: "2026-04-22T00:00:00.000Z",
    });

    const ctx = makeCtx({
      messageId: MSG_ID,
      tenantId: TENANT_ID,
      type: "audio",
    });
    const res = await transcribeAudioHandler(ctx);

    expect(res).toEqual({
      transcribed: true,
      transcriptId: "aaaaaaaa-1111-2222-3333-444444444444",
      textLength: "olá mundo, isso é um teste".length,
    });

    // Orchestration assertions: each step ran in order, exactly once.
    expect(ctx.stepNames).toEqual([
      "load-message",
      "signed-url",
      "transcribe",
      "save-transcript",
    ]);

    // Signed URL was minted with the stored path + 15 min TTL.
    expect(signedUrlMock).toHaveBeenCalledTimes(1);
    expect(signedUrlMock).toHaveBeenCalledWith(STORAGE_PATH, 900);

    // Groq was called with the signed URL + PT-BR language hint.
    expect(groqMock).toHaveBeenCalledTimes(1);
    expect(groqMock).toHaveBeenCalledWith(
      { url: "https://signed.example/x.ogg" },
      { language: "pt" },
    );

    // Upsert got the Groq output + our null confidence.
    expect(upsertTranscriptMock).toHaveBeenCalledTimes(1);
    expect(upsertTranscriptMock).toHaveBeenCalledWith({
      messageId: MSG_ID,
      text: "olá mundo, isso é um teste",
      language: "pt",
      confidence: null,
      model: "whisper-large-v3",
    });
  });
});

describe("transcribeAudioHandler — error propagation", () => {
  it("propagates Groq errors so Inngest can retry", async () => {
    queueRead("messages", {
      id: MSG_ID,
      tenant_id: TENANT_ID,
      media_storage_path: `${TENANT_ID}/2026/04/${MSG_ID}.ogg`,
      media_url: null,
      media_download_status: "downloaded",
    });
    queueRead("transcripts", null);
    signedUrlMock.mockResolvedValueOnce("https://signed.example/x.ogg");
    groqMock.mockRejectedValueOnce(new Error("groq 503: temporarily unavailable"));

    const ctx = makeCtx({
      messageId: MSG_ID,
      tenantId: TENANT_ID,
      type: "audio",
    });

    await expect(transcribeAudioHandler(ctx)).rejects.toThrow(
      /groq 503: temporarily unavailable/,
    );

    // We got as far as transcribe, but upsert never ran.
    expect(ctx.stepNames).toEqual(["load-message", "signed-url", "transcribe"]);
    expect(upsertTranscriptMock).not.toHaveBeenCalled();
  });

  it("propagates signed URL errors so Inngest can retry", async () => {
    queueRead("messages", {
      id: MSG_ID,
      tenant_id: TENANT_ID,
      media_storage_path: `${TENANT_ID}/2026/04/${MSG_ID}.ogg`,
      media_url: null,
      media_download_status: "downloaded",
    });
    queueRead("transcripts", null);
    signedUrlMock.mockRejectedValueOnce(new Error("createSignedUrl failed: nope"));

    const ctx = makeCtx({
      messageId: MSG_ID,
      tenantId: TENANT_ID,
      type: "audio",
    });

    await expect(transcribeAudioHandler(ctx)).rejects.toThrow(
      /createSignedUrl failed/,
    );
    expect(groqMock).not.toHaveBeenCalled();
  });
});
