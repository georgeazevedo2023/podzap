-- =====================================================================
-- podZAP — 0007_superadmin
-- =====================================================================
-- Cross-tenant admin capability. A user present in `public.superadmins`
-- bypasses tenant-scoped filters at the application layer (RLS can call
-- `public.is_superadmin()` as an escape hatch in future policies).
--
-- Writes are service_role only — authenticated users can SELECT their own
-- row (so the app can ask "am I a superadmin?") but cannot insert/update.
-- The helper function is security definer + locked search_path, same
-- pattern as `public.current_tenant_ids()` in 0002_fixes.sql.
-- =====================================================================

-- F12: superadmin (cross-tenant admin capability)
create table if not exists public.superadmins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  granted_at timestamptz not null default now(),
  granted_by uuid references auth.users(id) on delete set null,
  note text
);

alter table public.superadmins enable row level security;

-- Only service_role writes; authenticated can read their own row (to know if they ARE a superadmin)
drop policy if exists superadmins_read_self on public.superadmins;
create policy superadmins_read_self on public.superadmins
  for select to authenticated
  using (user_id = (select auth.uid()));

-- Helper usable in future RLS policies to grant superadmin cross-tenant visibility
create or replace function public.is_superadmin()
  returns boolean
  language sql
  stable
  security definer
  set search_path = ''
  as $$ select exists(select 1 from public.superadmins where user_id = (select auth.uid())) $$;

grant execute on function public.is_superadmin() to authenticated;
grant execute on function public.is_superadmin() to anon;
