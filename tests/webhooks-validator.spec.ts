/**
 * Unit tests for lib/webhooks/validator.ts.
 *
 * These tests don't need any Supabase or UAZAPI mocks — the validator is
 * a pure function of (env, Request). We do poke `process.env` around a
 * reset so each case can turn the secret off again if needed.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseWebhookBody, validateSecret } from "@/lib/webhooks/validator";

const SECRET = "super-secret-value-with-enough-entropy";

let originalSecret: string | undefined;

beforeEach(() => {
  originalSecret = process.env.UAZAPI_WEBHOOK_SECRET;
  process.env.UAZAPI_WEBHOOK_SECRET = SECRET;
});

afterEach(() => {
  if (originalSecret === undefined) {
    delete process.env.UAZAPI_WEBHOOK_SECRET;
  } else {
    process.env.UAZAPI_WEBHOOK_SECRET = originalSecret;
  }
});

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
