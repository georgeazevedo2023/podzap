/**
 * Admin users service — superadmin-only CRUD over auth users + their
 * tenant memberships + the `superadmins` flag.
 *
 * Uses `supabase.auth.admin.*` for the auth side (requires service role
 * key), and the plain admin client for `tenant_members` / `superadmins`.
 *
 * `createUser` is not wrapped in a DB transaction (Supabase JS doesn't
 * expose one). We get transactional *feel* via manual rollback: if the
 * membership / superadmin insert fails after we've already created the
 * auth user, we delete the auth user back out so the caller is left in a
 * clean state. See `createUser` for the full sequence.
 *
 * Introduced in Fase 13 A2 together with `lib/admin/tenants.ts`.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { AdminError } from "@/lib/admin/tenants";
import type { Database } from "@/lib/supabase/types";

// ──────────────────────────────────────────────────────────────────────────
//  Public types
// ──────────────────────────────────────────────────────────────────────────

export type UserTenantLink = {
  tenantId: string;
  tenantName: string;
  role: "owner" | "admin" | "member";
  joinedAt: string;
};

export type UserAdminView = {
  id: string;
  email: string;
  createdAt: string;
  lastSignInAt: string | null;
  isSuperadmin: boolean;
  tenants: UserTenantLink[];
};

// Re-export so callers can import both error classes from either module.
export { AdminError } from "@/lib/admin/tenants";

// ──────────────────────────────────────────────────────────────────────────
//  Internal types / helpers
// ──────────────────────────────────────────────────────────────────────────

type Role = "owner" | "admin" | "member";
type MemberRow = Database["public"]["Tables"]["tenant_members"]["Row"];
type TenantRow = Database["public"]["Tables"]["tenants"]["Row"];

type AuthUser = {
  id: string;
  email?: string | null;
  created_at?: string;
  last_sign_in_at?: string | null;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateEmail(email: unknown): string {
  if (typeof email !== "string") {
    throw new AdminError("VALIDATION_ERROR", "email must be a string");
  }
  const trimmed = email.trim().toLowerCase();
  if (!EMAIL_RE.test(trimmed)) {
    throw new AdminError("VALIDATION_ERROR", `email is not valid: ${email}`);
  }
  return trimmed;
}

function validatePassword(password: unknown, min = 8): string {
  if (typeof password !== "string") {
    throw new AdminError("VALIDATION_ERROR", "password must be a string");
  }
  if (password.length < min) {
    throw new AdminError(
      "VALIDATION_ERROR",
      `password must be at least ${min} characters`,
    );
  }
  return password;
}

function validateRole(role: unknown): Role {
  if (role === undefined || role === null) return "member";
  if (role !== "owner" && role !== "admin" && role !== "member") {
    throw new AdminError(
      "VALIDATION_ERROR",
      `role must be owner|admin|member (got ${String(role)})`,
    );
  }
  return role;
}

/**
 * Pull the full tenant membership + superadmin maps in one shot and index by
 * user_id so we can hydrate N users without N round trips. Used by both
 * list and single-user reads.
 */
async function loadMembershipIndex(): Promise<{
  membersByUser: Map<string, UserTenantLink[]>;
  superSet: Set<string>;
}> {
  const supabase = createAdminClient();

  const [membersRes, tenantsRes, superRes] = await Promise.all([
    supabase.from("tenant_members").select("*"),
    supabase.from("tenants").select("id,name"),
    supabase.from("superadmins").select("user_id"),
  ]);

  if (membersRes.error) {
    throw new AdminError(
      "DB_ERROR",
      `Failed to load tenant_members: ${membersRes.error.message}`,
      membersRes.error,
    );
  }
  if (tenantsRes.error) {
    throw new AdminError(
      "DB_ERROR",
      `Failed to load tenants: ${tenantsRes.error.message}`,
      tenantsRes.error,
    );
  }
  if (superRes.error) {
    throw new AdminError(
      "DB_ERROR",
      `Failed to load superadmins: ${superRes.error.message}`,
      superRes.error,
    );
  }

  const tenantNames = new Map<string, string>();
  for (const t of (tenantsRes.data ?? []) as Pick<TenantRow, "id" | "name">[]) {
    tenantNames.set(t.id, t.name);
  }

  const membersByUser = new Map<string, UserTenantLink[]>();
  for (const m of (membersRes.data ?? []) as MemberRow[]) {
    const bucket = membersByUser.get(m.user_id) ?? [];
    bucket.push({
      tenantId: m.tenant_id,
      tenantName: tenantNames.get(m.tenant_id) ?? "(unknown)",
      role: m.role,
      joinedAt: m.joined_at,
    });
    membersByUser.set(m.user_id, bucket);
  }

  const superSet = new Set<string>();
  for (const s of (superRes.data ?? []) as { user_id: string }[]) {
    superSet.add(s.user_id);
  }

  return { membersByUser, superSet };
}

function toView(
  u: AuthUser,
  membersByUser: Map<string, UserTenantLink[]>,
  superSet: Set<string>,
): UserAdminView {
  return {
    id: u.id,
    email: u.email ?? "",
    createdAt: u.created_at ?? new Date(0).toISOString(),
    lastSignInAt: u.last_sign_in_at ?? null,
    isSuperadmin: superSet.has(u.id),
    tenants: (membersByUser.get(u.id) ?? []).slice().sort((a, b) =>
      a.tenantName.localeCompare(b.tenantName),
    ),
  };
}

async function listAuthUsers(): Promise<AuthUser[]> {
  const supabase = createAdminClient();
  // `supabase.auth.admin.listUsers()` paginates at 50 by default. We fetch
  // page 1 with a larger perPage and trust callers to bump this later if a
  // customer grows past a few hundred users.
  const { data, error } = await supabase.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });
  if (error) {
    throw new AdminError(
      "AUTH_ERROR",
      `Failed to list auth users: ${error.message}`,
      error,
    );
  }
  const users = (data?.users ?? []) as AuthUser[];
  return users;
}

async function getAuthUser(id: string): Promise<AuthUser | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase.auth.admin.getUserById(id);
  if (error) {
    // 404 from GoTrue surfaces as AuthApiError — treat as null rather than
    // throwing, so the API route can return 404 cleanly.
    const msg = (error as { message?: string }).message?.toLowerCase() ?? "";
    if (msg.includes("not found") || msg.includes("user not found")) {
      return null;
    }
    throw new AdminError(
      "AUTH_ERROR",
      `Failed to load user ${id}: ${error.message}`,
      error,
    );
  }
  if (!data?.user) return null;
  return data.user as AuthUser;
}

async function hydrateSingleUser(
  id: string,
): Promise<UserAdminView | null> {
  const u = await getAuthUser(id);
  if (!u) return null;
  const { membersByUser, superSet } = await loadMembershipIndex();
  return toView(u, membersByUser, superSet);
}

// ──────────────────────────────────────────────────────────────────────────
//  Public API
// ──────────────────────────────────────────────────────────────────────────

/**
 * Return every user the auth service knows about, enriched with their
 * tenant memberships (role + joined_at) and superadmin flag. Sorted by
 * email alphabetically for predictable UI rendering.
 */
export async function listAllUsers(): Promise<UserAdminView[]> {
  const [users, indexes] = await Promise.all([
    listAuthUsers(),
    loadMembershipIndex(),
  ]);
  const views = users.map((u) => toView(u, indexes.membersByUser, indexes.superSet));
  views.sort((a, b) => a.email.localeCompare(b.email));
  return views;
}

/**
 * Single-user read. Returns null when the id doesn't exist in
 * `auth.users`.
 */
export async function getUserAdmin(id: string): Promise<UserAdminView | null> {
  return hydrateSingleUser(id);
}

/**
 * Create a new user with a password, attach them to a tenant with the
 * given role, and optionally grant superadmin. Any failure after the
 * auth-user creation rolls that creation back (best-effort `auth.admin
 * .deleteUser`) so the caller is not left with a ghost account.
 */
export async function createUser(input: {
  email: string;
  password: string;
  tenantId: string;
  role?: Role;
  isSuperadmin?: boolean;
}): Promise<UserAdminView> {
  const email = validateEmail(input.email);
  const password = validatePassword(input.password, 8);
  const role = validateRole(input.role);
  if (typeof input.tenantId !== "string" || input.tenantId.length === 0) {
    throw new AdminError("VALIDATION_ERROR", "tenantId is required");
  }

  const supabase = createAdminClient();

  // Verify tenant exists up-front so we fail BEFORE creating the auth user.
  const { data: tenant, error: tenantErr } = await supabase
    .from("tenants")
    .select("id")
    .eq("id", input.tenantId)
    .maybeSingle();
  if (tenantErr) {
    throw new AdminError(
      "DB_ERROR",
      `Failed to look up tenant ${input.tenantId}: ${tenantErr.message}`,
      tenantErr,
    );
  }
  if (!tenant) {
    throw new AdminError(
      "NOT_FOUND",
      `Tenant ${input.tenantId} not found`,
    );
  }

  // Step 1: auth user
  const { data: authData, error: authErr } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (authErr || !authData?.user) {
    throw new AdminError(
      "AUTH_ERROR",
      `Failed to create auth user: ${authErr?.message ?? "unknown error"}`,
      authErr ?? undefined,
    );
  }
  const userId = authData.user.id;

  // Step 2: tenant membership — rollback on failure
  const { error: memberErr } = await supabase.from("tenant_members").insert({
    tenant_id: input.tenantId,
    user_id: userId,
    role,
  });
  if (memberErr) {
    await rollbackAuthUser(userId);
    throw new AdminError(
      "DB_ERROR",
      `Failed to insert tenant_members: ${memberErr.message}`,
      memberErr,
    );
  }

  // Step 3: superadmin (optional) — rollback on failure
  if (input.isSuperadmin === true) {
    const { error: saErr } = await supabase.from("superadmins").insert({
      user_id: userId,
    });
    if (saErr) {
      // Best-effort rollback: delete membership + auth user.
      await supabase
        .from("tenant_members")
        .delete()
        .eq("tenant_id", input.tenantId)
        .eq("user_id", userId);
      await rollbackAuthUser(userId);
      throw new AdminError(
        "DB_ERROR",
        `Failed to grant superadmin: ${saErr.message}`,
        saErr,
      );
    }
  }

  const view = await hydrateSingleUser(userId);
  if (!view) {
    // Extremely unlikely — auth user was just created. Guard anyway.
    throw new AdminError(
      "DB_ERROR",
      "Failed to hydrate user immediately after creation",
    );
  }
  return view;
}

/**
 * Best-effort compensation when an insert fails after auth user creation.
 * Swallows errors — there's nothing the caller can do about a rollback
 * failure, and the upstream error is already about to be thrown.
 */
async function rollbackAuthUser(userId: string): Promise<void> {
  try {
    const supabase = createAdminClient();
    await supabase.auth.admin.deleteUser(userId);
  } catch {
    // swallow — rollback is best-effort
  }
}

/**
 * Upsert a user's role in a tenant. If they aren't a member yet, insert;
 * otherwise update. Returns the refreshed view.
 */
export async function updateUserMembership(
  userId: string,
  tenantId: string,
  role: Role,
): Promise<UserAdminView> {
  const validRole = validateRole(role);

  const supabase = createAdminClient();
  const { data: existing, error: readErr } = await supabase
    .from("tenant_members")
    .select("user_id")
    .eq("user_id", userId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (readErr) {
    throw new AdminError(
      "DB_ERROR",
      `Failed to look up tenant_members: ${readErr.message}`,
      readErr,
    );
  }

  if (existing) {
    const { error: upErr } = await supabase
      .from("tenant_members")
      .update({ role: validRole })
      .eq("user_id", userId)
      .eq("tenant_id", tenantId);
    if (upErr) {
      throw new AdminError(
        "DB_ERROR",
        `Failed to update membership: ${upErr.message}`,
        upErr,
      );
    }
  } else {
    const { error: insErr } = await supabase
      .from("tenant_members")
      .insert({ user_id: userId, tenant_id: tenantId, role: validRole });
    if (insErr) {
      throw new AdminError(
        "DB_ERROR",
        `Failed to insert membership: ${insErr.message}`,
        insErr,
      );
    }
  }

  const view = await hydrateSingleUser(userId);
  if (!view) {
    throw new AdminError("NOT_FOUND", `User ${userId} not found`);
  }
  return view;
}

/**
 * Remove a user from a specific tenant (keeps the auth user + any other
 * memberships intact).
 */
export async function removeUserFromTenant(
  userId: string,
  tenantId: string,
): Promise<UserAdminView> {
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("tenant_members")
    .delete()
    .eq("user_id", userId)
    .eq("tenant_id", tenantId);
  if (error) {
    throw new AdminError(
      "DB_ERROR",
      `Failed to remove membership: ${error.message}`,
      error,
    );
  }
  const view = await hydrateSingleUser(userId);
  if (!view) {
    throw new AdminError("NOT_FOUND", `User ${userId} not found`);
  }
  return view;
}

/**
 * Overwrite a user's password. Used by the admin UI's manual reset flow
 * (see Fase 13 audit addition #2). Password must be ≥8 chars.
 */
export async function setUserPassword(
  userId: string,
  password: string,
): Promise<void> {
  const pw = validatePassword(password, 8);
  const supabase = createAdminClient();
  const { error } = await supabase.auth.admin.updateUserById(userId, {
    password: pw,
  });
  if (error) {
    throw new AdminError(
      "AUTH_ERROR",
      `Failed to set password for user ${userId}: ${error.message}`,
      error,
    );
  }
}

/**
 * Toggle superadmin flag. Inserts or deletes the `superadmins` row. Idempotent.
 */
export async function setSuperadmin(
  userId: string,
  isSuperadmin: boolean,
  note?: string,
): Promise<UserAdminView> {
  const supabase = createAdminClient();

  if (isSuperadmin) {
    // Upsert semantics: insert if absent, otherwise keep row (no-op).
    const { data: existing, error: readErr } = await supabase
      .from("superadmins")
      .select("user_id")
      .eq("user_id", userId)
      .maybeSingle();
    if (readErr) {
      throw new AdminError(
        "DB_ERROR",
        `Failed to read superadmins: ${readErr.message}`,
        readErr,
      );
    }
    if (!existing) {
      const row: { user_id: string; note?: string } = { user_id: userId };
      if (typeof note === "string" && note.trim().length > 0) {
        row.note = note.trim();
      }
      const { error: insErr } = await supabase.from("superadmins").insert(row);
      if (insErr) {
        throw new AdminError(
          "DB_ERROR",
          `Failed to grant superadmin: ${insErr.message}`,
          insErr,
        );
      }
    }
  } else {
    const { error } = await supabase
      .from("superadmins")
      .delete()
      .eq("user_id", userId);
    if (error) {
      throw new AdminError(
        "DB_ERROR",
        `Failed to revoke superadmin: ${error.message}`,
        error,
      );
    }
  }

  const view = await hydrateSingleUser(userId);
  if (!view) {
    throw new AdminError("NOT_FOUND", `User ${userId} not found`);
  }
  return view;
}

/**
 * Hard-delete the auth user. FK cascade from `tenant_members` and
 * `superadmins` on `user_id` cleans up the rest.
 */
export async function deleteUser(userId: string): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase.auth.admin.deleteUser(userId);
  if (error) {
    const msg = (error as { message?: string }).message?.toLowerCase() ?? "";
    if (msg.includes("not found") || msg.includes("user not found")) {
      throw new AdminError("NOT_FOUND", `User ${userId} not found`);
    }
    throw new AdminError(
      "AUTH_ERROR",
      `Failed to delete user ${userId}: ${error.message}`,
      error,
    );
  }
}
