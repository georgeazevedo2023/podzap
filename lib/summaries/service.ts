/**
 * Read + write helpers around the `summaries` table.
 *
 * Reads (`listSummaries`, `getSummary`) back the `GET /api/summaries` and
 * `GET /api/summaries/[id]` routes. Writes (`approveSummary`,
 * `rejectSummary`, `updateSummaryText`) implement the Fase 8 human-
 * approval workflow and are called from the corresponding API route
 * handlers once the authenticated tenant has been resolved.
 *
 * All helpers use the service-role admin client on purpose: these run
 * from trusted server code (API routes, server components) that already
 * resolved the caller's tenant via `getCurrentUserAndTenant`. We still
 * double-filter every WHERE clause on `tenant_id = $1` (belt-and-
 * suspenders) so a bug in the route layer can never leak or mutate
 * another tenant's rows.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/types";

/** Row selection for the read views, including the `groups.name` join. */
const SUMMARY_SELECT_WITH_GROUP = `
  id,
  tenant_id,
  group_id,
  period_start,
  period_end,
  text,
  caption,
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
` as const;

/** Max text length we accept on `updateSummaryText`. The column is `text`
 *  (unbounded) but LLM prompts cap out well before 50k chars and the UI
 *  textarea realistically never gets close; rejecting anything larger
 *  early keeps DB + downstream TTS costs bounded. */
const MAX_SUMMARY_TEXT_LEN = 50_000;

/**
 * Narrow error class so route handlers can `instanceof` and map to HTTP
 * status codes. `cause` preserves the original exception for logging.
 */
export class SummariesError extends Error {
  constructor(
    public code:
      | "NOT_FOUND"
      | "INVALID_STATE"
      | "DB_ERROR"
      | "VALIDATION_ERROR",
    message: string,
    public cause?: unknown,
  ) {
    super(message);
    this.name = "SummariesError";
  }
}

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
  /**
   * Legenda curta emoji-rich (4-7 linhas) gerada junto com `text` desde
   * o prompt v6. Usada como caption do áudio no WhatsApp e como
   * preview-teaser na UI. `null` em rows antigas (pré-v6) — UI cai em
   * fallback pro `text[:200]`.
   */
  caption: string | null;
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
    caption: row.caption ?? null,
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
    .select(SUMMARY_SELECT_WITH_GROUP)
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
    .select(SUMMARY_SELECT_WITH_GROUP)
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

// ──────────────────────────────────────────────────────────────────────────
//  Write paths (Fase 8 — human approval)
// ──────────────────────────────────────────────────────────────────────────

/**
 * Refetch the updated row with the group-name join so callers always
 * receive a full `SummaryView` (consistent with the read helpers).
 * Throws `SummariesError('NOT_FOUND')` if the row disappears between
 * the update and this reload — shouldn't happen in practice but keeps
 * the return type non-nullable.
 */
async function reloadView(
  tenantId: string,
  summaryId: string,
): Promise<SummaryView> {
  const view = await getSummary(tenantId, summaryId);
  if (!view) {
    throw new SummariesError(
      "NOT_FOUND",
      `Summary ${summaryId} not found for tenant ${tenantId} after update`,
    );
  }
  return view;
}

/**
 * Read the raw `status` of a summary (tenant-scoped). Used by the write
 * helpers to guard the state-machine without pulling the whole
 * group-joined view. Returns `null` when the row doesn't exist or
 * belongs to another tenant.
 */
async function loadStatus(
  tenantId: string,
  summaryId: string,
): Promise<Database["public"]["Enums"]["summary_status"] | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("summaries")
    .select("status")
    .eq("tenant_id", tenantId)
    .eq("id", summaryId)
    .maybeSingle();

  if (error) {
    throw new SummariesError(
      "DB_ERROR",
      `Failed to load summary ${summaryId}: ${error.message}`,
      error,
    );
  }
  if (!data) return null;
  return (data as { status: Database["public"]["Enums"]["summary_status"] })
    .status;
}

/**
 * Transition a summary from `pending_review` → `approved`. Stamps
 * `approved_by` (the reviewer's user id) and `approved_at`. Throws
 * NOT_FOUND if the row is missing or cross-tenant, INVALID_STATE if it
 * has already been approved/rejected.
 */
export async function approveSummary(
  tenantId: string,
  summaryId: string,
  userId: string,
): Promise<SummaryView> {
  const current = await loadStatus(tenantId, summaryId);
  if (current === null) {
    throw new SummariesError(
      "NOT_FOUND",
      `Summary ${summaryId} not found for tenant ${tenantId}`,
    );
  }
  if (current !== "pending_review") {
    throw new SummariesError(
      "INVALID_STATE",
      `only pending_review can be approved; current state: ${current}`,
    );
  }

  const admin = createAdminClient();
  const nowIso = new Date().toISOString();
  const { error } = await admin
    .from("summaries")
    .update({
      status: "approved",
      approved_by: userId,
      approved_at: nowIso,
      updated_at: nowIso,
    })
    .eq("id", summaryId)
    .eq("tenant_id", tenantId);

  if (error) {
    throw new SummariesError(
      "DB_ERROR",
      `Failed to approve summary ${summaryId}: ${error.message}`,
      error,
    );
  }
  return reloadView(tenantId, summaryId);
}

/**
 * Transition a summary from `pending_review` → `rejected`. Requires a
 * non-blank `reason`; also records `approved_by` (who rejected) and
 * stamps `updated_at`. NOT_FOUND / INVALID_STATE semantics identical to
 * `approveSummary`; VALIDATION_ERROR for blank reason.
 */
export async function rejectSummary(
  tenantId: string,
  summaryId: string,
  userId: string,
  reason: string,
): Promise<SummaryView> {
  const trimmed = reason.trim();
  if (trimmed.length === 0) {
    throw new SummariesError(
      "VALIDATION_ERROR",
      "rejection reason is required",
    );
  }

  const current = await loadStatus(tenantId, summaryId);
  if (current === null) {
    throw new SummariesError(
      "NOT_FOUND",
      `Summary ${summaryId} not found for tenant ${tenantId}`,
    );
  }
  if (current !== "pending_review") {
    throw new SummariesError(
      "INVALID_STATE",
      `only pending_review can be rejected; current state: ${current}`,
    );
  }

  const admin = createAdminClient();
  const nowIso = new Date().toISOString();
  const { error } = await admin
    .from("summaries")
    .update({
      status: "rejected",
      rejected_reason: trimmed,
      approved_by: userId,
      updated_at: nowIso,
    })
    .eq("id", summaryId)
    .eq("tenant_id", tenantId);

  if (error) {
    throw new SummariesError(
      "DB_ERROR",
      `Failed to reject summary ${summaryId}: ${error.message}`,
      error,
    );
  }
  return reloadView(tenantId, summaryId);
}

/**
 * Save a manual edit to the summary text. Only allowed on
 * `pending_review` rows — once approved or rejected the text is
 * immutable so the approval decision keeps referring to a stable
 * artifact. Validates non-empty + `< 50_000` chars.
 */
export async function updateSummaryText(
  tenantId: string,
  summaryId: string,
  text: string,
): Promise<SummaryView> {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    throw new SummariesError(
      "VALIDATION_ERROR",
      "summary text cannot be empty",
    );
  }
  if (text.length >= MAX_SUMMARY_TEXT_LEN) {
    throw new SummariesError(
      "VALIDATION_ERROR",
      `summary text exceeds maximum length of ${MAX_SUMMARY_TEXT_LEN} characters`,
    );
  }

  const current = await loadStatus(tenantId, summaryId);
  if (current === null) {
    throw new SummariesError(
      "NOT_FOUND",
      `Summary ${summaryId} not found for tenant ${tenantId}`,
    );
  }
  if (current !== "pending_review") {
    throw new SummariesError(
      "INVALID_STATE",
      `only pending_review summaries can be edited; current state: ${current}`,
    );
  }

  const admin = createAdminClient();
  const nowIso = new Date().toISOString();
  const { error } = await admin
    .from("summaries")
    .update({
      text,
      updated_at: nowIso,
    })
    .eq("id", summaryId)
    .eq("tenant_id", tenantId);

  if (error) {
    throw new SummariesError(
      "DB_ERROR",
      `Failed to update summary ${summaryId} text: ${error.message}`,
      error,
    );
  }
  return reloadView(tenantId, summaryId);
}
