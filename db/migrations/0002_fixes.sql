-- =====================================================================
-- podZAP — 0002_fixes
-- =====================================================================
-- Addresses blockers and debts identified in docs/audits/fase-0-audit.md:
--   * §Bloqueadores #1: close tenants_insert (no direct inserts; trigger owns tenant creation).
--   * §Bloqueadores #2: messages.uazapi_message_id unique per tenant, not global.
--   * §Riscos/débitos #3: replace recursive RLS on tenant_members with a security definer helper.
--   * §Riscos/débitos #4: set_updated_at with security definer + locked search_path.
--   * §Riscos/débitos #5: composite index messages(group_id, type, captured_at desc).
--   * §Riscos/débitos #6: partial index audios(delivered_to_whatsapp=false).
--   * SQL TODO at the bottom of 0001: handle_new_user trigger.
--
-- Scope: additive or policy swaps only. No data loss.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) tenants_insert — drop the overly permissive policy.
--    Rationale: fase-0-audit §Bloqueadores #1. Any authenticated user could
--    create arbitrary tenants. After this migration tenants are created ONLY
--    by the handle_new_user() trigger (section 2) running as security definer.
--    No client/anon path should ever insert into tenants.
-- ---------------------------------------------------------------------
drop policy if exists tenants_insert on public.tenants;


-- ---------------------------------------------------------------------
-- 2) handle_new_user() + trigger on auth.users.
--    Rationale: fase-0-audit §Bloqueadores #1 (replacement for the open
--    insert policy) and 0001_init.sql lines 404-436 (TODO resolution).
--    On signup, create a tenant and owner membership for the new user.
--    security definer + empty search_path keeps the function safe from
--    search_path hijacks; all object references are fully qualified.
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_tenant_id uuid;
  tenant_name   text;
begin
  tenant_name := coalesce(
    new.raw_user_meta_data->>'full_name',
    pg_catalog.split_part(new.email, '@', 1),
    'My workspace'
  );

  insert into public.tenants (name, plan)
  values (tenant_name, 'free')
  returning id into new_tenant_id;

  insert into public.tenant_members (tenant_id, user_id, role)
  values (new_tenant_id, new.id, 'owner');

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- ---------------------------------------------------------------------
-- 3) messages.uazapi_message_id — make unique per tenant, not global.
--    Rationale: fase-0-audit §Bloqueadores #2. A global unique blocks
--    collisions across tenants (e.g. two tenants sharing a UAZAPI instance
--    during migration/testing). Scope the uniqueness to (tenant_id, id).
-- ---------------------------------------------------------------------
-- The 0001 migration declared the column as `text not null unique`, so
-- Postgres named the constraint automatically. We locate and drop it,
-- then add the composite unique. We also keep a plain index on the raw
-- uazapi_message_id for fast single-column lookups from workers.
do $$
declare
  conname_text text;
begin
  select conname
    into conname_text
  from pg_constraint
  where conrelid = 'public.messages'::regclass
    and contype  = 'u'
    and array_length(conkey, 1) = 1
    and conkey[1] = (
      select attnum from pg_attribute
      where attrelid = 'public.messages'::regclass
        and attname  = 'uazapi_message_id'
    );

  if conname_text is not null then
    execute format('alter table public.messages drop constraint %I', conname_text);
  end if;
end $$;

alter table public.messages
  add constraint messages_tenant_uazapi_message_id_key
  unique (tenant_id, uazapi_message_id);

create index if not exists idx_messages_uazapi_message_id
  on public.messages(uazapi_message_id);


-- ---------------------------------------------------------------------
-- 4) Recreate set_updated_at() with security definer + empty search_path.
--    Rationale: fase-0-audit §Riscos/débitos #4. Drop+recreate (instead of
--    CREATE OR REPLACE) because we need to ensure the function attributes
--    are fully refreshed; drop cascades to the triggers, so we recreate
--    them too. Object refs are qualified with pg_catalog.
-- ---------------------------------------------------------------------
drop function if exists public.set_updated_at() cascade;

create function public.set_updated_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

-- Recreate the triggers that were dropped by the cascade above.
create trigger trg_tenants_updated_at
  before update on public.tenants
  for each row execute function public.set_updated_at();

create trigger trg_whatsapp_instances_updated_at
  before update on public.whatsapp_instances
  for each row execute function public.set_updated_at();

create trigger trg_summaries_updated_at
  before update on public.summaries
  for each row execute function public.set_updated_at();

create trigger trg_schedules_updated_at
  before update on public.schedules
  for each row execute function public.set_updated_at();


-- ---------------------------------------------------------------------
-- 5) current_tenant_ids() + RLS refactor.
--    Rationale: fase-0-audit §Riscos/débitos #3. tenant_members_select used
--    a recursive subquery over the same table; the planner handles it today
--    but it's brittle and repeats per-row. Extract the lookup into a single
--    security-definer function and reuse it in every tenant-scoped policy.
-- ---------------------------------------------------------------------
create or replace function public.current_tenant_ids()
returns setof uuid
language sql
security definer
stable
set search_path = ''
as $$
  select tenant_id
  from public.tenant_members
  where user_id = (select auth.uid());
$$;

-- Allow the function to be invoked by authenticated sessions (security
-- definer runs with the owner's privileges, but EXECUTE must still be
-- granted on the function itself).
grant execute on function public.current_tenant_ids() to authenticated;
grant execute on function public.current_tenant_ids() to anon;

-- ---------- tenants policies -----------------------------------------
drop policy if exists tenants_select on public.tenants;
drop policy if exists tenants_update on public.tenants;
drop policy if exists tenants_delete on public.tenants;

create policy tenants_select on public.tenants
  for select using (
    id in (select public.current_tenant_ids())
  );

create policy tenants_update on public.tenants
  for update using (
    id in (
      select tm.tenant_id
      from public.tenant_members tm
      where tm.user_id = (select auth.uid())
        and tm.role in ('owner', 'admin')
    )
  );

create policy tenants_delete on public.tenants
  for delete using (
    id in (
      select tm.tenant_id
      from public.tenant_members tm
      where tm.user_id = (select auth.uid())
        and tm.role = 'owner'
    )
  );

-- ---------- tenant_members policies ----------------------------------
-- Drop the recursive select (and the other policies that still embedded
-- the subquery) and recreate using the helper where applicable. The
-- insert/update/delete policies need the role check and must continue to
-- scan tenant_members directly because current_tenant_ids() does not
-- expose role info.
drop policy if exists tenant_members_select on public.tenant_members;
drop policy if exists tenant_members_insert on public.tenant_members;
drop policy if exists tenant_members_update on public.tenant_members;
drop policy if exists tenant_members_delete on public.tenant_members;

create policy tenant_members_select on public.tenant_members
  for select using (
    tenant_id in (select public.current_tenant_ids())
    or user_id = (select auth.uid())
  );

create policy tenant_members_insert on public.tenant_members
  for insert with check (
    -- Either self-insert (first signup — but normally handled by the
    -- trigger under security definer, which bypasses this check) or an
    -- owner/admin adding someone.
    user_id = (select auth.uid())
    or tenant_id in (
      select tm.tenant_id
      from public.tenant_members tm
      where tm.user_id = (select auth.uid())
        and tm.role in ('owner', 'admin')
    )
  );

create policy tenant_members_update on public.tenant_members
  for update using (
    tenant_id in (
      select tm.tenant_id
      from public.tenant_members tm
      where tm.user_id = (select auth.uid())
        and tm.role in ('owner', 'admin')
    )
  );

create policy tenant_members_delete on public.tenant_members
  for delete using (
    tenant_id in (
      select tm.tenant_id
      from public.tenant_members tm
      where tm.user_id = (select auth.uid())
        and tm.role in ('owner', 'admin')
    )
    or user_id = (select auth.uid())
  );

-- ---------- generic tenant-scoped tables (FOR ALL policies) ----------
-- Drop the existing FOR ALL policies and recreate with the helper so
-- there is a single source of truth for tenant membership.

drop policy if exists whatsapp_instances_all on public.whatsapp_instances;
create policy whatsapp_instances_all on public.whatsapp_instances
  for all
  using      (tenant_id in (select public.current_tenant_ids()))
  with check (tenant_id in (select public.current_tenant_ids()));

drop policy if exists groups_all on public.groups;
create policy groups_all on public.groups
  for all
  using      (tenant_id in (select public.current_tenant_ids()))
  with check (tenant_id in (select public.current_tenant_ids()));

drop policy if exists messages_all on public.messages;
create policy messages_all on public.messages
  for all
  using      (tenant_id in (select public.current_tenant_ids()))
  with check (tenant_id in (select public.current_tenant_ids()));

drop policy if exists transcripts_all on public.transcripts;
create policy transcripts_all on public.transcripts
  for all
  using (
    message_id in (
      select m.id from public.messages m
      where m.tenant_id in (select public.current_tenant_ids())
    )
  )
  with check (
    message_id in (
      select m.id from public.messages m
      where m.tenant_id in (select public.current_tenant_ids())
    )
  );

drop policy if exists summaries_all on public.summaries;
create policy summaries_all on public.summaries
  for all
  using      (tenant_id in (select public.current_tenant_ids()))
  with check (tenant_id in (select public.current_tenant_ids()));

drop policy if exists audios_all on public.audios;
create policy audios_all on public.audios
  for all
  using      (tenant_id in (select public.current_tenant_ids()))
  with check (tenant_id in (select public.current_tenant_ids()));

drop policy if exists schedules_all on public.schedules;
create policy schedules_all on public.schedules
  for all
  using      (tenant_id in (select public.current_tenant_ids()))
  with check (tenant_id in (select public.current_tenant_ids()));


-- ---------------------------------------------------------------------
-- 6) Extra indexes called out by the audit.
--    Rationale: fase-0-audit §Riscos/débitos #5 and #6. These lookups will
--    be hot paths for Fase 5 (worker filtering audio messages by group and
--    time window) and Fase 10 (delivery worker scanning pending audios).
-- ---------------------------------------------------------------------
create index if not exists idx_messages_group_type_captured_at_desc
  on public.messages(group_id, type, captured_at desc);

create index if not exists idx_audios_not_delivered
  on public.audios(created_at)
  where delivered_to_whatsapp = false;

-- =====================================================================
-- End of 0002_fixes.
-- =====================================================================
