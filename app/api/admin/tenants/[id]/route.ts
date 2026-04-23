/**
 * GET    /api/admin/tenants/[id]  — read a single tenant
 * PATCH  /api/admin/tenants/[id]  — update { name?, plan? }
 * DELETE /api/admin/tenants/[id]  — HARD delete (FK cascades away children)
 *
 * Superadmin only.
 */

import { NextResponse } from "next/server";
import { requireSuperadmin } from "@/lib/tenant";
import {
  deleteTenant,
  getTenantAdmin,
  updateTenant,
} from "@/lib/admin/tenants";
import {
  errorResponse,
  mapErrorToResponse,
  readJsonBody,
} from "@/app/api/whatsapp/_shared";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const auth = await requireSuperadmin();
  if ("response" in auth) return auth.response;

  const { id } = await ctx.params;
  try {
    const tenant = await getTenantAdmin(id);
    if (!tenant) {
      return errorResponse(404, "NOT_FOUND", `Tenant ${id} not found`);
    }
    return NextResponse.json({ tenant });
  } catch (err) {
    return mapErrorToResponse(err);
  }
}

export async function PATCH(req: Request, ctx: Ctx) {
  const auth = await requireSuperadmin();
  if ("response" in auth) return auth.response;

  const { id } = await ctx.params;
  const body = await readJsonBody<{ name?: unknown; plan?: unknown }>(req);

  const patch: { name?: string; plan?: string } = {};
  if (typeof body.name === "string") patch.name = body.name;
  if (typeof body.plan === "string") patch.plan = body.plan;

  try {
    const tenant = await updateTenant(id, patch);
    return NextResponse.json({ tenant });
  } catch (err) {
    return mapErrorToResponse(err);
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const auth = await requireSuperadmin();
  if ("response" in auth) return auth.response;

  const { id } = await ctx.params;
  try {
    await deleteTenant(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return mapErrorToResponse(err);
  }
}
