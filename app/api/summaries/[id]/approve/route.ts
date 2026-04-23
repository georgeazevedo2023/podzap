/**
 * POST /api/summaries/[id]/approve
 *
 * Flips a summary from `pending_review` → `approved` and emits
 * `summary.approved` for the Fase 9 TTS worker to pick up. The state
 * transition + event emission are intentionally two separate steps:
 * the service helper is the single source of truth for the DB update
 * and its validations (NOT_FOUND / INVALID_STATE / DB_ERROR are all
 * shaped by `SummariesError`), while the event fan-out stays at the
 * edge where the request context (user id, tenant) is available.
 *
 * The event payload is deliberately minimal — downstream workers
 * re-read the summary row by id so they always see the latest text,
 * even if someone slipped in a `PATCH` between here and the worker.
 *
 * Reply: `200 { summary: SummaryView }`
 */

import { NextResponse } from "next/server";

import { inngest } from "@/inngest/client";
import { summaryApproved } from "@/inngest/events";
import { approveSummary } from "@/lib/summaries/service";
import {
  errorResponse,
  mapErrorToResponse,
  requireAuth,
} from "../../../whatsapp/_shared";

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth();
  if ("response" in auth) return auth.response;
  const { tenant, user } = auth;

  const { id } = await ctx.params;
  if (!id || typeof id !== "string") {
    return errorResponse(400, "VALIDATION_ERROR", "Missing summary id.");
  }

  try {
    const summary = await approveSummary(tenant.id, id, user.id);

    // Event is emitted after the DB transition commits so a failed send
    // can never leave us with an approved row but no TTS job in flight
    // — worst case the send fails and we surface 500; the row is still
    // approved but the reviewer can manually re-trigger via Fase 9 tooling.
    await inngest.send(
      summaryApproved.create({
        summaryId: summary.id,
        tenantId: tenant.id,
      }),
    );

    return NextResponse.json({ summary });
  } catch (err) {
    return mapErrorToResponse(err);
  }
}
