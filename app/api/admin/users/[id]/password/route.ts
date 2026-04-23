/**
 * POST /api/admin/users/[id]/password  — superadmin resets a user's password
 *
 * Body: { password: string }  (min 8 chars, enforced in service layer).
 *
 * Introduced as the "manual password reset" flow in Fase 13 (audit addition
 * #2) — no self-service recovery is shipped in F13, so superadmins reset
 * passwords here and share the new value out of band.
 */

import { NextResponse } from "next/server";
import { requireSuperadmin } from "@/lib/tenant";
import { setUserPassword } from "@/lib/admin/users";
import {
  errorResponse,
  mapErrorToResponse,
  readJsonBody,
} from "@/app/api/whatsapp/_shared";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, ctx: Ctx) {
  const auth = await requireSuperadmin();
  if ("response" in auth) return auth.response;

  const { id } = await ctx.params;
  const body = await readJsonBody<{ password?: unknown }>(req);

  if (typeof body.password !== "string") {
    return errorResponse(
      400,
      "VALIDATION_ERROR",
      "password (string) is required in body",
    );
  }

  try {
    await setUserPassword(id, body.password);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return mapErrorToResponse(err);
  }
}
