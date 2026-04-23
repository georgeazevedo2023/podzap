/**
 * POST /api/whatsapp/connect
 *
 * Creates (or reuses) a WhatsApp instance for the current tenant.
 *
 * Body:  `{ }` | `{ name?: string }`
 * Reply: `200 { instance: InstanceView }`
 *
 * Idempotent: if the tenant already has a `connected` instance we return it
 * unchanged. Otherwise we hand off to the service layer to create a new
 * instance on UAZAPI + persist it + seed an initial QR.
 */

import { NextResponse } from "next/server";
import {
  createInstanceForTenant,
  getCurrentInstance,
  getQrCodeForInstance,
} from "@/lib/whatsapp/service";
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

  const body = await readJsonBody<{ name?: unknown }>(req);
  let name: string | undefined;
  if (body.name !== undefined) {
    if (typeof body.name !== "string" || body.name.trim().length === 0) {
      return errorResponse(
        400,
        "VALIDATION_ERROR",
        "`name` must be a non-empty string when provided.",
      );
    }
    name = body.name.trim();
  }

  try {
    // Idempotency: already connected? skip the UAZAPI round-trip.
    const existing = await getCurrentInstance(tenant.id);
    if (existing && existing.status === "connected") {
      return NextResponse.json({ instance: existing });
    }

    // Reuse if the tenant has an instance that simply hasn't finished
    // scanning yet. Otherwise create fresh.
    let instance =
      existing && existing.status !== "disconnected"
        ? existing
        : await createInstanceForTenant(tenant.id, name);

    // Seed a QR for the caller. If the instance is somehow already
    // connected between the calls (race), this still succeeds and returns
    // an empty qr + connected status, which the service already handles.
    try {
      const qr = await getQrCodeForInstance(tenant.id, instance.id);
      instance = { ...instance, qrCodeBase64: qr.qrCodeBase64, status: qr.status };
    } catch {
      // Non-fatal: the caller can poll `/qrcode` separately.
    }

    return NextResponse.json({ instance });
  } catch (err) {
    return mapErrorToResponse(err);
  }
}
