/**
 * Unit tests for lib/groups/service.ts
 *
 * Strategy: pure mocks — same shape as tests/whatsapp-service.spec.ts.
 *   - UazapiClient is replaced via `vi.mock("@/lib/uazapi/client")` with an
 *     object-spy whose methods we swap per test.
 *   - The Supabase admin client is replaced by an in-memory fake that
 *     mimics the chainable builder surface (`from().select().eq()...`).
 *     We mirror only the subset the service uses — select/insert/update
 *     with `.eq`, `.ilike`, `.order`, `.limit`, `.maybeSingle`, and the
 *     thenable form used for multi-order list queries.
 */

import {
  beforeAll,
  afterAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { randomBytes, randomUUID } from "node:crypto";

// ──────────────────────────────────────────────────────────────────────────
//  Shared fixtures / in-memory DB
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

type GroupRow = {
  id: string;
  tenant_id: string;
  instance_id: string;
  uazapi_group_jid: string;
  name: string;
  picture_url: string | null;
  is_monitored: boolean;
  member_count: number | null;
  last_synced_at: string | null;
  created_at: string;
};

const db = {
  whatsapp_instances: [] as InstanceRow[],
  groups: [] as GroupRow[],
};

function resetDb() {
  db.whatsapp_instances = [];
  db.groups = [];
}

type AnyRow = Record<string, unknown>;

type FilterOp =
  | { kind: "eq"; col: string; val: unknown }
  | { kind: "neq"; col: string; val: unknown }
  | { kind: "ilike"; col: string; pattern: string }
  | { kind: "or"; clauses: Array<{ col: string; pattern: string }> };

/**
 * Chainable query builder that matches the subset of supabase-js the
 * service uses. Same philosophy as the whatsapp-service spec: narrow, fast,
 * deterministic; absolutely NOT a full PostgREST reimplementation.
 */
function makeBuilder(table: keyof typeof db) {
  const state: {
    filters: FilterOp[];
    orders: Array<{ col: string; ascending: boolean }>;
    limit?: number;
    range?: { from: number; to: number };
    selectCountExact: boolean;
    op:
      | { kind: "select"; columns: string }
      | { kind: "insert"; row: AnyRow }
      | { kind: "update"; patch: AnyRow }
      | { kind: "delete" };
    selectAfter: boolean;
  } = {
    filters: [],
    orders: [],
    selectCountExact: false,
    op: { kind: "select", columns: "*" },
    selectAfter: false,
  };

  const applyFilters = (rows: AnyRow[]): AnyRow[] =>
    rows.filter((r) =>
      state.filters.every((f) => {
        if (f.kind === "eq") return r[f.col] === f.val;
        if (f.kind === "neq") return r[f.col] !== f.val;
        if (f.kind === "or") {
          return f.clauses.some((c) => {
            const v = r[c.col];
            if (typeof v !== "string") return false;
            const escaped = c.pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
            const rx = new RegExp(
              "^" + escaped.replace(/%/g, ".*") + "$",
              "i",
            );
            return rx.test(v);
          });
        }
        if (f.kind === "ilike") {
          const v = r[f.col];
          if (typeof v !== "string") return false;
          // Translate SQL `%` wildcard into a regex fragment. Escape regex
          // metachars in the rest so "foo.bar" is literal.
          const escaped = f.pattern.replace(
            /[.+?^${}()|[\]\\]/g,
            "\\$&",
          );
          const regex = new RegExp(
            "^" + escaped.replace(/%/g, ".*") + "$",
            "i",
          );
          return regex.test(v);
        }
        return false;
      }),
    );

  const applyOrder = (rows: AnyRow[]): AnyRow[] => {
    if (state.orders.length === 0) return rows;
    const out = [...rows];
    out.sort((a, b) => {
      for (const o of state.orders) {
        const av = a[o.col];
        const bv = b[o.col];
        let cmp = 0;
        if (typeof av === "boolean" && typeof bv === "boolean") {
          // booleans: true > false in postgres `order by bool desc`.
          cmp = av === bv ? 0 : av ? 1 : -1;
        } else {
          const as = String(av ?? "");
          const bs = String(bv ?? "");
          cmp = as < bs ? -1 : as > bs ? 1 : 0;
        }
        if (cmp !== 0) return o.ascending ? cmp : -cmp;
      }
      return 0;
    });
    return out;
  };

  const api: Record<string, (...args: unknown[]) => unknown> = {};

  api.select = (cols?: unknown, opts?: unknown) => {
    if (state.op.kind === "select") {
      state.op.columns = (cols as string) ?? "*";
      const countOpt = (opts as { count?: string } | undefined)?.count;
      if (countOpt === "exact") state.selectCountExact = true;
    } else {
      // mutation followed by .select("*")
      state.selectAfter = true;
    }
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
  api.neq = (col: unknown, val: unknown) => {
    state.filters.push({ kind: "neq", col: col as string, val });
    return api;
  };
  api.ilike = (col: unknown, pattern: unknown) => {
    state.filters.push({
      kind: "ilike",
      col: col as string,
      pattern: pattern as string,
    });
    return api;
  };
  // `.or("name.ilike.%q%,uazapi_group_jid.ilike.%q%")` — só implementamos
  // o subset ilike porque é o que o service usa. Cada cláusula é "col.op.pattern".
  api.or = (expr: unknown) => {
    const clauses = (expr as string)
      .split(",")
      .map((raw) => {
        const m = /^([^.]+)\.ilike\.(.+)$/.exec(raw.trim());
        return m ? { col: m[1], pattern: m[2] } : null;
      })
      .filter((c): c is { col: string; pattern: string } => c !== null);
    state.filters.push({ kind: "or", clauses });
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
  api.range = (from: unknown, to: unknown) => {
    state.range = { from: from as number, to: to as number };
    return api;
  };

  const run = (): {
    data: AnyRow | AnyRow[] | null;
    error: { message: string } | null;
  } => {
    const rows = db[table] as AnyRow[];
    switch (state.op.kind) {
      case "select": {
        let out = applyFilters(rows);
        const fullCount = out.length;
        out = applyOrder(out);
        if (state.range) {
          out = out.slice(state.range.from, state.range.to + 1);
        } else if (state.limit !== undefined) {
          out = out.slice(0, state.limit);
        }
        const result = { data: out, error: null } as {
          data: AnyRow[];
          error: null;
          count?: number;
        };
        if (state.selectCountExact) result.count = fullCount;
        return result;
      }
      case "insert": {
        const now = new Date().toISOString();
        const base = state.op.row as AnyRow;
        const newRow = {
          id: (base.id as string | undefined) ?? randomUUID(),
          created_at: now,
          ...base,
        };
        (db[table] as AnyRow[]).push(newRow);
        return { data: state.selectAfter ? newRow : null, error: null };
      }
      case "update": {
        const matches = applyFilters(rows);
        if (matches.length === 0) {
          // No match: supabase returns data=null error=null for an update
          // without a matching row (unless .single() demands one). That
          // matches the semantics our service depends on for NOT_FOUND.
          return { data: null, error: null };
        }
        for (const m of matches) {
          Object.assign(m, state.op.patch);
        }
        return {
          data: state.selectAfter ? matches[0] : null,
          error: null,
        };
      }
      case "delete": {
        const matches = applyFilters(rows);
        for (const m of matches) {
          const idx = (db[table] as AnyRow[]).indexOf(m);
          if (idx >= 0) (db[table] as AnyRow[]).splice(idx, 1);
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

  // PromiseLike: for `await supabase.from(...).select(...).eq(...).order(...)`.
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
      if (table !== "whatsapp_instances" && table !== "groups") {
        throw new Error(`Unexpected table in mock: ${table}`);
      }
      return makeBuilder(table as keyof typeof db);
    },
  }),
}));

const uazapiSpy = {
  listGroups: vi.fn(),
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

let service: typeof import("../lib/groups/service");
let crypto: typeof import("../lib/crypto");
let uazapiMod: typeof import("../lib/uazapi/client");

beforeAll(async () => {
  service = await import("../lib/groups/service");
  crypto = await import("../lib/crypto");
  uazapiMod = await import("../lib/uazapi/client");
});

beforeEach(() => {
  resetDb();
  uazapiSpy.listGroups.mockReset();
});

// ──────────────────────────────────────────────────────────────────────────
//  Helpers
// ──────────────────────────────────────────────────────────────────────────

const TENANT_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const TENANT_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

function seedInstance(partial: Partial<InstanceRow> = {}): InstanceRow {
  const now = new Date().toISOString();
  const row: InstanceRow = {
    id: randomUUID(),
    tenant_id: TENANT_A,
    uazapi_instance_id: `uaz-${randomUUID()}`,
    uazapi_token_encrypted: crypto.encrypt("plain-token"),
    status: "connected",
    phone: null,
    connected_at: now,
    last_seen_at: now,
    created_at: now,
    updated_at: now,
    ...partial,
  };
  db.whatsapp_instances.push(row);
  return row;
}

function seedGroup(partial: Partial<GroupRow> = {}): GroupRow {
  const now = new Date().toISOString();
  const row: GroupRow = {
    id: randomUUID(),
    tenant_id: TENANT_A,
    instance_id: randomUUID(),
    uazapi_group_jid: `${randomUUID()}@g.us`,
    name: "Some Group",
    picture_url: null,
    is_monitored: false,
    member_count: 10,
    last_synced_at: null,
    created_at: now,
    ...partial,
  };
  db.groups.push(row);
  return row;
}

// ──────────────────────────────────────────────────────────────────────────
//  Tests
// ──────────────────────────────────────────────────────────────────────────

describe("listGroups", () => {
  it("returns empty when the tenant has no groups", async () => {
    const res = await service.listGroups(TENANT_A);
    expect(res.rows).toEqual([]);
    expect(res.total).toBe(0);
  });

  it("orders monitored first, then by name ascending", async () => {
    seedGroup({ name: "Zeta", is_monitored: false });
    seedGroup({ name: "Alpha", is_monitored: false });
    seedGroup({ name: "Mike", is_monitored: true });

    const out = (await service.listGroups(TENANT_A)).rows;
    expect(out.map((g) => g.name)).toEqual(["Mike", "Alpha", "Zeta"]);
  });

  it("filters to monitored-only when monitoredOnly=true", async () => {
    seedGroup({ name: "A", is_monitored: true });
    seedGroup({ name: "B", is_monitored: false });
    seedGroup({ name: "C", is_monitored: true });

    const out = (await service.listGroups(TENANT_A, { monitoredOnly: true })).rows;
    expect(out.map((g) => g.name).sort()).toEqual(["A", "C"]);
    expect(out.every((g) => g.isMonitored)).toBe(true);
  });

  it("filters by search (case-insensitive substring on name)", async () => {
    seedGroup({ name: "Dev Team Brazil" });
    seedGroup({ name: "Marketing" });
    seedGroup({ name: "dev - secret channel" });

    const out = (await service.listGroups(TENANT_A, { search: "DEV" })).rows;
    expect(out.map((g) => g.name).sort()).toEqual([
      "Dev Team Brazil",
      "dev - secret channel",
    ]);
  });

  it("never leaks groups from another tenant", async () => {
    seedGroup({ tenant_id: TENANT_A, name: "mine" });
    seedGroup({ tenant_id: TENANT_B, name: "theirs" });

    const out = (await service.listGroups(TENANT_A)).rows;
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("mine");
  });
});

describe("getGroup", () => {
  it("returns null when the group doesn't exist", async () => {
    expect(
      await service.getGroup(TENANT_A, "00000000-0000-0000-0000-000000000000"),
    ).toBeNull();
  });

  it("returns null for a group owned by a different tenant", async () => {
    const row = seedGroup({ tenant_id: TENANT_B });
    expect(await service.getGroup(TENANT_A, row.id)).toBeNull();
  });

  it("returns the mapped view when the group belongs to the tenant", async () => {
    const row = seedGroup({ name: "HR Team", is_monitored: true });
    const got = await service.getGroup(TENANT_A, row.id);
    expect(got).not.toBeNull();
    expect(got!.id).toBe(row.id);
    expect(got!.name).toBe("HR Team");
    expect(got!.isMonitored).toBe(true);
  });
});

describe("syncGroups", () => {
  it("throws NO_INSTANCE when the tenant has no instance at all", async () => {
    await expect(service.syncGroups(TENANT_A)).rejects.toMatchObject({
      name: "GroupsError",
      code: "NO_INSTANCE",
    });
    expect(uazapiSpy.listGroups).not.toHaveBeenCalled();
  });

  it("throws NO_INSTANCE when the latest instance is not connected", async () => {
    seedInstance({ status: "connecting" });
    await expect(service.syncGroups(TENANT_A)).rejects.toMatchObject({
      code: "NO_INSTANCE",
    });
    expect(uazapiSpy.listGroups).not.toHaveBeenCalled();
  });

  it("inserts new groups with is_monitored=false and member_count from size", async () => {
    const inst = seedInstance();
    uazapiSpy.listGroups.mockResolvedValueOnce([
      {
        jid: "111@g.us",
        name: "Dev",
        size: 42,
        pictureUrl: "https://cdn/p1.png",
        participants: [],
      },
      {
        jid: "222@g.us",
        name: "Ops",
        size: undefined,
        participants: [{ jid: "a" }, { jid: "b" }, { jid: "c" }],
      },
    ]);

    const res = await service.syncGroups(TENANT_A);
    expect(res).toEqual({ synced: 2, total: 2 });
    expect(db.groups).toHaveLength(2);

    const dev = db.groups.find((g) => g.uazapi_group_jid === "111@g.us")!;
    expect(dev.name).toBe("Dev");
    expect(dev.member_count).toBe(42);
    expect(dev.picture_url).toBe("https://cdn/p1.png");
    expect(dev.is_monitored).toBe(false);
    expect(dev.instance_id).toBe(inst.id);
    expect(dev.last_synced_at).toBeTruthy();

    // Fall-back to participants.length when `size` is absent.
    const ops = db.groups.find((g) => g.uazapi_group_jid === "222@g.us")!;
    expect(ops.member_count).toBe(3);
  });

  it("preserves is_monitored on re-sync (never flips user toggles off)", async () => {
    const inst = seedInstance();
    // User already had this group and turned monitoring ON.
    const preExisting = seedGroup({
      instance_id: inst.id,
      uazapi_group_jid: "111@g.us",
      name: "Old Name",
      is_monitored: true,
      picture_url: null,
      member_count: 5,
      last_synced_at: null,
    });

    uazapiSpy.listGroups.mockResolvedValueOnce([
      {
        jid: "111@g.us",
        name: "New Name",
        size: 99,
        pictureUrl: "https://cdn/new.png",
        participants: [],
      },
    ]);

    const res = await service.syncGroups(TENANT_A);
    expect(res.synced).toBe(1);

    const updated = db.groups.find((g) => g.id === preExisting.id)!;
    expect(updated.name).toBe("New Name");
    expect(updated.member_count).toBe(99);
    expect(updated.picture_url).toBe("https://cdn/new.png");
    // is_monitored must still be true — this is the key invariant.
    expect(updated.is_monitored).toBe(true);
  });

  it("updates last_synced_at on every synced row", async () => {
    const inst = seedInstance();
    seedGroup({
      instance_id: inst.id,
      uazapi_group_jid: "111@g.us",
      last_synced_at: null,
    });

    uazapiSpy.listGroups.mockResolvedValueOnce([
      { jid: "111@g.us", name: "G", size: 1, participants: [] },
      { jid: "222@g.us", name: "H", size: 2, participants: [] },
    ]);

    const before = Date.now();
    await service.syncGroups(TENANT_A);
    const after = Date.now();

    for (const g of db.groups) {
      expect(g.last_synced_at).toBeTruthy();
      const t = Date.parse(g.last_synced_at!);
      expect(t).toBeGreaterThanOrEqual(before - 1);
      expect(t).toBeLessThanOrEqual(after + 1);
    }
  });

  it("wraps UAZAPI errors as GroupsError('UAZAPI_ERROR')", async () => {
    seedInstance();
    uazapiSpy.listGroups.mockRejectedValueOnce(
      new uazapiMod.UazapiError({
        status: 500,
        message: "boom",
      }),
    );
    await expect(service.syncGroups(TENANT_A)).rejects.toMatchObject({
      name: "GroupsError",
      code: "UAZAPI_ERROR",
    });
  });

  it("uses the tenant's LATEST instance when multiple exist", async () => {
    // Older, disconnected instance.
    seedInstance({
      status: "disconnected",
      created_at: new Date(Date.now() - 60_000).toISOString(),
    });
    // Latest: connected.
    const latest = seedInstance({
      status: "connected",
      created_at: new Date().toISOString(),
    });

    uazapiSpy.listGroups.mockResolvedValueOnce([
      { jid: "z@g.us", name: "Z", size: 1, participants: [] },
    ]);
    await service.syncGroups(TENANT_A);

    expect(db.groups).toHaveLength(1);
    expect(db.groups[0].instance_id).toBe(latest.id);
  });
});

describe("toggleMonitor", () => {
  it("flips is_monitored true -> false -> true", async () => {
    const row = seedGroup({ is_monitored: false });

    const v1 = await service.toggleMonitor(TENANT_A, row.id, true);
    expect(v1.isMonitored).toBe(true);
    expect(db.groups[0].is_monitored).toBe(true);

    const v2 = await service.toggleMonitor(TENANT_A, row.id, false);
    expect(v2.isMonitored).toBe(false);

    const v3 = await service.toggleMonitor(TENANT_A, row.id, true);
    expect(v3.isMonitored).toBe(true);
  });

  it("throws NOT_FOUND when the group doesn't exist", async () => {
    await expect(
      service.toggleMonitor(
        TENANT_A,
        "00000000-0000-0000-0000-000000000000",
        true,
      ),
    ).rejects.toMatchObject({ name: "GroupsError", code: "NOT_FOUND" });
  });

  it("throws NOT_FOUND when the group belongs to a different tenant", async () => {
    const row = seedGroup({ tenant_id: TENANT_B, is_monitored: false });
    await expect(
      service.toggleMonitor(TENANT_A, row.id, true),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    // Cross-tenant flip must NOT have mutated the row.
    expect(db.groups[0].is_monitored).toBe(false);
  });
});
