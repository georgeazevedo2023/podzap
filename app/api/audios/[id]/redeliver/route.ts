/**
 * POST /api/audios/[id]/redeliver
 *
 * Forces a re-delivery of a generated audio to its target WhatsApp
 * group, even when the row is already flagged `delivered_to_whatsapp`.
 * Thin wrapper around `redeliver` in `lib/delivery/service.ts` — the
 * service handles tenant scoping, instance-health checks, UAZAPI call
 * and row update.
 *
 * Rate limit: 6 requests / hour / tenant (route name
 * `tenant:<id>:redeliver`). Manual retries are an admin affordance;
 * this guards against accidental button-mashing and keeps the UAZAPI
 * sender's reputation intact.
 *
 * Reply: `200 { delivery: DeliveryView }`.
 *
 * Error mapping (via `_shared.mapErrorToResponse`):
 *   DeliveryError('NOT_FOUND')              → 404 NOT_FOUND
 *   DeliveryError('NO_INSTANCE')             → 409 NO_INSTANCE
 *   DeliveryError('INSTANCE_NOT_CONNECTED')  → 409 INSTANCE_NOT_CONNECTED
 *   DeliveryError('UAZAPI_ERROR')            → 502 UAZAPI_ERROR
 *   DeliveryError('DB_ERROR')                → 500 INTERNAL_ERROR
 */

import { NextResponse } from "next/server";

import { redeliver } from "@/lib/delivery/service";
import {
  applyRateLimit,
  errorResponse,
  mapErrorToResponse,
  requireAuth,
} from "../../../whatsapp/_shared";

const REDELIVER_MAX_PER_HOUR = 6;
const ONE_HOUR_MS = 60 * 60 * 1000;

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth();
  if ("response" in auth) return auth.response;
  const { tenant } = auth;

  const { id } = await ctx.params;
  if (!id || typeof id !== "string") {
    return errorResponse(400, "VALIDATION_ERROR", "Missing audio id.");
  }
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return errorResponse(400, "VALIDATION_ERROR", "`id` must be a UUID.");
  }

  const limited = applyRateLimit(
    tenant.id,
    "redeliver",
    REDELIVER_MAX_PER_HOUR,
    ONE_HOUR_MS,
  );
  if (limited) return limited;

  try {
    const delivery = await redeliver(tenant.id, id);
    return NextResponse.json({ delivery });
  } catch (err) {
    return mapErrorToResponse(err);
  }
}
