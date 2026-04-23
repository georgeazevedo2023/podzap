/**
 * Unit tests for lib/stats/service.ts (Fase 12).
 *
 * Mirrors the in-memory Supabase-builder strategy used in
 * tests/audios-service.spec.ts / tests/summaries-service.spec.ts — we
 * never touch a real DB or Storage. The mocked admin client supports
 * just the query surface `getHomeStats` uses:
 *
 *   - `.select(cols, { count: 'exact', head: true })` — returns count only
 *   - `.select('*')` — returns rows
 *   - `.eq / .gte / .lte`
 *   - `.order / .limit`
 *   - `!inner`-style embed (resolved client-side against the
 *     `summaries` + `groups` in-memory tables)
 *
 * `getSignedUrl` is mocked to return a deterministic URL so we can
 * assert the signing happened without hitting Supabase Storage.
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

type MessageType = "text" | "audio" | "image" | "video" | "other";
type SummaryStatus = "pending_review" | "approved" | "rejected";
type SummaryTone = "formal" | "fun" | "corporate";

type SummaryRow = {
  id: string;
  tenant_id: string;
  group_id: string;
  status: SummaryStatus;
  tone: SummaryTone;
  text: string;
  created_at: string;
};

type AudioRow = {
  id: string;
  tenant_id: string;
  summary_id: string;
  storage_path: string;
  duration_seconds: number | null;
  delivered_to_whatsapp: boolean;
  delivered_at: string | null;
  created_at: string;
};

type GroupRow = {
  id: string;
  tenant_id: string;
  name: string;
};

type MessageRow = {
  id: string;
  tenant_id: string;
  group_id: string;
  type: MessageType;
  captured_at: string;
};

const db = {
  summaries: [] as SummaryRow[],
  audios: [] as AudioRow[],
  groups: [] as GroupRow[],
  messages: [] as MessageRow[],
};

function resetDb() {
  db.summaries = [];
  db.audios = [];
  db.groups = [];
  db.messages = [];
}

// ──────────────────────────────────────────────────────────────────────────
//  Chainable builder
// ──────────────────────────────────────────────────────────────────────────

type AnyRow = Record<string, unknown>;
type FilterOp =
  | { kind: "eq"; col: string; val: unknown }
  | { kind: "gte"; col: string; val: unknown }
  | { kind: "lte"; col: string; val: unknown };

type TableKey = keyof typeof db;

function getAtPath(row: AnyRow, path: string): unknown {
  // Supports "summaries.status" style column filters used with `!inner`.
  const parts = path.split(".");
  let cur: unknown = row;
  for (const p of parts) {
    if (cur === null || cur === undefined) return undefined;
    if (typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

function makeBuilder(table: TableKey) {
  const state: {
    filters: FilterOp[];
    orders: Array<{ col: string; ascending: boolean }>;
    limit?: number;
    selectColumns: string;
    selectOpts: { count?: "exact"; head?: boolean } | undefined;
  } = {
    filters: [],
    orders: [],
    selectColumns: "*",
    selectOpts: undefined,
  };

  const api: Record<string, (...args: unknown[]) => unknown> = {};

  api.select = (cols?: unknown, opts?: unknown) => {
    state.selectColumns = (cols as string) ?? "*";
    state.selectOpts = opts as typeof state.selectOpts;
    return api;
  };
  api.eq = (col: unknown, val: unknown) => {
    state.filters.push({ kind: "eq", col: col as string, val });
    return api;
  };
  api.gte = (col: unknown, val: unknown) => {
    state.filters.push({ kind: "gte", col: col as string, val });
    return api;
  };
  api.lte = (col: unknown, val: unknown) => {
    state.filters.push({ kind: "lte", col: col as string, val });
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

  const hydrate = (rows: AnyRow[]): AnyRow[] => {
    if (!state.selectColumns.includes("summaries")) return rows;
    // `audios` select with `summaries!inner (... groups:group_id (...))`.
    return rows.map((r) => {
      const summary =
        db.summaries.find((s) => s.id === (r.summary_id as string)) ?? null;
      if (!summary) return { ...r, summaries: null };
      const group =
        db.groups.find((g) => g.id === summary.group_id) ?? null;
      return {
        ...r,
        summaries: {
          id: summary.id,
          status: summary.status,
          tone: summary.tone,
          text: summary.text,
          created_at: summary.created_at,
          group_id: summary.group_id,
          groups: group ? { id: group.id, name: group.name } : null,
        },
      };
    });
  };

  const passesFilters = (row: AnyRow): boolean => {
    for (const f of state.filters) {
      const v = getAtPath(row, f.col);
      if (f.kind === "eq" && v !== f.val) return false;
      if (f.kind === "gte") {
        if (typeof v !== "string" || typeof f.val !== "string") return false;
        if (v < f.val) return false;
      }
      if (f.kind === "lte") {
        if (typeof v !== "string" || typeof f.val !== "string") return false;
        if (v > f.val) return false;
      }
    }
    return true;
  };

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

  const run = () => {
    const base = db[table] as unknown as AnyRow[];
    const hydrated = hydrate(base);
    const filtered = hydrated.filter(passesFilters);
    const ordered = applyOrder(filtered);
    const limited =
      state.limit !== undefined ? ordered.slice(0, state.limit) : ordered;

    if (state.selectOpts?.count === "exact" && state.selectOpts?.head) {
      return { data: null, count: filtered.length, error: null };
    }
    return { data: limited, count: filtered.length, error: null };
  };

  (api as unknown as { then: PromiseLike<unknown>["then"] }).then = function (
    onfulfilled,
    onrejected,
  ) {
    return Promise.resolve(run()).then(
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
      if (!(table in db)) {
        throw new Error(`Unexpected table in mock: ${table}`);
      }
      return makeBuilder(table as TableKey);
    },
  }),
}));

vi.mock("@/lib/media/signedUrl", () => ({
  getSignedUrl: vi.fn(
    async (path: string) => `https://signed.example/${path}?t=fake`,
  ),
}));

let service: typeof import("../lib/stats/service");
let signedUrlModule: typeof import("../lib/media/signedUrl");

beforeAll(async () => {
  service = await import("../lib/stats/service");
  signedUrlModule = await import("../lib/media/signedUrl");
});

beforeEach(() => {
  resetDb();
  vi.mocked(signedUrlModule.getSignedUrl).mockClear();
  vi.mocked(signedUrlModule.getSignedUrl).mockImplementation(
    async (path: string) => `https://signed.example/${path}?t=fake`,
  );
});

afterEach(() => {
  vi.restoreAllMocks();
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
    name: "Grupo Teste",
    ...partial,
  };
  db.groups.push(row);
  return row;
}

function seedSummary(partial: Partial<SummaryRow> = {}): SummaryRow {
  const row: SummaryRow = {
    id: randomUUID(),
    tenant_id: TENANT_A,
    group_id: randomUUID(),
    status: "approved",
    tone: "fun",
    text: "Resumo do dia.",
    created_at: new Date().toISOString(),
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
    duration_seconds: 60,
    delivered_to_whatsapp: false,
    delivered_at: null,
    created_at: new Date().toISOString(),
    ...partial,
  };
  db.audios.push(row);
  return row;
}

function seedMessage(partial: Partial<MessageRow> = {}): MessageRow {
  const row: MessageRow = {
    id: randomUUID(),
    tenant_id: TENANT_A,
    group_id: randomUUID(),
    type: "text",
    captured_at: new Date().toISOString(),
    ...partial,
  };
  db.messages.push(row);
  return row;
}

// ──────────────────────────────────────────────────────────────────────────
//  hashToVariant
// ──────────────────────────────────────────────────────────────────────────

describe("hashToVariant", () => {
  it("is deterministic for the same id", () => {
    const id = "group-abc-123";
    expect(service.hashToVariant(id)).toBe(service.hashToVariant(id));
  });

  it("always returns a value in [0, 5]", () => {
    for (const id of [
      "",
      "a",
      "x".repeat(100),
      randomUUID(),
      "a1b2-c3d4-e5f6",
    ]) {
      const v = service.hashToVariant(id);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(5);
      expect(Number.isInteger(v)).toBe(true);
    }
  });

  it("distributes at least somewhat — 20 distinct ids hit ≥2 buckets", () => {
    const seen = new Set<number>();
    for (let i = 0; i < 20; i++) seen.add(service.hashToVariant(`grp-${i}`));
    expect(seen.size).toBeGreaterThanOrEqual(2);
  });
});

// ──────────────────────────────────────────────────────────────────────────
//  getHomeStats — empty tenant
// ──────────────────────────────────────────────────────────────────────────

describe("getHomeStats — empty tenant", () => {
  it("returns zeros everywhere and null currentEpisode", async () => {
    const stats = await service.getHomeStats(TENANT_A);
    expect(stats).toEqual({
      summariesThisWeek: 0,
      minutesListened: 0,
      activeGroupsCount: 0,
      approvalRate: 0,
      pendingApprovalsCount: 0,
      latestEpisodes: [],
      currentEpisode: null,
    });
    expect(signedUrlModule.getSignedUrl).not.toHaveBeenCalled();
  });

  it("cross-tenant rows don't leak into tenant A stats", async () => {
    const g = seedGroup({ tenant_id: TENANT_B });
    const s = seedSummary({
      tenant_id: TENANT_B,
      group_id: g.id,
      status: "approved",
    });
    seedAudio({
      tenant_id: TENANT_B,
      summary_id: s.id,
      delivered_to_whatsapp: true,
      delivered_at: new Date().toISOString(),
      duration_seconds: 120,
    });
    seedMessage({ tenant_id: TENANT_B, group_id: g.id });

    const stats = await service.getHomeStats(TENANT_A);
    expect(stats.summariesThisWeek).toBe(0);
    expect(stats.minutesListened).toBe(0);
    expect(stats.activeGroupsCount).toBe(0);
    expect(stats.pendingApprovalsCount).toBe(0);
    expect(stats.currentEpisode).toBeNull();
  });
});

// ──────────────────────────────────────────────────────────────────────────
//  getHomeStats — counts
// ──────────────────────────────────────────────────────────────────────────

describe("getHomeStats — counts", () => {
  it("counts approved summaries in the last 7 days", async () => {
    const g = seedGroup();
    // Inside window
    seedSummary({
      group_id: g.id,
      status: "approved",
      created_at: new Date(Date.now() - 2 * 86_400_000).toISOString(),
    });
    seedSummary({
      group_id: g.id,
      status: "approved",
      created_at: new Date(Date.now() - 6 * 86_400_000).toISOString(),
    });
    // Outside window
    seedSummary({
      group_id: g.id,
      status: "approved",
      created_at: new Date(Date.now() - 10 * 86_400_000).toISOString(),
    });
    // Wrong status
    seedSummary({
      group_id: g.id,
      status: "pending_review",
      created_at: new Date().toISOString(),
    });

    const stats = await service.getHomeStats(TENANT_A);
    expect(stats.summariesThisWeek).toBe(2);
  });

  it("sums delivered minutes in the last 7 days (floor)", async () => {
    const g = seedGroup();
    const s1 = seedSummary({ group_id: g.id });
    const s2 = seedSummary({ group_id: g.id });
    const s3 = seedSummary({ group_id: g.id });

    // 90s + 150s = 240s → 4 min
    seedAudio({
      summary_id: s1.id,
      delivered_to_whatsapp: true,
      delivered_at: new Date(Date.now() - 60_000).toISOString(),
      duration_seconds: 90,
    });
    seedAudio({
      summary_id: s2.id,
      delivered_to_whatsapp: true,
      delivered_at: new Date(Date.now() - 120_000).toISOString(),
      duration_seconds: 150,
    });
    // Not delivered — excluded
    seedAudio({
      summary_id: s3.id,
      delivered_to_whatsapp: false,
      duration_seconds: 300,
    });

    const stats = await service.getHomeStats(TENANT_A);
    expect(stats.minutesListened).toBe(4);
  });

  it("counts distinct active groups in the last 7 days", async () => {
    const g1 = seedGroup();
    const g2 = seedGroup();
    const g3 = seedGroup();

    seedMessage({ group_id: g1.id });
    seedMessage({ group_id: g1.id });
    seedMessage({ group_id: g2.id });
    // g3: only an old message (outside window)
    seedMessage({
      group_id: g3.id,
      captured_at: new Date(Date.now() - 10 * 86_400_000).toISOString(),
    });

    const stats = await service.getHomeStats(TENANT_A);
    expect(stats.activeGroupsCount).toBe(2);
  });

  it("approvalRate over 30d — 3 approved / 5 total = 0.6", async () => {
    const g = seedGroup();
    for (let i = 0; i < 3; i++) {
      seedSummary({ group_id: g.id, status: "approved" });
    }
    seedSummary({ group_id: g.id, status: "pending_review" });
    seedSummary({ group_id: g.id, status: "rejected" });

    const stats = await service.getHomeStats(TENANT_A);
    expect(stats.approvalRate).toBeCloseTo(0.6, 5);
  });

  it("approvalRate is null-safe when denom = 0", async () => {
    const stats = await service.getHomeStats(TENANT_A);
    expect(stats.approvalRate).toBe(0);
  });

  it("counts pending approvals (any age)", async () => {
    const g = seedGroup();
    seedSummary({ group_id: g.id, status: "pending_review" });
    seedSummary({ group_id: g.id, status: "pending_review" });
    seedSummary({ group_id: g.id, status: "approved" });
    // Other tenant — ignored
    seedSummary({
      tenant_id: TENANT_B,
      group_id: g.id,
      status: "pending_review",
    });

    const stats = await service.getHomeStats(TENANT_A);
    expect(stats.pendingApprovalsCount).toBe(2);
  });
});

// ──────────────────────────────────────────────────────────────────────────
//  getHomeStats — latestEpisodes + currentEpisode
// ──────────────────────────────────────────────────────────────────────────

describe("getHomeStats — latestEpisodes", () => {
  it("returns up to 4 newest audios with approved summaries, desc", async () => {
    const g = seedGroup({ name: "Grupo X" });
    const makeEp = (ageMs: number) => {
      const s = seedSummary({ group_id: g.id, status: "approved" });
      return seedAudio({
        summary_id: s.id,
        created_at: new Date(Date.now() - ageMs).toISOString(),
      });
    };
    const a1 = makeEp(5_000);
    const a2 = makeEp(10_000);
    const a3 = makeEp(15_000);
    const a4 = makeEp(20_000);
    makeEp(25_000); // 5th → should be dropped by limit

    const stats = await service.getHomeStats(TENANT_A);
    expect(stats.latestEpisodes).toHaveLength(4);
    expect(stats.latestEpisodes.map((e) => e.summaryId)).toEqual([
      a1.summary_id,
      a2.summary_id,
      a3.summary_id,
      a4.summary_id,
    ]);
  });

  it("skips audios whose summary is not approved", async () => {
    const g = seedGroup();
    const sApproved = seedSummary({ group_id: g.id, status: "approved" });
    const sPending = seedSummary({ group_id: g.id, status: "pending_review" });
    seedAudio({ summary_id: sApproved.id });
    seedAudio({ summary_id: sPending.id });

    const stats = await service.getHomeStats(TENANT_A);
    expect(stats.latestEpisodes).toHaveLength(1);
    expect(stats.latestEpisodes[0].summaryId).toBe(sApproved.id);
  });

  it("populates coverVariant deterministically from groupId", async () => {
    const g = seedGroup({ id: "fixed-group-id-123" });
    const s = seedSummary({ group_id: g.id, status: "approved" });
    seedAudio({ summary_id: s.id });

    const stats = await service.getHomeStats(TENANT_A);
    expect(stats.latestEpisodes[0].coverVariant).toBe(
      service.hashToVariant("fixed-group-id-123"),
    );
  });

  it("signs audio URLs and returns an expiresAt ~1h in the future", async () => {
    const g = seedGroup();
    const s = seedSummary({ group_id: g.id, status: "approved" });
    seedAudio({
      summary_id: s.id,
      storage_path: `${TENANT_A}/2026/cool.wav`,
    });

    const before = Date.now();
    const stats = await service.getHomeStats(TENANT_A);
    const after = Date.now();

    const ep = stats.latestEpisodes[0];
    expect(ep.audioSignedUrl).toBe(
      `https://signed.example/${TENANT_A}/2026/cool.wav?t=fake`,
    );
    expect(ep.audioExpiresAt).not.toBeNull();
    const expiresMs = new Date(ep.audioExpiresAt!).getTime();
    expect(expiresMs).toBeGreaterThanOrEqual(before + 3_600_000);
    expect(expiresMs).toBeLessThanOrEqual(after + 3_600_000 + 10);
  });

  it("swallows per-episode signing failures (returns null url/expiresAt)", async () => {
    vi.mocked(signedUrlModule.getSignedUrl).mockRejectedValueOnce(
      new Error("boom"),
    );
    const g = seedGroup();
    const s = seedSummary({ group_id: g.id, status: "approved" });
    seedAudio({ summary_id: s.id });

    const stats = await service.getHomeStats(TENANT_A);
    expect(stats.latestEpisodes[0].audioSignedUrl).toBeNull();
    expect(stats.latestEpisodes[0].audioExpiresAt).toBeNull();
    // But the episode still shows up so the card renders.
    expect(stats.latestEpisodes).toHaveLength(1);
  });
});

describe("getHomeStats — currentEpisode", () => {
  it("is null when there are no approved summaries with audio", async () => {
    const g = seedGroup();
    seedSummary({ group_id: g.id, status: "pending_review" });
    const stats = await service.getHomeStats(TENANT_A);
    expect(stats.currentEpisode).toBeNull();
  });

  it("picks the newest approved+audio, with per-group counts over 24h", async () => {
    const g = seedGroup({ name: "Família" });
    const sOlder = seedSummary({
      group_id: g.id,
      status: "approved",
      created_at: new Date(Date.now() - 86_400_000).toISOString(),
      text: "Summary antigo.",
    });
    const sNewer = seedSummary({
      group_id: g.id,
      status: "approved",
      created_at: new Date().toISOString(),
      text: "Título incrível do episódio de hoje. Mais detalhes aqui.",
      tone: "formal",
    });
    seedAudio({
      summary_id: sOlder.id,
      created_at: new Date(Date.now() - 86_400_000).toISOString(),
    });
    seedAudio({
      summary_id: sNewer.id,
      duration_seconds: 180,
      created_at: new Date().toISOString(),
    });

    // Messages within 24h: 3 text + 2 audio + 1 image
    for (let i = 0; i < 3; i++) seedMessage({ group_id: g.id, type: "text" });
    seedMessage({ group_id: g.id, type: "audio" });
    seedMessage({ group_id: g.id, type: "audio" });
    seedMessage({ group_id: g.id, type: "image" });
    // Old message outside 24h window
    seedMessage({
      group_id: g.id,
      type: "text",
      captured_at: new Date(Date.now() - 2 * 86_400_000).toISOString(),
    });

    const stats = await service.getHomeStats(TENANT_A);
    expect(stats.currentEpisode).not.toBeNull();
    const cur = stats.currentEpisode!;
    expect(cur.summaryId).toBe(sNewer.id);
    expect(cur.groupName).toBe("Família");
    expect(cur.messagesCount).toBe(6);
    expect(cur.audiosCount).toBe(2);
    expect(cur.imagesCount).toBe(1);
    expect(cur.durationSeconds).toBe(180);
    expect(cur.tone).toBe("formal");
    // 2 approved summaries for this group → episode number = 2
    expect(cur.episodeNumber).toBe(2);
    // Title pulled from first sentence of summary text.
    expect(cur.title.length).toBeGreaterThan(0);
    expect(cur.title.length).toBeLessThanOrEqual(60);
    expect(cur.title.toLowerCase()).toContain("título");
  });

  it("falls back to 'ep. N' when summary text is empty", async () => {
    const g = seedGroup();
    const s = seedSummary({
      group_id: g.id,
      status: "approved",
      text: "",
    });
    seedAudio({ summary_id: s.id });

    const stats = await service.getHomeStats(TENANT_A);
    expect(stats.currentEpisode?.title).toBe("ep. 1");
  });
});
