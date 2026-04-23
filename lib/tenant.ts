import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Current authenticated user (minimal projection for UI).
 */
export type CurrentUser = {
  id: string;
  email: string;
};

/**
 * Primary tenant for the current user (membership + tenant fields flattened).
 */
export type CurrentTenant = {
  id: string;
  name: string;
  plan: string;
  role: 'owner' | 'admin' | 'member';
};

/**
 * Reads the current authenticated user from Supabase (via server client) and
 * fetches their primary tenant membership.
 *
 * Returns `null` if the user is not authenticated OR has no tenant membership.
 * Callers (layouts / pages) are expected to translate `null` into a redirect
 * to `/login`.
 *
 * The "primary" tenant is just the first row returned by the query — Fase 1
 * ships with one tenant per user (bootstrapped on signup), so this is safe.
 * When invite/multi-tenant membership lands, this helper will need a way to
 * select which tenant is active (cookie / url param / user preference).
 */
export async function getCurrentUserAndTenant(): Promise<
  { user: CurrentUser; tenant: CurrentTenant } | null
> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || !user.email) {
    return null;
  }

  const { data: membership, error } = await supabase
    .from('tenant_members')
    .select('role, tenants(id, name, plan)')
    .eq('user_id', user.id)
    .limit(1)
    .maybeSingle();

  if (error || !membership || !membership.tenants) {
    return null;
  }

  const tenants = membership.tenants;

  return {
    user: {
      id: user.id,
      email: user.email,
    },
    tenant: {
      id: tenants.id,
      name: tenants.name,
      plan: tenants.plan,
      role: membership.role,
    },
  };
}

/**
 * Returns true iff the given user is a superadmin.
 *
 * Uses the service-role admin client (bypasses RLS) so the lookup succeeds
 * even on sessions that belong to a different tenant (or no tenant at all —
 * superadmins aren't required to be tenant members).
 *
 * Introduced in F13 (A1) as the gate for `/admin` UI and admin services.
 */
export async function isSuperadmin(userId: string): Promise<boolean> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('superadmins')
    .select('user_id')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) return false;
  return !!data;
}

/**
 * Guard for `/admin` server components and admin API routes.
 *
 * Resolves to the current user (and primary tenant, if any) when the caller
 * is a superadmin. Otherwise returns a `Response` redirect that the caller
 * must return unchanged. Modelled on the "discriminated union or redirect"
 * pattern so call sites stay narrow:
 *
 *   const guard = await requireSuperadmin();
 *   if ('response' in guard) return guard.response;
 *   const { user, tenant } = guard;
 *
 * A superadmin may or may not belong to a tenant (they're cross-tenant by
 * design), so `tenant` is nullable.
 */
export async function requireSuperadmin(): Promise<
  | { user: CurrentUser; tenant: CurrentTenant | null; isSuperadmin: true }
  | { response: Response }
> {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || !user.email) {
    return {
      response: Response.redirect(
        new URL('/login?error=Login+requerido', base),
      ),
    };
  }

  const sa = await isSuperadmin(user.id);
  if (!sa) {
    return {
      response: Response.redirect(
        new URL('/home?error=Acesso+negado', base),
      ),
    };
  }

  // Superadmins don't need to be tenant members — fetch the primary tenant
  // if one exists but tolerate null.
  const ctx = await getCurrentUserAndTenant();

  return {
    user: { id: user.id, email: user.email },
    tenant: ctx?.tenant ?? null,
    isSuperadmin: true,
  };
}
