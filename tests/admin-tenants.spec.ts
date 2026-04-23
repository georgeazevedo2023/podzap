/**
 * Unit tests for lib/admin/tenants.ts
 *
 * Strategy mirrors tests/groups-service.spec.ts: pure in-memory fake of the
 * supabase admin client with a chainable builder covering the subset the
 * service uses. Service role bypass + gating is irrelevant here because we
 * mock the DB directly — we just verify the service's business rules.
 */

import {
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

type MemberRow = {
  tenant_id: string;
  user_id: string;
  role: "owner" | "admin" | "member";
  joined_at: string;
  created_at: string;
};

type InstanceRow = {
  id: string;
  tenant_id: string;
};

const db = {
  tenants: [] as TenantRow[],
  tenant_members: [] as MemberRow[],
  whatsapp_instances: [] as InstanceRow[],
};

function resetDb() {
  db.tenants = [];
  db.tenant_members = [];
  db.whatsapp_instances = [];
}

type AnyRow = Record<string, unknown>;

type FilterOp = { kind: "eq"; col: string; val: unknown };

function makeBuilder(table: keyof typeof db) {
  const state: {
    filters: FilterOp[];
    orders: Array<{ col: string; ascending: boolean }>;
    countMode: "exact" | null;
    headOnly: boolean;
    op:
      | { kind: "select"; columns: string }
      | { kind: "insert"; row: AnyRow }
      | { kind: "update"; patch: AnyRow }
      | { kind: "delete" };
    selectAfter: boolean;
  } = {
    filters: [],
    orders: [],
    countMode: null,
    headOnly: false,
    op: { kind: "select", columns: "*" },
    selectAfter: false,
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

  const api: Record<string, (...args: unknown[]) => unknown> = {};

  api.select = (cols?: unknown, opts?: unknown) => {
    const options = opts as
      | { count?: "exact"; head?: boolean }
      | undefined;
    if (state.op.kind === "select") {
      state.op.columns = (cols as string) ?? "*";
    } else {
      state.selectAfter = true;
    }
    if (options?.count === "exact") state.countMode = "exact";
    if (options?.head === true) state.headOnly = true;
    return api;
  };
  api.insert = (row: unknown) => {
    state.op = { kind: "insert", row: row as AnyRow };
    return api;
  };
  api.update = (patch: unknown) => {
    state.op = { kind: "update", patch: patch as AnyRow };
    return api;
  };
  api.delete = () => {
    state.op = { kind: "delete" };
    return api;
  };
  api.eq = (col: unknown, val: unknown) => {
    state.filters.push({ kind: "eq", col: col as string, val });
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

  const run = (): {
    data: AnyRow | AnyRow[] | null;
    count: number | null;
    error: { message: string } | null;
  } => {
    const rows = db[table] as AnyRow[];
    switch (state.op.kind) {
      case "select": {
        let out = applyFilters(rows);
        out = applyOrder(out);
        const count = state.countMode === "exact" ? out.length : null;
        if (state.headOnly) {
          return { data: null, count, error: null };
        }
        return { data: out, count, error: null };
      }
      case "insert": {
        const now = new Date().toISOString();
        const base = state.op.row as AnyRow;
        const defaults: AnyRow =
          table === "tenants"
            ? {
                id: randomUUID(),
                is_active: true,
                delivery_target: "",
                include_caption_on_delivery: false,
                created_at: now,
                updated_at: now,
                plan: "free",
              }
            : table === "tenant_members"
              ? {
                  role: "member",
                  joined_at: now,
                  created_at: now,
                }
              : { id: randomUUID() };
        const newRow: AnyRow = { ...defaults, ...base };
        (db[table] as AnyRow[]).push(newRow);
        return {
          data: state.selectAfter ? newRow : null,
          count: null,
          error: null,
        };
      }
      case "update": {
        const matches = applyFilters(rows);
        if (matches.length === 0) {
          return { data: null, count: null, error: null };
        }
        for (const m of matches) {
          Object.assign(m, state.op.patch, {
            updated_at: new Date().toISOString(),
          });
        }
        return {
          data: state.selectAfter ? matches[0] : null,
          count: null,
          error: null,
        };
      }
      case "delete": {
        const matches = applyFilters(rows);
        for (const m of matches) {
          const idx = (db[table] as AnyRow[]).indexOf(m);
          if (idx >= 0) (db[table] as AnyRow[]).splice(idx, 1);
          // Cascade tenants → tenant_members + whatsapp_instances (best-effort
          // in the fake).
          if (table === "tenants") {
            const tid = m.id as string;
            db.tenant_members = db.tenant_members.filter(
              (x) => x.tenant_id !== tid,
            );
            db.whatsapp_instances = db.whatsapp_instances.filter(
              (x) => x.tenant_id !== tid,
            );
          }
        }
        return { data: null, count: null, error: null };
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
//  Mock admin client
// ──────────────────────────────────────────────────────────────────────────

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (
        table !== "tenants" &&
        table !== "tenant_members" &&
        table !== "whatsapp_instances"
      ) {
        throw new Error(`Unexpected table in mock: ${table}`);
      }
      return makeBuilder(table as keyof typeof db);
    },
  }),
}));

// ──────────────────────────────────────────────────────────────────────────
//  Import service AFTER mocks
// ──────────────────────────────────────────────────────────────────────────

let service: typeof import("../lib/admin/tenants");

beforeAll(async () => {
  service = await import("../lib/admin/tenants");
});

beforeEach(() => {
  resetDb();
});

// ──────────────────────────────────────────────────────────────────────────
//  Helpers
// ──────────────────────────────────────────────────────────────────────────

function seedTenant(partial: Partial<TenantRow> = {}): TenantRow {
  const now = new Date().toISOString();
  const row: TenantRow = {
    id: randomUUID(),
    name: "Seeded",
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

function seedMember(tenantId: string, userId = randomUUID()): MemberRow {
  const now = new Date().toISOString();
  const row: MemberRow = {
    tenant_id: tenantId,
    user_id: userId,
    role: "member",
    joined_at: now,
    created_at: now,
  };
  db.tenant_members.push(row);
  return row;
}

function seedInstance(tenantId: string): InstanceRow {
  const row: InstanceRow = { id: randomUUID(), tenant_id: tenantId };
  db.whatsapp_instances.push(row);
  return row;
}

// ──────────────────────────────────────────────────────────────────────────
//  Tests
// ──────────────────────────────────────────────────────────────────────────

describe("listAllTenants", () => {
  it("returns empty when no tenants exist", async () => {
    expect(await service.listAllTenants()).toEqual([]);
  });

  it("hydrates each tenant with member count + hasInstance flag", async () => {
    const a = seedTenant({ name: "Alpha" });
    const b = seedTenant({ name: "Beta" });
    seedMember(a.id);
    seedMember(a.id);
    seedMember(b.id);
    seedInstance(a.id);

    const all = await service.listAllTenants();
    const byName = Object.fromEntries(all.map((t) => [t.name, t]));
    expect(byName.Alpha.memberCount).toBe(2);
    expect(byName.Alpha.hasInstance).toBe(true);
    expect(byName.Beta.memberCount).toBe(1);
    expect(byName.Beta.hasInstance).toBe(false);
  });
});

describe("getTenantAdmin", () => {
  it("returns null when not found", async () => {
    expect(
      await service.getTenantAdmin("00000000-0000-0000-0000-000000000000"),
    ).toBeNull();
  });

  it("returns the hydrated view when found", async () => {
    const t = seedTenant({ name: "Gamma", plan: "pro" });
    seedMember(t.id);
    const v = await service.getTenantAdmin(t.id);
    expect(v).not.toBeNull();
    expect(v!.name).toBe("Gamma");
    expect(v!.plan).toBe("pro");
    expect(v!.memberCount).toBe(1);
    expect(v!.hasInstance).toBe(false);
    expect(v!.isActive).toBe(true);
  });
});

describe("createTenant", () => {
  it("creates with defaults (plan=free, memberCount=0, hasInstance=false)", async () => {
    const v = await service.createTenant({ name: "New Co" });
    expect(v.name).toBe("New Co");
    expect(v.plan).toBe("free");
    expect(v.memberCount).toBe(0);
    expect(v.hasInstance).toBe(false);
    expect(v.isActive).toBe(true);
    expect(db.tenants).toHaveLength(1);
  });

  it("trims whitespace from name", async () => {
    const v = await service.createTenant({ name: "  Trimmed  " });
    expect(v.name).toBe("Trimmed");
  });

  it("accepts a custom plan", async () => {
    const v = await service.createTenant({ name: "X", plan: "enterprise" });
    expect(v.plan).toBe("enterprise");
  });

  it("rejects empty name with VALIDATION_ERROR", async () => {
    await expect(service.createTenant({ name: "" })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    await expect(service.createTenant({ name: "   " })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  it("rejects non-string name", async () => {
    await expect(
      service.createTenant({ name: 42 as unknown as string }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});

describe("updateTenant", () => {
  it("patches name + plan", async () => {
    const t = seedTenant({ name: "Old", plan: "free" });
    const v = await service.updateTenant(t.id, {
      name: "New",
      plan: "pro",
    });
    expect(v.name).toBe("New");
    expect(v.plan).toBe("pro");
  });

  it("throws NOT_FOUND for missing id", async () => {
    await expect(
      service.updateTenant("00000000-0000-0000-0000-000000000000", {
        name: "X",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("empty patch returns current view", async () => {
    const t = seedTenant({ name: "Same" });
    const v = await service.updateTenant(t.id, {});
    expect(v.name).toBe("Same");
  });

  it("rejects invalid name in patch", async () => {
    const t = seedTenant();
    await expect(
      service.updateTenant(t.id, { name: "" }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});

describe("suspendTenant / activateTenant", () => {
  it("suspend flips is_active=false", async () => {
    const t = seedTenant({ is_active: true });
    const v = await service.suspendTenant(t.id);
    expect(v.isActive).toBe(false);
    expect(db.tenants[0].is_active).toBe(false);
  });

  it("activate flips is_active=true", async () => {
    const t = seedTenant({ is_active: false });
    const v = await service.activateTenant(t.id);
    expect(v.isActive).toBe(true);
  });

  it("suspend on missing tenant throws NOT_FOUND", async () => {
    await expect(
      service.suspendTenant("00000000-0000-0000-0000-000000000000"),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("deleteTenant", () => {
  it("hard deletes the tenant row", async () => {
    const t = seedTenant();
    await service.deleteTenant(t.id);
    expect(db.tenants).toHaveLength(0);
  });

  it("cascades (in fake) to members + instances", async () => {
    const t = seedTenant();
    seedMember(t.id);
    seedInstance(t.id);
    await service.deleteTenant(t.id);
    expect(db.tenant_members).toHaveLength(0);
    expect(db.whatsapp_instances).toHaveLength(0);
  });

  it("throws NOT_FOUND on missing id", async () => {
    await expect(
      service.deleteTenant("00000000-0000-0000-0000-000000000000"),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
