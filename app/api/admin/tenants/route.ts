/**
 * GET  /api/admin/tenants        — list every tenant (superadmin only)
 * POST /api/admin/tenants        — create a new tenant
 *
 * Gated by `requireSuperadmin()` which either resolves to the authenticated
 * superadmin context OR returns a redirect Response for the caller to hand
 * straight back.
 */

import { NextResponse } from "next/server";
import { requireSuperadmin } from "@/lib/tenant";
import {
  createTenant,
  listAllTenants,
} from "@/lib/admin/tenants";
import {
  mapErrorToResponse,
  readJsonBody,
} from "@/app/api/whatsapp/_shared";

export async function GET() {
  const auth = await requireSuperadmin();
  if ("response" in auth) return auth.response;

  try {
    const tenants = await listAllTenants();
    return NextResponse.json({ tenants });
  } catch (err) {
    return mapErrorToResponse(err);
  }
}

export async function POST(req: Request) {
  const auth = await requireSuperadmin();
  if ("response" in auth) return auth.response;

  const body = await readJsonBody<{ name?: unknown; plan?: unknown }>(req);

  try {
    const tenant = await createTenant({
      name: typeof body.name === "string" ? body.name : "",
      plan: typeof body.plan === "string" ? body.plan : undefined,
    });
    return NextResponse.json({ tenant }, { status: 201 });
  } catch (err) {
    return mapErrorToResponse(err);
  }
}
