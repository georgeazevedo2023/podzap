-- =====================================================================
-- podZAP — 0008_admin_managed
-- =====================================================================
-- F13: admin-managed tenancy (switch from self-service).
--
-- Until F13 the app bootstrapped a tenant + owner membership for every
-- new auth.users row via the `handle_new_user` trigger introduced in
-- 0002_fixes.sql. The product direction has changed: tenants are now
-- created explicitly by a superadmin (UI to land in A4) and users
-- receive access by invitation only. This migration:
--
--   * drops the self-service trigger + function so that signing up via
--     Supabase auth no longer silently mints a tenant;
--   * enforces the MVP 1:1 rule between a tenant and its UAZAPI
--     instance (a tenant has AT MOST one active instance — detach
--     before re-attaching a different one);
--   * adds a `is_active` soft-suspend flag on tenants so a superadmin
--     can freeze access without deleting history (audit addition #5);
--   * expands the SELECT policies on the tenancy-core tables so that
--     superadmins (via `public.is_superadmin()`, see 0007) can read
--     every row cross-tenant. Writes remain gated by the existing
--     role-based policies; cross-tenant writes go through service_role
--     on the admin services (A2/A3).
--
-- Scope: policy swaps + drops + additive columns/indexes. No data loss.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Drop the self-service tenant bootstrap.
-- ---------------------------------------------------------------------
drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.handle_new_user();


-- ---------------------------------------------------------------------
-- 2) Enforce 1:1 tenant <-> UAZAPI instance (MVP admin-managed rule).
--    Unique on tenant_id (not composite). If a tenant is detached and
--    re-attached with a different UAZAPI instance, delete first, then
--    insert.
-- ---------------------------------------------------------------------
create unique index if not exists uniq_whatsapp_instances_tenant
  on public.whatsapp_instances(tenant_id);


-- ---------------------------------------------------------------------
-- 3) Soft-suspend flag on tenants (plan audit addition #5).
-- ---------------------------------------------------------------------
alter table public.tenants
  add column if not exists is_active boolean not null default true;


-- ---------------------------------------------------------------------
-- 4) Expand SELECT policies so superadmins see everything.
--    Uses the `public.is_superadmin()` helper from 0007_superadmin.sql.
-- ---------------------------------------------------------------------
drop policy if exists tenants_select on public.tenants;
create policy tenants_select on public.tenants
  for select to authenticated
  using (
    id in (select public.current_tenant_ids())
    OR public.is_superadmin()
  );

drop policy if exists tenant_members_select on public.tenant_members;
create policy tenant_members_select on public.tenant_members
  for select to authenticated
  using (
    tenant_id in (select public.current_tenant_ids())
    or user_id = (select auth.uid())
    OR public.is_superadmin()
  );

-- whatsapp_instances previously had a single FOR ALL policy
-- (`whatsapp_instances_all`). Split it so SELECT allows superadmins to
-- read cross-tenant while writes stay tenant-scoped (superadmin writes
-- go through service_role in the admin services, A2/A3).
drop policy if exists whatsapp_instances_all on public.whatsapp_instances;
drop policy if exists whatsapp_instances_select on public.whatsapp_instances;
drop policy if exists whatsapp_instances_modify on public.whatsapp_instances;

create policy whatsapp_instances_select on public.whatsapp_instances
  for select to authenticated
  using (
    tenant_id in (select public.current_tenant_ids())
    OR public.is_superadmin()
  );

create policy whatsapp_instances_modify on public.whatsapp_instances
  for all to authenticated
  using      (tenant_id in (select public.current_tenant_ids()))
  with check (tenant_id in (select public.current_tenant_ids()));

-- =====================================================================
-- End of 0008_admin_managed.
-- =====================================================================
