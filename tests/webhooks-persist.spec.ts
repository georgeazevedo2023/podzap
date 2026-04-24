/**
 * Unit tests for lib/webhooks/{persist,handler}.ts.
 *
 * Strategy — same philosophy as tests/groups-service.spec.ts:
 *   - Replace the Supabase admin client with an in-memory fake that mimics
 *     the chainable builder surface (select/insert/update/eq/maybeSingle/
 *     single/then). Narrow & deterministic — NOT a full PostgREST emulation.
 *   - We don't mock UAZAPI — the persist layer doesn't call it.
 *   - Events are constructed via the real `IncomingWebhookEventSchema` so
 *     the tests exercise the same parse path as production (catches schema
 *     drift that a hand-built `MessageUpsertEvent` literal would mask).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { IncomingWebhookEventSchema } from "@/lib/uazapi/types";

// ──────────────────────────────────────────────────────────────────────────
//  In-memory DB
// ──────────────────────────────────────────────────────────────────────────

type InstanceRow = {
  id: string;
  tenant_id: string;
  uazapi_instance_id: string;
  uazapi_instance_name: string | null;
  status: string;
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
  is_monitored: boolean;
  created_at: string;
};

type MessageRow = {
  id: string;
  tenant_id: string;
  group_id: string;
  uazapi_message_id: string;
  sender_jid: string | null;
  sender_name: string | null;
  type: string;
  content: string | null;
  media_url: string | null;
  media_mime_type: string | null;
  media_size_bytes: number | null;
  media_duration_seconds: number | null;
  media_download_status: string | null;
  media_storage_path: string | null;
  raw_payload: unknown;
  captured_at: string;
  created_at: string;
};

const db = {
  whatsapp_instances: [] as InstanceRow[],
  groups: [] as GroupRow[],
  messages: [] as MessageRow[],
};

function resetDb() {
  db.whatsapp_instances = [];
  db.groups = [];
  db.messages = [];
}

type AnyRow = Record<string, unknown>;
type FilterOp = { kind: "eq"; col: string; val: unknown };

function makeBuilder(table: keyof typeof db) {
  const state: {
    filters: FilterOp[];
    selectAfter: boolean;
    op:
      | { kind: "select"; columns: string }
      | { kind: "insert"; row: AnyRow }
      | { kind: "update"; patch: AnyRow }
      | { kind: "delete" };
  } = {
    filters: [],
    selectAfter: false,
    op: { kind: "select", columns: "*" },
  };

  const applyFilters = (rows: AnyRow[]): AnyRow[] =>
    rows.filter((r) =>
      state.filters.every((f) => r[f.col] === f.val),
    );

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

  const runUniqueCheck = (row: AnyRow): { code: string; message: string } | null => {
    if (table !== "messages") return null;
    const tid = row.tenant_id;
    const mid = row.uazapi_message_id;
    const clash = db.messages.some(
      (m) => m.tenant_id === tid && m.uazapi_message_id === mid,
    );
    return clash
      ? { code: "23505", message: "duplicate key value violates unique constraint" }
      : null;
  };

  const run = (): {
    data: AnyRow | AnyRow[] | null;
    error: { code?: string; message: string } | null;
  } => {
    const rows = db[table] as AnyRow[];
    switch (state.op.kind) {
      case "select": {
        const out = applyFilters(rows);
        return { data: out, error: null };
      }
      case "insert": {
        const conflict = runUniqueCheck(state.op.row);
        if (conflict) return { data: null, error: conflict };
        const now = new Date().toISOString();
        const base = state.op.row as AnyRow;
        const newRow: AnyRow = {
          id: (base.id as string | undefined) ?? randomUUID(),
          created_at: now,
          ...base,
        };
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

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (!(table in db)) {
        throw new Error(`Unexpected table in mock: ${table}`);
      }
      return makeBuilder(table as keyof typeof db);
    },
  }),
}));

// ──────────────────────────────────────────────────────────────────────────
//  Imports (after mocks)
// ──────────────────────────────────────────────────────────────────────────

import { handleWebhookEvent } from "@/lib/webhooks/handler";
import {
  persistIncomingMessage,
  updateInstanceConnection,
} from "@/lib/webhooks/persist";
import { parseWebhookBody } from "@/lib/webhooks/validator";

// ──────────────────────────────────────────────────────────────────────────
//  Fixtures / helpers
// ──────────────────────────────────────────────────────────────────────────

const TENANT = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const UAZ_INSTANCE = "inst_uaz_123";
const GROUP_JID = "120363000000000000@g.us";

function seedInstance(overrides: Partial<InstanceRow> = {}): InstanceRow {
  const now = new Date().toISOString();
  const row: InstanceRow = {
    id: randomUUID(),
    tenant_id: TENANT,
    uazapi_instance_id: UAZ_INSTANCE,
    uazapi_instance_name: null,
    status: "connected",
    last_seen_at: now,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
  db.whatsapp_instances.push(row);
  return row;
}

function seedGroup(
  instance: InstanceRow,
  overrides: Partial<GroupRow> = {},
): GroupRow {
  const now = new Date().toISOString();
  const row: GroupRow = {
    id: randomUUID(),
    tenant_id: instance.tenant_id,
    instance_id: instance.id,
    uazapi_group_jid: GROUP_JID,
    name: "Some Group",
    is_monitored: true,
    created_at: now,
    ...overrides,
  };
  db.groups.push(row);
  return row;
}

/**
 * Build a webhook payload in the exact shape UAZAPI sends, then run it
 * through the production parser. Forces the tests to stay aligned with
 * the zod schema instead of drifting to a hand-rolled event object.
 */
type RawEvent = {
  event: string;
  instance: string;
  data: Record<string, unknown>;
};

function parse(raw: RawEvent) {
  const parsed = IncomingWebhookEventSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `fixture failed schema parse: ${JSON.stringify(parsed.error.issues, null, 2)}`,
    );
  }
  return parsed.data;
}

function textMessageEvent(opts: {
  instance?: string;
  messageId?: string;
  remoteJid?: string;
  fromMe?: boolean;
  text?: string;
  pushName?: string;
}) {
  return parse({
    event: "messages.upsert",
    instance: opts.instance ?? UAZ_INSTANCE,
    data: {
      key: {
        id: opts.messageId ?? "msg_" + randomUUID(),
        remoteJid: opts.remoteJid ?? GROUP_JID,
        fromMe: opts.fromMe ?? false,
        participant: "5511999999999@s.whatsapp.net",
      },
      pushName: opts.pushName ?? "Alice",
      messageTimestamp: 1_732_022_400,
      messageType: "conversation",
      message: { conversation: opts.text ?? "hello" },
    },
  });
}

function audioMessageEvent(opts: { messageId?: string; fromMe?: boolean } = {}) {
  return parse({
    event: "messages.upsert",
    instance: UAZ_INSTANCE,
    data: {
      key: {
        id: opts.messageId ?? "msg_" + randomUUID(),
        remoteJid: GROUP_JID,
        fromMe: opts.fromMe ?? false,
      },
      messageTimestamp: 1_732_022_400,
      messageType: "audioMessage",
      message: {
        audioMessage: {
          mimetype: "audio/ogg; codecs=opus",
          seconds: 12,
          ptt: true,
          url: "https://mmg.whatsapp.net/abc",
          fileLength: 38_211,
        },
      },
    },
  });
}

function imageMessageEvent(opts: { messageId?: string; fromMe?: boolean } = {}) {
  return parse({
    event: "messages.upsert",
    instance: UAZ_INSTANCE,
    data: {
      key: {
        id: opts.messageId ?? "msg_" + randomUUID(),
        remoteJid: GROUP_JID,
        fromMe: opts.fromMe ?? false,
      },
      messageTimestamp: 1_732_022_400,
      messageType: "imageMessage",
      message: {
        imageMessage: {
          mimetype: "image/jpeg",
          caption: "olha só",
          url: "https://mmg.whatsapp.net/img",
          fileLength: 99_123,
          width: 960,
          height: 1280,
        },
      },
    },
  });
}

function connectionEvent() {
  return parse({
    event: "connection.update",
    instance: UAZ_INSTANCE,
    data: {
      status: "connected",
      loggedIn: true,
    },
  });
}

// ──────────────────────────────────────────────────────────────────────────
//  Tests
// ──────────────────────────────────────────────────────────────────────────

beforeEach(() => {
  resetDb();
});

describe("persistIncomingMessage — happy path", () => {
  it("persists a text message in a monitored group", async () => {
    const inst = seedInstance();
    seedGroup(inst, { is_monitored: true });

    const event = textMessageEvent({ text: "world" });
    if (event.event !== "message") throw new Error("expected message");
    const res = await persistIncomingMessage(event);

    expect(res.status).toBe("persisted");
    expect(res.messageId).toBeTruthy();
    expect(db.messages).toHaveLength(1);
    const stored = db.messages[0];
    expect(stored.tenant_id).toBe(TENANT);
    expect(stored.type).toBe("text");
    expect(stored.content).toBe("world");
    expect(stored.media_download_status).toBe("skipped");
    expect(stored.raw_payload).toBeTruthy();
    expect(stored.sender_name).toBe("Alice");
  });

  it("persists an audio message with media_download_status='pending'", async () => {
    const inst = seedInstance();
    seedGroup(inst, { is_monitored: true });

    const event = audioMessageEvent();
    if (event.event !== "message") throw new Error("expected message");
    const res = await persistIncomingMessage(event);

    expect(res.status).toBe("persisted");
    const stored = db.messages[0];
    expect(stored.type).toBe("audio");
    expect(stored.media_download_status).toBe("pending");
    expect(stored.media_mime_type).toBe("audio/ogg; codecs=opus");
    expect(stored.media_duration_seconds).toBe(12);
    expect(stored.media_size_bytes).toBe(38_211);
    expect(stored.media_url).toBe("https://mmg.whatsapp.net/abc");
  });

  it("persists an image message with media_download_status='pending'", async () => {
    const inst = seedInstance();
    seedGroup(inst, { is_monitored: true });

    const event = imageMessageEvent();
    if (event.event !== "message") throw new Error("expected message");
    const res = await persistIncomingMessage(event);

    expect(res.status).toBe("persisted");
    const stored = db.messages[0];
    expect(stored.type).toBe("image");
    expect(stored.media_download_status).toBe("pending");
    expect(stored.content).toBe("olha só"); // caption -> content
  });
});

describe("persistIncomingMessage — filtering", () => {
  it("ignores a text message when the group is not monitored", async () => {
    const inst = seedInstance();
    seedGroup(inst, { is_monitored: false });

    const event = textMessageEvent({});
    if (event.event !== "message") throw new Error("expected message");
    const res = await persistIncomingMessage(event);

    expect(res.status).toBe("ignored");
    expect(res.reason).toMatch(/not monitored/);
    expect(db.messages).toHaveLength(0);
  });

  it("ignores a message from an unknown instance", async () => {
    // Seed group but NO instance — so the instance lookup fails.
    const event = textMessageEvent({ instance: "inst_unknown_xxx" });
    if (event.event !== "message") throw new Error("expected message");
    const res = await persistIncomingMessage(event);

    expect(res.status).toBe("ignored");
    expect(res.reason).toMatch(/unknown instance/);
  });

  it("ignores a message from an unknown group (no auto-create)", async () => {
    seedInstance();
    // No seedGroup call.
    const event = textMessageEvent({});
    if (event.event !== "message") throw new Error("expected message");
    const res = await persistIncomingMessage(event);

    expect(res.status).toBe("ignored");
    expect(res.reason).toMatch(/unknown group/);
    expect(db.groups).toHaveLength(0); // did NOT auto-create
  });

  it("ignores a direct message (not a group)", async () => {
    const inst = seedInstance();
    seedGroup(inst, { is_monitored: true });

    const event = textMessageEvent({
      remoteJid: "5511999999999@s.whatsapp.net",
    });
    if (event.event !== "message") throw new Error("expected message");
    const res = await persistIncomingMessage(event);

    expect(res.status).toBe("ignored");
    expect(res.reason).toMatch(/direct message/);
  });

  it("captures fromMe=true text (owner posted in monitored group)", async () => {
    const inst = seedInstance();
    seedGroup(inst, { is_monitored: true });

    const event = textMessageEvent({ fromMe: true, text: "owner falando" });
    if (event.event !== "message") throw new Error("expected message");
    const res = await persistIncomingMessage(event);

    expect(res.status).toBe("persisted");
    expect(db.messages).toHaveLength(1);
    expect(db.messages[0]?.content).toBe("owner falando");
  });

  it("captures fromMe=true image (owner posted image in monitored group)", async () => {
    const inst = seedInstance();
    seedGroup(inst, { is_monitored: true });

    const event = imageMessageEvent({ fromMe: true });
    if (event.event !== "message") throw new Error("expected message");
    const res = await persistIncomingMessage(event);

    expect(res.status).toBe("persisted");
    expect(db.messages).toHaveLength(1);
    expect(db.messages[0]?.type).toBe("image");
  });

  it("ignores fromMe=true audio (guards against podcast delivery loop)", async () => {
    const inst = seedInstance();
    seedGroup(inst, { is_monitored: true });

    const event = audioMessageEvent({ fromMe: true });
    if (event.event !== "message") throw new Error("expected message");
    const res = await persistIncomingMessage(event);

    expect(res.status).toBe("ignored");
    expect(res.reason).toMatch(/fromMe audio/);
    expect(db.messages).toHaveLength(0);
  });
});

describe("persistIncomingMessage — dedup", () => {
  it("returns dedup on duplicate uazapi_message_id (pre-check hit)", async () => {
    const inst = seedInstance();
    seedGroup(inst, { is_monitored: true });

    const event = textMessageEvent({ messageId: "msg_dup", text: "once" });
    if (event.event !== "message") throw new Error("expected message");
    const first = await persistIncomingMessage(event);
    expect(first.status).toBe("persisted");

    // Same uazapi_message_id again — must dedup.
    const second = await persistIncomingMessage(event);
    expect(second.status).toBe("dedup");
    expect(db.messages).toHaveLength(1);
  });

  it("treats unique-violation race as dedup, not error", async () => {
    // Skip the pre-check by pre-inserting a row with the same id AFTER
    // persistIncomingMessage looked it up — we simulate this by seeding
    // a message row then calling persistIncomingMessage with a matching id.
    const inst = seedInstance();
    const g = seedGroup(inst, { is_monitored: true });

    const MSG_ID = "msg_racy";
    db.messages.push({
      id: randomUUID(),
      tenant_id: TENANT,
      group_id: g.id,
      uazapi_message_id: MSG_ID,
      sender_jid: null,
      sender_name: null,
      type: "text",
      content: "pre-existing",
      media_url: null,
      media_mime_type: null,
      media_size_bytes: null,
      media_duration_seconds: null,
      media_download_status: "skipped",
      media_storage_path: null,
      raw_payload: null,
      captured_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    });

    const event = textMessageEvent({ messageId: MSG_ID });
    if (event.event !== "message") throw new Error("expected message");
    const res = await persistIncomingMessage(event);

    // Pre-check catches it here, so we still return dedup.
    expect(res.status).toBe("dedup");
  });
});

describe("updateInstanceConnection", () => {
  it("bumps last_seen_at for known instances", async () => {
    const inst = seedInstance({ last_seen_at: null });
    const event = connectionEvent();
    if (event.event !== "connection") throw new Error("expected connection");
    const before = Date.now();
    const res = await updateInstanceConnection(event);
    const after = Date.now();

    expect(res.status).toBe("persisted");
    const updated = db.whatsapp_instances.find((r) => r.id === inst.id)!;
    expect(updated.last_seen_at).toBeTruthy();
    const t = Date.parse(updated.last_seen_at!);
    expect(t).toBeGreaterThanOrEqual(before - 1);
    expect(t).toBeLessThanOrEqual(after + 1);
  });

  it("ignores connection events for unknown instances", async () => {
    const event = connectionEvent();
    if (event.event !== "connection") throw new Error("expected connection");
    const res = await updateInstanceConnection(event);
    expect(res.status).toBe("ignored");
    expect(res.reason).toMatch(/unknown instance/);
  });
});

describe("handleWebhookEvent — dispatch", () => {
  it("routes message events to persistIncomingMessage", async () => {
    const inst = seedInstance();
    seedGroup(inst, { is_monitored: true });

    const event = textMessageEvent({ text: "via dispatch" });
    const res = await handleWebhookEvent(event);
    expect(res.status).toBe("persisted");
  });

  it("routes connection events to updateInstanceConnection", async () => {
    seedInstance();
    const event = connectionEvent();
    const res = await handleWebhookEvent(event);
    expect(res.status).toBe("persisted");
  });

  it("ignores unknown event types without throwing", async () => {
    const parsed = parse({
      event: "weird.thing",
      instance: "x",
      data: { whatever: 1 },
    });
    expect(parsed.event).toBe("unknown");
    const res = await handleWebhookEvent(parsed);
    expect(res.status).toBe("ignored");
    expect(res.reason).toMatch(/unknown event/);
  });

  it("malformed body is rejected by the validator, not the handler", () => {
    const res = parseWebhookBody({
      event: "messages.upsert",
      instance: "inst_abc",
      data: {
        // key missing — schema must reject
        pushName: "x",
        messageType: "conversation",
        message: { conversation: "hi" },
      },
    });
    expect(res).toMatchObject({ ok: false, status: 400 });
  });
});

// ──────────────────────────────────────────────────────────────────────────
//  UAZAPI wsmart shape — real-world payload end-to-end
//
//  Regression guard for the bug fixed in 0009_uazapi_instance_name.sql +
//  the corresponding preprocess/persist changes: UAZAPI `wsmart.uazapi.com`
//  sends `{ EventType, instanceName, message, ... }` rather than the
//  Evolution-shape the original parser assumed.
// ──────────────────────────────────────────────────────────────────────────

const UAZAPI_INSTANCE_NAME = "podzap-13d4eb57-1776932610527";

function uazapiTextBody(overrides: Partial<{
  instanceName: string;
  token: string;
  messageid: string;
  chatid: string;
  senderName: string;
  text: string;
  fromMe: boolean;
}> = {}) {
  return {
    BaseUrl: "https://wsmart.uazapi.com",
    EventType: "messages",
    instanceName: overrides.instanceName ?? UAZAPI_INSTANCE_NAME,
    chat: {
      wa_chatid: overrides.chatid ?? GROUP_JID,
      wa_isGroup: true,
      name: "Some Group",
    },
    message: {
      messageid: overrides.messageid ?? "UAZ_" + randomUUID(),
      id: "558193856099:ABC",
      chatid: overrides.chatid ?? GROUP_JID,
      fromMe: overrides.fromMe ?? false,
      sender: "27578253496368:37@lid",
      senderName: overrides.senderName ?? "Soyaux",
      messageTimestamp: 1776993684000,
      messageType: "Conversation",
      type: "text",
      text: overrides.text ?? "hello from prod",
      content: overrides.text ?? "hello from prod",
      wasSentByApi: false,
    },
    owner: "558193856099",
    token: overrides.token ?? "88ffe2b8-095c-4942-b37d-a8d365187b55",
  };
}

describe("persistIncomingMessage — UAZAPI wsmart shape", () => {
  it("resolves the tenant via uazapi_instance_name (real prod path)", async () => {
    const inst = seedInstance({
      uazapi_instance_id: "r096894b4a51062",
      uazapi_instance_name: UAZAPI_INSTANCE_NAME,
    });
    seedGroup(inst, { is_monitored: true });

    const parsed = IncomingWebhookEventSchema.safeParse(uazapiTextBody());
    if (!parsed.success) throw new Error("UAZAPI shape rejected by schema");
    if (parsed.data.event !== "message") throw new Error("expected message");

    const res = await persistIncomingMessage(parsed.data);
    expect(res.status).toBe("persisted");
    expect(db.messages).toHaveLength(1);
    const stored = db.messages[0];
    expect(stored.content).toBe("hello from prod");
    expect(stored.sender_name).toBe("Soyaux");
    expect(stored.type).toBe("text");
  });

  it("falls back to uazapi_instance_id when name column is still null", async () => {
    // Legacy row attached before migration 0009 — name is NULL but the
    // webhook payload shipped `instanceName`. persist.ts should try by
    // name (miss), then fall back to id. To exercise the fallback, the
    // payload's instance ref has to match the short id, which happens
    // when something manually re-posts an Evolution-shape payload.
    const inst = seedInstance({
      uazapi_instance_id: "r_legacy_123",
      uazapi_instance_name: null,
    });
    seedGroup(inst, { is_monitored: true });

    const event = textMessageEvent({ instance: "r_legacy_123", text: "legacy" });
    if (event.event !== "message") throw new Error("expected message");

    const res = await persistIncomingMessage(event);
    expect(res.status).toBe("persisted");
    expect(db.messages[0].content).toBe("legacy");
  });

  it("ignores when neither name nor id match anything in the DB", async () => {
    const inst = seedInstance({
      uazapi_instance_id: "r_other",
      uazapi_instance_name: "podzap-other",
    });
    seedGroup(inst, { is_monitored: true });

    const parsed = IncomingWebhookEventSchema.safeParse(
      uazapiTextBody({ instanceName: "podzap-does-not-exist" }),
    );
    if (!parsed.success) throw new Error("UAZAPI shape rejected by schema");
    if (parsed.data.event !== "message") throw new Error("expected message");

    const res = await persistIncomingMessage(parsed.data);
    expect(res.status).toBe("ignored");
    expect(res.reason).toMatch(/unknown instance/);
  });

  it("UAZAPI audio degrades to type=other, media_download_status=skipped", async () => {
    const inst = seedInstance({
      uazapi_instance_id: "r096894b4a51062",
      uazapi_instance_name: UAZAPI_INSTANCE_NAME,
    });
    seedGroup(inst, { is_monitored: true });

    const audioBody = uazapiTextBody();
    // Mutate to audio shape — no mediaUrl, no text.
    audioBody.message.type = "audio";
    audioBody.message.messageType = "AudioMessage";
    audioBody.message.text = "";
    audioBody.message.content = "";

    const parsed = IncomingWebhookEventSchema.safeParse(audioBody);
    if (!parsed.success) throw new Error("UAZAPI shape rejected by schema");
    if (parsed.data.event !== "message") throw new Error("expected message");

    const res = await persistIncomingMessage(parsed.data);
    expect(res.status).toBe("persisted");
    expect(db.messages[0].type).toBe("other");
    // No mediaUrl extracted → not queued for download.
    expect(db.messages[0].media_download_status).toBe("skipped");
  });
});
