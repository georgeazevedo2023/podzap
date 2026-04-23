/**
 * GET /api/groups[?monitoredOnly=true&search=foo]
 *
 * Returns the current tenant's groups. Supports optional filters:
 *   - `monitoredOnly=true` — only groups flagged `is_monitored`
 *   - `search=<text>`      — substring match on group name (case-insensitive,
 *                            service-layer concern)
 *
 * Reply: `200 { groups: GroupView[] }`
 */

import { NextResponse } from "next/server";
import { listGroups } from "@/lib/groups/service";
import {
  mapErrorToResponse,
  requireAuth,
} from "../whatsapp/_shared";

export async function GET(req: Request) {
  const auth = await requireAuth();
  if ("response" in auth) return auth.response;
  const { tenant } = auth;

  const url = new URL(req.url);
  const monitoredOnlyParam = url.searchParams.get("monitoredOnly");
  const searchParam = url.searchParams.get("search");

  const opts: { monitoredOnly?: boolean; search?: string } = {};
  if (monitoredOnlyParam === "true") opts.monitoredOnly = true;
  if (searchParam && searchParam.trim().length > 0) {
    opts.search = searchParam.trim();
  }

  try {
    const groups = await listGroups(tenant.id, opts);
    return NextResponse.json({ groups });
  } catch (err) {
    return mapErrorToResponse(err);
  }
}
