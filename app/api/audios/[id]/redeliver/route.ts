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
import { z } from "zod";

import { redeliver } from "@/lib/delivery/service";
import {
  resolveTargetJid,
  TargetResolutionError,
} from "@/lib/delivery/target";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  applyRateLimit,
  errorResponse,
  mapErrorToResponse,
  readJsonBody,
  requireAuth,
} from "../../../whatsapp/_shared";

const REDELIVER_MAX_PER_HOUR = 6;
const ONE_HOUR_MS = 60 * 60 * 1000;

const BodySchema = z
  .object({
    target: z.enum(["group", "me", "contact"]).default("group"),
    jid: z.string().trim().min(1).max(60).optional(),
  })
  .optional();

async function loadGroupIdForAudio(
  tenantId: string,
  audioId: string,
): Promise<string | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("audios")
    .select("summary_id, summaries!inner(group_id)")
    .eq("tenant_id", tenantId)
    .eq("id", audioId)
    .maybeSingle();
  // Supabase renders the join as nested object or array depending on the
  // relationship cardinality inferred from the PostgREST schema.
  const joined = (data as unknown as {
    summaries?: { group_id?: string } | { group_id?: string }[] | null;
  } | null)?.summaries;
  if (!joined) return null;
  if (Array.isArray(joined)) return joined[0]?.group_id ?? null;
  return joined.group_id ?? null;
}

function mapTargetError(err: TargetResolutionError): Response {
  switch (err.code) {
    case "PHONE_NOT_SET":
      return errorResponse(400, "PHONE_NOT_SET", err.message);
    case "INVALID_CONTACT":
      return errorResponse(400, "INVALID_CONTACT", err.message);
    case "GROUP_NOT_FOUND":
      return errorResponse(404, "GROUP_NOT_FOUND", err.message);
    case "DB_ERROR":
    default:
      return errorResponse(500, "INTERNAL_ERROR", err.message);
  }
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth();
  if ("response" in auth) return auth.response;
  const { tenant, user } = auth;

  const { id } = await ctx.params;
  if (!id || typeof id !== "string") {
    return errorResponse(400, "VALIDATION_ERROR", "Missing audio id.");
  }
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return errorResponse(400, "VALIDATION_ERROR", "`id` must be a UUID.");
  }

  const raw = await readJsonBody<unknown>(req).catch(() => null);
  const parsed = BodySchema.safeParse(raw ?? undefined);
  if (!parsed.success) {
    return errorResponse(400, "VALIDATION_ERROR", "Invalid body.", {
      issues: parsed.error.issues,
    });
  }
  const body = parsed.data ?? { target: "group" as const };

  const limited = applyRateLimit(
    tenant.id,
    "redeliver",
    REDELIVER_MAX_PER_HOUR,
    ONE_HOUR_MS,
  );
  if (limited) return limited;

  let targetJid: string;
  try {
    const groupId = await loadGroupIdForAudio(tenant.id, id);
    targetJid = await resolveTargetJid({
      tenantId: tenant.id,
      userId: user.id,
      target: body.target,
      contactPhone: body.jid,
      groupId: groupId ?? undefined,
    });
  } catch (err) {
    if (err instanceof TargetResolutionError) return mapTargetError(err);
    return mapErrorToResponse(err);
  }

  try {
    const delivery = await redeliver(tenant.id, id, { targetJid });
    return NextResponse.json({ delivery });
  } catch (err) {
    return mapErrorToResponse(err);
  }
}
