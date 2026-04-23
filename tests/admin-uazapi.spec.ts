/**
 * Unit tests for lib/admin/uazapi.ts — the superadmin service layer that
 * lists, attaches, detaches, and create-and-attaches UAZAPI instances.
 *
 * Strategy mirrors whatsapp-service.spec.ts:
 *   - In-memory fake of the chainable Supabase admin client, keyed on the
 *     two tables the service touches (`whatsapp_instances`, `tenants`).
 *   - `UazapiClient` replaced by a class shim whose methods are vi.fns so
 *     each test can set the return values it needs.
 *   - Real `lib/crypto` module — we just ensure ENCRYPTION_KEY is set.
 */

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { randomBytes, randomUUID } from "node:crypto";

// ──────────────────────────────────────────────────────────────────────────
//  In-memory DB fake
// ──────────────────────────────────────────────────────────────────────────

type InstanceRow = {
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

type TenantRow = {
  id: string;
  name: string;
  plan: string;
  is_active: boolean;
  delivery_target: string;
  include_caption_on_delivery: boolean;
  created_at: string;
  updated_at: string;
};

const db = {
  whatsapp_instances: [] as InstanceRow[],
  tenants: [] as TenantRow[],
};

function resetDb() {
  db.whatsapp_instances = [];
  db.tenants = [];
}

type AnyRow = InstanceRow | TenantRow;

/**
 * Minimal chainable builder — enough to cover the surface
 * `lib/admin/uazapi.ts` actually exercises. Terminators are `maybeSingle`,
 * `single`, and the PromiseLike `then` (for `await builder.select(...)`).
 */
function makeBuilder(table: keyof typeof db) {
  const state: {
    filters: Array<{ col: string; val: unknown }>;
    op:
      | { kind: "select"; cols?: string }
      | { kind: "insert"; row: Partial<AnyRow> }
      | { kind: "update"; patch: Partial<AnyRow> }
      | { kind: "delete" };
  } = {
    filters: [],
    op: { kind: "select" },
  };

  const applyFilters = <T extends AnyRow>(rows: T[]): T[] =>
    rows.filter((r) =>
      state.filters.every(
        (f) => (r as unknown as Record<string, unknown>)[f.col] === f.val,
      ),
    );

  const api: Record<string, (...args: unknown[]) => unknown> = {};

  api.select = (cols?: unknown) => {
    if (state.op.kind === "select") {
      state.op.cols = typeof cols === "string" ? cols : "*";
    }
    // For insert/update with `.select("*").single()` terminator, the op
    // stays as insert/update and the run() path returns the row.
    return api;
  };
  api.insert = (row: unknown) => {
    state.op = { kind: "insert", row: row as Partial<AnyRow> };
    return api;
  };
  api.update = (patch: unknown) => {
    state.op = { kind: "update", patch: patch as Partial<AnyRow> };
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

  const run = (): { data: AnyRow | AnyRow[] | null; error: { message: string } | null } => {
    const rows = db[table] as AnyRow[];
    switch (state.op.kind) {
      case "select":
        return { data: applyFilters(rows), error: null };
      case "insert": {
        const now = new Date().toISOString();
        if (table === "whatsapp_instances") {
          // Enforce UNIQUE (tenant_id) at the fake level so tests catch
          // double-attach bugs the same way the real DB would.
          const dup = (db.whatsapp_instances as InstanceRow[]).find(
            (r) =>
              r.tenant_id ===
              ((state.op as { row: Partial<InstanceRow> }).row.tenant_id ?? ""),
          );
          if (dup) {
            return {
              data: null,
              error: { message: "duplicate key value violates uniq_whatsapp_instances_tenant" },
            };
          }
          const defaults: InstanceRow = {
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
          const newRow: InstanceRow = {
            ...defaults,
            ...(state.op.row as InstanceRow),
          };
          db.whatsapp_instances.push(newRow);
          return { data: newRow, error: null };
        }
        // tenants insert (not exercised by A3 but keeps the fake general).
        const defaults: TenantRow = {
          id: randomUUID(),
          name: "",
          plan: "free",
          is_active: true,
          delivery_target: "",
          include_caption_on_delivery: false,
          created_at: now,
          updated_at: now,
        };
        const newRow: TenantRow = {
          ...defaults,
          ...(state.op.row as TenantRow),
        };
        db.tenants.push(newRow);
        return { data: newRow, error: null };
      }
      case "update": {
        const matches = applyFilters(rows);
        if (matches.length === 0) {
          return { data: null, error: { message: "no row matched" } };
        }
        Object.assign(matches[0], state.op.patch, {
          updated_at: new Date().toISOString(),
        });
        return { data: matches[0], error: null };
      }
      case "delete": {
        const matches = applyFilters(rows);
        for (const m of matches) {
          const idx = (rows as AnyRow[]).indexOf(m);
          if (idx >= 0) (rows as AnyRow[]).splice(idx, 1);
        }
        return { data: null, error: null };
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
//  Mocks — installed BEFORE the service import
// ──────────────────────────────────────────────────────────────────────────

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table !== "whatsapp_instances" && table !== "tenants") {
        throw new Error(`Unexpected table in mock: ${table}`);
      }
      return makeBuilder(table as keyof typeof db);
    },
  }),
}));

const uazapiSpy = {
  createInstance: vi.fn(),
  listInstances: vi.fn(),
  deleteInstance: vi.fn(),
  getInstanceStatus: vi.fn(),
  getQrCode: vi.fn(),
};

vi.mock("@/lib/uazapi/client", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/uazapi/client")>(
      "@/lib/uazapi/client",
    );
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
//  Env setup
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

// Late imports so the mocks take effect.
let service: typeof import("../lib/admin/uazapi");
let crypto: typeof import("../lib/crypto");

beforeAll(async () => {
  service = await import("../lib/admin/uazapi");
  crypto = await import("../lib/crypto");
});

beforeEach(() => {
  resetDb();
  uazapiSpy.createInstance.mockReset();
  uazapiSpy.listInstances.mockReset();
  uazapiSpy.deleteInstance.mockReset();
  uazapiSpy.getInstanceStatus.mockReset();
  uazapiSpy.getQrCode.mockReset();
});

// ──────────────────────────────────────────────────────────────────────────
//  Fixtures
// ──────────────────────────────────────────────────────────────────────────

const TENANT_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const TENANT_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

function seedTenant(partial: Partial<TenantRow> = {}): TenantRow {
  const now = new Date().toISOString();
  const row: TenantRow = {
    id: TENANT_A,
    name: "Acme",
    plan: "free",
    is_active: true,
    delivery_target: "",
    include_caption_on_delivery: false,
    created_at: now,
    updated_at: now,
    ...partial,
  };
  db.tenants.push(row);
  return row;
}

function seedInstanceRow(partial: Partial<InstanceRow> = {}): InstanceRow {
  const now = new Date().toISOString();
  const row: InstanceRow = {
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

/** Minimal UAZAPI Instance shape we pass through the client spy. */
function fakeUazapiInstance(
  overrides: Partial<{
    id: string;
    name: string;
    token: string;
    status: string;
    owner: string;
    profileName: string;
  }> = {},
) {
  return {
    id: overrides.id ?? `uaz-${randomUUID()}`,
    name: overrides.name ?? "instance-1",
    token: overrides.token ?? "uazapi-secret",
    status: overrides.status ?? "connected",
    owner: overrides.owner ?? "5511999999999@s.whatsapp.net",
    profileName: overrides.profileName ?? "Acme WA",
  };
}

// ──────────────────────────────────────────────────────────────────────────
//  Tests
// ──────────────────────────────────────────────────────────────────────────

describe("listAllInstances", () => {
  it("joins UAZAPI instances against local attachments and returns a sorted mix", async () => {
    seedTenant({ id: TENANT_A, name: "Acme" });

    const remoteAttached = fakeUazapiInstance({
      id: "uaz-attached",
      name: "bravo",
      status: "connected",
    });
    const remoteUnattached = fakeUazapiInstance({
      id: "uaz-free",
      name: "alpha",
      status: "disconnected",
      owner: "",
    });
    uazapiSpy.listInstances.mockResolvedValueOnce([
      remoteAttached,
      remoteUnattached,
    ]);

    seedInstanceRow({
      uazapi_instance_id: "uaz-attached",
      tenant_id: TENANT_A,
    });

    const out = await service.listAllInstances();
    expect(out.map((i) => i.name)).toEqual(["alpha", "bravo"]);

    const attached = out.find((i) => i.uazapiInstanceId === "uaz-attached")!;
    expect(attached.attachedTenantId).toBe(TENANT_A);
    expect(attached.attachedTenantName).toBe("Acme");
    expect(attached.localInstanceId).toBeTruthy();
    expect(attached.status).toBe("connected");
    expect(attached.phone).toBe("5511999999999");

    const free = out.find((i) => i.uazapiInstanceId === "uaz-free")!;
    expect(free.attachedTenantId).toBeNull();
    expect(free.attachedTenantName).toBeNull();
    expect(free.localInstanceId).toBeNull();
  });

  it("wraps UAZAPI failures in UazapiAdminError('UAZAPI_ERROR')", async () => {
    uazapiSpy.listInstances.mockRejectedValueOnce(new Error("boom"));
    await expect(service.listAllInstances()).rejects.toMatchObject({
      name: "UazapiAdminError",
      code: "UAZAPI_ERROR",
    });
  });
});

describe("attachInstance", () => {
  it("happy path: inserts local row with encrypted token + attached view", async () => {
    seedTenant({ id: TENANT_A, name: "Acme" });
    const remote = fakeUazapiInstance({
      id: "uaz-1",
      name: "inst",
      token: "tok-plain",
      status: "connected",
      owner: "5511555555555@s.whatsapp.net",
    });
    uazapiSpy.listInstances.mockResolvedValueOnce([remote]);

    const view = await service.attachInstance("uaz-1", TENANT_A);

    expect(view.uazapiInstanceId).toBe("uaz-1");
    expect(view.attachedTenantId).toBe(TENANT_A);
    expect(view.attachedTenantName).toBe("Acme");
    expect(view.localInstanceId).toBeTruthy();
    expect(view.phone).toBe("5511555555555");
    expect(view.status).toBe("connected");

    const [row] = db.whatsapp_instances;
    expect(row.tenant_id).toBe(TENANT_A);
    expect(row.uazapi_instance_id).toBe("uaz-1");
    expect(row.uazapi_token_encrypted).toBeTruthy();
    expect(row.uazapi_token_encrypted).not.toBe("tok-plain");
    expect(crypto.decrypt(row.uazapi_token_encrypted!)).toBe("tok-plain");
  });

  it("throws TENANT_NOT_FOUND when the tenant row is missing", async () => {
    uazapiSpy.listInstances.mockResolvedValue([]);
    await expect(
      service.attachInstance("uaz-x", TENANT_A),
    ).rejects.toMatchObject({ code: "TENANT_NOT_FOUND" });
    // Must not have called UAZAPI: the tenant check happens first.
    expect(uazapiSpy.listInstances).not.toHaveBeenCalled();
  });

  it("throws TENANT_ALREADY_HAS_INSTANCE (409) when tenant already attached", async () => {
    seedTenant({ id: TENANT_A });
    seedInstanceRow({ uazapi_instance_id: "uaz-existing", tenant_id: TENANT_A });
    await expect(
      service.attachInstance("uaz-new", TENANT_A),
    ).rejects.toMatchObject({ code: "TENANT_ALREADY_HAS_INSTANCE" });
  });

  it("throws NOT_FOUND when the UAZAPI instance doesn't exist on the gateway", async () => {
    seedTenant({ id: TENANT_A });
    uazapiSpy.listInstances.mockResolvedValueOnce([
      fakeUazapiInstance({ id: "uaz-other" }),
    ]);
    await expect(
      service.attachInstance("uaz-missing", TENANT_A),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("throws ALREADY_ATTACHED when the UAZAPI instance is attached to a different tenant", async () => {
    seedTenant({ id: TENANT_A, name: "Acme" });
    seedTenant({ id: TENANT_B, name: "Other" });
    // Existing attachment on TENANT_B for uaz-1.
    seedInstanceRow({ uazapi_instance_id: "uaz-1", tenant_id: TENANT_B });
    uazapiSpy.listInstances.mockResolvedValueOnce([
      fakeUazapiInstance({ id: "uaz-1" }),
    ]);
    await expect(
      service.attachInstance("uaz-1", TENANT_A),
    ).rejects.toMatchObject({ code: "ALREADY_ATTACHED" });
  });
});

describe("detachInstance", () => {
  it("happy path: deletes the local row for the tenant", async () => {
    seedTenant({ id: TENANT_A });
    seedInstanceRow({ uazapi_instance_id: "uaz-1", tenant_id: TENANT_A });
    expect(db.whatsapp_instances).toHaveLength(1);

    await service.detachInstance(TENANT_A);
    expect(db.whatsapp_instances).toHaveLength(0);
    // Must NOT call UAZAPI delete — detach is local-only.
    expect(uazapiSpy.deleteInstance).not.toHaveBeenCalled();
  });

  it("throws NOT_FOUND when tenant has no instance", async () => {
    seedTenant({ id: TENANT_A });
    await expect(service.detachInstance(TENANT_A)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("createAndAttach", () => {
  it("happy path: creates on UAZAPI + inserts local attachment", async () => {
    seedTenant({ id: TENANT_A, name: "Acme" });
    const remote = fakeUazapiInstance({
      id: "uaz-new-1",
      name: "onboarding-acme",
      token: "tok-new",
      status: "connecting",
    });
    uazapiSpy.createInstance.mockResolvedValueOnce(remote);

    const view = await service.createAndAttach(TENANT_A, "onboarding-acme");
    expect(view.uazapiInstanceId).toBe("uaz-new-1");
    expect(view.attachedTenantId).toBe(TENANT_A);
    expect(view.attachedTenantName).toBe("Acme");
    expect(view.status).toBe("connecting");

    expect(uazapiSpy.createInstance).toHaveBeenCalledWith("onboarding-acme");
    const [row] = db.whatsapp_instances;
    expect(row.tenant_id).toBe(TENANT_A);
    expect(crypto.decrypt(row.uazapi_token_encrypted!)).toBe("tok-new");
  });
});
