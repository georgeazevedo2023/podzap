/**
 * POST /api/groups/[id]/monitor
 *
 * Toggles `is_monitored` for a single group owned by the current tenant.
 *
 * Body:  `{ on: boolean }`
 * Reply: `200 { group: GroupView }`
 *
 * `GroupsError('NOT_FOUND')` surfaces as HTTP 404 via `mapErrorToResponse`.
 */

import { NextResponse } from "next/server";
import { toggleMonitor } from "@/lib/groups/service";
import {
  errorResponse,
  mapErrorToResponse,
  readJsonBody,
  requireAuth,
} from "../../../whatsapp/_shared";

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth();
  if ("response" in auth) return auth.response;
  const { tenant } = auth;

  const { id } = await ctx.params;
  if (!id || typeof id !== "string") {
    return errorResponse(400, "VALIDATION_ERROR", "Missing group id.");
  }

  const body = await readJsonBody<{ on?: unknown }>(req);
  if (typeof body.on !== "boolean") {
    return errorResponse(
      400,
      "VALIDATION_ERROR",
      "`on` must be a boolean.",
    );
  }

  try {
    const group = await toggleMonitor(tenant.id, id, body.on);
    return NextResponse.json({ group });
  } catch (err) {
    return mapErrorToResponse(err);
  }
}
