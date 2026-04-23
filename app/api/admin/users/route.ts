/**
 * GET  /api/admin/users   — list every auth user, enriched with tenants
 * POST /api/admin/users   — create user { email, password, tenantId, role?, isSuperadmin? }
 *
 * Superadmin only.
 */

import { NextResponse } from "next/server";
import { requireSuperadmin } from "@/lib/tenant";
import {
  createUser,
  listAllUsers,
} from "@/lib/admin/users";
import {
  mapErrorToResponse,
  readJsonBody,
} from "@/app/api/whatsapp/_shared";

export async function GET() {
  const auth = await requireSuperadmin();
  if ("response" in auth) return auth.response;

  try {
    const users = await listAllUsers();
    return NextResponse.json({ users });
  } catch (err) {
    return mapErrorToResponse(err);
  }
}

export async function POST(req: Request) {
  const auth = await requireSuperadmin();
  if ("response" in auth) return auth.response;

  const body = await readJsonBody<{
    email?: unknown;
    password?: unknown;
    tenantId?: unknown;
    role?: unknown;
    isSuperadmin?: unknown;
  }>(req);

  const role =
    body.role === "owner" || body.role === "admin" || body.role === "member"
      ? body.role
      : undefined;

  try {
    const user = await createUser({
      email: typeof body.email === "string" ? body.email : "",
      password: typeof body.password === "string" ? body.password : "",
      tenantId: typeof body.tenantId === "string" ? body.tenantId : "",
      role,
      isSuperadmin: body.isSuperadmin === true,
    });
    return NextResponse.json({ user }, { status: 201 });
  } catch (err) {
    return mapErrorToResponse(err);
  }
}
