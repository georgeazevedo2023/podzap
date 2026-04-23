/**
 * POST /api/groups/sync
 *
 * Pulls the current tenant's groups from UAZAPI and upserts them into the
 * `groups` table. Body is ignored.
 *
 * Reply: `200 { synced: number; total: number }`
 *
 * Rate limited: 6 req/min per tenant. Syncs hit UAZAPI and write to the DB,
 * so we cap this tighter than read endpoints. `GroupsError('NO_INSTANCE')`
 * surfaces as HTTP 409 via `mapErrorToResponse`.
 */

import { NextResponse } from "next/server";
import { syncGroups } from "@/lib/groups/service";
import {
  applyRateLimit,
  mapErrorToResponse,
  requireAuth,
} from "../../whatsapp/_shared";

const RATE_LIMIT_MAX = 6;
const RATE_LIMIT_WINDOW_MS = 60_000;

export async function POST() {
  const auth = await requireAuth();
  if ("response" in auth) return auth.response;
  const { tenant } = auth;

  const limited = applyRateLimit(
    tenant.id,
    "groups-sync",
    RATE_LIMIT_MAX,
    RATE_LIMIT_WINDOW_MS,
  );
  if (limited) return limited;

  try {
    const result = await syncGroups(tenant.id);
    return NextResponse.json(result);
  } catch (err) {
    return mapErrorToResponse(err);
  }
}
