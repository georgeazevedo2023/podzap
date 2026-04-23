/**
 * Shared helpers for /api/whatsapp/* route handlers.
 *
 * Every route in this tree is a thin wrapper around `lib/whatsapp/service.ts`
 * with the same boilerplate: authenticate, translate errors to a consistent
 * JSON envelope, and (optionally) apply a rate limit. Keeping that boilerplate
 * here lets the route files stay short and focused on the service call.
 *
 * Error envelope shape (must match the spec in fase-2-plan):
 *   { error: { code: string; message: string; details?: unknown } }
 */

import { NextResponse } from "next/server";
import { UazapiError } from "@/lib/uazapi/types";
import { checkRateLimit } from "@/lib/ratelimit";
import { getCurrentUserAndTenant, type CurrentTenant, type CurrentUser } from "@/lib/tenant";

export type ErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "RATE_LIMITED"
  | "UAZAPI_ERROR"
  | "TTS_ERROR"
  | "VALIDATION_ERROR"
  | "INTERNAL_ERROR"
  | "NO_INSTANCE"
  | "INSTANCE_NOT_CONNECTED"
  | "INVALID_STATE"
  | "ALREADY_EXISTS"
  | "CONFLICT"
  | "AUTH_ERROR"
  | "DELIVERY_ERROR";

export interface ApiError {
  code: ErrorCode;
  message: string;
  details?: unknown;
}

/** Build the standard `{ error: { code, message, details } }` payload. */
export function errorResponse(
  status: number,
  code: ErrorCode,
  message: string,
  details?: unknown,
  headers?: Record<string, string>,
): NextResponse {
  const body: { error: ApiError } = { error: { code, message } };
  if (details !== undefined) body.error.details = details;
  return NextResponse.json(body, { status, headers });
}

/**
 * Require an authenticated user + tenant. Returns the auth context or an
 * error response. Callers pattern-match on the presence of `.user`.
 */
export async function requireAuth(): Promise<
  | { user: CurrentUser; tenant: CurrentTenant }
  | { response: NextResponse }
> {
  const ctx = await getCurrentUserAndTenant();
  if (!ctx) {
    return {
      response: errorResponse(
        401,
        "UNAUTHORIZED",
        "Authentication required.",
      ),
    };
  }
  return ctx;
}

/**
 * Apply a per-tenant rate limit. Returns `null` if the request is allowed;
 * otherwise returns a 429 response with `Retry-After` set in seconds (per
 * RFC 7231) — callers return it verbatim.
 */
export function applyRateLimit(
  tenantId: string,
  routeName: string,
  maxPerWindow: number,
  windowMs: number,
): NextResponse | null {
  const result = checkRateLimit(
    `tenant:${tenantId}:${routeName}`,
    maxPerWindow,
    windowMs,
  );
  if (result.ok) return null;

  const retryAfterMs = result.retryAfterMs ?? windowMs;
  const retryAfterSec = Math.max(1, Math.ceil(retryAfterMs / 1000));
  return errorResponse(
    429,
    "RATE_LIMITED",
    `Too many requests. Retry in ${retryAfterSec}s.`,
    { retryAfterMs },
    { "Retry-After": String(retryAfterSec) },
  );
}

/**
 * Map an arbitrary error caught around a service call to an appropriate
 * NextResponse. This is where the error-code policy for the whole API tree
 * lives — keep it in one place so every route is consistent.
 *
 * Mapping:
 *   UazapiError                         → 502 UAZAPI_ERROR
 *   Postgres RLS / FK violations        → 400 VALIDATION_ERROR
 *   anything we tagged with .code "NOT_FOUND" → 404 NOT_FOUND
 *   anything else                       → 500 INTERNAL_ERROR
 */
export function mapErrorToResponse(err: unknown): NextResponse {
  if (err instanceof UazapiError) {
    return errorResponse(
      502,
      "UAZAPI_ERROR",
      err.message,
      { status: err.status, code: err.code },
    );
  }

  // Heuristic match for Supabase / Postgres errors surfaced as plain objects.
  // PostgREST errors have `code` (Postgres SQLSTATE) + `message`. RLS failures
  // arrive as 42501; FK violations as 23503; not-null as 23502; unique as 23505.
  if (isPgError(err)) {
    const { code, message, details, hint } = err;
    const rlsOrConstraint =
      code === "42501" || // insufficient privilege (RLS)
      code === "23503" || // foreign key violation
      code === "23502" || // not-null violation
      code === "23505" || // unique violation
      code === "23514";   // check violation
    if (rlsOrConstraint) {
      return errorResponse(400, "VALIDATION_ERROR", message, { code, details, hint });
    }
  }

  // Service layer may throw plain Errors with a `code` hint.
  if (err && typeof err === "object" && "code" in err) {
    const bag = err as { code?: unknown; message?: unknown };
    const code = bag.code;
    const message =
      typeof bag.message === "string" ? bag.message : "Request failed.";
    if (code === "NOT_FOUND") {
      return errorResponse(404, "NOT_FOUND", message);
    }
    if (code === "VALIDATION_ERROR") {
      return errorResponse(400, "VALIDATION_ERROR", message);
    }
    if (code === "INVALID_STATE") {
      return errorResponse(409, "INVALID_STATE", message);
    }
    if (code === "NO_INSTANCE" || code === "INSTANCE_NOT_CONNECTED") {
      return errorResponse(409, code, message);
    }
    if (code === "UAZAPI_ERROR") {
      return errorResponse(502, "UAZAPI_ERROR", message);
    }
    if (code === "TTS_ERROR") {
      return errorResponse(502, "TTS_ERROR", message);
    }
    if (code === "ALREADY_EXISTS") {
      return errorResponse(409, "ALREADY_EXISTS", message);
    }
    if (code === "CONFLICT") {
      return errorResponse(409, "CONFLICT", message);
    }
    if (code === "AUTH_ERROR") {
      return errorResponse(500, "AUTH_ERROR", message);
    }
    if (code === "DB_ERROR") {
      return errorResponse(500, "INTERNAL_ERROR", message);
    }
  }

  const message = err instanceof Error ? err.message : "Internal server error.";
  return errorResponse(500, "INTERNAL_ERROR", message);
}

/** Narrow check for a Postgres-shaped error object. */
function isPgError(
  err: unknown,
): err is { code: string; message: string; details?: unknown; hint?: unknown } {
  return (
    !!err &&
    typeof err === "object" &&
    "code" in err &&
    typeof (err as { code?: unknown }).code === "string" &&
    "message" in err &&
    typeof (err as { message?: unknown }).message === "string"
  );
}

/** Best-effort JSON body parser — returns `{}` on empty / malformed bodies. */
export async function readJsonBody<T = unknown>(req: Request): Promise<T> {
  try {
    const text = await req.text();
    if (!text) return {} as T;
    return JSON.parse(text) as T;
  } catch {
    return {} as T;
  }
}
