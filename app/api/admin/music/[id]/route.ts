/**
 * PATCH  /api/admin/music/[id] — edita label/description/emoji/active/order.
 * DELETE /api/admin/music/[id] — apaga track upload (proibido em builtin/sentinel).
 */

import { NextResponse } from "next/server";

import {
  deleteTrack,
  updateTrack,
  type UpdateTrackPatch,
} from "@/lib/admin/music";
import {
  mapErrorToResponse,
  readJsonBody,
  requireSuperadminJson,
} from "../../_shared";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function PATCH(req: Request, ctx: RouteContext) {
  const auth = await requireSuperadminJson();
  if ("response" in auth) return auth.response;

  const { id } = await ctx.params;
  const body = await readJsonBody<{
    label?: unknown;
    description?: unknown;
    emoji?: unknown;
    isActive?: unknown;
    sortOrder?: unknown;
  }>(req);

  const patch: UpdateTrackPatch = {};
  if (typeof body.label === "string") patch.label = body.label;
  if (typeof body.description === "string") patch.description = body.description;
  if (typeof body.emoji === "string") patch.emoji = body.emoji;
  if (typeof body.isActive === "boolean") patch.isActive = body.isActive;
  if (typeof body.sortOrder === "number") patch.sortOrder = body.sortOrder;

  try {
    const track = await updateTrack(id, patch);
    return NextResponse.json({ track });
  } catch (err) {
    return mapErrorToResponse(err);
  }
}

export async function DELETE(_req: Request, ctx: RouteContext) {
  const auth = await requireSuperadminJson();
  if ("response" in auth) return auth.response;

  const { id } = await ctx.params;
  try {
    await deleteTrack(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return mapErrorToResponse(err);
  }
}
