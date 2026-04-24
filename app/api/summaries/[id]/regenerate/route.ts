/**
 * POST /api/summaries/[id]/regenerate
 *
 * "Give me another shot at this summary" — loads the existing row to
 * copy forward `groupId`/`periodStart`/`periodEnd`, then emits a fresh
 * `summary.requested` event so the Fase 7 generator creates a brand
 * new `pending_review` row (optionally with a different tone). The
 * original row is left untouched; the UI surfaces both versions and
 * the reviewer picks one.
 *
 * A summary that's already `approved` is frozen: the downstream TTS
 * artefact references that row by id, so re-running it would break the
 * invariant that "the approved text is what got rendered". We return
 * 409 INVALID_STATE in that case. Rejected rows *can* be regenerated
 * — they're dead weight and regenerating is the main recovery path.
 *
 * Body: `{ tone?: 'formal' | 'fun' | 'corporate' }` — defaults to the
 * original summary's tone so "regenerate" with no args reproduces the
 * same configuration (in case the LLM just had a bad day).
 *
 * Reply: `200 { dispatched: true }`
 */

import { NextResponse } from "next/server";
import { z } from "zod";

import { inngest } from "@/inngest/client";
import { summaryRequested } from "@/inngest/events";
import { getSummary } from "@/lib/summaries/service";
import {
  applyRateLimit,
  errorResponse,
  mapErrorToResponse,
  readJsonBody,
  requireAuth,
} from "../../../whatsapp/_shared";

const RegenerateBodySchema = z.object({
  tone: z.enum(["formal", "fun", "corporate"]).optional(),
});

/**
 * Share the rate-limit bucket with `POST /api/summaries/generate` — both
 * endpoints emit `summary.requested` and incur the same Gemini 2.5 Pro
 * cost, so a separate bucket would let a caller bypass the ceiling by
 * alternating between them. 10/hour combined. Documented in
 * `docs/api/auth-matrix.md` (inconsistência #1).
 */
const RATE_LIMIT_KEY = "summary-generate";
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 3_600_000;

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth();
  if ("response" in auth) return auth.response;
  const { tenant } = auth;

  const limited = applyRateLimit(
    tenant.id,
    RATE_LIMIT_KEY,
    RATE_LIMIT_MAX,
    RATE_LIMIT_WINDOW_MS,
  );
  if (limited) return limited;

  const { id } = await ctx.params;
  if (!id || typeof id !== "string") {
    return errorResponse(400, "VALIDATION_ERROR", "Missing summary id.");
  }

  const raw = await readJsonBody<unknown>(req);
  const parsed = RegenerateBodySchema.safeParse(raw);
  if (!parsed.success) {
    return errorResponse(
      400,
      "VALIDATION_ERROR",
      "Invalid request body.",
      { issues: parsed.error.issues },
    );
  }

  try {
    const existing = await getSummary(tenant.id, id);
    if (!existing) {
      return errorResponse(404, "NOT_FOUND", "Summary not found.");
    }
    if (existing.status === "approved") {
      return errorResponse(
        409,
        "INVALID_STATE",
        "Cannot regenerate an already-approved summary.",
      );
    }

    await inngest.send(
      summaryRequested.create({
        tenantId: tenant.id,
        groupId: existing.groupId,
        periodStart: existing.periodStart,
        periodEnd: existing.periodEnd,
        tone: parsed.data.tone ?? existing.tone,
      }),
    );

    return NextResponse.json({ dispatched: true });
  } catch (err) {
    return mapErrorToResponse(err);
  }
}
