/**
 * POST /api/admin/uazapi/attach
 *
 * Attach an existing UAZAPI instance (by its UAZAPI-side id) to a tenant.
 * Validation layers live in `lib/admin/uazapi.attachInstance`; this route
 * is a thin wrapper that translates input + errors to JSON.
 *
 * Body:  `{ uazapiInstanceId: string, tenantId: string }`
 * Reply: `200 { instance: UazapiInstanceAdminView }`
 */

import { NextResponse } from "next/server";
import { attachInstance } from "@/lib/admin/uazapi";
import {
  errorResponse,
  mapErrorToResponse,
  readJsonBody,
  requireSuperadminJson,
} from "../../_shared";

export async function POST(req: Request) {
  const auth = await requireSuperadminJson();
  if ("response" in auth) return auth.response;

  const body = await readJsonBody<{
    uazapiInstanceId?: unknown;
    tenantId?: unknown;
  }>(req);

  const uazapiInstanceId = body.uazapiInstanceId;
  const tenantId = body.tenantId;

  if (typeof uazapiInstanceId !== "string" || uazapiInstanceId.trim() === "") {
    return errorResponse(
      400,
      "VALIDATION_ERROR",
      "`uazapiInstanceId` must be a non-empty string.",
    );
  }
  if (typeof tenantId !== "string" || tenantId.trim() === "") {
    return errorResponse(
      400,
      "VALIDATION_ERROR",
      "`tenantId` must be a non-empty string.",
    );
  }

  try {
    const instance = await attachInstance(
      uazapiInstanceId.trim(),
      tenantId.trim(),
    );
    return NextResponse.json({ instance });
  } catch (err) {
    return mapErrorToResponse(err);
  }
}
