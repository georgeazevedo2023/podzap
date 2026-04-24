/**
 * Unit tests for lib/schedules/service.ts — Fase 11 foundations.
 *
 * Same in-memory supabase-fake strategy as `summaries-service.spec.ts`
 * and `groups-service.spec.ts`. We only mirror the subset of the builder
 * surface the service actually uses: select, insert, update, delete, eq,
 * lte, gte, order, limit, maybeSingle, and the thenable `.then` form.
 *
 * Coverage:
 *   - list / get happy path + tenant scoping
 *   - create happy, CONFLICT on duplicate group_id, VALIDATION_ERROR on
 *     cross-tenant group
 *   - update + delete happy paths and NOT_FOUND semantics
 *   - dueSchedulesNow — daily in-window, weekly day gating, inactive
 *     filter, non-fixed-time trigger skipped
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

type ScheduleRow = {
  id: string;
  tenant_id: string;
  group_id: string;
  frequency: "daily" | "weekly" | "custom";
  time_of_day: string | null;
  day_of_week: number | null;
  trigger_type: "fixed_time" | "inactivity" | "dynamic_window";
  approval_mode: "optional" | "required";
  voice: string | null;
  tone: "formal" | "fun" | "corporate";
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

type GroupRow = {
  id: string;
  tenant_id: string;
};

const db = {
  schedules: [] as ScheduleRow[],
  groups: [] as GroupRow[],
};

function resetDb() {
  db.schedules = [];
  db.groups = [];
}

type AnyRow = Record<string, unknown>;

type Filter =
  | { kind: "eq"; col: string; val: unknown }
  | { kind: "lte"; col: string; val: unknown }
  | { kind: "gte"; col: string; val: unknown };

function matches(row: AnyRow, filters: Filter[]): boolean {
  for (const f of filters) {
    const v = row[f.col];
    switch (f.kind) {
      case "eq":
        if (v !== f.val) return false;
        break;
      case "lte":
        if (
          !(typeof v === "string" && typeof f.val === "string" && v <= f.val)
        )
          return false;
        break;
      case "gte":
        if (
          !(typeof v === "string" && typeof f.val === "string" && v >= f.val)
        )
          return false;
        break;
    }
  }
  return true;
}

function makeBuilder(table: keyof typeof db) {
  const state: {
    filters: Filter[];
    orders: Array<{ col: string; ascending: boolean }>;
    limit?: number;
    op:
      | { kind: "select"; columns: string }
      | { kind: "insert"; row: AnyRow }
      | { kind: "update"; patch: AnyRow }
      | { kind: "delete" };
    selectAfter: boolean;
  } = {
    filters: [],
    orders: [],
    op: { kind: "select", columns: "*" },
    selectAfter: false,
  };

  const applyFilters = (rows: AnyRow[]): AnyRow[] =>
    rows.filter((r) => matches(r, state.filters));

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
  api.lte = (col: unknown, val: unknown) => {
    state.filters.push({ kind: "lte", col: col as string, val });
    return api;
  };
  api.gte = (col: unknown, val: unknown) => {
    state.filters.push({ kind: "gte", col: col as string, val });
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

  const run = (): {
    data: AnyRow | AnyRow[] | null;
    error: { message: string; code?: string } | null;
  } => {
    const rows = db[table] as AnyRow[];
    switch (state.op.kind) {
      case "select": {
        let out = applyFilters(rows);
        out = applyOrder(out);
        if (state.limit !== undefined) out = out.slice(0, state.limit);
        return { data: out, error: null };
      }
      case "insert": {
        const toInsert = state.op.row;
        if (table === "schedules") {
          // enforce group_id UNIQUE
          const existing = (db.schedules as AnyRow[]).find(
            (s) => s.group_id === toInsert.group_id,
          );
          if (existing) {
            return {
              data: null,
              error: {
                message:
                  'duplicate key value violates unique constraint "schedules_group_id_key"',
                code: "23505",
              },
            };
          }
        }
        const nowIso = new Date().toISOString();
        const full = {
          id: randomUUID(),
          created_at: nowIso,
          updated_at: nowIso,
          ...toInsert,
        } as AnyRow;
        (rows as AnyRow[]).push(full);
        return { data: state.selectAfter ? full : null, error: null };
      }
      case "update": {
        const hits = applyFilters(rows);
        if (hits.length === 0) {
          return { data: null, error: null };
        }
        for (const m of hits) {
          Object.assign(m, state.op.patch, {
            updated_at: new Date().toISOString(),
          });
        }
        return {
          data: state.selectAfter ? hits[0] : null,
          error: null,
        };
      }
      case "delete": {
        const hits = applyFilters(rows);
        if (hits.length === 0) {
          return { data: null, error: null };
        }
        for (const h of hits) {
          const idx = (rows as AnyRow[]).indexOf(h);
          if (idx !== -1) (rows as AnyRow[]).splice(idx, 1);
        }
        return {
          data: state.selectAfter ? hits[0] : null,
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
//  Mocks
// ──────────────────────────────────────────────────────────────────────────

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table !== "schedules" && table !== "groups") {
        throw new Error(`Unexpected table in mock: ${table}`);
      }
      return makeBuilder(table as keyof typeof db);
    },
  }),
}));

let service: typeof import("../lib/schedules/service");

beforeAll(async () => {
  service = await import("../lib/schedules/service");
});

beforeEach(() => {
  resetDb();
});

// ──────────────────────────────────────────────────────────────────────────
//  Fixtures
// ──────────────────────────────────────────────────────────────────────────

const TENANT_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const TENANT_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

function seedGroup(partial: Partial<GroupRow> = {}): GroupRow {
  const row: GroupRow = {
    id: randomUUID(),
    tenant_id: TENANT_A,
    ...partial,
  };
  db.groups.push(row);
  return row;
}

function seedSchedule(partial: Partial<ScheduleRow> = {}): ScheduleRow {
  const now = new Date().toISOString();
  const groupId = partial.group_id ?? seedGroup().id;
  const row: ScheduleRow = {
    id: randomUUID(),
    tenant_id: TENANT_A,
    group_id: groupId,
    frequency: "daily",
    time_of_day: "18:00:00",
    day_of_week: null,
    trigger_type: "fixed_time",
    approval_mode: "required",
    voice: null,
    tone: "fun",
    is_active: true,
    created_at: now,
    updated_at: now,
    ...partial,
  };
  db.schedules.push(row);
  return row;
}

// ──────────────────────────────────────────────────────────────────────────
//  listSchedules / getSchedule
// ──────────────────────────────────────────────────────────────────────────

describe("listSchedules", () => {
  it("returns empty for a tenant with no rows", async () => {
    expect(await service.listSchedules(TENANT_A)).toEqual([]);
  });

  it("scopes to the tenant", async () => {
    seedSchedule();
    seedSchedule({ tenant_id: TENANT_B });
    const out = await service.listSchedules(TENANT_A);
    expect(out).toHaveLength(1);
    expect(out[0].tenantId).toBe(TENANT_A);
  });
});

describe("getSchedule", () => {
  it("returns null when not found", async () => {
    expect(
      await service.getSchedule(
        TENANT_A,
        "00000000-0000-0000-0000-000000000000",
      ),
    ).toBeNull();
  });

  it("returns null across tenants", async () => {
    const row = seedSchedule({ tenant_id: TENANT_B });
    expect(await service.getSchedule(TENANT_A, row.id)).toBeNull();
  });

  it("returns the view when found", async () => {
    const row = seedSchedule();
    const view = await service.getSchedule(TENANT_A, row.id);
    expect(view).not.toBeNull();
    expect(view!.id).toBe(row.id);
    expect(view!.frequency).toBe("daily");
  });
});

// ──────────────────────────────────────────────────────────────────────────
//  createSchedule
// ──────────────────────────────────────────────────────────────────────────

describe("createSchedule", () => {
  it("creates a schedule for a group that belongs to the tenant", async () => {
    const g = seedGroup();
    const view = await service.createSchedule({
      tenantId: TENANT_A,
      groupId: g.id,
      frequency: "daily",
      timeOfDay: "09:00:00",
      dayOfWeek: null,
      triggerType: "fixed_time",
      approvalMode: "optional",
      voice: null,
      tone: "fun",
      isActive: true,
    });
    expect(view.id).toBeTruthy();
    expect(view.approvalMode).toBe("optional");
    expect(db.schedules).toHaveLength(1);
  });

  it("throws CONFLICT when a schedule already exists for the group", async () => {
    const g = seedGroup();
    seedSchedule({ group_id: g.id });

    await expect(
      service.createSchedule({
        tenantId: TENANT_A,
        groupId: g.id,
        frequency: "daily",
        timeOfDay: "10:00:00",
        dayOfWeek: null,
        triggerType: "fixed_time",
        approvalMode: "required",
        voice: null,
        tone: "fun",
        isActive: true,
      }),
    ).rejects.toMatchObject({
      name: "SchedulesError",
      code: "CONFLICT",
    });
  });

  it("throws VALIDATION_ERROR when group doesn't belong to tenant", async () => {
    const g = seedGroup({ tenant_id: TENANT_B });
    await expect(
      service.createSchedule({
        tenantId: TENANT_A,
        groupId: g.id,
        frequency: "daily",
        timeOfDay: "10:00:00",
        dayOfWeek: null,
        triggerType: "fixed_time",
        approvalMode: "required",
        voice: null,
        tone: "fun",
        isActive: true,
      }),
    ).rejects.toMatchObject({
      name: "SchedulesError",
      code: "VALIDATION_ERROR",
    });
    expect(db.schedules).toHaveLength(0);
  });
});

// ──────────────────────────────────────────────────────────────────────────
//  updateSchedule
// ──────────────────────────────────────────────────────────────────────────

describe("updateSchedule", () => {
  it("patches the provided fields", async () => {
    const row = seedSchedule({
      frequency: "daily",
      approval_mode: "required",
      is_active: true,
    });

    const view = await service.updateSchedule(TENANT_A, row.id, {
      approvalMode: "optional",
      isActive: false,
      tone: "formal",
    });

    expect(view.approvalMode).toBe("optional");
    expect(view.isActive).toBe(false);
    expect(view.tone).toBe("formal");
    // untouched fields stay intact
    expect(view.frequency).toBe("daily");
  });

  it("throws NOT_FOUND when id doesn't match", async () => {
    await expect(
      service.updateSchedule(
        TENANT_A,
        "00000000-0000-0000-0000-000000000000",
        { isActive: false },
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("throws NOT_FOUND across tenants", async () => {
    const row = seedSchedule({ tenant_id: TENANT_B });
    await expect(
      service.updateSchedule(TENANT_A, row.id, { isActive: false }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    // Row untouched
    expect(db.schedules[0].is_active).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────
//  deleteSchedule
// ──────────────────────────────────────────────────────────────────────────

describe("deleteSchedule", () => {
  it("removes the row", async () => {
    const row = seedSchedule();
    await service.deleteSchedule(TENANT_A, row.id);
    expect(db.schedules).toHaveLength(0);
  });

  it("throws NOT_FOUND across tenants", async () => {
    const row = seedSchedule({ tenant_id: TENANT_B });
    await expect(
      service.deleteSchedule(TENANT_A, row.id),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(db.schedules).toHaveLength(1);
  });
});

// ──────────────────────────────────────────────────────────────────────────
//  dueSchedulesNow
// ──────────────────────────────────────────────────────────────────────────

/**
 * Build a `Date` whose wall-clock in America/Sao_Paulo is exactly
 * `hh:mm` on `weekday` (0=Sun..6=Sat). Strategy: pick a known Sunday
 * at 00:00 UTC, add the offset for the target weekday, then add the
 * time components. America/Sao_Paulo is UTC-03 year-round (no DST
 * since 2019), so a UTC shift of +3h yields the target local time.
 *
 * This keeps the fixture test-time-zone-agnostic.
 */
function saoPauloAt(
  weekday: number,
  hh: number,
  mm: number,
): Date {
  // 2026-04-19 is a Sunday (ref: 2026-04-22 Wed per env).
  // 00:00 local São Paulo = 03:00 UTC.
  const baseUtc = Date.UTC(2026, 3, 19, 3, 0, 0); // Apr 19 2026 00:00 BRT
  const ms =
    baseUtc +
    weekday * 24 * 60 * 60 * 1000 +
    hh * 60 * 60 * 1000 +
    mm * 60 * 1000;
  return new Date(ms);
}

describe("dueSchedulesNow", () => {
  it("returns daily schedules whose time_of_day falls in the window", async () => {
    // "now" = 18:02 São Paulo, Wednesday
    const now = saoPauloAt(3 /* Wed */, 18, 2);

    seedSchedule({
      frequency: "daily",
      time_of_day: "18:00:00", // within window
      trigger_type: "fixed_time",
    });
    seedSchedule({
      frequency: "daily",
      time_of_day: "12:00:00", // outside
      trigger_type: "fixed_time",
    });

    const due = await service.dueSchedulesNow(now, 5);
    expect(due).toHaveLength(1);
    expect(due[0].timeOfDay).toBe("18:00:00");
  });

  it("gates weekly schedules by day_of_week", async () => {
    // "now" = 09:00 São Paulo, Wednesday (day_of_week=3)
    const now = saoPauloAt(3, 9, 0);

    seedSchedule({
      frequency: "weekly",
      time_of_day: "09:00:00",
      day_of_week: 3, // Wed — match
    });
    seedSchedule({
      frequency: "weekly",
      time_of_day: "09:00:00",
      day_of_week: 1, // Mon — skip
    });

    const due = await service.dueSchedulesNow(now, 5);
    expect(due).toHaveLength(1);
    expect(due[0].dayOfWeek).toBe(3);
  });

  it("skips inactive schedules", async () => {
    const now = saoPauloAt(3, 18, 2);
    seedSchedule({
      frequency: "daily",
      time_of_day: "18:00:00",
      is_active: false,
    });
    const due = await service.dueSchedulesNow(now, 5);
    expect(due).toHaveLength(0);
  });

  it("skips non-fixed_time triggers", async () => {
    const now = saoPauloAt(3, 18, 2);
    seedSchedule({
      frequency: "daily",
      time_of_day: "18:00:00",
      trigger_type: "inactivity",
    });
    const due = await service.dueSchedulesNow(now, 5);
    expect(due).toHaveLength(0);
  });
});
