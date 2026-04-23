/**
 * Webhook validator — gate for `POST /api/webhooks/uazapi`.
 *
 * Two independent validations:
 *   1. Secret: the caller must prove they know our shared secret. UAZAPI's
 *      `POST /webhook` config doesn't support custom auth headers directly,
 *      but it does round-trip any query string present on the URL we register
 *      (e.g. `https://app/api/webhooks/uazapi?secret=abc`). We accept the
 *      secret via either:
 *        * the `x-uazapi-secret` header (used by first-party / reverse-proxy
 *          setups and our own `/api/webhooks/test` dev harness), OR
 *        * the `?secret=` query string (used by UAZAPI in production).
 *      Both paths use `crypto.timingSafeEqual` for constant-time comparison.
 *
 *      If `UAZAPI_WEBHOOK_SECRET` is not set in the environment at all we
 *      fail-closed with `SERVER_MISCONFIG` — never allow unauthenticated
 *      webhook ingestion.
 *
 *   2. Body: parsed via `IncomingWebhookEventSchema` from
 *      `lib/uazapi/types.ts` — the same discriminated union used by the
 *      handler below. We prefer the zod error's first issue for the 400
 *      `reason` so ops can tell apart malformed payloads from unknown event
 *      shapes (which are NOT an error — the `unknown` branch exists exactly
 *      to log and drop without throwing).
 *
 * All public functions return tagged unions (`{ ok: true } | { ok: false }`)
 * rather than throwing — the route handler is a pure mapper from tag → HTTP
 * status, which keeps error paths auditable.
 */

import { timingSafeEqual } from "node:crypto";
import {
  IncomingWebhookEventSchema,
  type IncomingWebhookEvent,
} from "@/lib/uazapi/types";

// ──────────────────────────────────────────────────────────────────────────
//  Public types
// ──────────────────────────────────────────────────────────────────────────

export type WebhookEvent = IncomingWebhookEvent;

export type SecretValidationResult =
  | { ok: true }
  | { ok: false; status: 401 | 500; reason: string };

export type ValidationResult =
  | { ok: true; event: WebhookEvent }
  | { ok: false; status: 400; reason: string };

// ──────────────────────────────────────────────────────────────────────────
//  Secret
// ──────────────────────────────────────────────────────────────────────────

/**
 * Compare two strings in constant time. Returns false when lengths differ
 * (length is not secret-sensitive — the pattern is standard).
 */
function secretsMatch(expected: string, provided: string): boolean {
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(provided, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Look at the incoming request and confirm it carries the expected secret.
 *
 * Accepts both `x-uazapi-secret` header (preferred for first-party callers)
 * and `?secret=` query string (UAZAPI's only reliable channel — custom
 * headers aren't honoured by `POST /webhook` registration on wsmart.uazapi.com
 * as of 2026-04-22).
 *
 * TODO(fase-4): once we confirm UAZAPI's final secret-transport convention
 * (header-signing with HMAC, or embedded in payload), collapse this to a
 * single mechanism. Keeping both for now means the dev harness can continue
 * using the header while production uses the query string.
 */
export function validateSecret(request: Request): SecretValidationResult {
  const expected = process.env.UAZAPI_WEBHOOK_SECRET;
  if (!expected || expected.length === 0) {
    return {
      ok: false,
      status: 500,
      reason: "SERVER_MISCONFIG: UAZAPI_WEBHOOK_SECRET not set",
    };
  }

  const header = request.headers.get("x-uazapi-secret") ?? "";
  let fromQuery = "";
  try {
    const url = new URL(request.url);
    fromQuery = url.searchParams.get("secret") ?? "";
  } catch {
    // Malformed URL — fall through; the caller already has `request.url`
    // so this "shouldn't happen" but we guard to keep the branch total.
    fromQuery = "";
  }

  const provided = header.length > 0 ? header : fromQuery;
  if (provided.length === 0) {
    return { ok: false, status: 401, reason: "missing secret" };
  }

  if (!secretsMatch(expected, provided)) {
    return { ok: false, status: 401, reason: "invalid secret" };
  }
  return { ok: true };
}

// ──────────────────────────────────────────────────────────────────────────
//  Body
// ──────────────────────────────────────────────────────────────────────────

/**
 * Parse an already-JSON-decoded webhook body.
 *
 * Does not attempt `JSON.parse` itself — the route handler owns that (so it
 * can distinguish "malformed JSON" from "malformed shape" and return a
 * different 400 reason if desired). Here we only validate the zod shape.
 */
export function parseWebhookBody(body: unknown): ValidationResult {
  const parsed = IncomingWebhookEventSchema.safeParse(body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const reason = first
      ? `${first.path.join(".") || "<root>"}: ${first.message}`
      : "invalid body";
    return { ok: false, status: 400, reason };
  }
  return { ok: true, event: parsed.data };
}
