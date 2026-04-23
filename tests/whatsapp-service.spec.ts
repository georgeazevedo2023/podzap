/**
 * Unit tests for lib/whatsapp/service.ts
 *
 * Strategy: pure mocks.
 *   - UazapiClient is replaced via `vi.mock("@/lib/uazapi/client")` with an
 *     object-spy whose methods we swap per test.
 *   - The Supabase admin client is replaced by an in-memory fake that
 *     mimics the chainable builder surface (`from().select().eq().…`). The
 *     fake is keyed on table name and supports select / insert / update /
 *     delete with the WHERE-clause chaining the service actually uses.
 *
 * Keeping the fake narrow: we do NOT attempt to reimplement PostgREST — we
 * only mirror the shape the service expects, which keeps the tests
 * deterministic and fast (<10ms each).
 */

import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";

// ──────────────────────────────────────────────────────────────────────────
//  Shared fixtures / in-memory DB
// ──────────────────────────────────────────────────────────────────────────

type Row = {
  id: string;
  tenant_id: string;
  uazapi_instance_id: string;
  uazapi_token_encrypted: string | null;
  status: "disconnected" | "connecting" | "qrcode" | "connected";
  phone: string | null;
  connected_at: string | null;
  last_seen_at: string | null;
  created_at: string;
  updated_at: string;
};

const db = {
  whatsapp_instances: [] as Row[],
};

function resetDb() {
  db.whatsapp_instances = [];
}

/**
 * Chainable query builder that matches the subset of supabase-js the
 * service uses. Filters are applied at terminator time (maybeSingle,
 * single, or the promise `then`).
 */
function makeBuilder(table: keyof typeof db) {
  const state: {
    filters: Array<{ col: string; val: unknown }>;
    order?: { col: string; ascending: boolean };
    limit?: number;
    // pending op
    op:
      | { kind: "select" }
      | { kind: "insert"; row: Partial<Row> }
      | { kind: "update"; patch: Partial<Row> }
      | { kind: "delete" };
    selectAfter: boolean;
  } = {
    filters: [],
    op: { kind: "select" },
    selectAfter: false,
  };

  const applyFilters = (rows: Row[]) =>
    rows.filter((r) =>
      state.filters.every(
        (f) => (r as unknown as Record<string, unknown>)[f.col] === f.val,
      ),
    );

  const api: Record<string, (...args: unknown[]) => unknown> = {};

  api.select = () => {
    if (state.op.kind === "select") {
      // no-op, the kind is already select
    } else {
      // insert/update/delete followed by .select("*"): remember to return
      // rows after the mutation terminator.
      state.selectAfter = true;
    }
    return api;
  };
  api.insert = (row: unknown) => {
    state.op = { kind: "insert", row: row as Partial<Row> };
    return api;
  };
  api.update = (patch: unknown) => {
    state.op = { kind: "update", patch: patch as Partial<Row> };
    return api;
  };
  api.delete = () => {
    state.op = { kind: "delete" };
    return api;
  };
  api.eq = (col: unknown, val: unknown) => {
    state.filters.push({ col: col as string, val });
    return api;
  };
  api.order = (col: unknown, opts: unknown) => {
    state.order = {
      col: col as string,
      ascending: (opts as { ascending?: boolean } | undefined)?.ascending ?? true,
    };
    return api;
  };
  api.limit = (n: unknown) => {
    state.limit = n as number;
    return api;
  };

  const run = (): { data: Row | Row[] | null; error: { message: string } | null } => {
    const rows = db[table];
    switch (state.op.kind) {
      case "select": {
        let out = applyFilters(rows);
        if (state.order) {
          out = [...out].sort((a, b) => {
            const av = (a as unknown as Record<string, string>)[state.order!.col] ?? "";
            const bv = (b as unknown as Record<string, string>)[state.order!.col] ?? "";
            const cmp = av < bv ? -1 : av > bv ? 1 : 0;
            return state.order!.ascending ? cmp : -cmp;
          });
        }
        if (state.limit !== undefined) out = out.slice(0, state.limit);
        return { data: out, error: null };
      }
      case "insert": {
        const now = new Date().toISOString();
        const defaults: Row = {
          id: randomUUID(),
          tenant_id: "",
          uazapi_instance_id: "",
          uazapi_token_encrypted: null,
          status: "disconnected",
          phone: null,
          connected_at: null,
          last_seen_at: null,
          created_at: now,
          updated_at: now,
        };
        const newRow: Row = { ...defaults, ...(state.op.row as Row) };
        (db[table] as Row[]).push(newRow);
        return { data: newRow, error: null };
      }
      case "update": {
        const matches = applyFilters(rows);
        if (matches.length === 0) {
          return { data: null, error: { message: "no row matched" } };
        }
        const target = matches[0];
        Object.assign(target, state.op.patch, {
          updated_at: new Date().toISOString(),
        });
        return { data: target, error: null };
      }
      case "delete": {
        const matches = applyFilters(rows);
        for (const m of matches) {
          const idx = (db[table] as Row[]).indexOf(m);
          if (idx >= 0) (db[table] as Row[]).splice(idx, 1);
        }
        return { data: null, error: null };
      }
    }
  };

  // Terminators: maybeSingle / single return { data, error } where `data`
  // is a single row or null.
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

  // Thenable: for the `await supabase.from(...).select().eq(...).limit(...)`
  // pattern used by `getCurrentInstance`. PromiseLike-compatible signature.
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
//  Mocks — installed BEFORE importing the service
// ──────────────────────────────────────────────────────────────────────────

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table !== "whatsapp_instances") {
        throw new Error(`Unexpected table in mock: ${table}`);
      }
      return makeBuilder("whatsapp_instances");
    },
  }),
}));

// Spy stubs for the UAZAPI client. Each test swaps these as needed.
const uazapiSpy = {
  createInstance: vi.fn(),
  getInstanceStatus: vi.fn(),
  getQrCode: vi.fn(),
  deleteInstance: vi.fn(),
};

vi.mock("@/lib/uazapi/client", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/uazapi/client")>(
      "@/lib/uazapi/client",
    );
  // Use a real class shim rather than vi.fn() so `new UazapiClient(...)`
  // returns the spy object directly. vi.fn().mockImplementation(...) does
  // not always wire `new` to the factory in newer Vitest.
  class UazapiClientStub {
    constructor(_baseUrl: string, _token: string) {
      return uazapiSpy as unknown as InstanceType<typeof actual.UazapiClient>;
    }
  }
  return {
    ...actual,
    UazapiClient: UazapiClientStub,
  };
});

// ──────────────────────────────────────────────────────────────────────────
//  Env setup for lib/crypto
// ──────────────────────────────────────────────────────────────────────────

const ORIGINAL_KEY = process.env.ENCRYPTION_KEY;

beforeAll(() => {
  process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64");
  process.env.UAZAPI_BASE_URL = "https://test.uazapi.example";
  process.env.UAZAPI_ADMIN_TOKEN = "test-admin-token";
});

afterAll(() => {
  if (ORIGINAL_KEY === undefined) delete process.env.ENCRYPTION_KEY;
  else process.env.ENCRYPTION_KEY = ORIGINAL_KEY;
});

// Late import so the mocks above take effect.
let service: typeof import("../lib/whatsapp/service");
let crypto: typeof import("../lib/crypto");
let uazapiMod: typeof import("../lib/uazapi/client");

beforeAll(async () => {
  service = await import("../lib/whatsapp/service");
  crypto = await import("../lib/crypto");
  uazapiMod = await import("../lib/uazapi/client");
});

beforeEach(() => {
  resetDb();
  uazapiSpy.createInstance.mockReset();
  uazapiSpy.getInstanceStatus.mockReset();
  uazapiSpy.getQrCode.mockReset();
  uazapiSpy.deleteInstance.mockReset();
});

// ──────────────────────────────────────────────────────────────────────────
//  Helpers
// ──────────────────────────────────────────────────────────────────────────

const TENANT_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const TENANT_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

function seedRow(partial: Partial<Row> = {}): Row {
  const now = new Date().toISOString();
  const row: Row = {
    id: randomUUID(),
    tenant_id: TENANT_A,
    uazapi_instance_id: `uaz-${randomUUID()}`,
    uazapi_token_encrypted: crypto.encrypt("plain-token"),
    status: "connecting",
    phone: null,
    connected_at: null,
    last_seen_at: null,
    created_at: now,
    updated_at: now,
    ...partial,
  };
  db.whatsapp_instances.push(row);
  return row;
}

// ──────────────────────────────────────────────────────────────────────────
//  Tests
// ──────────────────────────────────────────────────────────────────────────

describe("getCurrentInstance", () => {
  it("returns null when the tenant has no rows", async () => {
    expect(await service.getCurrentInstance(TENANT_A)).toBeNull();
  });

  it("returns the most-recently-created row when multiple exist", async () => {
    const old = seedRow({
      created_at: new Date(Date.now() - 60_000).toISOString(),
      status: "disconnected",
    });
    const latest = seedRow({
      created_at: new Date().toISOString(),
      status: "connected",
    });
    // Also seed a row for a different tenant to make sure scoping works.
    seedRow({ tenant_id: TENANT_B, status: "connected" });

    const got = await service.getCurrentInstance(TENANT_A);
    expect(got).not.toBeNull();
    expect(got!.id).toBe(latest.id);
    expect(got!.status).toBe("connected");
    expect(got!.id).not.toBe(old.id);
  });
});

describe("createInstanceForTenant", () => {
  it("throws ALREADY_CONNECTED when the tenant already has a connected instance", async () => {
    seedRow({ status: "connected" });
    await expect(
      service.createInstanceForTenant(TENANT_A),
    ).rejects.toMatchObject({
      name: "WhatsappError",
      code: "ALREADY_CONNECTED",
    });
    expect(uazapiSpy.createInstance).not.toHaveBeenCalled();
  });

  it("inserts a row with an encrypted token that decrypts back to the original", async () => {
    const secretToken = "uazapi-secret-token-xyz";
    uazapiSpy.createInstance.mockResolvedValueOnce({
      id: "uaz-new-1",
      token: secretToken,
      name: "podzap-test",
      status: "connecting",
    });

    const view = await service.createInstanceForTenant(TENANT_A, "my-instance");

    expect(view.status).toBe("connecting");
    expect(view.uazapiInstanceId).toBe("uaz-new-1");
    expect(view.qrCodeBase64).toBeNull();

    // DB should have exactly one row with an encrypted token.
    expect(db.whatsapp_instances).toHaveLength(1);
    const stored = db.whatsapp_instances[0];
    expect(stored.uazapi_token_encrypted).toBeTruthy();
    expect(stored.uazapi_token_encrypted).not.toEqual(secretToken);

    // Round-trip: decrypt matches the original plaintext.
    expect(crypto.decrypt(stored.uazapi_token_encrypted!)).toBe(secretToken);
  });

  it("falls back to a default instance name when none is passed", async () => {
    uazapiSpy.createInstance.mockResolvedValueOnce({
      id: "uaz-auto",
      token: "tok",
      name: "unused",
      status: "connecting",
    });
    await service.createInstanceForTenant(TENANT_A);
    const callArg = uazapiSpy.createInstance.mock.calls[0]?.[0] as string;
    expect(callArg).toMatch(/^podzap-[0-9a-f]{1,8}-\d+$/);
  });

  it("wraps UAZAPI failures in WhatsappError('UAZAPI_ERROR')", async () => {
    uazapiSpy.createInstance.mockRejectedValueOnce(
      new uazapiMod.UazapiError({
        status: 500,
        message: "boom",
      }),
    );
    await expect(
      service.createInstanceForTenant(TENANT_A),
    ).rejects.toMatchObject({ name: "WhatsappError", code: "UAZAPI_ERROR" });
  });
});

describe("refreshInstanceStatus", () => {
  it("updates the status and last_seen_at on the matched row", async () => {
    const row = seedRow({ status: "connecting", connected_at: null });
    uazapiSpy.getInstanceStatus.mockResolvedValueOnce("connecting");

    const view = await service.refreshInstanceStatus(TENANT_A, row.id);
    expect(view.status).toBe("connecting");

    const stored = db.whatsapp_instances[0];
    expect(stored.status).toBe("connecting");
    expect(stored.last_seen_at).toBeTruthy();
    expect(stored.connected_at).toBeNull();
    expect(uazapiSpy.getInstanceStatus).toHaveBeenCalledTimes(1);
  });

  it("sets connected_at exactly once when transitioning to connected", async () => {
    const row = seedRow({ status: "connecting", connected_at: null });
    uazapiSpy.getInstanceStatus.mockResolvedValueOnce("connected");
    const v1 = await service.refreshInstanceStatus(TENANT_A, row.id);
    expect(v1.status).toBe("connected");
    const firstConnectedAt = db.whatsapp_instances[0].connected_at;
    expect(firstConnectedAt).toBeTruthy();

    // Second refresh — still connected — connected_at must be preserved,
    // not rewritten.
    uazapiSpy.getInstanceStatus.mockResolvedValueOnce("connected");
    await new Promise((r) => setTimeout(r, 5));
    await service.refreshInstanceStatus(TENANT_A, row.id);
    expect(db.whatsapp_instances[0].connected_at).toBe(firstConnectedAt);
  });

  it("throws NOT_FOUND when the instance doesn't exist", async () => {
    await expect(
      service.refreshInstanceStatus(TENANT_A, "00000000-0000-0000-0000-000000000000"),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("throws NOT_FOUND when the instance belongs to another tenant", async () => {
    const row = seedRow({ tenant_id: TENANT_B, status: "connected" });
    await expect(
      service.refreshInstanceStatus(TENANT_A, row.id),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("getQrCodeForInstance", () => {
  it("returns the base64 QR when status is not connected", async () => {
    const row = seedRow({ status: "connecting" });
    uazapiSpy.getQrCode.mockResolvedValueOnce({
      qrCodeBase64: "AAA=",
      status: "connecting",
    });
    const r = await service.getQrCodeForInstance(TENANT_A, row.id);
    expect(r.status).toBe("connecting");
    expect(r.qrCodeBase64).toBe("AAA=");
  });

  it("returns { qrCodeBase64: null, status: 'connected' } when already logged in", async () => {
    const row = seedRow({ status: "connected" });
    uazapiSpy.getQrCode.mockResolvedValueOnce({
      qrCodeBase64: "shouldBeHidden",
      status: "connected",
    });
    const r = await service.getQrCodeForInstance(TENANT_A, row.id);
    expect(r.status).toBe("connected");
    expect(r.qrCodeBase64).toBeNull();
  });

  it("returns null qr when UAZAPI returns an empty string", async () => {
    const row = seedRow({ status: "connecting" });
    uazapiSpy.getQrCode.mockResolvedValueOnce({
      qrCodeBase64: "",
      status: "connecting",
    });
    const r = await service.getQrCodeForInstance(TENANT_A, row.id);
    expect(r.qrCodeBase64).toBeNull();
  });

  it("throws NOT_FOUND for the wrong tenant", async () => {
    const row = seedRow({ tenant_id: TENANT_B });
    await expect(
      service.getQrCodeForInstance(TENANT_A, row.id),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("disconnectInstance", () => {
  it("calls UAZAPI delete and removes the DB row", async () => {
    const row = seedRow({ status: "connected" });
    uazapiSpy.deleteInstance.mockResolvedValueOnce(undefined);

    await service.disconnectInstance(TENANT_A, row.id);

    expect(uazapiSpy.deleteInstance).toHaveBeenCalledTimes(1);
    expect(db.whatsapp_instances).toHaveLength(0);
  });

  it("swallows a 404 from UAZAPI and still deletes the local row", async () => {
    const row = seedRow({ status: "connected" });
    uazapiSpy.deleteInstance.mockRejectedValueOnce(
      new uazapiMod.UazapiError({ status: 404, message: "not found" }),
    );

    await service.disconnectInstance(TENANT_A, row.id);
    expect(db.whatsapp_instances).toHaveLength(0);
  });

  it("propagates non-404 UAZAPI errors as WhatsappError('UAZAPI_ERROR')", async () => {
    const row = seedRow({ status: "connected" });
    uazapiSpy.deleteInstance.mockRejectedValueOnce(
      new uazapiMod.UazapiError({ status: 500, message: "boom" }),
    );

    await expect(
      service.disconnectInstance(TENANT_A, row.id),
    ).rejects.toMatchObject({ code: "UAZAPI_ERROR" });
    // Row left in place because the UAZAPI delete failed hard.
    expect(db.whatsapp_instances).toHaveLength(1);
  });

  it("throws NOT_FOUND when the instance belongs to another tenant", async () => {
    const row = seedRow({ tenant_id: TENANT_B });
    await expect(
      service.disconnectInstance(TENANT_A, row.id),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(uazapiSpy.deleteInstance).not.toHaveBeenCalled();
  });
});
