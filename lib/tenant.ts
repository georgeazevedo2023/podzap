import { createClient } from '@/lib/supabase/server';

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
