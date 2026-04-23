/**
 * GET /api/whatsapp/status[?instanceId=...]
 *
 * Refresh (and return) the connection status for the current tenant's
 * WhatsApp instance.
 *
 *   - `?instanceId=<uuid>` — refresh that specific instance.
 *   - no param             — return the tenant's current instance or
 *                            `{ instance: null }`.
 *
 * Rate limited: 30 req/min per tenant. The polling UI calls this every ~2s,
 * so this caps a single browser tab at ~1 req/2s and forbids multiple tabs
 * from hammering UAZAPI.
 */

import { NextResponse } from "next/server";
import {
  getCurrentInstance,
  refreshInstanceStatus,
} from "@/lib/whatsapp/service";
import {
  applyRateLimit,
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
    "status",
    RATE_LIMIT_MAX,
    RATE_LIMIT_WINDOW_MS,
  );
  if (limited) return limited;

  const url = new URL(req.url);
  const instanceId = url.searchParams.get("instanceId");

  try {
    if (instanceId) {
      const instance = await refreshInstanceStatus(tenant.id, instanceId);
      return NextResponse.json({ instance });
    }
    const instance = await getCurrentInstance(tenant.id);
    return NextResponse.json({ instance });
  } catch (err) {
    return mapErrorToResponse(err);
  }
}
