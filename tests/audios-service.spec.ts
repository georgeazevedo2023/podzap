/**
 * Unit tests for lib/audios/service.ts (Fase 9).
 *
 * Strategy mirrors tests/summaries-service.spec.ts and
 * tests/ai-tracking.spec.ts:
 *
 *   - `@/lib/ai/gemini-tts`, `@/lib/ai-tracking/service`, and
 *     `@/lib/supabase/admin` are all mocked at the module boundary. The
 *     admin mock exposes an in-memory chainable builder plus a fake
 *     storage API so we can assert both DB and Storage side effects
 *     without booting a real Supabase project.
 */

import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { randomUUID } from "node:crypto";

// ──────────────────────────────────────────────────────────────────────────
//  In-memory DB
// ──────────────────────────────────────────────────────────────────────────

type AudioRow = {
  id: string;
  tenant_id: string;
  summary_id: string;
  storage_path: string;
  duration_seconds: number | null;
  voice: string | null;
  speed: number | null;
  model: string | null;
  size_bytes: number | null;
  delivered_to_whatsapp: boolean;
  delivered_at: string | null;
  created_at: string;
};

type SummaryRow = {
  id: string;
  tenant_id: string;
  text: string;
  status: "pending_review" | "approved" | "rejected";
  prompt_version: string | null;
  voice_mode: "single" | "duo";
};

const db = {
  audios: [] as AudioRow[],
  summaries: [] as SummaryRow[],
};

type StorageObject = {
  path: string;
  contentType: string;
  bytes: number;
};

const storageState = {
  uploaded: [] as StorageObject[],
  removed: [] as string[],
  /** When set, next upload fails with this message. */
  nextUploadError: null as string | null,
};

function resetAll() {
  db.audios = [];
  db.summaries = [];
  storageState.uploaded = [];
  storageState.removed = [];
  storageState.nextUploadError = null;
}

// ──────────────────────────────────────────────────────────────────────────
//  Builder
// ──────────────────────────────────────────────────────────────────────────

type AnyRow = Record<string, unknown>;
type FilterOp = { col: string; val: unknown };

function makeBuilder(table: keyof typeof db) {
  const state: {
    filters: FilterOp[];
    orders: Array<{ col: string; ascending: boolean }>;
    limit?: number;
    op:
      | { kind: "select"; columns: string }
      | { kind: "insert"; row: AnyRow };
    selectAfter: boolean;
    // Forced error for this run — lets tests simulate DB failures.
    forcedError: { message: string } | null;
  } = {
    filters: [],
    orders: [],
    op: { kind: "select", columns: "*" },
    selectAfter: false,
    forcedError: null,
  };

  const api: Record<string, (...args: unknown[]) => unknown> = {};

  api.select = (cols?: unknown) => {
    if (state.op.kind === "select") {
      state.op.columns = (cols as string) ?? "*";
    } else {
      state.selectAfter = true;
    }
    return api;
  };
  api.insert = (row: unknown) => {
    state.op = { kind: "insert", row: row as AnyRow };
    return api;
  };
  api.eq = (col: unknown, val: unknown) => {
    state.filters.push({ col: col as string, val });
    return api;
  };
  api.order = (col: unknown, opts?: unknown) => {
    state.orders.push({
      col: col as string,
      ascending:
        (opts as { ascending?: boolean } | undefined)?.ascending ?? true,
    });
    return api;
  };
  api.limit = (n: unknown) => {
    state.limit = n as number;
    return api;
  };

  const applyFilters = (rows: AnyRow[]): AnyRow[] =>
    rows.filter((r) => state.filters.every((f) => r[f.col] === f.val));

  const applyOrder = (rows: AnyRow[]): AnyRow[] => {
    if (state.orders.length === 0) return rows;
    const out = [...rows];
    out.sort((a, b) => {
      for (const o of state.orders) {
        const av = a[o.col];
        const bv = b[o.col];
        const as = String(av ?? "");
        const bs = String(bv ?? "");
        const cmp = as < bs ? -1 : as > bs ? 1 : 0;
        if (cmp !== 0) return o.ascending ? cmp : -cmp;
      }
      return 0;
    });
    return out;
  };

  const run = (): {
    data: AnyRow | AnyRow[] | null;
    error: { message: string } | null;
  } => {
    if (state.forcedError) return { data: null, error: state.forcedError };
    const rows = db[table] as AnyRow[];
    switch (state.op.kind) {
      case "select": {
        let out = applyFilters(rows);
        out = applyOrder(out);
        if (state.limit !== undefined) out = out.slice(0, state.limit);
        return { data: out, error: null };
      }
      case "insert": {
        const inserted: AnyRow = {
          id: randomUUID(),
          created_at: new Date().toISOString(),
          ...state.op.row,
        };
        rows.push(inserted);
        return { data: state.selectAfter ? inserted : null, error: null };
      }
    }
  };

  api.maybeSingle = async () => {
    const res = run();
    if (Array.isArray(res.data)) {
      return { data: res.data[0] ?? null, error: res.error };
    }
    return res;
  };
  api.single = async () => {
    const res = run();
    if (Array.isArray(res.data)) {
      if (res.data.length === 0) {
        return { data: null, error: { message: "no row" } };
      }
      return { data: res.data[0], error: res.error };
    }
    return res;
  };

  (api as unknown as { then: PromiseLike<unknown>["then"] }).then = function (
    onfulfilled,
    onrejected,
  ) {
    const res = run();
    return Promise.resolve(res).then(
      onfulfilled as never,
      onrejected as never,
    );
  };

  return api;
}

// ──────────────────────────────────────────────────────────────────────────
//  Mocks — must be installed BEFORE importing the service
// ──────────────────────────────────────────────────────────────────────────

vi.mock("@/lib/ai/gemini-tts", () => ({
  generateAudio: vi.fn(),
}));

vi.mock("@/lib/ai-tracking/service", () => ({
  trackAiCall: vi.fn(async () => ({ id: "tracked" })),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table !== "audios" && table !== "summaries") {
        throw new Error(`Unexpected table in mock: ${table}`);
      }
      return makeBuilder(table as keyof typeof db);
    },
    storage: {
      from: (bucket: string) => ({
        upload: async (
          path: string,
          buffer: Buffer,
          opts: { contentType: string },
        ) => {
          if (bucket !== "audios") {
            return { error: { message: `wrong bucket: ${bucket}` } };
          }
          if (storageState.nextUploadError) {
            const msg = storageState.nextUploadError;
            storageState.nextUploadError = null;
            return { error: { message: msg } };
          }
          storageState.uploaded.push({
            path,
            contentType: opts.contentType,
            bytes: buffer.byteLength,
          });
          return { error: null };
        },
        remove: async (paths: string[]) => {
          storageState.removed.push(...paths);
          return { error: null };
        },
      }),
    },
  }),
}));

let service: typeof import("../lib/audios/service");
let ttsModule: typeof import("../lib/ai/gemini-tts");
let trackingModule: typeof import("../lib/ai-tracking/service");

beforeAll(async () => {
  service = await import("../lib/audios/service");
  ttsModule = await import("../lib/ai/gemini-tts");
  trackingModule = await import("../lib/ai-tracking/service");
});

beforeEach(() => {
  resetAll();
  vi.mocked(ttsModule.generateAudio).mockReset();
  vi.mocked(trackingModule.trackAiCall).mockReset();
  vi.mocked(trackingModule.trackAiCall).mockResolvedValue({ id: "tracked" });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ──────────────────────────────────────────────────────────────────────────
//  Fixtures
// ──────────────────────────────────────────────────────────────────────────

const TENANT_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const TENANT_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

function seedSummary(partial: Partial<SummaryRow> = {}): SummaryRow {
  const row: SummaryRow = {
    id: randomUUID(),
    tenant_id: TENANT_A,
    text: "Hello world, this is the approved summary.",
    status: "approved",
    prompt_version: "v1",
    voice_mode: "single",
    ...partial,
  };
  db.summaries.push(row);
  return row;
}

function seedAudio(partial: Partial<AudioRow> = {}): AudioRow {
  const row: AudioRow = {
    id: randomUUID(),
    tenant_id: TENANT_A,
    summary_id: randomUUID(),
    storage_path: `${TENANT_A}/2026/some.wav`,
    duration_seconds: 12,
    voice: "female",
    speed: 1,
    model: "gemini-2.5-flash-preview-tts",
    size_bytes: 12345,
    delivered_to_whatsapp: false,
    delivered_at: null,
    created_at: new Date().toISOString(),
    ...partial,
  };
  db.audios.push(row);
  return row;
}

// ──────────────────────────────────────────────────────────────────────────
//  getAudioBySummary
// ──────────────────────────────────────────────────────────────────────────

describe("getAudioBySummary", () => {
  it("returns the view for a matching row", async () => {
    const summaryId = randomUUID();
    const row = seedAudio({ summary_id: summaryId });

    const view = await service.getAudioBySummary(TENANT_A, summaryId);
    expect(view).not.toBeNull();
    expect(view!.id).toBe(row.id);
    expect(view!.summaryId).toBe(summaryId);
    expect(view!.tenantId).toBe(TENANT_A);
    expect(view!.deliveredToWhatsapp).toBe(false);
  });

  it("returns null when there is no matching row", async () => {
    const out = await service.getAudioBySummary(TENANT_A, randomUUID());
    expect(out).toBeNull();
  });

  it("returns null for a row owned by a different tenant", async () => {
    const summaryId = randomUUID();
    seedAudio({ summary_id: summaryId, tenant_id: TENANT_B });
    expect(await service.getAudioBySummary(TENANT_A, summaryId)).toBeNull();
  });
});

// ──────────────────────────────────────────────────────────────────────────
//  listAudios
// ──────────────────────────────────────────────────────────────────────────

describe("listAudios", () => {
  it("returns empty when the tenant has no rows", async () => {
    expect(await service.listAudios(TENANT_A)).toEqual([]);
  });

  it("scopes to the tenant and returns newest first", async () => {
    const older = seedAudio({
      created_at: new Date(Date.now() - 10_000).toISOString(),
    });
    const newer = seedAudio({
      created_at: new Date().toISOString(),
    });
    seedAudio({ tenant_id: TENANT_B });

    const out = await service.listAudios(TENANT_A);
    expect(out.map((a) => a.id)).toEqual([newer.id, older.id]);
  });

  it("respects the limit option", async () => {
    for (let i = 0; i < 5; i++) {
      seedAudio({
        created_at: new Date(Date.now() - i * 1000).toISOString(),
      });
    }
    const out = await service.listAudios(TENANT_A, { limit: 2 });
    expect(out).toHaveLength(2);
  });
});

// ──────────────────────────────────────────────────────────────────────────
//  createAudioForSummary
// ──────────────────────────────────────────────────────────────────────────

describe("createAudioForSummary", () => {
  it("happy path: loads summary, calls Gemini, uploads, inserts row, tracks call", async () => {
    const summary = seedSummary({ status: "approved", text: "Resumo do dia." });
    const fakeWav = Buffer.from("FAKEWAVDATA");
    vi.mocked(ttsModule.generateAudio).mockResolvedValue({
      audio: fakeWav,
      mimeType: "audio/wav",
      durationSeconds: 4.2,
      model: "gemini-2.5-flash-preview-tts",
    });

    const view = await service.createAudioForSummary(TENANT_A, summary.id, {
      voice: "female",
      speed: 1,
    });

    // Gemini called with the summary text.
    expect(ttsModule.generateAudio).toHaveBeenCalledWith({
      text: "Resumo do dia.",
      voice: "female",
      speed: 1,
      mode: "single",
    });

    // Storage upload happened.
    expect(storageState.uploaded).toHaveLength(1);
    const uploaded = storageState.uploaded[0];
    expect(uploaded.path).toBe(
      `${TENANT_A}/${new Date().getUTCFullYear()}/${summary.id}.wav`,
    );
    expect(uploaded.contentType).toBe("audio/wav");
    expect(uploaded.bytes).toBe(fakeWav.byteLength);

    // DB row inserted.
    expect(db.audios).toHaveLength(1);
    const persisted = db.audios[0];
    expect(persisted.tenant_id).toBe(TENANT_A);
    expect(persisted.summary_id).toBe(summary.id);
    expect(persisted.storage_path).toBe(uploaded.path);
    expect(persisted.size_bytes).toBe(fakeWav.byteLength);
    expect(persisted.duration_seconds).toBe(4);
    expect(persisted.model).toBe("gemini-2.5-flash-preview-tts");
    expect(persisted.voice).toBe("female");

    // View returned correctly.
    expect(view.id).toBe(persisted.id);
    expect(view.storagePath).toBe(uploaded.path);
    expect(view.voice).toBe("female");
  });

  it("calls trackAiCall on success (best-effort)", async () => {
    const summary = seedSummary({ status: "approved" });
    vi.mocked(ttsModule.generateAudio).mockResolvedValue({
      audio: Buffer.from("X"),
      mimeType: "audio/wav",
      durationSeconds: 1,
      model: "gemini-2.5-flash-preview-tts",
    });

    await service.createAudioForSummary(TENANT_A, summary.id);

    // `void trackAiCall(...)` — give the microtask queue a tick to run it.
    await Promise.resolve();
    expect(trackingModule.trackAiCall).toHaveBeenCalledTimes(1);
    const callArg = vi.mocked(trackingModule.trackAiCall).mock.calls[0][0];
    expect(callArg.tenantId).toBe(TENANT_A);
    expect(callArg.summaryId).toBe(summary.id);
    expect(callArg.provider).toBe("gemini");
    expect(callArg.operation).toBe("tts");
    expect(callArg.model).toBe("gemini-2.5-flash-preview-tts");
    expect(typeof callArg.durationMs).toBe("number");
  });

  it("throws NOT_FOUND when the summary does not exist", async () => {
    await expect(
      service.createAudioForSummary(TENANT_A, randomUUID()),
    ).rejects.toMatchObject({
      name: "AudiosError",
      code: "NOT_FOUND",
    });
    expect(ttsModule.generateAudio).not.toHaveBeenCalled();
    expect(storageState.uploaded).toHaveLength(0);
    expect(db.audios).toHaveLength(0);
  });

  it("throws NOT_FOUND when the summary belongs to another tenant", async () => {
    const summary = seedSummary({
      tenant_id: TENANT_B,
      status: "approved",
    });
    await expect(
      service.createAudioForSummary(TENANT_A, summary.id),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("throws NOT_FOUND when the summary is not approved", async () => {
    const summary = seedSummary({ status: "pending_review" });
    await expect(
      service.createAudioForSummary(TENANT_A, summary.id),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(ttsModule.generateAudio).not.toHaveBeenCalled();
  });

  it("throws ALREADY_EXISTS when an audio row already exists for the summary", async () => {
    const summary = seedSummary({ status: "approved" });
    seedAudio({ summary_id: summary.id });

    await expect(
      service.createAudioForSummary(TENANT_A, summary.id),
    ).rejects.toMatchObject({
      name: "AudiosError",
      code: "ALREADY_EXISTS",
    });
    expect(ttsModule.generateAudio).not.toHaveBeenCalled();
    expect(storageState.uploaded).toHaveLength(0);
    // The original row is still there; no new row appended.
    expect(db.audios).toHaveLength(1);
  });

  it("wraps Gemini failures as TTS_ERROR and does NOT upload or insert", async () => {
    const summary = seedSummary({ status: "approved" });
    vi.mocked(ttsModule.generateAudio).mockRejectedValue(
      new Error("gemini down"),
    );

    await expect(
      service.createAudioForSummary(TENANT_A, summary.id),
    ).rejects.toMatchObject({
      name: "AudiosError",
      code: "TTS_ERROR",
      message: expect.stringContaining("gemini down"),
    });

    expect(storageState.uploaded).toHaveLength(0);
    expect(db.audios).toHaveLength(0);
    expect(trackingModule.trackAiCall).not.toHaveBeenCalled();
  });
});
