/**
 * POST /api/admin/uazapi/create-and-attach
 *
 * Create a new UAZAPI instance and immediately attach it to a tenant in
 * one step. Convenience for fresh customer onboarding.
 *
 * Body:  `{ tenantId: string, name: string }`
 * Reply: `200 { instance: UazapiInstanceAdminView }`
 */

import { NextResponse } from "next/server";
import { createAndAttach } from "@/lib/admin/uazapi";
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
    tenantId?: unknown;
    name?: unknown;
  }>(req);

  const tenantId = body.tenantId;
  const name = body.name;

  if (typeof tenantId !== "string" || tenantId.trim() === "") {
    return errorResponse(
      400,
      "VALIDATION_ERROR",
      "`tenantId` must be a non-empty string.",
    );
  }
  if (typeof name !== "string" || name.trim() === "") {
    return errorResponse(
      400,
      "VALIDATION_ERROR",
      "`name` must be a non-empty string.",
    );
  }

  try {
    const instance = await createAndAttach(tenantId.trim(), name.trim());
    return NextResponse.json({ instance });
  } catch (err) {
    return mapErrorToResponse(err);
  }
}
