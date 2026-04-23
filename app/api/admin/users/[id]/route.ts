/**
 * GET    /api/admin/users/[id]   — read single user
 * PATCH  /api/admin/users/[id]   — update membership OR superadmin flag
 *                                   body supports two shapes:
 *                                     { tenantId, role }       (membership)
 *                                     { isSuperadmin, note? }  (sa flag)
 *                                   or both combined (membership first).
 *                                   Also: { tenantId, remove: true } to
 *                                   remove the user from a tenant.
 * DELETE /api/admin/users/[id]   — hard delete auth user (cascades)
 *
 * Superadmin only.
 */

import { NextResponse } from "next/server";
import { requireSuperadmin } from "@/lib/tenant";
import {
  deleteUser,
  getUserAdmin,
  removeUserFromTenant,
  setSuperadmin,
  updateUserMembership,
  type UserAdminView,
} from "@/lib/admin/users";
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
    const user = await getUserAdmin(id);
    if (!user) {
      return errorResponse(404, "NOT_FOUND", `User ${id} not found`);
    }
    return NextResponse.json({ user });
  } catch (err) {
    return mapErrorToResponse(err);
  }
}

export async function PATCH(req: Request, ctx: Ctx) {
  const auth = await requireSuperadmin();
  if ("response" in auth) return auth.response;

  const { id } = await ctx.params;
  const body = await readJsonBody<{
    tenantId?: unknown;
    role?: unknown;
    remove?: unknown;
    isSuperadmin?: unknown;
    note?: unknown;
  }>(req);

  try {
    let latest: UserAdminView | null = null;

    if (typeof body.tenantId === "string" && body.tenantId.length > 0) {
      if (body.remove === true) {
        latest = await removeUserFromTenant(id, body.tenantId);
      } else if (
        body.role === "owner" ||
        body.role === "admin" ||
        body.role === "member"
      ) {
        latest = await updateUserMembership(id, body.tenantId, body.role);
      } else {
        return errorResponse(
          400,
          "VALIDATION_ERROR",
          "role must be owner|admin|member (or pass remove:true)",
        );
      }
    }

    if (typeof body.isSuperadmin === "boolean") {
      const note = typeof body.note === "string" ? body.note : undefined;
      latest = await setSuperadmin(id, body.isSuperadmin, note);
    }

    if (!latest) {
      return errorResponse(
        400,
        "VALIDATION_ERROR",
        "PATCH body must include either { tenantId, role|remove } or { isSuperadmin }",
      );
    }

    return NextResponse.json({ user: latest });
  } catch (err) {
    return mapErrorToResponse(err);
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const auth = await requireSuperadmin();
  if ("response" in auth) return auth.response;

  const { id } = await ctx.params;
  try {
    await deleteUser(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return mapErrorToResponse(err);
  }
}
