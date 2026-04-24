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

import { createHmac, timingSafeEqual } from "node:crypto";
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
 * Constant-time compare two hex strings. Returns false on length mismatch,
 * empty, or non-hex characters.
 */
function hexSignaturesMatch(expected: string, provided: string): boolean {
  if (expected.length === 0 || expected.length !== provided.length) return false;
  try {
    const a = Buffer.from(expected, "hex");
    const b = Buffer.from(provided, "hex");
    if (a.length === 0 || a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Validate authenticity of an incoming webhook. Two modes, checked in order:
 *
 *   1. HMAC-SHA256 (preferred) — `x-podzap-signature: <hex>` signed over
 *      the raw request body with `UAZAPI_WEBHOOK_HMAC_SECRET`. This is the
 *      mode used by the n8n forwarding flow (Fase 15+). Strict: when the
 *      header is present it MUST validate — we never fall back to the
 *      legacy secret because that would allow a downgrade attack.
 *
 *   2. Shared secret (legacy) — `x-uazapi-secret` header or `?secret=`
 *      query string, compared against `UAZAPI_WEBHOOK_SECRET`. Retained
 *      during the n8n migration so existing UAZAPI webhook registrations
 *      keep working until the Fase 15 cutover.
 *
 * At least one of the two env vars MUST be set; otherwise we fail closed
 * with 500 SERVER_MISCONFIG to prevent accidental unauthenticated ingress.
 *
 * `rawBody` is the exact bytes received (not re-serialized). The caller
 * must read the body as text BEFORE re-parsing to JSON — any whitespace
 * or key-order change breaks the HMAC.
 */
export function validateAuth(
  request: Request,
  rawBody: string,
): SecretValidationResult {
  const querySecret = process.env.UAZAPI_WEBHOOK_SECRET;
  const hmacSecret = process.env.UAZAPI_WEBHOOK_HMAC_SECRET;

  if (
    (!querySecret || querySecret.length === 0) &&
    (!hmacSecret || hmacSecret.length === 0)
  ) {
    return {
      ok: false,
      status: 500,
      reason:
        "SERVER_MISCONFIG: neither UAZAPI_WEBHOOK_SECRET nor UAZAPI_WEBHOOK_HMAC_SECRET set",
    };
  }

  // HMAC path. Presence of the header is a commitment: if it's there and
  // doesn't validate, we reject — we don't silently fall back to the
  // legacy secret. That keeps an attacker from downgrading the auth
  // check by shipping both a bad HMAC and a valid query secret.
  const signature = request.headers.get("x-podzap-signature");
  if (signature && signature.length > 0) {
    if (!hmacSecret || hmacSecret.length === 0) {
      return {
        ok: false,
        status: 500,
        reason:
          "SERVER_MISCONFIG: x-podzap-signature received but UAZAPI_WEBHOOK_HMAC_SECRET not set",
      };
    }
    const expected = createHmac("sha256", hmacSecret)
      .update(rawBody, "utf8")
      .digest("hex");
    if (hexSignaturesMatch(expected, signature)) return { ok: true };
    return { ok: false, status: 401, reason: "invalid HMAC signature" };
  }

  // Legacy secret path (header or query).
  if (!querySecret || querySecret.length === 0) {
    return {
      ok: false,
      status: 401,
      reason: "missing x-podzap-signature (HMAC-only mode)",
    };
  }

  const header = request.headers.get("x-uazapi-secret") ?? "";
  let fromQuery = "";
  try {
    fromQuery = new URL(request.url).searchParams.get("secret") ?? "";
  } catch {
    fromQuery = "";
  }

  const provided = header.length > 0 ? header : fromQuery;
  if (provided.length === 0) {
    return { ok: false, status: 401, reason: "missing credentials" };
  }
  if (!secretsMatch(querySecret, provided)) {
    return { ok: false, status: 401, reason: "invalid secret" };
  }
  return { ok: true };
}

/**
 * @deprecated Use `validateAuth(request, rawBody)` — HMAC support requires
 * access to the raw body. This wrapper calls the legacy-secret path only
 * (empty rawBody means HMAC validation path can't match).
 */
export function validateSecret(request: Request): SecretValidationResult {
  return validateAuth(request, "");
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
