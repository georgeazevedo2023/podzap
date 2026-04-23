/**
 * Unit tests for `lib/pipeline/normalize.ts`.
 *
 * Strategy:
 *   - Mock `@/lib/supabase/admin` with an in-memory fake that mimics the
 *     narrow chainable surface `buildNormalizedConversation` exercises:
 *     `.from().select().eq().eq().gte().lte().order()` — resolved as a
 *     thenable to `{ data, error }`.
 *   - Drive `filterMessages` / `clusterByTopic` with real inputs so the
 *     test exercises the full orchestration path rather than mocking them.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// ──────────────────────────────────────────────────────────────────────────
//  In-memory row store + chainable builder
// ──────────────────────────────────────────────────────────────────────────

type Row = Record<string, unknown>;

type Filter =
  | { kind: "eq"; col: string; val: unknown }
  | { kind: "gte"; col: string; val: unknown }
  | { kind: "lte"; col: string; val: unknown };

const state: {
  table: string | null;
  rows: Row[];
  error: { message: string } | null;
} = {
  table: null,
  rows: [],
  error: null,
};

function resetState(): void {
  state.table = null;
  state.rows = [];
  state.error = null;
}

function applyFilters(rows: Row[], filters: Filter[]): Row[] {
  return rows.filter((r) =>
    filters.every((f) => {
      const v = r[f.col];
      switch (f.kind) {
        case "eq":
          return v === f.val;
        case "gte":
          return typeof v === "string" && v >= (f.val as string);
        case "lte":
          return typeof v === "string" && v <= (f.val as string);
      }
    }),
  );
}

function makeBuilder(table: string) {
  const filters: Filter[] = [];
  let order: { col: string; asc: boolean } | null = null;

  const chain = {
    select(_cols: string) {
      return chain;
    },
    eq(col: string, val: unknown) {
      filters.push({ kind: "eq", col, val });
      return chain;
    },
    gte(col: string, val: unknown) {
      filters.push({ kind: "gte", col, val });
      return chain;
    },
    lte(col: string, val: unknown) {
      filters.push({ kind: "lte", col, val });
      return chain;
    },
    order(col: string, opts?: { ascending?: boolean }) {
      order = { col, asc: opts?.ascending ?? true };
      return chain;
    },
    then(
      onfulfilled: (v: { data: Row[] | null; error: { message: string } | null }) => unknown,
      onrejected?: (e: unknown) => unknown,
    ) {
      if (state.error) {
        return Promise.resolve({ data: null, error: state.error }).then(
          onfulfilled,
          onrejected,
        );
      }
      let rows = applyFilters(state.rows, filters);
      if (order) {
        const key = order.col;
        const asc = order.asc;
        rows = [...rows].sort((a, b) => {
          const av = a[key] as string;
          const bv = b[key] as string;
          if (av === bv) return 0;
          return asc ? (av < bv ? -1 : 1) : av < bv ? 1 : -1;
        });
      }
      return Promise.resolve({ data: rows, error: null }).then(
        onfulfilled,
        onrejected,
      );
    },
  };

  // Remember which table we're scoped to (sanity check).
  state.table = table;
  return chain;
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table !== "messages") {
        throw new Error(`Unexpected table in normalize mock: ${table}`);
      }
      return makeBuilder(table);
    },
  }),
}));

// ──────────────────────────────────────────────────────────────────────────
//  Imports (after mock)
// ──────────────────────────────────────────────────────────────────────────

import { buildNormalizedConversation } from "@/lib/pipeline/normalize";

// ──────────────────────────────────────────────────────────────────────────
//  Fixtures
// ──────────────────────────────────────────────────────────────────────────

const TENANT = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const GROUP = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const OTHER_GROUP = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const GROUP_NAME = "Equipe PodZAP";

type SeedOpts = {
  id?: string;
  senderName?: string | null;
  senderJid?: string | null;
  capturedAt: Date;
  type?: "text" | "audio" | "image" | "video" | "other";
  content?: string | null;
  mediaUrl?: string | null;
  mediaDurationSeconds?: number | null;
  transcriptText?: string | null;
  tenantId?: string;
  groupId?: string;
  groupName?: string;
};

let autoId = 0;
function seedMessage(opts: SeedOpts): void {
  autoId += 1;
  const tid = opts.tenantId ?? TENANT;
  const gid = opts.groupId ?? GROUP;
  const gname = opts.groupName ?? GROUP_NAME;
  state.rows.push({
    id: opts.id ?? `msg-${autoId}`,
    tenant_id: tid,
    group_id: gid,
    sender_name: opts.senderName ?? "Alice",
    sender_jid: opts.senderJid ?? "5511999999999@s.whatsapp.net",
    captured_at: opts.capturedAt.toISOString(),
    type: opts.type ?? "text",
    content: opts.content ?? null,
    media_url: opts.mediaUrl ?? null,
    media_duration_seconds: opts.mediaDurationSeconds ?? null,
    transcripts:
      opts.transcriptText != null ? { text: opts.transcriptText } : null,
    groups: { name: gname },
  });
}

beforeEach(() => {
  resetState();
  autoId = 0;
});

// ──────────────────────────────────────────────────────────────────────────
//  Tests
// ──────────────────────────────────────────────────────────────────────────

describe("buildNormalizedConversation — empty result", () => {
  it("returns an empty-but-shaped conversation when the DB has no rows", async () => {
    const start = new Date("2026-04-20T00:00:00Z");
    const end = new Date("2026-04-20T23:59:59Z");

    const result = await buildNormalizedConversation(
      TENANT,
      GROUP,
      start,
      end,
    );

    expect(result).toEqual({
      tenantId: TENANT,
      groupId: GROUP,
      groupName: "",
      periodStart: start,
      periodEnd: end,
      topics: [],
      discarded: 0,
      total: 0,
    });
  });

  it("filters by tenant_id + group_id + period window", async () => {
    const start = new Date("2026-04-20T00:00:00Z");
    const end = new Date("2026-04-20T23:59:59Z");

    // Row in the right tenant/group but *before* the window.
    seedMessage({
      capturedAt: new Date("2026-04-19T23:00:00Z"),
      content: "before window, long enough to not be filtered out",
    });
    // Row in the right tenant/group but *after* the window.
    seedMessage({
      capturedAt: new Date("2026-04-21T00:30:00Z"),
      content: "after window, long enough to not be filtered out",
    });
    // Row in a different group.
    seedMessage({
      capturedAt: new Date("2026-04-20T12:00:00Z"),
      content: "wrong group, long enough to not be filtered out",
      groupId: OTHER_GROUP,
    });
    // Row in a different tenant.
    seedMessage({
      capturedAt: new Date("2026-04-20T12:00:00Z"),
      content: "wrong tenant, long enough to not be filtered out",
      tenantId: "zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz",
    });

    const result = await buildNormalizedConversation(
      TENANT,
      GROUP,
      start,
      end,
    );

    expect(result.total).toBe(0);
    expect(result.topics).toEqual([]);
    expect(result.discarded).toBe(0);
  });
});

describe("buildNormalizedConversation — happy path", () => {
  it("produces 1+ topic from a 10-message fixture", async () => {
    const start = new Date("2026-04-20T00:00:00Z");
    const end = new Date("2026-04-20T23:59:59Z");
    const base = new Date("2026-04-20T09:00:00Z").getTime();

    // 10 messages, same conversation cluster (all within ~10 min of each other).
    const fixtures: Array<{
      offsetMin: number;
      sender: string;
      content: string | null;
      type?: SeedOpts["type"];
      transcriptText?: string;
      duration?: number;
    }> = [
      {
        offsetMin: 0,
        sender: "Alice",
        content: "Pessoal, temos uma reunião importante hoje sobre o prazo do projeto",
      },
      { offsetMin: 1, sender: "Bob", content: "ok" }, // stopword → dropped
      {
        offsetMin: 2,
        sender: "Bob",
        content: "Qual é a decisão final sobre a proposta do cliente?",
      },
      {
        offsetMin: 3,
        sender: "Carol",
        content: "Acho que precisamos revisar o contrato antes de fechar qualquer decisão",
      },
      { offsetMin: 4, sender: "Alice", content: "kkk" }, // stopword → dropped
      {
        offsetMin: 5,
        sender: "Alice",
        content: "https://example.com/doc", // URL-only → dropped
      },
      {
        offsetMin: 6,
        sender: "Dave",
        type: "audio",
        content: null,
        transcriptText:
          "Então pessoal, sobre o prazo — precisamos entregar a proposta até sexta, senão vamos ter problema com o cliente e pode até virar um erro grave no cronograma.",
        duration: 35,
      },
      {
        offsetMin: 7,
        sender: "Carol",
        content: "Concordo, temos que priorizar isso antes que vire problema maior",
      },
      {
        offsetMin: 8,
        sender: "Bob",
        content: "Importante: vou reunir o time logo cedo amanhã para alinharmos tudo",
      },
      { offsetMin: 9, sender: "Alice", content: "👍" }, // emoji-only → dropped
    ];

    for (let i = 0; i < fixtures.length; i += 1) {
      const f = fixtures[i];
      seedMessage({
        id: `msg-${i + 1}`,
        senderName: f.sender,
        capturedAt: new Date(base + f.offsetMin * 60_000),
        type: f.type ?? "text",
        content: f.content,
        mediaDurationSeconds: f.duration ?? null,
        transcriptText: f.transcriptText ?? null,
      });
    }

    const result = await buildNormalizedConversation(
      TENANT,
      GROUP,
      start,
      end,
    );

    expect(result.tenantId).toBe(TENANT);
    expect(result.groupId).toBe(GROUP);
    expect(result.groupName).toBe(GROUP_NAME);
    expect(result.periodStart).toBe(start);
    expect(result.periodEnd).toBe(end);
    expect(result.total).toBe(10);

    // Stopwords (ok, kkk), URL-only, and emoji-only rows get dropped.
    expect(result.discarded).toBe(4);

    // At least one topic emerges from the surviving 6 messages.
    expect(result.topics.length).toBeGreaterThanOrEqual(1);

    // Sanity: kept messages total === 10 - discarded.
    const keptCount = result.topics.reduce(
      (acc, t) => acc + t.messages.length,
      0,
    );
    expect(keptCount).toBe(10 - result.discarded);

    // The audio transcript flows through to the clustered message content.
    const allContents = result.topics.flatMap((t) =>
      t.messages.map((m) => m.content),
    );
    expect(allContents.some((c) => c.includes("precisamos entregar"))).toBe(
      true,
    );

    // Dominant keywords should exist (topic picked up at least some tokens).
    const allKeywords = result.topics.flatMap((t) => t.dominantKeywords);
    expect(allKeywords.length).toBeGreaterThan(0);
  });
});

describe("buildNormalizedConversation — validation", () => {
  it("throws when periodEnd < periodStart", async () => {
    const start = new Date("2026-04-20T12:00:00Z");
    const end = new Date("2026-04-20T00:00:00Z");

    await expect(
      buildNormalizedConversation(TENANT, GROUP, start, end),
    ).rejects.toThrow(/periodEnd.*<.*periodStart/);
  });

  it("allows periodEnd === periodStart (zero-width window)", async () => {
    const t = new Date("2026-04-20T12:00:00Z");
    const result = await buildNormalizedConversation(TENANT, GROUP, t, t);
    expect(result.total).toBe(0);
    expect(result.topics).toEqual([]);
  });

  it("propagates DB errors as thrown errors", async () => {
    state.error = { message: "connection lost" };
    const start = new Date("2026-04-20T00:00:00Z");
    const end = new Date("2026-04-20T23:59:59Z");
    await expect(
      buildNormalizedConversation(TENANT, GROUP, start, end),
    ).rejects.toThrow(/connection lost/);
  });
});
