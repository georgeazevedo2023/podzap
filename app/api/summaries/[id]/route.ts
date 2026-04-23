/**
 * GET /api/summaries/[id]
 *
 * Fetches a single summary by id, scoped to the caller's tenant. Returns
 * 404 if the row doesn't exist or belongs to another tenant — we don't
 * leak existence by distinguishing the two cases.
 *
 * Reply: `200 { summary: SummaryView }`
 *
 * ────────────────────────────────────────────────────────────────────
 *
 * PATCH /api/summaries/[id]
 *
 * Saves a manual edit to the summary text. Only `pending_review` rows
 * are editable — the service layer enforces that with an INVALID_STATE
 * → 409 response. Once the reviewer approves, the text is frozen so
 * the downstream TTS artefact keeps referring to a stable source.
 *
 * Body: `{ text: string }` — non-empty, `< 50_000` chars. The service
 * re-validates both bounds.
 *
 * Reply: `200 { summary: SummaryView }`
 */

import { NextResponse } from "next/server";
import { z } from "zod";

import { getSummary, updateSummaryText } from "@/lib/summaries/service";
import {
  errorResponse,
  mapErrorToResponse,
  readJsonBody,
  requireAuth,
} from "../../whatsapp/_shared";

const PatchBodySchema = z.object({
  text: z.string().min(1, "text is required"),
});

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

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth();
  if ("response" in auth) return auth.response;
  const { tenant } = auth;

  const { id } = await ctx.params;
  if (!id || typeof id !== "string") {
    return errorResponse(400, "VALIDATION_ERROR", "Missing summary id.");
  }

  const raw = await readJsonBody<unknown>(req);
  const parsed = PatchBodySchema.safeParse(raw);
  if (!parsed.success) {
    return errorResponse(
      400,
      "VALIDATION_ERROR",
      "Invalid request body.",
      { issues: parsed.error.issues },
    );
  }

  try {
    const summary = await updateSummaryText(tenant.id, id, parsed.data.text);
    return NextResponse.json({ summary });
  } catch (err) {
    return mapErrorToResponse(err);
  }
}
