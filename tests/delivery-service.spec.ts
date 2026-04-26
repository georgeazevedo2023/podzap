/**
 * Unit tests for lib/delivery/service.ts (Fase 10).
 *
 * Strategy mirrors tests/audios-service.spec.ts + tests/whatsapp-service.spec.ts:
 *
 *   - `@/lib/supabase/admin` → in-memory chainable builder + storage stub.
 *   - `@/lib/uazapi/client` → constructor-spy; sendAudio is a vi.fn we swap
 *     per test to assert call args / simulate failures.
 *   - `@/lib/crypto` → decrypt returns a deterministic token string so the
 *     UazapiClient call args are predictable.
 *   - `@/lib/whatsapp/service` → we do NOT mock this; instead we seed the
 *     `whatsapp_instances` table and let the real `getCurrentInstance`
 *     read it through our admin mock. That keeps the NO_INSTANCE /
 *     INSTANCE_NOT_CONNECTED branches realistic.
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
  delivered_to_whatsapp: boolean;
  delivered_at: string | null;
  created_at: string;
};

type SummaryRow = {
  id: string;
  tenant_id: string;
  text: string;
  group_id: string;
};

type GroupRow = {
  id: string;
  tenant_id: string;
  uazapi_group_jid: string;
};

type WhatsappInstanceRow = {
  id: string;
  tenant_id: string;
  uazapi_instance_id: string;
  uazapi_token_encrypted: string | null;
  status: "disconnected" | "connecting" | "qrcode" | "connected";
  phone: string | null;
  connected_at: string | null;
  last_seen_at: string | null;
  created_at: string;
};

const db = {
  audios: [] as AudioRow[],
  summaries: [] as SummaryRow[],
  groups: [] as GroupRow[],
  whatsapp_instances: [] as WhatsappInstanceRow[],
};

type StorageState = {
  /** path → bytes. If missing → download returns { data: null, error } */
  blobs: Map<string, Buffer>;
  /** When set, next download returns an error with this message. */
  nextDownloadError: string | null;
};

const storageState: StorageState = {
  blobs: new Map(),
  nextDownloadError: null,
};

function resetAll() {
  db.audios = [];
  db.summaries = [];
  db.groups = [];
  db.whatsapp_instances = [];
  storageState.blobs = new Map();
  storageState.nextDownloadError = null;
}

// ──────────────────────────────────────────────────────────────────────────
//  Supabase builder
// ──────────────────────────────────────────────────────────────────────────

type AnyRow = Record<string, unknown>;

function makeBuilder(table: keyof typeof db) {
  const state: {
    filters: Array<{ col: string; val: unknown }>;
    orders: Array<{ col: string; ascending: boolean }>;
    limit?: number;
    op:
      | { kind: "select"; columns: string }
      | { kind: "update"; patch: AnyRow };
    selectAfter: boolean;
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
  api.update = (patch: unknown) => {
    state.op = { kind: "update", patch: patch as AnyRow };
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
      case "update": {
        const matched = applyFilters(rows);
        for (const r of matched) {
          Object.assign(r, state.op.patch);
        }
        return {
          data: state.selectAfter ? matched : null,
          error: null,
        };
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
//  Mocks — MUST be installed before the service is imported
// ──────────────────────────────────────────────────────────────────────────

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (
        table !== "audios" &&
        table !== "summaries" &&
        table !== "groups" &&
        table !== "whatsapp_instances"
      ) {
        throw new Error(`Unexpected table in mock: ${table}`);
      }
      return makeBuilder(table as keyof typeof db);
    },
    storage: {
      from: (bucket: string) => ({
        download: async (path: string) => {
          if (bucket !== "audios") {
            return {
              data: null,
              error: { message: `wrong bucket: ${bucket}` },
            };
          }
          if (storageState.nextDownloadError) {
            const msg = storageState.nextDownloadError;
            storageState.nextDownloadError = null;
            return { data: null, error: { message: msg } };
          }
          const buf = storageState.blobs.get(path);
          if (!buf) {
            return {
              data: null,
              error: { message: `not found: ${path}` },
            };
          }
          // Emulate a Blob — just the pieces the service actually uses.
          const blob = {
            arrayBuffer: async () =>
              buf.buffer.slice(
                buf.byteOffset,
                buf.byteOffset + buf.byteLength,
              ),
          };
          return { data: blob, error: null };
        },
      }),
    },
  }),
}));

vi.mock("@/lib/crypto", async () => {
  // Keep CryptoError real so `instanceof` checks in the service behave,
  // but stub decrypt to a known literal.
  const actual =
    await vi.importActual<typeof import("@/lib/crypto")>("@/lib/crypto");
  return {
    ...actual,
    decrypt: vi.fn((cipher: string) => `decrypted(${cipher})`),
  };
});

// Capture every UazapiClient instance + the last sendAudio args.
type UazapiInstance = {
  sendAudio: ReturnType<typeof vi.fn>;
};
const uazapiInstances: UazapiInstance[] = [];

/**
 * When a test needs sendAudio to throw, it pushes a factory here and
 * the next `new UazapiClient()` will use it instead of the default.
 */
const nextSendAudioImpls: Array<
  (...args: unknown[]) => Promise<unknown>
> = [];

vi.mock("@/lib/uazapi/client", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/uazapi/client")>(
      "@/lib/uazapi/client",
    );
  class MockUazapiClient {
    sendAudio: ReturnType<typeof vi.fn>;
    constructor(_baseUrl: string, _token: string) {
      const impl = nextSendAudioImpls.shift();
      this.sendAudio = vi.fn(
        impl
          ? (impl as (...args: unknown[]) => Promise<unknown>)
          // Default: succeed with a fake whatsapp message id. Mirrors the
          // SendMessageResponseSchema shape — { id?, status? }.
          : async () => ({ id: "msg_fake_uazapi_id" }),
      );
      uazapiInstances.push({ sendAudio: this.sendAudio });
    }
  }
  return {
    ...actual,
    UazapiClient: MockUazapiClient,
  };
});

let service: typeof import("../lib/delivery/service");
let uazapiModule: typeof import("../lib/uazapi/client");

beforeAll(async () => {
  service = await import("../lib/delivery/service");
  uazapiModule = await import("../lib/uazapi/client");
});

beforeEach(() => {
  resetAll();
  uazapiInstances.length = 0;
  nextSendAudioImpls.length = 0;
});

afterEach(() => {
  vi.clearAllMocks();
});

// ──────────────────────────────────────────────────────────────────────────
//  Fixtures
// ──────────────────────────────────────────────────────────────────────────

const TENANT_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const TENANT_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

function seedScenario(
  opts: {
    tenantId?: string;
    instanceStatus?: WhatsappInstanceRow["status"] | "missing";
    tokenEncrypted?: string | null;
    summaryText?: string;
    deliveredAlready?: boolean;
    jid?: string;
    audioBytes?: Buffer;
    omitStorageObject?: boolean;
  } = {},
) {
  const tenantId = opts.tenantId ?? TENANT_A;
  const groupId = randomUUID();
  const summaryId = randomUUID();
  const audioId = randomUUID();
  const storagePath = `${tenantId}/2026/${summaryId}.wav`;
  const jid = opts.jid ?? "120363999999999999@g.us";

  db.groups.push({
    id: groupId,
    tenant_id: tenantId,
    uazapi_group_jid: jid,
  });
  db.summaries.push({
    id: summaryId,
    tenant_id: tenantId,
    text: opts.summaryText ?? "Resumo do dia.",
    group_id: groupId,
  });
  db.audios.push({
    id: audioId,
    tenant_id: tenantId,
    summary_id: summaryId,
    storage_path: storagePath,
    delivered_to_whatsapp: opts.deliveredAlready ?? false,
    delivered_at: opts.deliveredAlready ? new Date().toISOString() : null,
    created_at: new Date().toISOString(),
  });

  if (opts.instanceStatus !== "missing") {
    db.whatsapp_instances.push({
      id: randomUUID(),
      tenant_id: tenantId,
      uazapi_instance_id: "uazapi-" + randomUUID().slice(0, 8),
      uazapi_token_encrypted:
        opts.tokenEncrypted === undefined
          ? "CIPHERTEXT-FOR-TENANT"
          : opts.tokenEncrypted,
      status: opts.instanceStatus ?? "connected",
      phone: null,
      connected_at: new Date().toISOString(),
      last_seen_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    });
  }

  if (!opts.omitStorageObject) {
    const bytes = opts.audioBytes ?? Buffer.from("FAKEWAVDATA");
    storageState.blobs.set(storagePath, bytes);
  }

  return {
    tenantId,
    audioId,
    summaryId,
    groupId,
    jid,
    storagePath,
  };
}

// ──────────────────────────────────────────────────────────────────────────
//  Tests
// ──────────────────────────────────────────────────────────────────────────

describe("deliverAudio", () => {
  it("happy path: downloads, sends, marks delivered", async () => {
    const { tenantId, audioId, jid, storagePath } = seedScenario({
      summaryText: "Fala pra galera.",
      audioBytes: Buffer.from("hello-wav"),
    });

    const view = await service.deliverAudio(tenantId, audioId, {
      includeCaption: true,
    });

    // UazapiClient was constructed and sendAudio called with the right args.
    expect(uazapiInstances).toHaveLength(1);
    const sendAudio = uazapiInstances[0].sendAudio;
    expect(sendAudio).toHaveBeenCalledTimes(1);
    const [token, to, buf, caption] = sendAudio.mock.calls[0];
    expect(token).toBe("decrypted(CIPHERTEXT-FOR-TENANT)");
    expect(to).toBe(jid);
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect((buf as Buffer).toString("utf8")).toBe("hello-wav");
    expect(caption).toBe("Fala pra galera.");

    // DeliveryView is shaped correctly.
    expect(view.audioId).toBe(audioId);
    expect(view.targetJid).toBe(jid);
    expect(view.deliveredToWhatsapp).toBe(true);
    expect(view.deliveredAt).toBeTypeOf("string");
    expect(view.error).toBeNull();

    // The audios row was flipped.
    const row = db.audios.find((r) => r.id === audioId)!;
    expect(row.delivered_to_whatsapp).toBe(true);
    expect(row.delivered_at).toBeTypeOf("string");

    // The storage object still exists (we downloaded, didn't delete).
    expect(storageState.blobs.has(storagePath)).toBe(true);
  });

  it("omits caption when includeCaption is false", async () => {
    const { tenantId, audioId } = seedScenario({
      summaryText: "Should not appear as caption.",
    });

    await service.deliverAudio(tenantId, audioId, { includeCaption: false });

    const sendAudio = uazapiInstances[0].sendAudio;
    const [, , , caption] = sendAudio.mock.calls[0];
    expect(caption).toBeUndefined();
  });

  it("defaults includeCaption to false when opts is omitted", async () => {
    const { tenantId, audioId } = seedScenario();

    await service.deliverAudio(tenantId, audioId);

    const [, , , caption] = uazapiInstances[0].sendAudio.mock.calls[0];
    expect(caption).toBeUndefined();
  });

  it("throws NOT_FOUND when the audio row is missing", async () => {
    await expect(
      service.deliverAudio(TENANT_A, randomUUID()),
    ).rejects.toMatchObject({
      name: "DeliveryError",
      code: "NOT_FOUND",
    });
    expect(uazapiInstances).toHaveLength(0);
  });

  it("throws NOT_FOUND when the audio belongs to another tenant", async () => {
    const { audioId } = seedScenario({ tenantId: TENANT_B });
    await expect(
      service.deliverAudio(TENANT_A, audioId),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("throws NO_INSTANCE when the tenant has no whatsapp instance", async () => {
    const { tenantId, audioId } = seedScenario({ instanceStatus: "missing" });

    await expect(
      service.deliverAudio(tenantId, audioId),
    ).rejects.toMatchObject({
      name: "DeliveryError",
      code: "NO_INSTANCE",
    });

    // Row should NOT be marked delivered.
    const row = db.audios.find((r) => r.id === audioId)!;
    expect(row.delivered_to_whatsapp).toBe(false);
  });

  it("throws INSTANCE_NOT_CONNECTED when the instance is still connecting", async () => {
    const { tenantId, audioId } = seedScenario({
      instanceStatus: "connecting",
    });

    await expect(
      service.deliverAudio(tenantId, audioId),
    ).rejects.toMatchObject({
      code: "INSTANCE_NOT_CONNECTED",
    });

    const row = db.audios.find((r) => r.id === audioId)!;
    expect(row.delivered_to_whatsapp).toBe(false);
    expect(uazapiInstances).toHaveLength(0);
  });

  it("throws INSTANCE_NOT_CONNECTED when disconnected", async () => {
    const { tenantId, audioId } = seedScenario({
      instanceStatus: "disconnected",
    });

    await expect(
      service.deliverAudio(tenantId, audioId),
    ).rejects.toMatchObject({
      code: "INSTANCE_NOT_CONNECTED",
    });
  });

  it("wraps UAZAPI errors and leaves delivered=false", async () => {
    const { tenantId, audioId } = seedScenario();

    // Pre-configure the NEXT UazapiClient so its sendAudio throws.
    nextSendAudioImpls.push(async () => {
      throw new uazapiModule.UazapiError({
        status: 502,
        code: "BAD_GATEWAY",
        message: "upstream crashed",
      });
    });

    await expect(
      service.deliverAudio(tenantId, audioId, { includeCaption: true }),
    ).rejects.toMatchObject({
      name: "DeliveryError",
      code: "UAZAPI_ERROR",
      message: expect.stringContaining("upstream crashed"),
    });

    // Row should NOT be marked delivered.
    const row = db.audios.find((r) => r.id === audioId)!;
    expect(row.delivered_to_whatsapp).toBe(false);
    expect(row.delivered_at).toBeNull();
  });

  it("short-circuits when already delivered (does not re-send)", async () => {
    const { tenantId, audioId, jid } = seedScenario({
      deliveredAlready: true,
    });

    const view = await service.deliverAudio(tenantId, audioId);

    expect(view.deliveredToWhatsapp).toBe(true);
    expect(view.targetJid).toBe(jid);
    // No UazapiClient was instantiated.
    expect(uazapiInstances).toHaveLength(0);
  });
});

describe("redeliver", () => {
  it("re-sends even when already delivered", async () => {
    const { tenantId, audioId, jid } = seedScenario({
      deliveredAlready: true,
      summaryText: "Segunda tentativa.",
    });

    const view = await service.redeliver(tenantId, audioId, {
      includeCaption: true,
    });

    expect(view.deliveredToWhatsapp).toBe(true);
    expect(view.targetJid).toBe(jid);

    // UAZAPI was actually called this time.
    expect(uazapiInstances).toHaveLength(1);
    expect(uazapiInstances[0].sendAudio).toHaveBeenCalledTimes(1);

    // delivered_at gets refreshed.
    const row = db.audios.find((r) => r.id === audioId)!;
    expect(row.delivered_to_whatsapp).toBe(true);
    expect(row.delivered_at).toBeTypeOf("string");
  });

  it("still throws NOT_FOUND for a missing audio", async () => {
    await expect(
      service.redeliver(TENANT_A, randomUUID()),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
