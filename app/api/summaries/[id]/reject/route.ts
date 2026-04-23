/**
 * POST /api/summaries/[id]/reject
 *
 * Flips a summary from `pending_review` → `rejected` with a mandatory
 * reason (recorded on the row for audit). Unlike `/approve`, there's no
 * downstream worker — rejection is terminal, and the UI shows the
 * stored `rejected_reason` back to anyone triaging historical runs.
 *
 * Body: `{ reason: string }` — non-blank; the service layer also trims
 * and re-validates so we're not the only gatekeeper.
 *
 * Reply: `200 { summary: SummaryView }`
 */

import { NextResponse } from "next/server";
import { z } from "zod";

import { rejectSummary } from "@/lib/summaries/service";
import {
  errorResponse,
  mapErrorToResponse,
  readJsonBody,
  requireAuth,
} from "../../../whatsapp/_shared";

const RejectBodySchema = z.object({
  reason: z.string().min(1, "reason is required"),
});

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth();
  if ("response" in auth) return auth.response;
  const { tenant, user } = auth;

  const { id } = await ctx.params;
  if (!id || typeof id !== "string") {
    return errorResponse(400, "VALIDATION_ERROR", "Missing summary id.");
  }

  const raw = await readJsonBody<unknown>(req);
  const parsed = RejectBodySchema.safeParse(raw);
  if (!parsed.success) {
    return errorResponse(
      400,
      "VALIDATION_ERROR",
      "Invalid request body.",
      { issues: parsed.error.issues },
    );
  }

  try {
    const summary = await rejectSummary(
      tenant.id,
      id,
      user.id,
      parsed.data.reason,
    );
    return NextResponse.json({ summary });
  } catch (err) {
    return mapErrorToResponse(err);
  }
}
