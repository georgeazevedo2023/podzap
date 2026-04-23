/**
 * Thin read helpers around the `summaries` table.
 *
 * These are the only SQL queries shared by `GET /api/summaries` and
 * `GET /api/summaries/[id]`. Keeping them in one place so the row→view
 * mapping (snake_case → camelCase, null normalisation, group-name join)
 * lives in one spot instead of being duplicated per route.
 *
 * No writes live here. Write paths (generation, approval) go through
 * `lib/summary/generator.ts` and (Fase 8) an approval service — both are
 * orchestrated from Inngest handlers, not from HTTP routes, to keep the
 * cost tracking and RLS bypass concerns co-located.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/types";

type SummaryTone = Database["public"]["Enums"]["summary_tone"];
type SummaryStatus = Database["public"]["Enums"]["summary_status"];

export type SummaryView = {
  id: string;
  tenantId: string;
  groupId: string;
  groupName: string | null;
  periodStart: string;
  periodEnd: string;
  text: string;
  tone: SummaryTone;
  status: SummaryStatus;
  model: string | null;
  promptVersion: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  rejectedReason: string | null;
  createdAt: string;
  updatedAt: string | null;
};

export interface ListSummariesOptions {
  groupId?: string;
  status?: string;
  limit?: number;
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/** Known status values — used to reject unknown `?status=` values defensively. */
const VALID_STATUSES: readonly SummaryStatus[] = [
  "pending_review",
  "approved",
  "rejected",
] as const;

function isValidStatus(value: string): value is SummaryStatus {
  return (VALID_STATUSES as readonly string[]).includes(value);
}

type SummaryRow = Database["public"]["Tables"]["summaries"]["Row"] & {
  groups: { name: string | null } | { name: string | null }[] | null;
};

function rowToView(row: SummaryRow): SummaryView {
  const group = Array.isArray(row.groups) ? row.groups[0] : row.groups;
  return {
    id: row.id,
    tenantId: row.tenant_id,
    groupId: row.group_id,
    groupName: group?.name ?? null,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    text: row.text,
    tone: row.tone,
    status: row.status,
    model: row.model ?? null,
    promptVersion: row.prompt_version ?? null,
    approvedBy: row.approved_by ?? null,
    approvedAt: row.approved_at ?? null,
    rejectedReason: row.rejected_reason ?? null,
    createdAt: row.created_at,
    // `summaries.updated_at` is non-null in the schema, but we expose it as
    // nullable in the view because the type is documented that way and it
    // lets consumers treat "never modified" distinctly if the schema ever
    // relaxes the NOT NULL constraint.
    updatedAt: row.updated_at ?? null,
  };
}

/**
 * List summaries for a tenant, newest first.
 *
 * `limit` is clamped to [1, 100]; default 20. `status` is ignored if the
 * value isn't a recognised `summary_status` (route validation catches it
 * earlier, but the redundant check here prevents the DB from returning
 * zero rows silently on a typo).
 */
export async function listSummaries(
  tenantId: string,
  opts: ListSummariesOptions = {},
): Promise<SummaryView[]> {
  const admin = createAdminClient();
  const limit = Math.max(
    1,
    Math.min(MAX_LIMIT, opts.limit ?? DEFAULT_LIMIT),
  );

  let query = admin
    .from("summaries")
    .select(
      `
      id,
      tenant_id,
      group_id,
      period_start,
      period_end,
      text,
      tone,
      status,
      model,
      prompt_version,
      approved_by,
      approved_at,
      rejected_reason,
      created_at,
      updated_at,
      groups:group_id ( name )
      `,
    )
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (opts.groupId) {
    query = query.eq("group_id", opts.groupId);
  }
  if (opts.status && isValidStatus(opts.status)) {
    query = query.eq("status", opts.status);
  }

  const { data, error } = await query;
  if (error) {
    throw Object.assign(new Error(error.message), {
      code: "DB_ERROR",
      details: error,
    });
  }

  return (data ?? []).map((row) => rowToView(row as SummaryRow));
}

/**
 * Fetch a single summary by id, scoped to `tenantId`. Returns `null` when
 * the row doesn't exist or belongs to a different tenant — callers map
 * `null` to HTTP 404.
 */
export async function getSummary(
  tenantId: string,
  summaryId: string,
): Promise<SummaryView | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("summaries")
    .select(
      `
      id,
      tenant_id,
      group_id,
      period_start,
      period_end,
      text,
      tone,
      status,
      model,
      prompt_version,
      approved_by,
      approved_at,
      rejected_reason,
      created_at,
      updated_at,
      groups:group_id ( name )
      `,
    )
    .eq("tenant_id", tenantId)
    .eq("id", summaryId)
    .maybeSingle();

  if (error) {
    throw Object.assign(new Error(error.message), {
      code: "DB_ERROR",
      details: error,
    });
  }
  if (!data) return null;
  return rowToView(data as SummaryRow);
}
