/**
 * GET /api/audios[?limit=<n>]
 *
 * Lists audios generated for the current tenant, newest first. Query params:
 *   - `limit` — default 20, clamped to [1, 100] by the service layer.
 *
 * Reply: `200 { audios: AudioView[] }`
 *
 * All rows are scoped to the caller's tenant via the service helper — this
 * route never touches other tenants' data even though it goes through the
 * admin (service-role) client.
 */

import { NextResponse } from "next/server";

import { listAudios } from "@/lib/audios/service";
import {
  errorResponse,
  mapErrorToResponse,
  requireAuth,
} from "../whatsapp/_shared";

export async function GET(req: Request) {
  const auth = await requireAuth();
  if ("response" in auth) return auth.response;
  const { tenant } = auth;

  const url = new URL(req.url);
  const limitParam = url.searchParams.get("limit");

  const opts: { limit?: number } = {};

  if (limitParam) {
    const parsed = Number.parseInt(limitParam, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return errorResponse(
        400,
        "VALIDATION_ERROR",
        "`limit` must be a positive integer.",
      );
    }
    opts.limit = parsed;
  }

  try {
    const audios = await listAudios(tenant.id, opts);
    return NextResponse.json({ audios });
  } catch (err) {
    return mapErrorToResponse(err);
  }
}
