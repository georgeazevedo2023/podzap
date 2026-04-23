/**
 * Unit tests for lib/media/download.ts
 *
 * Strategy:
 *   - Mock global `fetch` per test via vi.stubGlobal.
 *   - Mock `@/lib/supabase/admin` with an in-memory fake that captures
 *     storage uploads and `messages.update` calls.
 *   - Assert both the returned DownloadResult and the side-effects
 *     (storage + DB) match the expected semantics.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// ──────────────────────────────────────────────────────────────────────────
//  Supabase admin mock — in-memory capture
// ──────────────────────────────────────────────────────────────────────────

type StorageUploadCall = {
  path: string;
  body: Buffer | Uint8Array;
  contentType?: string;
  upsert?: boolean;
};
type MessagesUpdateCall = {
  patch: Record<string, unknown>;
  filters: Array<{ col: string; val: unknown }>;
};

const state = {
  storageUploads: [] as StorageUploadCall[],
  messagesUpdates: [] as MessagesUpdateCall[],
  signedUrls: [] as Array<{ path: string; expiresIn: number }>,
  // test-controlled outcomes
  storageUploadError: null as { message: string } | null,
  messagesUpdateError: null as { message: string } | null,
  signedUrlResult: {
    data: { signedUrl: "https://signed.example/media/path" } as { signedUrl: string } | null,
    error: null as { message: string } | null,
  },
};

function resetState() {
  state.storageUploads = [];
  state.messagesUpdates = [];
  state.signedUrls = [];
  state.storageUploadError = null;
  state.messagesUpdateError = null;
  state.signedUrlResult = {
    data: { signedUrl: "https://signed.example/media/path" },
    error: null,
  };
}

function makeMessagesUpdateBuilder() {
  const call: MessagesUpdateCall = { patch: {}, filters: [] };
  const api = {
    update(patch: Record<string, unknown>) {
      call.patch = patch;
      return api;
    },
    eq(col: string, val: unknown) {
      call.filters.push({ col, val });
      // Supabase returns a thenable after the final filter
      return api;
    },
    then<T>(
      onfulfilled: (v: { data: null; error: { message: string } | null }) => T,
    ): Promise<T> {
      state.messagesUpdates.push(call);
      return Promise.resolve(
        onfulfilled({ data: null, error: state.messagesUpdateError }),
      );
    },
  };
  return api;
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from(table: string) {
      if (table !== "messages") {
        throw new Error(`unexpected table in mock: ${table}`);
      }
      return makeMessagesUpdateBuilder();
    },
    storage: {
      from(bucket: string) {
        if (bucket !== "media") {
          throw new Error(`unexpected bucket: ${bucket}`);
        }
        return {
          async upload(
            path: string,
            body: Buffer | Uint8Array,
            opts?: { contentType?: string; upsert?: boolean },
          ) {
            state.storageUploads.push({
              path,
              body,
              contentType: opts?.contentType,
              upsert: opts?.upsert,
            });
            if (state.storageUploadError) {
              return { data: null, error: state.storageUploadError };
            }
            return { data: { path }, error: null };
          },
          async createSignedUrl(path: string, expiresIn: number) {
            state.signedUrls.push({ path, expiresIn });
            return state.signedUrlResult;
          },
        };
      },
    },
  }),
}));

// ──────────────────────────────────────────────────────────────────────────
//  Import AFTER mocks are installed
// ──────────────────────────────────────────────────────────────────────────

const { downloadAndStore, sniffMimeType } = await import("@/lib/media/download");

// ──────────────────────────────────────────────────────────────────────────
//  fetch helpers
// ──────────────────────────────────────────────────────────────────────────

function bufferToStream(buf: Buffer): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(buf));
      controller.close();
    },
  });
}

function okResponse(
  buf: Buffer,
  opts?: { contentType?: string; contentLength?: number },
): Response {
  const headers = new Headers();
  if (opts?.contentType) headers.set("content-type", opts.contentType);
  if (opts?.contentLength !== undefined) headers.set("content-length", String(opts.contentLength));
  const r: Response = {
    ok: true,
    status: 200,
    statusText: "OK",
    headers,
    body: bufferToStream(buf),
    arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
  } as unknown as Response;
  return r;
}

// PNG magic + a few trailing bytes — enough for sniffMimeType to recognise.
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);

// ──────────────────────────────────────────────────────────────────────────
//  Tests
// ──────────────────────────────────────────────────────────────────────────

beforeEach(() => {
  resetState();
  vi.unstubAllGlobals();
});

const TENANT = "11111111-1111-1111-1111-111111111111";
const MSG = "22222222-2222-2222-2222-222222222222";

describe("downloadAndStore — happy path", () => {
  it("sniffs PNG, uploads to media bucket, and updates the messages row", async () => {
    const body = Buffer.concat([PNG_SIG, Buffer.alloc(128, 0xab)]);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okResponse(body, { contentType: "image/png" })));

    const res = await downloadAndStore(TENANT, MSG, "https://cdn.example.com/pic.png");

    expect(res.status).toBe("downloaded");
    expect(res.mimeType).toBe("image/png");
    expect(res.sizeBytes).toBe(body.byteLength);
    expect(res.storagePath).toMatch(new RegExp(`^${TENANT}/\\d{4}/\\d{2}/${MSG}\\.png$`));

    expect(state.storageUploads).toHaveLength(1);
    expect(state.storageUploads[0].contentType).toBe("image/png");
    expect(state.storageUploads[0].upsert).toBe(false);

    // One update, happy path
    expect(state.messagesUpdates).toHaveLength(1);
    const upd = state.messagesUpdates[0];
    expect(upd.patch.media_download_status).toBe("downloaded");
    expect(upd.patch.media_mime_type).toBe("image/png");
    expect(upd.patch.media_size_bytes).toBe(body.byteLength);
    expect(upd.patch.media_storage_path).toBe(res.storagePath);
    // Tenant isolation guard
    expect(upd.filters).toEqual(
      expect.arrayContaining([
        { col: "id", val: MSG },
        { col: "tenant_id", val: TENANT },
      ]),
    );
  });

  it("sniffMimeType recognises OGG audio", () => {
    const ogg = Buffer.from([0x4f, 0x67, 0x67, 0x53, 0x00, 0x02, 0x00, 0x00]);
    expect(sniffMimeType(ogg)).toBe("audio/ogg");
  });
});

describe("downloadAndStore — SSRF guard", () => {
  it("rejects http://localhost and marks row as failed", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const res = await downloadAndStore(TENANT, MSG, "http://localhost:3000/leak");

    expect(res.status).toBe("failed");
    expect(res.error).toMatch(/localhost|scheme/i);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(state.storageUploads).toHaveLength(0);
    // Must have recorded the failure in DB
    expect(state.messagesUpdates).toHaveLength(1);
    expect(state.messagesUpdates[0].patch.media_download_status).toBe("failed");
  });
});

describe("downloadAndStore — size cap", () => {
  it("bails when Content-Length exceeds max", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        okResponse(Buffer.alloc(8), { contentType: "image/png", contentLength: 10_000_000 }),
      ),
    );

    const res = await downloadAndStore(TENANT, MSG, "https://cdn.example.com/big.bin", {
      maxSizeBytes: 1000,
    });

    expect(res.status).toBe("failed");
    expect(res.error).toMatch(/exceeds|content-length/i);
    expect(state.storageUploads).toHaveLength(0);
    expect(state.messagesUpdates[0].patch.media_download_status).toBe("failed");
  });
});

describe("downloadAndStore — timeout", () => {
  it("aborts the fetch and returns failed on timeout", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: unknown, init?: { signal?: AbortSignal }) => {
        const sig = init?.signal;
        return await new Promise<Response>((_, reject) => {
          if (sig) {
            const onAbort = () => {
              const err = new Error("aborted");
              err.name = "AbortError";
              reject(err);
            };
            if (sig.aborted) onAbort();
            else sig.addEventListener("abort", onAbort, { once: true });
          }
        });
      }),
    );

    const res = await downloadAndStore(TENANT, MSG, "https://slow.example.com/x", {
      timeoutMs: 30,
    });

    expect(res.status).toBe("failed");
    expect(res.error).toMatch(/timed out|abort/i);
    expect(state.storageUploads).toHaveLength(0);
    expect(state.messagesUpdates[0].patch.media_download_status).toBe("failed");
  });
});

describe("downloadAndStore — empty URL", () => {
  it("returns 'skipped' without marking the row failed", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const res = await downloadAndStore(TENANT, MSG, "");

    expect(res.status).toBe("skipped");
    expect(fetchSpy).not.toHaveBeenCalled();
    // Skipped must NOT produce a DB write — webhook handler decides what
    // to store for the no-media case.
    expect(state.messagesUpdates).toHaveLength(0);
    expect(state.storageUploads).toHaveLength(0);
  });
});

describe("downloadAndStore — storage error", () => {
  it("persists status='failed' when the upload call errors", async () => {
    const body = Buffer.concat([PNG_SIG, Buffer.alloc(32)]);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okResponse(body, { contentType: "image/png" })));
    state.storageUploadError = { message: "bucket not found" };

    const res = await downloadAndStore(TENANT, MSG, "https://cdn.example.com/pic.png");

    expect(res.status).toBe("failed");
    expect(res.error).toMatch(/bucket not found|storage upload/i);
    expect(state.storageUploads).toHaveLength(1);
    // The "fail" update is the only update (no happy-path update on the way down).
    expect(state.messagesUpdates).toHaveLength(1);
    expect(state.messagesUpdates[0].patch.media_download_status).toBe("failed");
  });
});
