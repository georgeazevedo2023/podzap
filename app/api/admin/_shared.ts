/**
 * Shared helpers for `/api/admin/*` routes.
 *
 * Every admin route is gated by `requireSuperadmin()` (from `lib/tenant.ts`)
 * and uses the service-role admin client under the hood. This module owns
 * the auth bridge (turn `requireSuperadmin`'s discriminated union into a
 * route-friendly "auth or response" shape) and the error→HTTP mapper for
 * admin-service-specific error classes.
 */

import { NextResponse } from "next/server";
import { requireSuperadmin } from "@/lib/tenant";
import type { CurrentTenant, CurrentUser } from "@/lib/tenant";
import { UazapiAdminError } from "@/lib/admin/uazapi";
import { UazapiError } from "@/lib/uazapi/types";

export type AdminErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "VALIDATION_ERROR"
  | "UAZAPI_ERROR"
  | "INTERNAL_ERROR";

export interface AdminApiError {
  code: AdminErrorCode;
  message: string;
  details?: unknown;
}

export function errorResponse(
  status: number,
  code: AdminErrorCode,
  message: string,
  details?: unknown,
): NextResponse {
  const body: { error: AdminApiError } = { error: { code, message } };
  if (details !== undefined) body.error.details = details;
  return NextResponse.json(body, { status });
}

/**
 * Gate the route on a superadmin session. `requireSuperadmin()` returns a
 * `Response` redirect for unauthenticated / non-superadmin requests, which
 * is the right behaviour for server components but not for an API JSON
 * endpoint — so we translate the redirect into a plain 401/403 JSON body
 * here (using the redirect target URL path as the discriminator).
 */
export async function requireSuperadminJson(): Promise<
  | { user: CurrentUser; tenant: CurrentTenant | null }
  | { response: NextResponse }
> {
  const guard = await requireSuperadmin();
  if ("response" in guard) {
    // Peek the redirect target so we can return the right status code.
    let location = "";
    try {
      location = guard.response.headers.get("location") ?? "";
    } catch {
      location = "";
    }
    const isLoginRedirect = location.includes("/login");
    return {
      response: errorResponse(
        isLoginRedirect ? 401 : 403,
        isLoginRedirect ? "UNAUTHORIZED" : "FORBIDDEN",
        isLoginRedirect
          ? "Authentication required."
          : "Superadmin access required.",
      ),
    };
  }
  return { user: guard.user, tenant: guard.tenant };
}

/**
 * Map errors from the admin services (currently `UazapiAdminError`) to a
 * consistent JSON envelope. Unknown errors become 500 INTERNAL_ERROR.
 */
export function mapErrorToResponse(err: unknown): NextResponse {
  if (err instanceof UazapiAdminError) {
    switch (err.code) {
      case "NOT_FOUND":
      case "TENANT_NOT_FOUND":
        return errorResponse(404, "NOT_FOUND", err.message);
      case "ALREADY_ATTACHED":
      case "TENANT_ALREADY_HAS_INSTANCE":
        return errorResponse(409, "CONFLICT", err.message);
      case "UAZAPI_ERROR":
        return errorResponse(502, "UAZAPI_ERROR", err.message);
      case "DB_ERROR":
      default:
        return errorResponse(500, "INTERNAL_ERROR", err.message);
    }
  }

  if (err instanceof UazapiError) {
    return errorResponse(502, "UAZAPI_ERROR", err.message, {
      status: err.status,
      code: err.code,
    });
  }

  const message = err instanceof Error ? err.message : "Internal server error.";
  return errorResponse(500, "INTERNAL_ERROR", message);
}

/** Tolerant JSON body reader — `{}` on empty / malformed. */
export async function readJsonBody<T = unknown>(req: Request): Promise<T> {
  try {
    const text = await req.text();
    if (!text) return {} as T;
    return JSON.parse(text) as T;
  } catch {
    return {} as T;
  }
}
