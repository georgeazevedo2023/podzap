/**
 * POST /api/whatsapp/disconnect
 *
 * Body:  `{ instanceId: string }`
 * Reply: `200 { ok: true }`
 *
 * Delegates to `disconnectInstance` in the service layer, which handles
 * both the UAZAPI call (instance DELETE or soft disconnect) and DB state.
 */

import { NextResponse } from "next/server";
import { disconnectInstance } from "@/lib/whatsapp/service";
import {
  errorResponse,
  mapErrorToResponse,
  readJsonBody,
  requireAuth,
} from "../_shared";

export async function POST(req: Request) {
  const auth = await requireAuth();
  if ("response" in auth) return auth.response;
  const { tenant } = auth;

  const body = await readJsonBody<{ instanceId?: unknown }>(req);
  if (!body.instanceId || typeof body.instanceId !== "string") {
    return errorResponse(
      400,
      "VALIDATION_ERROR",
      "`instanceId` is required in the request body.",
    );
  }

  try {
    await disconnectInstance(tenant.id, body.instanceId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return mapErrorToResponse(err);
  }
}
