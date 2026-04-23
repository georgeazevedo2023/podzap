/**
 * GET /api/summaries/[id]
 *
 * Fetches a single summary by id, scoped to the caller's tenant. Returns
 * 404 if the row doesn't exist or belongs to another tenant — we don't
 * leak existence by distinguishing the two cases.
 *
 * Reply: `200 { summary: SummaryView }`
 */

import { NextResponse } from "next/server";

import { getSummary } from "@/lib/summaries/service";
import {
  errorResponse,
  mapErrorToResponse,
  requireAuth,
} from "../../whatsapp/_shared";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth();
  if ("response" in auth) return auth.response;
  const { tenant } = auth;

  const { id } = await ctx.params;
  if (!id || typeof id !== "string") {
    return errorResponse(400, "VALIDATION_ERROR", "Missing summary id.");
  }

  try {
    const summary = await getSummary(tenant.id, id);
    if (!summary) {
      return errorResponse(404, "NOT_FOUND", "Summary not found.");
    }
    return NextResponse.json({ summary });
  } catch (err) {
    return mapErrorToResponse(err);
  }
}
