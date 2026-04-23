/**
 * GET /api/whatsapp/qrcode?instanceId=...
 *
 * Returns the current QR code for an instance as raw base64 (no
 * `data:image/png;base64,` prefix — the client re-adds it). If the instance
 * is already `connected`, returns `{ qrCodeBase64: null, status: "connected" }`.
 *
 * Rate limited: 30 req/min per tenant.
 */

import { NextResponse } from "next/server";
import { getQrCodeForInstance } from "@/lib/whatsapp/service";
import {
  applyRateLimit,
  errorResponse,
  mapErrorToResponse,
  requireAuth,
} from "../_shared";

const RATE_LIMIT_MAX = 30;
const RATE_LIMIT_WINDOW_MS = 60_000;

export async function GET(req: Request) {
  const auth = await requireAuth();
  if ("response" in auth) return auth.response;
  const { tenant } = auth;

  const limited = applyRateLimit(
    tenant.id,
    "qrcode",
    RATE_LIMIT_MAX,
    RATE_LIMIT_WINDOW_MS,
  );
  if (limited) return limited;

  const url = new URL(req.url);
  const instanceId = url.searchParams.get("instanceId");
  if (!instanceId) {
    return errorResponse(
      400,
      "VALIDATION_ERROR",
      "`instanceId` query parameter is required.",
    );
  }

  try {
    const result = await getQrCodeForInstance(tenant.id, instanceId);
    if (result.status === "connected") {
      return NextResponse.json({ qrCodeBase64: null, status: "connected" });
    }
    return NextResponse.json({
      qrCodeBase64: result.qrCodeBase64,
      status: result.status,
    });
  } catch (err) {
    return mapErrorToResponse(err);
  }
}
