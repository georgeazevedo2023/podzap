/**
 * Admin tenants service — superadmin-only CRUD over the `tenants` table.
 *
 * Bypasses RLS via `createAdminClient()` (service role) on purpose: the
 * calling route is already gated by `requireSuperadmin()`, so RLS on the
 * admin path would only get in the way. We still tag each method narrowly
 * and keep DB writes surgical.
 *
 * Introduced in Fase 13 A2 together with `lib/admin/users.ts` and the
 * `/api/admin/*` route tree.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/types";

// ──────────────────────────────────────────────────────────────────────────
//  Public types
// ──────────────────────────────────────────────────────────────────────────

export type TenantAdminView = {
  id: string;
  name: string;
  plan: string;
  isActive: boolean;
  memberCount: number;
  hasInstance: boolean;
  createdAt: string;
  updatedAt: string;
};

/**
 * Narrow error class so API routes can `instanceof` and map to HTTP codes.
 * Reuses the same pattern as `GroupsError` / `SchedulesError`.
 *
 *   NOT_FOUND          → 404
 *   CONFLICT           → 409 (name conflict / FK already present)
 *   VALIDATION_ERROR   → 400
 *   DB_ERROR           → 500
 *   AUTH_ERROR         → 500 (supabase.auth.admin.* failure)
 */
export class AdminError extends Error {
  constructor(
    public code:
      | "NOT_FOUND"
      | "CONFLICT"
      | "VALIDATION_ERROR"
      | "DB_ERROR"
      | "AUTH_ERROR",
    message: string,
    public cause?: unknown,
  ) {
    super(message);
    this.name = "AdminError";
  }
}

// ──────────────────────────────────────────────────────────────────────────
//  Internals
// ──────────────────────────────────────────────────────────────────────────

type TenantRow = Database["public"]["Tables"]["tenants"]["Row"];

/**
 * Hydrate a bare tenants row into the admin view by pulling the member count
 * and instance presence in parallel. All three queries are tenant-scoped
 * (implicit via `.eq("tenant_id", row.id)`) so they stay fast.
 */
async function hydrate(row: TenantRow): Promise<TenantAdminView> {
  const supabase = createAdminClient();

  const [membersRes, instanceRes] = await Promise.all([
    supabase
      .from("tenant_members")
      .select("user_id", { count: "exact", head: true })
      .eq("tenant_id", row.id),
    supabase
      .from("whatsapp_instances")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", row.id),
  ]);

  if (membersRes.error) {
    throw new AdminError(
      "DB_ERROR",
      `Failed to count members for tenant ${row.id}: ${membersRes.error.message}`,
      membersRes.error,
    );
  }
  if (instanceRes.error) {
    throw new AdminError(
      "DB_ERROR",
      `Failed to probe instance for tenant ${row.id}: ${instanceRes.error.message}`,
      instanceRes.error,
    );
  }

  return {
    id: row.id,
    name: row.name,
    plan: row.plan,
    isActive: row.is_active,
    memberCount: membersRes.count ?? 0,
    hasInstance: (instanceRes.count ?? 0) > 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function validateName(name: unknown): string {
  if (typeof name !== "string") {
    throw new AdminError("VALIDATION_ERROR", "name must be a string");
  }
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    throw new AdminError("VALIDATION_ERROR", "name cannot be empty");
  }
  if (trimmed.length > 200) {
    throw new AdminError("VALIDATION_ERROR", "name is too long (>200 chars)");
  }
  return trimmed;
}

function validatePlan(plan: unknown): string {
  if (plan === undefined || plan === null) return "free";
  if (typeof plan !== "string") {
    throw new AdminError("VALIDATION_ERROR", "plan must be a string");
  }
  const trimmed = plan.trim();
  if (trimmed.length === 0) return "free";
  if (trimmed.length > 50) {
    throw new AdminError("VALIDATION_ERROR", "plan is too long (>50 chars)");
  }
  return trimmed;
}

// ──────────────────────────────────────────────────────────────────────────
//  Public API
// ──────────────────────────────────────────────────────────────────────────

/**
 * List every tenant in the system (superadmin-only). Each view includes a
 * member count and instance-presence flag so the admin UI can render a one-
 * row-per-tenant table without a second round trip.
 */
export async function listAllTenants(): Promise<TenantAdminView[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("tenants")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    throw new AdminError(
      "DB_ERROR",
      `Failed to list tenants: ${error.message}`,
      error,
    );
  }

  const rows = (data ?? []) as TenantRow[];
  const views = await Promise.all(rows.map((r) => hydrate(r)));
  return views;
}

/**
 * Read a single tenant by id, or `null` when missing. Same shape as the
 * list view (member count + has-instance included).
 */
export async function getTenantAdmin(
  id: string,
): Promise<TenantAdminView | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("tenants")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new AdminError(
      "DB_ERROR",
      `Failed to load tenant ${id}: ${error.message}`,
      error,
    );
  }
  if (!data) return null;
  return hydrate(data as TenantRow);
}

/**
 * Create a new tenant with no members and no instance. Name must be non-
 * empty; `plan` defaults to `'free'`. Returns the fully hydrated view so
 * the UI can immediately drop the new row into its table.
 */
export async function createTenant(input: {
  name: string;
  plan?: string;
}): Promise<TenantAdminView> {
  const name = validateName(input.name);
  const plan = validatePlan(input.plan);

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("tenants")
    .insert({ name, plan })
    .select("*")
    .maybeSingle();

  if (error) {
    throw new AdminError(
      "DB_ERROR",
      `Failed to create tenant: ${error.message}`,
      error,
    );
  }
  if (!data) {
    throw new AdminError(
      "DB_ERROR",
      "Insert returned no row — unexpected supabase behaviour.",
    );
  }
  return hydrate(data as TenantRow);
}

/**
 * Patch `name` and/or `plan` on an existing tenant. Silent no-op when the
 * patch is empty (still returns the current view). Throws NOT_FOUND when
 * the id doesn't exist.
 */
export async function updateTenant(
  id: string,
  patch: { name?: string; plan?: string },
): Promise<TenantAdminView> {
  const update: { name?: string; plan?: string } = {};
  if (patch.name !== undefined) update.name = validateName(patch.name);
  if (patch.plan !== undefined) update.plan = validatePlan(patch.plan);

  if (Object.keys(update).length === 0) {
    const current = await getTenantAdmin(id);
    if (!current) {
      throw new AdminError("NOT_FOUND", `Tenant ${id} not found`);
    }
    return current;
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("tenants")
    .update(update)
    .eq("id", id)
    .select("*")
    .maybeSingle();

  if (error) {
    throw new AdminError(
      "DB_ERROR",
      `Failed to update tenant ${id}: ${error.message}`,
      error,
    );
  }
  if (!data) {
    throw new AdminError("NOT_FOUND", `Tenant ${id} not found`);
  }
  return hydrate(data as TenantRow);
}

/** Flip `is_active=false` on the tenant. Non-destructive. */
export async function suspendTenant(id: string): Promise<TenantAdminView> {
  return setTenantActive(id, false);
}

/** Flip `is_active=true` on the tenant. Reverses `suspendTenant`. */
export async function activateTenant(id: string): Promise<TenantAdminView> {
  return setTenantActive(id, true);
}

async function setTenantActive(
  id: string,
  isActive: boolean,
): Promise<TenantAdminView> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("tenants")
    .update({ is_active: isActive })
    .eq("id", id)
    .select("*")
    .maybeSingle();

  if (error) {
    throw new AdminError(
      "DB_ERROR",
      `Failed to set is_active=${isActive} on tenant ${id}: ${error.message}`,
      error,
    );
  }
  if (!data) {
    throw new AdminError("NOT_FOUND", `Tenant ${id} not found`);
  }
  return hydrate(data as TenantRow);
}

/**
 * HARD delete — cascades via FK to tenant_members, whatsapp_instances,
 * groups, messages, summaries, audios, schedules, etc. Caller UI MUST
 * confirm with the superadmin; there is no soft-delete alternative here
 * (use `suspendTenant` for that).
 */
export async function deleteTenant(id: string): Promise<void> {
  const supabase = createAdminClient();

  // Verify first so we can throw NOT_FOUND explicitly rather than silently
  // no-op (supabase delete without a matching row returns data=null/err=null).
  const { data: existing, error: readErr } = await supabase
    .from("tenants")
    .select("id")
    .eq("id", id)
    .maybeSingle();

  if (readErr) {
    throw new AdminError(
      "DB_ERROR",
      `Failed to look up tenant ${id}: ${readErr.message}`,
      readErr,
    );
  }
  if (!existing) {
    throw new AdminError("NOT_FOUND", `Tenant ${id} not found`);
  }

  const { error } = await supabase.from("tenants").delete().eq("id", id);
  if (error) {
    throw new AdminError(
      "DB_ERROR",
      `Failed to delete tenant ${id}: ${error.message}`,
      error,
    );
  }
}
