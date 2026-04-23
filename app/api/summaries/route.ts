/**
 * GET /api/summaries[?groupId=<uuid>&status=<summary_status>&limit=<n>]
 *
 * Lists summaries for the current tenant, newest first. Query params:
 *   - `groupId` — restrict to a single group (must be a UUID string)
 *   - `status`  — `pending_review | approved | rejected`
 *   - `limit`   — default 20, clamped to [1, 100]
 *
 * Reply: `200 { summaries: SummaryView[] }`
 *
 * All rows are scoped to the caller's tenant via the service helper —
 * this route never touches other tenants' data even though it goes
 * through the admin (service-role) client.
 */

import { NextResponse } from "next/server";

import { listSummaries } from "@/lib/summaries/service";
import {
  errorResponse,
  mapErrorToResponse,
  requireAuth,
} from "../whatsapp/_shared";

const VALID_STATUSES = ["pending_review", "approved", "rejected"] as const;

export async function GET(req: Request) {
  const auth = await requireAuth();
  if ("response" in auth) return auth.response;
  const { tenant } = auth;

  const url = new URL(req.url);
  const groupIdParam = url.searchParams.get("groupId");
  const statusParam = url.searchParams.get("status");
  const limitParam = url.searchParams.get("limit");

  const opts: { groupId?: string; status?: string; limit?: number } = {};

  if (groupIdParam) {
    // Best-effort UUID sanity check — the service still runs with the raw
    // value if this passes, but we surface an obviously malformed input
    // as a 400 rather than letting Postgres reject it at query time.
    if (!/^[0-9a-f-]{36}$/i.test(groupIdParam)) {
      return errorResponse(
        400,
        "VALIDATION_ERROR",
        "`groupId` must be a UUID.",
      );
    }
    opts.groupId = groupIdParam;
  }

  if (statusParam) {
    if (!(VALID_STATUSES as readonly string[]).includes(statusParam)) {
      return errorResponse(
        400,
        "VALIDATION_ERROR",
        `\`status\` must be one of ${VALID_STATUSES.join(", ")}.`,
      );
    }
    opts.status = statusParam;
  }

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
    const summaries = await listSummaries(tenant.id, opts);
    return NextResponse.json({ summaries });
  } catch (err) {
    return mapErrorToResponse(err);
  }
}
