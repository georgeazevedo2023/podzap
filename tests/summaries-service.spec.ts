/**
 * Unit tests for lib/summaries/service.ts — covers Fase 8 write helpers
 * (approveSummary / rejectSummary / updateSummaryText) plus the existing
 * listSummaries / getSummary read paths.
 *
 * Strategy mirrors tests/groups-service.spec.ts:
 *   - `createAdminClient` is mocked with an in-memory chainable fake that
 *     implements just enough of the supabase-js builder surface for this
 *     service: select / update / eq / order / limit / maybeSingle / then.
 *   - The fake resolves the `groups:group_id ( name )` embed by joining
 *     our in-memory `groups` table on the fly so the row returned from
 *     `.select(...)` matches what real PostgREST would produce.
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

type SummaryStatus = "pending_review" | "approved" | "rejected";
type SummaryTone = "formal" | "fun" | "corporate";

type SummaryRow = {
  id: string;
  tenant_id: string;
  group_id: string;
  period_start: string;
  period_end: string;
  text: string;
  tone: SummaryTone;
  status: SummaryStatus;
  model: string | null;
  prompt_version: string | null;
  approved_by: string | null;
  approved_at: string | null;
  rejected_reason: string | null;
  created_at: string;
  updated_at: string;
};

type GroupRow = {
  id: string;
  tenant_id: string;
  name: string;
};

const db = {
  summaries: [] as SummaryRow[],
  groups: [] as GroupRow[],
};

function resetDb() {
  db.summaries = [];
  db.groups = [];
}

type AnyRow = Record<string, unknown>;

type FilterOp = { kind: "eq"; col: string; val: unknown };

/**
 * Chainable supabase fake — narrow and deterministic, not a full
 * PostgREST reimplementation. Notable quirks:
 *   - If a `select(...)` string includes `groups:group_id ( name )` we
 *     hydrate a `groups` property on each returned summary row by
 *     looking up the matching group. That mimics the embed response
 *     shape the service's `rowToView` expects.
 */
function makeBuilder(table: keyof typeof db) {
  const state: {
    filters: FilterOp[];
    orders: Array<{ col: string; ascending: boolean }>;
    limit?: number;
    op:
      | { kind: "select"; columns: string }
      | { kind: "update"; patch: AnyRow };
    selectAfter: boolean;
  } = {
    filters: [],
    orders: [],
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

  const hydrateJoin = (rows: AnyRow[], columns: string): AnyRow[] => {
    if (table !== "summaries") return rows;
    if (!columns.includes("groups:group_id")) return rows;
    return rows.map((r) => {
      const groupId = r.group_id as string | undefined;
      const g = db.groups.find((x) => x.id === groupId) ?? null;
      return {
        ...r,
        groups: g ? { name: g.name } : null,
      };
    });
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
  api.limit = (n: unknown) => {
    state.limit = n as number;
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
        out = applyOrder(out);
        if (state.limit !== undefined) out = out.slice(0, state.limit);
        out = hydrateJoin(out, state.op.columns);
        return { data: out, error: null };
      }
      case "update": {
        const matches = applyFilters(rows);
        if (matches.length === 0) {
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
//  Mocks — installed BEFORE importing the service
// ──────────────────────────────────────────────────────────────────────────

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table !== "summaries" && table !== "groups") {
        throw new Error(`Unexpected table in mock: ${table}`);
      }
      return makeBuilder(table as keyof typeof db);
    },
  }),
}));

let service: typeof import("../lib/summaries/service");

beforeAll(async () => {
  service = await import("../lib/summaries/service");
});

beforeEach(() => {
  resetDb();
});

// ──────────────────────────────────────────────────────────────────────────
//  Fixtures
// ──────────────────────────────────────────────────────────────────────────

const TENANT_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const TENANT_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const USER_REVIEWER = "11111111-1111-1111-1111-111111111111";

function seedGroup(partial: Partial<GroupRow> = {}): GroupRow {
  const row: GroupRow = {
    id: randomUUID(),
    tenant_id: TENANT_A,
    name: "Some Group",
    ...partial,
  };
  db.groups.push(row);
  return row;
}

function seedSummary(partial: Partial<SummaryRow> = {}): SummaryRow {
  const now = new Date().toISOString();
  const groupId = partial.group_id ?? seedGroup().id;
  const row: SummaryRow = {
    id: randomUUID(),
    tenant_id: TENANT_A,
    group_id: groupId,
    period_start: now,
    period_end: now,
    text: "original text",
    tone: "fun",
    status: "pending_review",
    model: null,
    prompt_version: null,
    approved_by: null,
    approved_at: null,
    rejected_reason: null,
    created_at: now,
    updated_at: now,
    ...partial,
  };
  db.summaries.push(row);
  return row;
}

// ──────────────────────────────────────────────────────────────────────────
//  listSummaries / getSummary — existing read paths still pass
// ──────────────────────────────────────────────────────────────────────────

describe("listSummaries", () => {
  it("returns empty for a tenant with no rows", async () => {
    expect(await service.listSummaries(TENANT_A)).toEqual([]);
  });

  it("returns newest-first and scopes to the tenant", async () => {
    const g = seedGroup({ name: "Dev" });
    const older = seedSummary({
      group_id: g.id,
      created_at: new Date(Date.now() - 10_000).toISOString(),
    });
    const newer = seedSummary({
      group_id: g.id,
      created_at: new Date().toISOString(),
    });
    seedSummary({ tenant_id: TENANT_B });

    const out = await service.listSummaries(TENANT_A);
    expect(out.map((s) => s.id)).toEqual([newer.id, older.id]);
    expect(out[0].groupName).toBe("Dev");
  });

  it("filters by status when the value is valid", async () => {
    seedSummary({ status: "pending_review" });
    seedSummary({ status: "approved" });

    const out = await service.listSummaries(TENANT_A, { status: "approved" });
    expect(out).toHaveLength(1);
    expect(out[0].status).toBe("approved");
  });
});

describe("getSummary", () => {
  it("returns null when not found", async () => {
    expect(
      await service.getSummary(TENANT_A, "00000000-0000-0000-0000-000000000000"),
    ).toBeNull();
  });

  it("returns null for a row owned by a different tenant", async () => {
    const row = seedSummary({ tenant_id: TENANT_B });
    expect(await service.getSummary(TENANT_A, row.id)).toBeNull();
  });

  it("maps row to view with the joined group name", async () => {
    const g = seedGroup({ name: "HR" });
    const row = seedSummary({ group_id: g.id });
    const view = await service.getSummary(TENANT_A, row.id);
    expect(view).not.toBeNull();
    expect(view!.id).toBe(row.id);
    expect(view!.groupName).toBe("HR");
  });
});

// ──────────────────────────────────────────────────────────────────────────
//  approveSummary
// ──────────────────────────────────────────────────────────────────────────

describe("approveSummary", () => {
  it("flips pending_review → approved and stamps approved_by + approved_at", async () => {
    const row = seedSummary({ status: "pending_review" });

    const before = Date.now();
    const view = await service.approveSummary(
      TENANT_A,
      row.id,
      USER_REVIEWER,
    );
    const after = Date.now();

    expect(view.status).toBe("approved");
    expect(view.approvedBy).toBe(USER_REVIEWER);
    expect(view.approvedAt).toBeTruthy();

    const persisted = db.summaries.find((s) => s.id === row.id)!;
    expect(persisted.status).toBe("approved");
    expect(persisted.approved_by).toBe(USER_REVIEWER);
    const t = Date.parse(persisted.approved_at!);
    expect(t).toBeGreaterThanOrEqual(before - 1);
    expect(t).toBeLessThanOrEqual(after + 1);
    // updated_at should have been bumped to the same stamp.
    expect(persisted.updated_at).toBe(persisted.approved_at);
  });

  it("throws NOT_FOUND when the id doesn't exist", async () => {
    await expect(
      service.approveSummary(
        TENANT_A,
        "00000000-0000-0000-0000-000000000000",
        USER_REVIEWER,
      ),
    ).rejects.toMatchObject({
      name: "SummariesError",
      code: "NOT_FOUND",
    });
  });

  it("throws NOT_FOUND for cross-tenant id (doesn't leak existence)", async () => {
    const row = seedSummary({
      tenant_id: TENANT_B,
      status: "pending_review",
    });
    await expect(
      service.approveSummary(TENANT_A, row.id, USER_REVIEWER),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    // And the row must remain untouched.
    const after = db.summaries.find((s) => s.id === row.id)!;
    expect(after.status).toBe("pending_review");
    expect(after.approved_by).toBeNull();
  });

  it("throws INVALID_STATE when already approved", async () => {
    const row = seedSummary({ status: "approved" });
    await expect(
      service.approveSummary(TENANT_A, row.id, USER_REVIEWER),
    ).rejects.toMatchObject({
      code: "INVALID_STATE",
      message: expect.stringContaining("approved"),
    });
  });

  it("throws INVALID_STATE when rejected", async () => {
    const row = seedSummary({
      status: "rejected",
      rejected_reason: "nope",
    });
    await expect(
      service.approveSummary(TENANT_A, row.id, USER_REVIEWER),
    ).rejects.toMatchObject({ code: "INVALID_STATE" });
  });
});

// ──────────────────────────────────────────────────────────────────────────
//  rejectSummary
// ──────────────────────────────────────────────────────────────────────────

describe("rejectSummary", () => {
  it("flips pending_review → rejected with reason + reviewer logged", async () => {
    const row = seedSummary({ status: "pending_review" });

    const view = await service.rejectSummary(
      TENANT_A,
      row.id,
      USER_REVIEWER,
      "  tone is off  ",
    );

    expect(view.status).toBe("rejected");
    expect(view.rejectedReason).toBe("tone is off");
    expect(view.approvedBy).toBe(USER_REVIEWER);

    const persisted = db.summaries.find((s) => s.id === row.id)!;
    expect(persisted.status).toBe("rejected");
    expect(persisted.rejected_reason).toBe("tone is off");
    expect(persisted.approved_by).toBe(USER_REVIEWER);
  });

  it("throws VALIDATION_ERROR for an empty / whitespace-only reason", async () => {
    const row = seedSummary({ status: "pending_review" });
    await expect(
      service.rejectSummary(TENANT_A, row.id, USER_REVIEWER, ""),
    ).rejects.toMatchObject({
      name: "SummariesError",
      code: "VALIDATION_ERROR",
    });
    await expect(
      service.rejectSummary(TENANT_A, row.id, USER_REVIEWER, "   "),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    // Row must be untouched.
    const after = db.summaries.find((s) => s.id === row.id)!;
    expect(after.status).toBe("pending_review");
    expect(after.rejected_reason).toBeNull();
  });

  it("throws INVALID_STATE when not pending_review", async () => {
    const row = seedSummary({ status: "approved" });
    await expect(
      service.rejectSummary(TENANT_A, row.id, USER_REVIEWER, "because"),
    ).rejects.toMatchObject({ code: "INVALID_STATE" });
  });

  it("throws NOT_FOUND when cross-tenant", async () => {
    const row = seedSummary({
      tenant_id: TENANT_B,
      status: "pending_review",
    });
    await expect(
      service.rejectSummary(TENANT_A, row.id, USER_REVIEWER, "because"),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

// ──────────────────────────────────────────────────────────────────────────
//  updateSummaryText
// ──────────────────────────────────────────────────────────────────────────

describe("updateSummaryText", () => {
  it("updates the text and bumps updated_at", async () => {
    const row = seedSummary({
      status: "pending_review",
      text: "old text",
    });

    const before = Date.now();
    const view = await service.updateSummaryText(
      TENANT_A,
      row.id,
      "new shiny text",
    );
    const after = Date.now();

    expect(view.text).toBe("new shiny text");
    expect(view.status).toBe("pending_review");

    const persisted = db.summaries.find((s) => s.id === row.id)!;
    expect(persisted.text).toBe("new shiny text");
    const t = Date.parse(persisted.updated_at);
    expect(t).toBeGreaterThanOrEqual(before - 1);
    expect(t).toBeLessThanOrEqual(after + 1);
  });

  it("throws INVALID_STATE when the row is already approved", async () => {
    const row = seedSummary({
      status: "approved",
      text: "locked text",
    });
    await expect(
      service.updateSummaryText(TENANT_A, row.id, "tampered"),
    ).rejects.toMatchObject({
      name: "SummariesError",
      code: "INVALID_STATE",
    });

    // Text must not have changed.
    const after = db.summaries.find((s) => s.id === row.id)!;
    expect(after.text).toBe("locked text");
  });

  it("throws INVALID_STATE when rejected", async () => {
    const row = seedSummary({ status: "rejected" });
    await expect(
      service.updateSummaryText(TENANT_A, row.id, "whatever"),
    ).rejects.toMatchObject({ code: "INVALID_STATE" });
  });

  it("throws VALIDATION_ERROR on empty / whitespace-only text", async () => {
    const row = seedSummary({ status: "pending_review" });
    await expect(
      service.updateSummaryText(TENANT_A, row.id, ""),
    ).rejects.toMatchObject({
      name: "SummariesError",
      code: "VALIDATION_ERROR",
    });
    await expect(
      service.updateSummaryText(TENANT_A, row.id, "   \n  "),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("throws VALIDATION_ERROR when text is too long (>= 50_000 chars)", async () => {
    const row = seedSummary({ status: "pending_review" });
    const huge = "a".repeat(50_000);
    await expect(
      service.updateSummaryText(TENANT_A, row.id, huge),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    // Just under the limit should succeed.
    const ok = "b".repeat(49_999);
    const view = await service.updateSummaryText(TENANT_A, row.id, ok);
    expect(view.text.length).toBe(49_999);
  });

  it("throws NOT_FOUND for an unknown id", async () => {
    await expect(
      service.updateSummaryText(
        TENANT_A,
        "00000000-0000-0000-0000-000000000000",
        "text",
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("throws NOT_FOUND for a cross-tenant id", async () => {
    const row = seedSummary({
      tenant_id: TENANT_B,
      status: "pending_review",
    });
    await expect(
      service.updateSummaryText(TENANT_A, row.id, "new"),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
