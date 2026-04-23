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
  const pageParam = Number.parseInt(url.searchParams.get("page") ?? "0", 10);
  const pageSizeParam = Number.parseInt(url.searchParams.get("pageSize") ?? "20", 10);

  const opts: { monitoredOnly?: boolean; search?: string; page: number; pageSize: number } = {
    page: Number.isFinite(pageParam) ? Math.max(0, pageParam) : 0,
    pageSize: Number.isFinite(pageSizeParam) ? Math.min(100, Math.max(1, pageSizeParam)) : 20,
  };
  if (monitoredOnlyParam === "true") opts.monitoredOnly = true;
  if (searchParam && searchParam.trim().length > 0) {
    opts.search = searchParam.trim();
  }

  try {
    const result = await listGroups(tenant.id, opts);
    return NextResponse.json({
      groups: result.rows,
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
    });
  } catch (err) {
    return mapErrorToResponse(err);
  }
}
