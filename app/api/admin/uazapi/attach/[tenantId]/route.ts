/**
 * DELETE /api/admin/uazapi/attach/[tenantId]
 *
 * Detach the WhatsApp instance currently attached to the given tenant.
 * Destructive — cascades into groups / messages / transcripts / summaries
 * / audios / schedules for that tenant. The UI must confirm.
 *
 * Reply: `204` on success.
 */

import { NextResponse } from "next/server";
import { detachInstance } from "@/lib/admin/uazapi";
import {
  errorResponse,
  mapErrorToResponse,
  requireSuperadminJson,
} from "../../../_shared";

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ tenantId: string }> },
) {
  const auth = await requireSuperadminJson();
  if ("response" in auth) return auth.response;

  const { tenantId } = await ctx.params;
  if (typeof tenantId !== "string" || tenantId.trim() === "") {
    return errorResponse(
      400,
      "VALIDATION_ERROR",
      "`tenantId` path segment is required.",
    );
  }

  try {
    await detachInstance(tenantId);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return mapErrorToResponse(err);
  }
}
