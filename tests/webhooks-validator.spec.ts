/**
 * Unit tests for lib/webhooks/validator.ts.
 *
 * These tests don't need any Supabase or UAZAPI mocks — the validator is
 * a pure function of (env, Request). We do poke `process.env` around a
 * reset so each case can turn the secret off again if needed.
 */

import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  parseWebhookBody,
  validateAuth,
  validateSecret,
} from "@/lib/webhooks/validator";

const SECRET = "super-secret-value-with-enough-entropy";
const HMAC_SECRET =
  "79cd5e31918f233a8b389bf0b0289f96a5083d0b627880aa1364bcd962576cb2";

let originalSecret: string | undefined;
let originalHmac: string | undefined;

beforeEach(() => {
  originalSecret = process.env.UAZAPI_WEBHOOK_SECRET;
  originalHmac = process.env.UAZAPI_WEBHOOK_HMAC_SECRET;
  process.env.UAZAPI_WEBHOOK_SECRET = SECRET;
  delete process.env.UAZAPI_WEBHOOK_HMAC_SECRET;
});

afterEach(() => {
  if (originalSecret === undefined) {
    delete process.env.UAZAPI_WEBHOOK_SECRET;
  } else {
    process.env.UAZAPI_WEBHOOK_SECRET = originalSecret;
  }
  if (originalHmac === undefined) {
    delete process.env.UAZAPI_WEBHOOK_HMAC_SECRET;
  } else {
    process.env.UAZAPI_WEBHOOK_HMAC_SECRET = originalHmac;
  }
});

function hmacHex(secret: string, body: string): string {
  return createHmac("sha256", secret).update(body, "utf8").digest("hex");
}

function req(opts: { headers?: Record<string, string>; url?: string } = {}) {
  return new Request(opts.url ?? "https://app.test/api/webhooks/uazapi", {
    method: "POST",
    headers: opts.headers,
    body: "{}",
  });
}

// ──────────────────────────────────────────────────────────────────────────
//  Secret
// ──────────────────────────────────────────────────────────────────────────

describe("validateSecret", () => {
  it("accepts the right secret in the x-uazapi-secret header", () => {
    const res = validateSecret(req({ headers: { "x-uazapi-secret": SECRET } }));
    expect(res.ok).toBe(true);
  });

  it("accepts the right secret in the ?secret= query string", () => {
    const res = validateSecret(
      req({ url: `https://app.test/api/webhooks/uazapi?secret=${SECRET}` }),
    );
    expect(res.ok).toBe(true);
  });

  it("rejects when the header carries a wrong secret (401)", () => {
    const res = validateSecret(
      req({ headers: { "x-uazapi-secret": "nope" } }),
    );
    expect(res).toMatchObject({ ok: false, status: 401 });
  });

  it("rejects when no secret is provided (401)", () => {
    const res = validateSecret(req());
    expect(res).toMatchObject({ ok: false, status: 401 });
  });

  it("fails closed with 500 when UAZAPI_WEBHOOK_SECRET is unset", () => {
    delete process.env.UAZAPI_WEBHOOK_SECRET;
    const res = validateSecret(req({ headers: { "x-uazapi-secret": SECRET } }));
    expect(res).toMatchObject({ ok: false, status: 500 });
    if (res.ok === false) {
      expect(res.reason).toMatch(/SERVER_MISCONFIG/);
    }
  });

  it("prefers the header over the query when both are present", () => {
    // Header has the good secret, query has a bad one. Header wins.
    const res = validateSecret(
      req({
        url: "https://app.test/api/webhooks/uazapi?secret=bad",
        headers: { "x-uazapi-secret": SECRET },
      }),
    );
    expect(res.ok).toBe(true);
  });

  it("does not leak timing on length-mismatched secrets", () => {
    // Not a real timing test — just confirms we handle the mismatched-length
    // path without throwing, since timingSafeEqual would error if we forgot.
    const res = validateSecret(
      req({ headers: { "x-uazapi-secret": "short" } }),
    );
    expect(res.ok).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────────
//  Auth (HMAC + legacy)
// ──────────────────────────────────────────────────────────────────────────

describe("validateAuth — HMAC path", () => {
  beforeEach(() => {
    process.env.UAZAPI_WEBHOOK_HMAC_SECRET = HMAC_SECRET;
  });

  it("accepts a valid x-podzap-signature over the raw body", () => {
    const body = '{"event":"messages","data":{"x":1}}';
    const sig = hmacHex(HMAC_SECRET, body);
    const r = new Request("https://app.test/api/webhooks/uazapi", {
      method: "POST",
      headers: { "x-podzap-signature": sig },
      body,
    });
    expect(validateAuth(r, body).ok).toBe(true);
  });

  it("rejects an invalid HMAC signature without falling back to secret", () => {
    const body = '{"x":1}';
    const r = new Request(
      `https://app.test/api/webhooks/uazapi?secret=${SECRET}`,
      {
        method: "POST",
        headers: { "x-podzap-signature": "deadbeef".repeat(8) },
        body,
      },
    );
    // Even though the query secret is valid, we MUST NOT fall back —
    // that would be a downgrade attack surface.
    const res = validateAuth(r, body);
    expect(res).toMatchObject({ ok: false, status: 401 });
    if (res.ok === false) {
      expect(res.reason).toMatch(/invalid HMAC/);
    }
  });

  it("rejects HMAC signature computed over a different body (tamper)", () => {
    const sent = '{"tampered":true}';
    const sig = hmacHex(HMAC_SECRET, '{"original":true}');
    const r = new Request("https://app.test/api/webhooks/uazapi", {
      method: "POST",
      headers: { "x-podzap-signature": sig },
      body: sent,
    });
    expect(validateAuth(r, sent)).toMatchObject({ ok: false, status: 401 });
  });

  it("500s if the HMAC header is present but HMAC_SECRET is unset", () => {
    delete process.env.UAZAPI_WEBHOOK_HMAC_SECRET;
    const body = '{"x":1}';
    const r = new Request("https://app.test/api/webhooks/uazapi", {
      method: "POST",
      headers: { "x-podzap-signature": "abc" },
      body,
    });
    expect(validateAuth(r, body)).toMatchObject({ ok: false, status: 500 });
  });
});

describe("validateAuth — legacy secret path coexists", () => {
  beforeEach(() => {
    process.env.UAZAPI_WEBHOOK_HMAC_SECRET = HMAC_SECRET;
  });

  it("accepts query secret when HMAC header is absent", () => {
    const r = new Request(
      `https://app.test/api/webhooks/uazapi?secret=${SECRET}`,
      { method: "POST", body: "{}" },
    );
    expect(validateAuth(r, "{}").ok).toBe(true);
  });

  it("accepts x-uazapi-secret header when HMAC header is absent", () => {
    const r = new Request("https://app.test/api/webhooks/uazapi", {
      method: "POST",
      headers: { "x-uazapi-secret": SECRET },
      body: "{}",
    });
    expect(validateAuth(r, "{}").ok).toBe(true);
  });

  it("rejects missing credentials when neither header is present (HMAC enabled)", () => {
    const r = new Request("https://app.test/api/webhooks/uazapi", {
      method: "POST",
      body: "{}",
    });
    expect(validateAuth(r, "{}")).toMatchObject({ ok: false, status: 401 });
  });
});

describe("validateAuth — HMAC-only mode (secret disabled)", () => {
  beforeEach(() => {
    delete process.env.UAZAPI_WEBHOOK_SECRET;
    process.env.UAZAPI_WEBHOOK_HMAC_SECRET = HMAC_SECRET;
  });

  it("accepts valid HMAC", () => {
    const body = '{"ok":true}';
    const r = new Request("https://app.test/api/webhooks/uazapi", {
      method: "POST",
      headers: { "x-podzap-signature": hmacHex(HMAC_SECRET, body) },
      body,
    });
    expect(validateAuth(r, body).ok).toBe(true);
  });

  it("rejects a query secret (would work in legacy mode, blocked in HMAC-only)", () => {
    const r = new Request(
      `https://app.test/api/webhooks/uazapi?secret=${SECRET}`,
      { method: "POST", body: "{}" },
    );
    expect(validateAuth(r, "{}")).toMatchObject({ ok: false, status: 401 });
  });
});

describe("validateAuth — server misconfig", () => {
  it("500s when NEITHER secret env var is set", () => {
    delete process.env.UAZAPI_WEBHOOK_SECRET;
    delete process.env.UAZAPI_WEBHOOK_HMAC_SECRET;
    const r = new Request("https://app.test/api/webhooks/uazapi", {
      method: "POST",
      body: "{}",
    });
    const res = validateAuth(r, "{}");
    expect(res).toMatchObject({ ok: false, status: 500 });
    if (res.ok === false) {
      expect(res.reason).toMatch(/SERVER_MISCONFIG/);
    }
  });
});

// ──────────────────────────────────────────────────────────────────────────
//  Body
// ──────────────────────────────────────────────────────────────────────────

describe("parseWebhookBody", () => {
  it("accepts a well-formed text message event", () => {
    const body = {
      event: "messages.upsert",
      instance: "inst_abc",
      data: {
        key: {
          id: "msg_1",
          remoteJid: "group-1@g.us",
          fromMe: false,
        },
        pushName: "Alice",
        messageTimestamp: 1_732_022_400,
        messageType: "conversation",
        message: { conversation: "hello" },
      },
    };
    const res = parseWebhookBody(body);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.event.event).toBe("message");
      if (res.event.event === "message") {
        expect(res.event.content.kind).toBe("text");
      }
    }
  });

  it("accepts a well-formed connection event", () => {
    const body = {
      event: "connection.update",
      instance: "inst_abc",
      data: {
        status: "connected",
        loggedIn: true,
      },
    };
    const res = parseWebhookBody(body);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.event.event).toBe("connection");
    }
  });

  it("tags truly unknown event types as { event: 'unknown' } (not an error)", () => {
    const body = { event: "weird.thing", data: { x: 1 } };
    const res = parseWebhookBody(body);
    // The schema tolerates unknown types — it does NOT reject.
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.event.event).toBe("unknown");
    }
  });

  it("rejects a message event that is missing the key entirely", () => {
    const body = {
      event: "messages.upsert",
      instance: "inst_abc",
      data: {
        // key missing
        pushName: "Alice",
        messageType: "conversation",
        message: { conversation: "hello" },
      },
    };
    const res = parseWebhookBody(body);
    expect(res).toMatchObject({ ok: false, status: 400 });
  });

  it("rejects non-object bodies", () => {
    const res = parseWebhookBody("not an event");
    expect(res).toMatchObject({ ok: false, status: 400 });
  });
});

// ──────────────────────────────────────────────────────────────────────────
//  parseWebhookBody — UAZAPI wsmart shape
//  Real payload shape captured from wsmart.uazapi.com on 2026-04-23 via the
//  n8n forwarding flow. See docs/integrations/uazapi.md for the full sample.
// ──────────────────────────────────────────────────────────────────────────

describe("parseWebhookBody — UAZAPI wsmart shape", () => {
  it("accepts a text message from the real UAZAPI payload", () => {
    const body = {
      BaseUrl: "https://wsmart.uazapi.com",
      EventType: "messages",
      instanceName: "podzap-13d4eb57-1776932610527",
      chat: {
        wa_chatid: "120363424039524910@g.us",
        wa_isGroup: true,
        name: "PRO TOOLS BOX| NETWORK PRIME",
      },
      message: {
        messageid: "3EB089F8ECEDAC7A9E4BFD",
        id: "558193856099:3EB089F8ECEDAC7A9E4BFD",
        chatid: "120363424039524910@g.us",
        fromMe: false,
        sender: "27578253496368:37@lid",
        senderName: "Soyaux",
        messageTimestamp: 1776993684000,
        messageType: "Conversation",
        type: "text",
        text: "teste de texto",
        content: "teste de texto",
        wasSentByApi: false,
      },
      owner: "558193856099",
      token: "88ffe2b8-095c-4942-b37d-a8d365187b55",
    };
    const res = parseWebhookBody(body);
    expect(res.ok).toBe(true);
    if (res.ok && res.event.event === "message") {
      expect(res.event.instance).toBe("podzap-13d4eb57-1776932610527");
      expect(res.event.key.id).toBe("3EB089F8ECEDAC7A9E4BFD");
      expect(res.event.key.remoteJid).toBe("120363424039524910@g.us");
      expect(res.event.key.fromMe).toBe(false);
      expect(res.event.pushName).toBe("Soyaux");
      // messageTimestamp already in ms → passes through unchanged.
      expect(res.event.timestamp).toBe(1776993684000);
      expect(res.event.content.kind).toBe("text");
      if (res.event.content.kind === "text") {
        expect(res.event.content.text).toBe("teste de texto");
      }
    }
  });

  it("classifies AudioMessage as kind='audio' even without media url", () => {
    // Campos de URL/mimetype não estavam no fixture wsmart capturado — o
    // parser cria a row como `audio` mesmo assim, e `media_download_status`
    // vai pra 'skipped' no persist.ts. Quando vier um payload real com URL
    // real, o body cru fica em `raw_payload` pra refinar.
    const body = {
      EventType: "messages",
      instanceName: "podzap-xyz",
      message: {
        messageid: "AUDIO01",
        chatid: "120363000000000000@g.us",
        fromMe: false,
        senderName: "Alice",
        messageTimestamp: 1776993684000,
        messageType: "AudioMessage",
        type: "audio",
      },
      token: "tkn",
    };
    const res = parseWebhookBody(body);
    expect(res.ok).toBe(true);
    if (res.ok && res.event.event === "message") {
      expect(res.event.content.kind).toBe("audio");
      if (res.event.content.kind === "audio") {
        expect(res.event.content.mediaUrl).toBeUndefined();
        expect(res.event.content.ptt).toBe(false);
      }
    }
  });

  it("extracts ExtendedTextMessage as kind='text' (suffix tolerant)", () => {
    // Wire envia `messageType: "ExtendedTextMessage"` (com sufixo Message)
    // — o parser strip-a "Message" e compara case-insensitive.
    const body = {
      EventType: "messages",
      instanceName: "podzap-xyz",
      message: {
        messageid: "EXT01",
        chatid: "120363000000000000@g.us",
        fromMe: false,
        senderName: "Bob",
        messageTimestamp: 1776993684000,
        messageType: "ExtendedTextMessage",
        text: "responde aí @123",
      },
      token: "tkn",
    };
    const res = parseWebhookBody(body);
    expect(res.ok).toBe(true);
    if (res.ok && res.event.event === "message") {
      expect(res.event.content.kind).toBe("text");
      if (res.event.content.kind === "text") {
        expect(res.event.content.text).toBe("responde aí @123");
      }
    }
  });

  it("classifies ImageMessage as kind='image' with caption fallback", () => {
    const body = {
      EventType: "messages",
      instanceName: "podzap-xyz",
      message: {
        messageid: "IMG01",
        chatid: "120363000000000000@g.us",
        fromMe: false,
        senderName: "Carol",
        messageTimestamp: 1776993684000,
        messageType: "ImageMessage",
        type: "image",
        caption: "olha isso",
      },
      token: "tkn",
    };
    const res = parseWebhookBody(body);
    expect(res.ok).toBe(true);
    if (res.ok && res.event.event === "message") {
      expect(res.event.content.kind).toBe("image");
      if (res.event.content.kind === "image") {
        expect(res.event.content.caption).toBe("olha isso");
      }
    }
  });

  it("extracts media URL when wire provides nested audioMessage shape", () => {
    // Hypothetical Evolution-style nested shape inside wsmart envelope —
    // defensivo, garante que se algum payload vier nessa shape o parser
    // pega a URL pra disparar download.
    const body = {
      EventType: "messages",
      instanceName: "podzap-xyz",
      message: {
        messageid: "AUD-NESTED",
        chatid: "120363000000000000@g.us",
        fromMe: false,
        messageTimestamp: 1776993684000,
        messageType: "AudioMessage",
        audioMessage: {
          url: "https://mmg.whatsapp.net/foo.enc",
          mimetype: "audio/ogg; codecs=opus",
          seconds: 14,
          ptt: true,
          fileLength: 38211,
        },
      },
      token: "tkn",
    };
    const res = parseWebhookBody(body);
    expect(res.ok).toBe(true);
    if (res.ok && res.event.event === "message") {
      expect(res.event.content.kind).toBe("audio");
      if (res.event.content.kind === "audio") {
        expect(res.event.content.mediaUrl).toBe(
          "https://mmg.whatsapp.net/foo.enc",
        );
        expect(res.event.content.seconds).toBe(14);
        expect(res.event.content.ptt).toBe(true);
        expect(res.event.content.mimetype).toBe("audio/ogg; codecs=opus");
      }
    }
  });

  it("extracts URL/mimetype/seconds from real wsmart audio payload (m.content.URL)", () => {
    // Payload real capturado em 2026-04-25 — wsmart guarda os campos de
    // mídia dentro de `m.content` com URL/PTT em MAIÚSCULAS.
    const body = {
      BaseUrl: "https://wsmart.uazapi.com",
      EventType: "messages",
      instanceName: "podzap-13d4eb57-1776932610527",
      message: {
        messageType: "AudioMessage",
        mediaType: "ptt",
        type: "media",
        messageid: "3A900368F7FF4A601BEA",
        chatid: "120363358399876640@g.us",
        fromMe: false,
        sender: "90044006187258@lid",
        senderName: "Wsmart",
        messageTimestamp: 1777162489000,
        text: "",
        content: {
          URL: "https://mmg.whatsapp.net/v/t62.7117-24/foo.enc?ccb=11-4&oh=01_Q5",
          mimetype: "audio/ogg; codecs=opus",
          fileLength: 6034,
          seconds: 2,
          PTT: true,
          mediaKey: "1Ikl5UBKomkrbwDcxM3KM/kTbzTHpVfVTm7LfVwwEm0=",
          directPath: "/v/t62.7117-24/foo.enc",
        },
      },
      token: "tkn",
    };
    const res = parseWebhookBody(body);
    expect(res.ok).toBe(true);
    if (res.ok && res.event.event === "message") {
      expect(res.event.content.kind).toBe("audio");
      if (res.event.content.kind === "audio") {
        expect(res.event.content.mediaUrl).toBe(
          "https://mmg.whatsapp.net/v/t62.7117-24/foo.enc?ccb=11-4&oh=01_Q5",
        );
        expect(res.event.content.mimetype).toBe("audio/ogg; codecs=opus");
        expect(res.event.content.seconds).toBe(2);
        expect(res.event.content.fileLength).toBe(6034);
        expect(res.event.content.ptt).toBe(true);
      }
    }
  });

  it("keeps ReactionMessage / StickerMessage as kind='other' (preserves rawType)", () => {
    const body = {
      EventType: "messages",
      instanceName: "podzap-xyz",
      message: {
        messageid: "RX01",
        chatid: "120363000000000000@g.us",
        fromMe: false,
        messageTimestamp: 1776993684000,
        messageType: "ReactionMessage",
      },
      token: "tkn",
    };
    const res = parseWebhookBody(body);
    expect(res.ok).toBe(true);
    if (res.ok && res.event.event === "message") {
      expect(res.event.content.kind).toBe("other");
      if (res.event.content.kind === "other") {
        expect(res.event.content.rawType).toBe("ReactionMessage");
      }
    }
  });

  it("falls back to token when instanceName is absent", () => {
    const body = {
      EventType: "messages",
      message: {
        messageid: "M1",
        chatid: "120363000000000000@g.us",
        fromMe: false,
        messageTimestamp: 1776993684000,
        type: "text",
        text: "hi",
      },
      token: "tok-abc",
    };
    const res = parseWebhookBody(body);
    expect(res.ok).toBe(true);
    if (res.ok && res.event.event === "message") {
      expect(res.event.instance).toBe("tok-abc");
    }
  });

  it("upscales timestamp from seconds to milliseconds when small", () => {
    const body = {
      EventType: "messages",
      instanceName: "inst-1",
      message: {
        messageid: "M2",
        chatid: "120363000000000000@g.us",
        fromMe: false,
        messageTimestamp: 1776993684, // seconds
        type: "text",
        text: "hi",
      },
    };
    const res = parseWebhookBody(body);
    expect(res.ok).toBe(true);
    if (res.ok && res.event.event === "message") {
      expect(res.event.timestamp).toBe(1776993684_000);
    }
  });

  it("accepts a UAZAPI connection event defensively", () => {
    const body = {
      EventType: "connection",
      instanceName: "inst-1",
      status: "connected",
      loggedIn: true,
    };
    const res = parseWebhookBody(body);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.event.event).toBe("connection");
      if (res.event.event === "connection") {
        expect(res.event.instance).toBe("inst-1");
        expect(res.event.status).toBe("connected");
      }
    }
  });
});
