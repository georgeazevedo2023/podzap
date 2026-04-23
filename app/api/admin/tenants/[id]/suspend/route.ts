/**
 * POST   /api/admin/tenants/[id]/suspend  — set is_active=false
 * DELETE /api/admin/tenants/[id]/suspend  — set is_active=true (lift suspension)
 *
 * Non-destructive alternative to tenant deletion (audit addition #5).
 * Superadmin only.
 */

import { NextResponse } from "next/server";
import { requireSuperadmin } from "@/lib/tenant";
import {
  activateTenant,
  suspendTenant,
} from "@/lib/admin/tenants";
import { mapErrorToResponse } from "@/app/api/whatsapp/_shared";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: Request, ctx: Ctx) {
  const auth = await requireSuperadmin();
  if ("response" in auth) return auth.response;

  const { id } = await ctx.params;
  try {
    const tenant = await suspendTenant(id);
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
    const tenant = await activateTenant(id);
    return NextResponse.json({ tenant });
  } catch (err) {
    return mapErrorToResponse(err);
  }
}
