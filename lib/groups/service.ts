/**
 * Groups service layer — wraps the UAZAPI group listing with multi-tenant
 * Supabase persistence. This is the single contract used by API routes and
 * Next.js server components in Fase 3 (groups sync + monitor toggle).
 *
 * Responsibilities:
 *   - List / read / sync / toggle monitored-status on `groups` rows scoped to
 *     a tenant (tenant_id check is always enforced in the WHERE clause even
 *     when using the service-role admin client).
 *   - Pull the tenant's latest connected WhatsApp instance, decrypt its
 *     UAZAPI token (`lib/crypto`), call `UazapiClient.listGroups`, and upsert
 *     each group by `(tenant_id, uazapi_group_jid)` while PRESERVING the
 *     user-set `is_monitored` flag (so a re-sync never flips toggles off).
 *   - Surface all failures via a typed `GroupsError` so route handlers can
 *     branch cleanly (404 / 409 / 500).
 *
 * Uses the service-role admin client on purpose: these helpers run from
 * trusted server code (API routes, server components) that already resolved
 * the authenticated tenant via `getCurrentUserAndTenant`. Bypassing RLS here
 * lets us still select/update rows that the caller owns while keeping a
 * mandatory `tenant_id = $1` filter everywhere below — belt-and-suspenders.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { decrypt, CryptoError } from "@/lib/crypto";
import { UazapiClient } from "@/lib/uazapi/client";
import type { Database } from "@/lib/supabase/types";
import type { Group } from "@/lib/uazapi/types";

// ──────────────────────────────────────────────────────────────────────────
//  Public types
// ──────────────────────────────────────────────────────────────────────────

export type GroupView = {
  id: string;
  tenantId: string;
  instanceId: string;
  uazapiGroupJid: string;
  name: string;
  pictureUrl: string | null;
  isMonitored: boolean;
  memberCount: number | null;
  lastSyncedAt: string | null;
  createdAt: string;
};

/**
 * Narrow error class so route handlers can `instanceof` and map to HTTP
 * status codes. `cause` preserves the original exception for logging.
 */
export class GroupsError extends Error {
  constructor(
    public code: "NO_INSTANCE" | "NOT_FOUND" | "UAZAPI_ERROR" | "DB_ERROR",
    message: string,
    public cause?: unknown,
  ) {
    super(message);
    this.name = "GroupsError";
  }
}

// ──────────────────────────────────────────────────────────────────────────
//  Internals
// ──────────────────────────────────────────────────────────────────────────

type GroupRow = Database["public"]["Tables"]["groups"]["Row"];
type InstanceRow = Database["public"]["Tables"]["whatsapp_instances"]["Row"];

/** Hydrate a DB row into the view returned to callers. */
function toView(row: GroupRow): GroupView {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    instanceId: row.instance_id,
    uazapiGroupJid: row.uazapi_group_jid,
    name: row.name,
    pictureUrl: row.picture_url ?? null,
    isMonitored: row.is_monitored,
    memberCount: row.member_count ?? null,
    lastSyncedAt: row.last_synced_at ?? null,
    createdAt: row.created_at,
  };
}

/**
 * Resolve the UAZAPI client at call time (not module load) so tests can
 * stub it via `vi.mock` and so env-missing errors surface at the first
 * actual call rather than at import.
 */
function getUazapiClient(): UazapiClient {
  const baseUrl = process.env.UAZAPI_BASE_URL ?? "https://wsmart.uazapi.com";
  const adminToken = process.env.UAZAPI_ADMIN_TOKEN ?? "";
  return new UazapiClient(baseUrl, adminToken);
}

/**
 * Load the tenant's most-recently-created WhatsApp instance. Returns null if
 * the tenant has never connected. Callers must branch on `status` themselves.
 */
async function loadLatestInstance(
  tenantId: string,
): Promise<InstanceRow | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("whatsapp_instances")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) {
    throw new GroupsError(
      "DB_ERROR",
      `Failed to query whatsapp_instances: ${error.message}`,
      error,
    );
  }
  const row = (data?.[0] ?? null) as InstanceRow | null;
  return row;
}

function decryptInstanceToken(row: InstanceRow): string {
  const cipher = row.uazapi_token_encrypted;
  if (!cipher) {
    throw new GroupsError(
      "NO_INSTANCE",
      `Instance ${row.id} has no token stored (possibly disconnected).`,
    );
  }
  try {
    return decrypt(cipher);
  } catch (err) {
    if (err instanceof CryptoError) {
      throw new GroupsError(
        "NO_INSTANCE",
        `Failed to decrypt instance token: ${err.message}`,
        err,
      );
    }
    throw err;
  }
}

// ──────────────────────────────────────────────────────────────────────────
//  Public API
// ──────────────────────────────────────────────────────────────────────────

/**
 * Return every group this tenant has synced, ordered with monitored rows
 * first then alphabetically by name. Supports optional `monitoredOnly` and
 * `search` (case-insensitive substring on `name`). Never throws NOT_FOUND —
 * an empty array is a valid answer for a tenant that hasn't synced yet.
 */
export type ListGroupsResult = {
  rows: GroupView[];
  total: number;
  page: number;
  pageSize: number;
};

/**
 * Return a paginated slice of this tenant's groups. Filters out rows with
 * empty `name` by default (UAZAPI returns ~20% of rows as zombie groups
 * the user was added to but never opened).
 *
 * Always returns server-paginated data — do NOT load everything and slice
 * client-side. Tenants with 1000+ groups will otherwise stall the browser.
 */
export async function listGroups(
  tenantId: string,
  opts?: {
    monitoredOnly?: boolean;
    search?: string;
    page?: number;      // 0-indexed
    pageSize?: number;  // default 20, max 100
    includeUnnamed?: boolean; // default false
  },
): Promise<ListGroupsResult> {
  const supabase = createAdminClient();
  const page = Math.max(0, opts?.page ?? 0);
  const pageSize = Math.min(100, Math.max(1, opts?.pageSize ?? 20));
  const from = page * pageSize;
  const to = from + pageSize - 1;

  let query = supabase
    .from("groups")
    .select("*", { count: "exact" })
    .eq("tenant_id", tenantId);

  // Exclude empty-name zombies by default — they pollute the list and have
  // no useful identity to show.
  if (!opts?.includeUnnamed) {
    query = query.neq("name", "");
  }

  if (opts?.monitoredOnly) {
    query = query.eq("is_monitored", true);
  }
  if (opts?.search && opts.search.trim().length > 0) {
    const q = opts.search.trim();
    query = query.ilike("name", `%${q}%`);
  }

  const { data, error, count } = await query
    .order("is_monitored", { ascending: false })
    .order("name", { ascending: true, nullsFirst: false })
    .range(from, to);

  if (error) {
    throw new GroupsError(
      "DB_ERROR",
      `Failed to list groups: ${error.message}`,
      error,
    );
  }
  const rows = (data ?? []) as GroupRow[];
  return {
    rows: rows.map(toView),
    total: count ?? rows.length,
    page,
    pageSize,
  };
}

/**
 * Single-group read scoped to the tenant. Returns null when not found or
 * belongs to a different tenant (we never leak existence across tenants).
 */
export async function getGroup(
  tenantId: string,
  groupId: string,
): Promise<GroupView | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("groups")
    .select("*")
    .eq("id", groupId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (error) {
    throw new GroupsError(
      "DB_ERROR",
      `Failed to load group: ${error.message}`,
      error,
    );
  }
  if (!data) return null;
  return toView(data as GroupRow);
}

/**
 * Pull the canonical group list from UAZAPI and upsert into our `groups`
 * table.
 *
 * Semantics:
 *   - Requires a `connected` WhatsApp instance for the tenant — otherwise
 *     throws `NO_INSTANCE` (caller should redirect to onboarding).
 *   - For every group returned by UAZAPI, we upsert on
 *     `(tenant_id, uazapi_group_jid)`:
 *       * INSERT new groups with `is_monitored=false` (the default).
 *       * UPDATE existing rows' `name`, `picture_url`, `member_count`,
 *         `last_synced_at`. We deliberately do NOT touch `is_monitored`
 *         so a re-sync never silently flips user-set toggles off.
 *   - Groups that have disappeared upstream are left in place (soft-forget).
 *     Fase 3 plan: UI can indicate "not found in last sync" later; deleting
 *     here would cascade away `messages` which we don't want.
 *   - Returns `{ synced, total }` — `synced` is the count actually written
 *     in this call, `total` is the row count for the tenant afterwards.
 */
export async function syncGroups(
  tenantId: string,
): Promise<{ synced: number; total: number }> {
  const instance = await loadLatestInstance(tenantId);
  if (!instance) {
    throw new GroupsError(
      "NO_INSTANCE",
      `Tenant ${tenantId} has no WhatsApp instance. Connect one first.`,
    );
  }
  if (instance.status !== "connected") {
    throw new GroupsError(
      "NO_INSTANCE",
      `Tenant ${tenantId}'s instance is not connected (status=${instance.status}).`,
    );
  }

  const token = decryptInstanceToken(instance);
  const client = getUazapiClient();

  let groups: Group[];
  try {
    groups = await client.listGroups(token);
  } catch (err) {
    throw new GroupsError(
      "UAZAPI_ERROR",
      `UAZAPI listGroups failed: ${(err as Error).message}`,
      err,
    );
  }

  const supabase = createAdminClient();
  const nowIso = new Date().toISOString();

  // Pre-load existing rows for this tenant keyed by JID so we can:
  //   a) decide insert vs update
  //   b) preserve `is_monitored` on update (never regress)
  const { data: existingData, error: existingErr } = await supabase
    .from("groups")
    .select("id,uazapi_group_jid,is_monitored")
    .eq("tenant_id", tenantId);
  if (existingErr) {
    throw new GroupsError(
      "DB_ERROR",
      `Failed to pre-load existing groups: ${existingErr.message}`,
      existingErr,
    );
  }
  const existingByJid = new Map<
    string,
    { id: string; is_monitored: boolean }
  >();
  for (const r of (existingData ?? []) as Array<
    Pick<GroupRow, "id" | "uazapi_group_jid" | "is_monitored">
  >) {
    existingByJid.set(r.uazapi_group_jid, {
      id: r.id,
      is_monitored: r.is_monitored,
    });
  }

  let synced = 0;
  for (const g of groups) {
    const existing = existingByJid.get(g.jid);
    const name = g.name ?? g.jid;
    const pictureUrl = g.pictureUrl ?? null;
    const memberCount =
      typeof g.size === "number"
        ? g.size
        : Array.isArray(g.participants)
          ? g.participants.length
          : null;

    if (existing) {
      const { error: upErr } = await supabase
        .from("groups")
        .update({
          name,
          picture_url: pictureUrl,
          member_count: memberCount,
          last_synced_at: nowIso,
          // intentionally NOT touching is_monitored
        })
        .eq("id", existing.id)
        .eq("tenant_id", tenantId);
      if (upErr) {
        throw new GroupsError(
          "DB_ERROR",
          `Failed to update group ${g.jid}: ${upErr.message}`,
          upErr,
        );
      }
    } else {
      const { error: insErr } = await supabase.from("groups").insert({
        tenant_id: tenantId,
        instance_id: instance.id,
        uazapi_group_jid: g.jid,
        name,
        picture_url: pictureUrl,
        member_count: memberCount,
        last_synced_at: nowIso,
        is_monitored: false,
      });
      if (insErr) {
        throw new GroupsError(
          "DB_ERROR",
          `Failed to insert group ${g.jid}: ${insErr.message}`,
          insErr,
        );
      }
    }
    synced += 1;
  }

  // Post-sync total for this tenant.
  const { data: allRows, error: totalErr } = await supabase
    .from("groups")
    .select("id")
    .eq("tenant_id", tenantId);
  if (totalErr) {
    throw new GroupsError(
      "DB_ERROR",
      `Failed to count groups after sync: ${totalErr.message}`,
      totalErr,
    );
  }
  const total = (allRows ?? []).length;

  return { synced, total };
}

/**
 * Flip a group's `is_monitored` flag. Tenant-scoped; throws NOT_FOUND if the
 * row doesn't exist OR belongs to another tenant (same externally-visible
 * shape so we never leak cross-tenant existence).
 */
export async function toggleMonitor(
  tenantId: string,
  groupId: string,
  on: boolean,
): Promise<GroupView> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("groups")
    .update({ is_monitored: on })
    .eq("id", groupId)
    .eq("tenant_id", tenantId)
    .select("*")
    .maybeSingle();

  if (error) {
    throw new GroupsError(
      "DB_ERROR",
      `Failed to toggle monitor on group ${groupId}: ${error.message}`,
      error,
    );
  }
  if (!data) {
    throw new GroupsError(
      "NOT_FOUND",
      `Group ${groupId} not found for tenant ${tenantId}`,
    );
  }
  return toView(data as GroupRow);
}
