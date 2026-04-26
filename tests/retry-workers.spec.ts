/**
 * Unit tests for the three Fase-5 retry workers:
 *   - inngest/functions/retry-pending.ts
 *   - inngest/functions/media-download-retry.ts
 *   - inngest/functions/transcription-retry.ts
 *
 * Strategy
 *   - Mock `@/lib/supabase/admin` with a small fake that supports the
 *     query shapes the workers use: select, eq, lt, gt, in, order, limit,
 *     maybeSingle. NOT a full PostgREST emulation — just enough to drive
 *     the specific code paths.
 *   - Mock `@/lib/media/download` so `downloadAndStore` becomes a spy.
 *   - Mock `inngest.send` so we can assert event fan-out.
 *   - Invoke the function handler directly by reading its `fn` property
 *     (Inngest exposes this; it's the handler closure). We pass a minimal
 *     `{ event, step, logger }` context — `step.run` just unwraps the
 *     callback, matching prod behaviour for functions that don't exercise
 *     Inngest's memoisation.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// ──────────────────────────────────────────────────────────────────────────
//  In-memory DB
// ──────────────────────────────────────────────────────────────────────────

type MessageRow = {
  id: string;
  tenant_id: string;
  uazapi_message_id: string;
  media_url: string | null;
  media_mime_type: string | null;
  media_download_status: string | null;
  type: "text" | "audio" | "image" | "video" | "other";
  created_at: string;
};

type TranscriptRow = { message_id: string };

type WhatsappInstanceRow = {
  tenant_id: string;
  uazapi_token_encrypted: string | null;
};

const db = {
  messages: [] as MessageRow[],
  transcripts: [] as TranscriptRow[],
  whatsapp_instances: [] as WhatsappInstanceRow[],
};

function resetDb() {
  db.messages = [];
  db.transcripts = [];
  db.whatsapp_instances = [];
}

type AnyRow = Record<string, unknown>;
type Filter =
  | { kind: "eq"; col: string; val: unknown }
  | { kind: "lt"; col: string; val: unknown }
  | { kind: "gt"; col: string; val: unknown }
  | { kind: "in"; col: string; vals: unknown[] };

function matches(row: AnyRow, filters: Filter[]): boolean {
  for (const f of filters) {
    const v = row[f.col];
    switch (f.kind) {
      case "eq":
        if (v !== f.val) return false;
        break;
      case "lt":
        if (!(typeof v === "string" && typeof f.val === "string" && v < f.val)) return false;
        break;
      case "gt":
        if (!(typeof v === "string" && typeof f.val === "string" && v > f.val)) return false;
        break;
      case "in":
        if (!f.vals.includes(v)) return false;
        break;
    }
  }
  return true;
}

function makeBuilder(table: keyof typeof db) {
  const filters: Filter[] = [];
  let limit: number | null = null;
  let orderCol: string | null = null;
  let orderAsc = true;

  const run = (): { data: AnyRow[]; error: null } => {
    const rows = (db[table] as AnyRow[]).filter((r) => matches(r, filters));
    if (orderCol) {
      rows.sort((a, b) => {
        const av = a[orderCol!];
        const bv = b[orderCol!];
        if (av === bv) return 0;
        const cmp = (av as string) < (bv as string) ? -1 : 1;
        return orderAsc ? cmp : -cmp;
      });
    }
    if (limit != null) rows.splice(limit);
    return { data: rows, error: null };
  };

  const api = {
    select: (_cols?: unknown) => api,
    eq: (col: string, val: unknown) => {
      filters.push({ kind: "eq", col, val });
      return api;
    },
    lt: (col: string, val: unknown) => {
      filters.push({ kind: "lt", col, val });
      return api;
    },
    gt: (col: string, val: unknown) => {
      filters.push({ kind: "gt", col, val });
      return api;
    },
    in: (col: string, vals: unknown[]) => {
      filters.push({ kind: "in", col, vals });
      return api;
    },
    order: (col: string, opts?: { ascending?: boolean }) => {
      orderCol = col;
      orderAsc = opts?.ascending ?? true;
      return api;
    },
    limit: (n: number) => {
      limit = n;
      return api;
    },
    maybeSingle: async () => {
      const res = run();
      return { data: res.data[0] ?? null, error: null };
    },
    then<T1 = unknown, T2 = never>(
      onfulfilled?: ((value: { data: AnyRow[]; error: null }) => T1) | null | undefined,
      onrejected?: ((reason: unknown) => T2) | null | undefined,
    ): Promise<T1 | T2> {
      return Promise.resolve(run()).then(onfulfilled as never, onrejected as never);
    },
  };

  return api;
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (!(table in db)) {
        throw new Error(`Unexpected table in mock: ${table}`);
      }
      return makeBuilder(table as keyof typeof db);
    },
  }),
}));

// ──────────────────────────────────────────────────────────────────────────
//  downloadAndStore mock
// ──────────────────────────────────────────────────────────────────────────

type DownloadCall = {
  tenantId: string;
  messageId: string;
  sourceUrl: string;
  opts?: { hintedMime?: string };
};

const downloadState = {
  calls: [] as DownloadCall[],
  /** Each call returns the next result from this queue. If empty, defaults to downloaded. */
  results: [] as Array<{ status: "downloaded" | "failed" | "skipped"; error?: string }>,
};

vi.mock("@/lib/media/download", () => ({
  downloadAndStore: vi.fn(
    async (
      tenantId: string,
      messageId: string,
      sourceUrl: string,
      opts?: { hintedMime?: string },
    ) => {
      downloadState.calls.push({ tenantId, messageId, sourceUrl, opts });
      const next =
        downloadState.results.shift() ??
        ({ status: "downloaded" as const });
      return next;
    },
  ),
}));

// ──────────────────────────────────────────────────────────────────────────
//  inngest.send mock
// ──────────────────────────────────────────────────────────────────────────

const sendCalls: unknown[] = [];

vi.mock("@/inngest/client", async () => {
  const actual = await vi.importActual<typeof import("@/inngest/client")>(
    "@/inngest/client",
  );
  return {
    ...actual,
    inngest: {
      ...actual.inngest,
      send: vi.fn(async (payload: unknown) => {
        sendCalls.push(payload);
        return { ids: ["mock"] };
      }),
    },
  };
});

// ──────────────────────────────────────────────────────────────────────────
//  Imports (after mocks)
// ──────────────────────────────────────────────────────────────────────────

import { retryPendingDownloads } from "@/inngest/functions/retry-pending";
import { mediaDownloadRetryWorker } from "@/inngest/functions/media-download-retry";
import { transcriptionRetry } from "@/inngest/functions/transcription-retry";

// ──────────────────────────────────────────────────────────────────────────
//  Handler invocation helpers
// ──────────────────────────────────────────────────────────────────────────

type Logger = {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
};

function mkLogger(): Logger {
  return {
    info: () => {},
    warn: () => {},
    error: () => {},
  };
}

/**
 * Minimal step runner that unwraps the callback. Inngest's real runtime
 * adds memoisation + retry, but the function bodies we test don't depend
 * on any of that.
 */
const step = {
  run: async <T>(_id: string, fn: () => Promise<T> | T): Promise<T> => {
    return await fn();
  },
};

/**
 * Pull the underlying handler off an Inngest function. In @inngest v4 the
 * `createFunction` return is a class instance with private `fn` — but
 * the callback reference is preserved. The simplest stable path across
 * minor versions is to read it via index signature after a cast.
 */
function callHandler(
  target: unknown,
  ctx: { event?: unknown; step: typeof step; logger: Logger },
): Promise<unknown> {
  const fnHolder = target as { fn?: (...args: unknown[]) => Promise<unknown> } & Record<
    string,
    unknown
  >;
  const candidate =
    (typeof fnHolder.fn === "function" && fnHolder.fn) ||
    (typeof (fnHolder as Record<string, unknown>)["handler"] === "function" &&
      (fnHolder as Record<string, () => Promise<unknown>>)["handler"]);
  if (!candidate || typeof candidate !== "function") {
    throw new Error(
      "Could not locate handler on Inngest function — SDK internals changed?",
    );
  }
  return candidate.call(fnHolder, ctx);
}

// ──────────────────────────────────────────────────────────────────────────
//  Fixtures
// ──────────────────────────────────────────────────────────────────────────

const TENANT = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

function seedMessage(over: Partial<MessageRow> & { id: string }): MessageRow {
  const row: MessageRow = {
    id: over.id,
    tenant_id: over.tenant_id ?? TENANT,
    uazapi_message_id: over.uazapi_message_id ?? `wamid_${over.id}`,
    // Use `in` to honour explicit null/undefined overrides (avoids `??`
    // swapping in the default when the test wants a null url).
    media_url:
      "media_url" in over ? over.media_url ?? null : "https://mmg.whatsapp.net/x",
    media_mime_type:
      "media_mime_type" in over ? over.media_mime_type ?? null : "audio/ogg",
    media_download_status: over.media_download_status ?? "pending",
    type: over.type ?? "audio",
    created_at:
      over.created_at ?? new Date(Date.now() - 5 * 60_000).toISOString(),
  };
  db.messages.push(row);
  return row;
}

// ──────────────────────────────────────────────────────────────────────────
//  beforeEach
// ──────────────────────────────────────────────────────────────────────────

beforeEach(() => {
  resetDb();
  downloadState.calls = [];
  downloadState.results = [];
  sendCalls.length = 0;
});

// ──────────────────────────────────────────────────────────────────────────
//  retry-pending-downloads
// ──────────────────────────────────────────────────────────────────────────

describe("retryPendingDownloads", () => {
  it("retries stale pending rows and emits message.captured on success", async () => {
    seedMessage({ id: "m1", type: "audio" });
    seedMessage({ id: "m2", type: "image", media_mime_type: "image/jpeg" });

    const result = (await callHandler(retryPendingDownloads, {
      step,
      logger: mkLogger(),
    })) as { found: number; retried: number; succeeded: number; failed: number };

    expect(result.found).toBe(2);
    expect(result.retried).toBe(2);
    expect(result.succeeded).toBe(2);
    expect(result.failed).toBe(0);
    expect(downloadState.calls).toHaveLength(2);
    expect(downloadState.calls[0].messageId).toBe("m1");
    expect(downloadState.calls[1].messageId).toBe("m2");
    // Two captured events emitted.
    expect(sendCalls).toHaveLength(2);
  });

  it("skips rows too fresh (< 2min) and rows too old (> 24h)", async () => {
    // fresh: 30s old
    seedMessage({
      id: "fresh",
      created_at: new Date(Date.now() - 30_000).toISOString(),
    });
    // ancient: 25h old
    seedMessage({
      id: "ancient",
      created_at: new Date(Date.now() - 25 * 60 * 60_000).toISOString(),
    });
    // good: 10min old
    seedMessage({
      id: "good",
      created_at: new Date(Date.now() - 10 * 60_000).toISOString(),
    });

    const result = (await callHandler(retryPendingDownloads, {
      step,
      logger: mkLogger(),
    })) as { found: number; succeeded: number };

    expect(result.found).toBe(1);
    expect(result.succeeded).toBe(1);
    expect(downloadState.calls).toHaveLength(1);
    expect(downloadState.calls[0].messageId).toBe("good");
  });

  it("counts failed downloads and does NOT emit captured for them", async () => {
    seedMessage({ id: "ok" });
    seedMessage({ id: "bad" });
    // First call downloads OK, second fails.
    downloadState.results.push({ status: "downloaded" });
    downloadState.results.push({ status: "failed", error: "oops" });

    const result = (await callHandler(retryPendingDownloads, {
      step,
      logger: mkLogger(),
    })) as { succeeded: number; failed: number };

    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(1);
    // Only the successful one emitted a captured event.
    expect(sendCalls).toHaveLength(1);
  });

  it("skips rows with null media_url (counts as failed, no download call)", async () => {
    seedMessage({ id: "no-url", media_url: null });
    const result = (await callHandler(retryPendingDownloads, {
      step,
      logger: mkLogger(),
    })) as { found: number; succeeded: number; failed: number };

    expect(result.found).toBe(1);
    expect(result.succeeded).toBe(0);
    expect(result.failed).toBe(1);
    expect(downloadState.calls).toHaveLength(0);
    expect(sendCalls).toHaveLength(0);
  });

  it("returns zeros when nothing is pending", async () => {
    const result = (await callHandler(retryPendingDownloads, {
      step,
      logger: mkLogger(),
    })) as { found: number };
    expect(result.found).toBe(0);
    expect(downloadState.calls).toHaveLength(0);
  });
});

// ──────────────────────────────────────────────────────────────────────────
//  media-download-retry
// ──────────────────────────────────────────────────────────────────────────

describe("mediaDownloadRetryWorker", () => {
  it("loads the message, retries, and emits message.captured on success", async () => {
    seedMessage({ id: "m1", type: "audio", media_mime_type: "audio/ogg" });

    const result = (await callHandler(mediaDownloadRetryWorker, {
      event: { data: { messageId: "m1" } },
      step,
      logger: mkLogger(),
    })) as { status: string; messageId: string };

    expect(result.status).toBe("downloaded");
    expect(downloadState.calls).toHaveLength(1);
    expect(downloadState.calls[0].messageId).toBe("m1");
    expect(downloadState.calls[0].opts?.hintedMime).toBe("audio/ogg");
    expect(sendCalls).toHaveLength(1);
  });

  it("returns status=missing when the message row is not found", async () => {
    const result = (await callHandler(mediaDownloadRetryWorker, {
      event: { data: { messageId: "ghost" } },
      step,
      logger: mkLogger(),
    })) as { status: string };

    expect(result.status).toBe("missing");
    expect(downloadState.calls).toHaveLength(0);
    expect(sendCalls).toHaveLength(0);
  });

  it("returns status=no-url when media_url is null", async () => {
    seedMessage({ id: "m1", media_url: null });
    const result = (await callHandler(mediaDownloadRetryWorker, {
      event: { data: { messageId: "m1" } },
      step,
      logger: mkLogger(),
    })) as { status: string };

    expect(result.status).toBe("no-url");
    expect(downloadState.calls).toHaveLength(0);
    expect(sendCalls).toHaveLength(0);
  });

  it("does NOT emit message.captured when download fails", async () => {
    seedMessage({ id: "m1" });
    downloadState.results.push({ status: "failed", error: "upstream 500" });

    const result = (await callHandler(mediaDownloadRetryWorker, {
      event: { data: { messageId: "m1" } },
      step,
      logger: mkLogger(),
    })) as { status: string; error?: string };

    expect(result.status).toBe("failed");
    expect(result.error).toBe("upstream 500");
    expect(sendCalls).toHaveLength(0);
  });
});

// ──────────────────────────────────────────────────────────────────────────
//  transcription-retry
// ──────────────────────────────────────────────────────────────────────────

describe("transcriptionRetry", () => {
  it("emits message.captured for downloaded audio/image without a transcripts row", async () => {
    seedMessage({
      id: "a1",
      type: "audio",
      media_download_status: "downloaded",
    });
    seedMessage({
      id: "i1",
      type: "image",
      media_download_status: "downloaded",
    });

    const result = (await callHandler(transcriptionRetry, {
      step,
      logger: mkLogger(),
    })) as { found: number; emitted: number };

    expect(result.found).toBe(2);
    expect(result.emitted).toBe(2);
    // `inngest.send` is called once with an array payload containing both.
    expect(sendCalls).toHaveLength(1);
    const payload = sendCalls[0];
    expect(Array.isArray(payload)).toBe(true);
    expect((payload as unknown[]).length).toBe(2);
  });

  it("skips rows that already have a transcripts row", async () => {
    seedMessage({
      id: "a1",
      type: "audio",
      media_download_status: "downloaded",
    });
    seedMessage({
      id: "a2",
      type: "audio",
      media_download_status: "downloaded",
    });
    db.transcripts.push({ message_id: "a1" });

    const result = (await callHandler(transcriptionRetry, {
      step,
      logger: mkLogger(),
    })) as { found: number; emitted: number };

    expect(result.found).toBe(1);
    expect(result.emitted).toBe(1);
    expect(sendCalls).toHaveLength(1);
  });

  it("skips text/video rows (only audio+image are candidates)", async () => {
    seedMessage({
      id: "t1",
      type: "text",
      media_download_status: "downloaded",
    });
    seedMessage({
      id: "v1",
      type: "video",
      media_download_status: "downloaded",
    });

    const result = (await callHandler(transcriptionRetry, {
      step,
      logger: mkLogger(),
    })) as { found: number };

    expect(result.found).toBe(0);
    expect(sendCalls).toHaveLength(0);
  });

  it("skips rows older than 24h", async () => {
    seedMessage({
      id: "old",
      type: "audio",
      media_download_status: "downloaded",
      created_at: new Date(Date.now() - 25 * 60 * 60_000).toISOString(),
    });

    const result = (await callHandler(transcriptionRetry, {
      step,
      logger: mkLogger(),
    })) as { found: number };

    expect(result.found).toBe(0);
  });

  it("returns zeros and does not call send when nothing is missing", async () => {
    const result = (await callHandler(transcriptionRetry, {
      step,
      logger: mkLogger(),
    })) as { found: number; emitted: number };

    expect(result.found).toBe(0);
    expect(result.emitted).toBe(0);
    expect(sendCalls).toHaveLength(0);
  });
});
