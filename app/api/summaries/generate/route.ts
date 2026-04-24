/**
 * POST /api/summaries/generate
 *
 * Kicks off a background summary generation run. The actual Gemini call
 * is deferred to an Inngest worker (`inngest/functions/generate-summary.ts`)
 * because it routinely takes 10-30s — far too long to block a request.
 *
 * Body:
 *   { groupId, periodStart, periodEnd, tone }
 *
 * Reply: `202 { ok: true, dispatched: true }`
 *
 * Rate limited to 10/hour/tenant. Gemini 2.5 Pro runs cost $0.005-0.02 a
 * pop and most user-facing flows only need one summary at a time; the
 * ceiling protects against a UI bug or a runaway script.
 */

import { NextResponse } from "next/server";
import { z } from "zod";

import { inngest } from "@/inngest/client";
import { summaryRequested } from "@/inngest/events";
import {
  applyRateLimit,
  errorResponse,
  mapErrorToResponse,
  readJsonBody,
  requireAuth,
} from "../../whatsapp/_shared";

const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 3_600_000; // 1h

// `tone` values mirror the `summary_tone` DB enum. Keep in sync with
// `lib/supabase/types.ts` and `inngest/events.ts#summaryRequested`.
const GenerateBodySchema = z
  .object({
    groupId: z.string().uuid(),
    periodStart: z.string().datetime({ offset: true }),
    periodEnd: z.string().datetime({ offset: true }),
    tone: z.enum(["formal", "fun", "corporate"]).default("fun"),
    voiceMode: z.enum(["single", "duo"]).default("single"),
  })
  .refine(
    (body) => new Date(body.periodEnd) > new Date(body.periodStart),
    { message: "periodEnd must be after periodStart", path: ["periodEnd"] },
  );

export async function POST(req: Request) {
  const auth = await requireAuth();
  if ("response" in auth) return auth.response;
  const { tenant } = auth;

  const limited = applyRateLimit(
    tenant.id,
    "summary-generate",
    RATE_LIMIT_MAX,
    RATE_LIMIT_WINDOW_MS,
  );
  if (limited) return limited;

  const raw = await readJsonBody<unknown>(req);
  const parsed = GenerateBodySchema.safeParse(raw);
  if (!parsed.success) {
    return errorResponse(
      400,
      "VALIDATION_ERROR",
      "Invalid request body.",
      { issues: parsed.error.issues },
    );
  }

  const { groupId, periodStart, periodEnd, tone, voiceMode } = parsed.data;

  try {
    await inngest.send(
      summaryRequested.create({
        tenantId: tenant.id,
        groupId,
        periodStart,
        periodEnd,
        tone,
        voiceMode,
      }),
    );
    return NextResponse.json(
      { ok: true, dispatched: true },
      { status: 202 },
    );
  } catch (err) {
    return mapErrorToResponse(err);
  }
}
