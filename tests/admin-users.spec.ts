/**
 * Unit tests for lib/admin/users.ts
 *
 * Strategy: mock both the DB side (tenant_members / superadmins / tenants
 * via a chainable builder) AND the `supabase.auth.admin.*` surface that
 * wraps GoTrue. The auth spy is a simple in-memory user list so we can
 * verify rollback semantics on createUser.
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
//  In-memory DB (DB tables touched by the service)
// ──────────────────────────────────────────────────────────────────────────

type TenantRow = { id: string; name: string };
type MemberRow = {
  tenant_id: string;
  user_id: string;
  role: "owner" | "admin" | "member";
  joined_at: string;
  created_at: string;
};
type SuperRow = { user_id: string; note?: string; granted_at: string };

const db = {
  tenants: [] as TenantRow[],
  tenant_members: [] as MemberRow[],
  superadmins: [] as SuperRow[],
};

function resetDb() {
  db.tenants = [];
  db.tenant_members = [];
  db.superadmins = [];
}

type AnyRow = Record<string, unknown>;
type FilterOp = { kind: "eq"; col: string; val: unknown };

// Toggles for fault injection
const failFlags = {
  insertMembers: false,
  insertSuperadmins: false,
};

function makeBuilder(table: keyof typeof db) {
  const state: {
    filters: FilterOp[];
    op:
      | { kind: "select" }
      | { kind: "insert"; row: AnyRow }
      | { kind: "update"; patch: AnyRow }
      | { kind: "delete" };
    selectAfter: boolean;
  } = {
    filters: [],
    op: { kind: "select" },
    selectAfter: false,
  };

  const applyFilters = (rows: AnyRow[]): AnyRow[] =>
    rows.filter((r) => state.filters.every((f) => r[f.col] === f.val));

  const api: Record<string, (...args: unknown[]) => unknown> = {};
  api.select = () => {
    if (state.op.kind !== "select") state.selectAfter = true;
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

  const run = (): {
    data: AnyRow | AnyRow[] | null;
    error: { message: string } | null;
  } => {
    const rows = db[table] as AnyRow[];
    switch (state.op.kind) {
      case "select":
        return { data: applyFilters(rows), error: null };
      case "insert": {
        if (table === "tenant_members" && failFlags.insertMembers) {
          return {
            data: null,
            error: { message: "simulated tenant_members insert failure" },
          };
        }
        if (table === "superadmins" && failFlags.insertSuperadmins) {
          return {
            data: null,
            error: { message: "simulated superadmins insert failure" },
          };
        }
        const now = new Date().toISOString();
        const base = state.op.row as AnyRow;
        const defaults: AnyRow =
          table === "tenant_members"
            ? { role: "member", joined_at: now, created_at: now }
            : table === "superadmins"
              ? { granted_at: now }
              : {};
        const newRow: AnyRow = { ...defaults, ...base };
        (db[table] as AnyRow[]).push(newRow);
        return { data: state.selectAfter ? newRow : null, error: null };
      }
      case "update": {
        const matches = applyFilters(rows);
        for (const m of matches) Object.assign(m, state.op.patch);
        return {
          data: state.selectAfter ? matches[0] ?? null : null,
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
//  Fake `auth.admin` API
// ──────────────────────────────────────────────────────────────────────────

type AuthUser = {
  id: string;
  email: string;
  created_at: string;
  last_sign_in_at: string | null;
};

const auth = {
  users: [] as AuthUser[],
  passwordByUser: new Map<string, string>(),
  rollbacks: 0,
  admin: {
    async listUsers() {
      return { data: { users: auth.users }, error: null };
    },
    async getUserById(id: string) {
      const u = auth.users.find((x) => x.id === id);
      if (!u) {
        return { data: null, error: { message: "user not found" } };
      }
      return { data: { user: u }, error: null };
    },
    async createUser(input: { email: string; password: string }) {
      const id = randomUUID();
      const now = new Date().toISOString();
      const u: AuthUser = {
        id,
        email: input.email,
        created_at: now,
        last_sign_in_at: null,
      };
      auth.users.push(u);
      auth.passwordByUser.set(id, input.password);
      return { data: { user: u }, error: null };
    },
    async updateUserById(id: string, patch: { password?: string }) {
      const u = auth.users.find((x) => x.id === id);
      if (!u) return { data: null, error: { message: "user not found" } };
      if (patch.password) auth.passwordByUser.set(id, patch.password);
      return { data: { user: u }, error: null };
    },
    async deleteUser(id: string) {
      const idx = auth.users.findIndex((x) => x.id === id);
      if (idx < 0) return { data: null, error: { message: "user not found" } };
      auth.users.splice(idx, 1);
      auth.passwordByUser.delete(id);
      auth.rollbacks += 1;
      return { data: null, error: null };
    },
  },
};

function resetAuth() {
  auth.users = [];
  auth.passwordByUser.clear();
  auth.rollbacks = 0;
  failFlags.insertMembers = false;
  failFlags.insertSuperadmins = false;
}

// ──────────────────────────────────────────────────────────────────────────
//  Mock admin client (both DB + auth)
// ──────────────────────────────────────────────────────────────────────────

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (
        table !== "tenants" &&
        table !== "tenant_members" &&
        table !== "superadmins"
      ) {
        throw new Error(`Unexpected table in mock: ${table}`);
      }
      return makeBuilder(table as keyof typeof db);
    },
    auth: { admin: auth.admin },
  }),
}));

// ──────────────────────────────────────────────────────────────────────────

let service: typeof import("../lib/admin/users");

beforeAll(async () => {
  service = await import("../lib/admin/users");
});

beforeEach(() => {
  resetDb();
  resetAuth();
});

// ──────────────────────────────────────────────────────────────────────────
//  Helpers
// ──────────────────────────────────────────────────────────────────────────

function seedTenant(name = "T"): TenantRow {
  const t = { id: randomUUID(), name };
  db.tenants.push(t);
  return t;
}

async function seedUserInTenant(
  tenantId: string,
  opts: { email?: string; role?: "owner" | "admin" | "member" } = {},
): Promise<string> {
  const email = opts.email ?? `u${Math.random().toString(36).slice(2, 8)}@x.com`;
  const id = randomUUID();
  auth.users.push({
    id,
    email,
    created_at: new Date().toISOString(),
    last_sign_in_at: null,
  });
  auth.passwordByUser.set(id, "seeded");
  db.tenant_members.push({
    tenant_id: tenantId,
    user_id: id,
    role: opts.role ?? "member",
    joined_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
  });
  return id;
}

// ──────────────────────────────────────────────────────────────────────────
//  Tests
// ──────────────────────────────────────────────────────────────────────────

describe("listAllUsers", () => {
  it("returns [] when no users exist", async () => {
    expect(await service.listAllUsers()).toEqual([]);
  });

  it("enriches users with their tenant memberships + superadmin flag", async () => {
    const t1 = seedTenant("Alpha");
    const t2 = seedTenant("Beta");
    const u = await seedUserInTenant(t1.id, {
      email: "a@x.com",
      role: "admin",
    });
    db.tenant_members.push({
      tenant_id: t2.id,
      user_id: u,
      role: "member",
      joined_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    });
    db.superadmins.push({
      user_id: u,
      granted_at: new Date().toISOString(),
    });

    const users = await service.listAllUsers();
    expect(users).toHaveLength(1);
    expect(users[0].email).toBe("a@x.com");
    expect(users[0].isSuperadmin).toBe(true);
    const tenantNames = users[0].tenants.map((t) => t.tenantName).sort();
    expect(tenantNames).toEqual(["Alpha", "Beta"]);
  });

  it("sorts users by email alphabetically", async () => {
    const t = seedTenant();
    await seedUserInTenant(t.id, { email: "zed@x.com" });
    await seedUserInTenant(t.id, { email: "abe@x.com" });
    const users = await service.listAllUsers();
    expect(users.map((u) => u.email)).toEqual(["abe@x.com", "zed@x.com"]);
  });
});

describe("getUserAdmin", () => {
  it("returns null for unknown id", async () => {
    const v = await service.getUserAdmin(randomUUID());
    expect(v).toBeNull();
  });

  it("returns enriched view for known id", async () => {
    const t = seedTenant("X");
    const uid = await seedUserInTenant(t.id, { email: "x@x.com" });
    const v = await service.getUserAdmin(uid);
    expect(v!.email).toBe("x@x.com");
    expect(v!.tenants[0].tenantName).toBe("X");
  });
});

describe("createUser", () => {
  it("creates auth user + membership + hydrates view", async () => {
    const t = seedTenant("Home");
    const v = await service.createUser({
      email: "new@x.com",
      password: "password1",
      tenantId: t.id,
      role: "admin",
    });
    expect(v.email).toBe("new@x.com");
    expect(v.tenants).toHaveLength(1);
    expect(v.tenants[0].role).toBe("admin");
    expect(v.isSuperadmin).toBe(false);
    expect(auth.users).toHaveLength(1);
    expect(auth.passwordByUser.get(v.id)).toBe("password1");
  });

  it("optionally grants superadmin", async () => {
    const t = seedTenant();
    const v = await service.createUser({
      email: "boss@x.com",
      password: "password1",
      tenantId: t.id,
      isSuperadmin: true,
    });
    expect(v.isSuperadmin).toBe(true);
    expect(db.superadmins.map((s) => s.user_id)).toContain(v.id);
  });

  it("lowercases + trims email", async () => {
    const t = seedTenant();
    const v = await service.createUser({
      email: "  Mixed@X.com  ",
      password: "password1",
      tenantId: t.id,
    });
    expect(v.email).toBe("mixed@x.com");
  });

  it("rejects invalid email with VALIDATION_ERROR", async () => {
    const t = seedTenant();
    await expect(
      service.createUser({
        email: "not-an-email",
        password: "password1",
        tenantId: t.id,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(auth.users).toHaveLength(0);
  });

  it("rejects password shorter than 8 chars", async () => {
    const t = seedTenant();
    await expect(
      service.createUser({
        email: "a@x.com",
        password: "short",
        tenantId: t.id,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(auth.users).toHaveLength(0);
  });

  it("rejects missing tenantId", async () => {
    await expect(
      service.createUser({
        email: "a@x.com",
        password: "password1",
        tenantId: "",
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("rejects unknown tenantId with NOT_FOUND (no auth user created)", async () => {
    await expect(
      service.createUser({
        email: "a@x.com",
        password: "password1",
        tenantId: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(auth.users).toHaveLength(0);
  });

  it("rolls back auth user when tenant_members insert fails", async () => {
    const t = seedTenant();
    failFlags.insertMembers = true;
    await expect(
      service.createUser({
        email: "rollback@x.com",
        password: "password1",
        tenantId: t.id,
      }),
    ).rejects.toMatchObject({ code: "DB_ERROR" });
    // Auth user must have been deleted back out.
    expect(auth.users).toHaveLength(0);
    expect(auth.rollbacks).toBeGreaterThanOrEqual(1);
  });

  it("rolls back auth user + membership when superadmins insert fails", async () => {
    const t = seedTenant();
    failFlags.insertSuperadmins = true;
    await expect(
      service.createUser({
        email: "rollback2@x.com",
        password: "password1",
        tenantId: t.id,
        isSuperadmin: true,
      }),
    ).rejects.toMatchObject({ code: "DB_ERROR" });
    expect(auth.users).toHaveLength(0);
    expect(db.tenant_members).toHaveLength(0);
  });
});

describe("updateUserMembership", () => {
  it("updates role when already a member", async () => {
    const t = seedTenant();
    const uid = await seedUserInTenant(t.id, { role: "member" });
    const v = await service.updateUserMembership(uid, t.id, "admin");
    expect(v.tenants.find((x) => x.tenantId === t.id)!.role).toBe("admin");
  });

  it("inserts when not yet a member", async () => {
    const t1 = seedTenant("A");
    const t2 = seedTenant("B");
    const uid = await seedUserInTenant(t1.id);
    const v = await service.updateUserMembership(uid, t2.id, "owner");
    expect(v.tenants.map((x) => x.tenantName).sort()).toEqual(["A", "B"]);
  });

  it("rejects invalid role", async () => {
    const t = seedTenant();
    const uid = await seedUserInTenant(t.id);
    await expect(
      service.updateUserMembership(uid, t.id, "god" as "owner"),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});

describe("removeUserFromTenant", () => {
  it("removes membership row", async () => {
    const t1 = seedTenant("A");
    const t2 = seedTenant("B");
    const uid = await seedUserInTenant(t1.id);
    db.tenant_members.push({
      tenant_id: t2.id,
      user_id: uid,
      role: "member",
      joined_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    });
    const v = await service.removeUserFromTenant(uid, t1.id);
    expect(v.tenants.map((x) => x.tenantName)).toEqual(["B"]);
  });
});

describe("setUserPassword", () => {
  it("updates password in auth", async () => {
    const t = seedTenant();
    const uid = await seedUserInTenant(t.id);
    await service.setUserPassword(uid, "newpass1");
    expect(auth.passwordByUser.get(uid)).toBe("newpass1");
  });

  it("rejects password shorter than 8", async () => {
    const t = seedTenant();
    const uid = await seedUserInTenant(t.id);
    await expect(
      service.setUserPassword(uid, "x"),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});

describe("setSuperadmin", () => {
  it("grants then revokes", async () => {
    const t = seedTenant();
    const uid = await seedUserInTenant(t.id);
    let v = await service.setSuperadmin(uid, true, "granted by test");
    expect(v.isSuperadmin).toBe(true);
    expect(db.superadmins[0].note).toBe("granted by test");
    v = await service.setSuperadmin(uid, false);
    expect(v.isSuperadmin).toBe(false);
    expect(db.superadmins).toHaveLength(0);
  });

  it("is idempotent when granting twice", async () => {
    const t = seedTenant();
    const uid = await seedUserInTenant(t.id);
    await service.setSuperadmin(uid, true);
    await service.setSuperadmin(uid, true);
    expect(db.superadmins).toHaveLength(1);
  });
});

describe("deleteUser", () => {
  it("deletes auth user", async () => {
    const t = seedTenant();
    const uid = await seedUserInTenant(t.id);
    await service.deleteUser(uid);
    expect(auth.users.find((u) => u.id === uid)).toBeUndefined();
  });

  it("throws NOT_FOUND on unknown id", async () => {
    await expect(
      service.deleteUser(randomUUID()),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("cross-linking", () => {
  it("createUser then listAllUsers includes the new user", async () => {
    const t = seedTenant("Home");
    const created = await service.createUser({
      email: "link@x.com",
      password: "password1",
      tenantId: t.id,
    });
    const all = await service.listAllUsers();
    expect(all.map((u) => u.id)).toContain(created.id);
    const found = all.find((u) => u.id === created.id)!;
    expect(found.tenants.map((x) => x.tenantName)).toEqual(["Home"]);
  });
});
