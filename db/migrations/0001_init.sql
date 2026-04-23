-- =====================================================================
-- podZAP — Initial schema (0001_init)
-- =====================================================================
-- Multi-tenant SaaS that turns WhatsApp group chats into podcast-style
-- audio summaries. This migration creates:
--   * ENUM types
--   * Core tables (tenants, tenant_members, whatsapp_instances, groups,
--     messages, transcripts, summaries, audios, schedules)
--   * Indexes (including tenant_id on every tenant-scoped table)
--   * updated_at trigger (set_updated_at)
--   * Row Level Security (RLS) enabled on every table, with tenant-scoped
--     policies backed by tenant_members + auth.uid()
--
-- Assumes Supabase Postgres with the `auth` schema already provisioned.
-- Comments kept in English, consistent across the file.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------
create extension if not exists "pgcrypto"; -- for gen_random_uuid()

-- ---------------------------------------------------------------------
-- ENUM types
-- ---------------------------------------------------------------------
do $$ begin
  create type tenant_member_role as enum ('owner', 'admin', 'member');
exception when duplicate_object then null; end $$;

do $$ begin
  create type whatsapp_instance_status as enum ('disconnected', 'connecting', 'qrcode', 'connected');
exception when duplicate_object then null; end $$;

do $$ begin
  create type message_type as enum ('text', 'audio', 'image', 'video', 'other');
exception when duplicate_object then null; end $$;

do $$ begin
  create type summary_tone as enum ('formal', 'fun', 'corporate');
exception when duplicate_object then null; end $$;

do $$ begin
  create type summary_status as enum ('pending_review', 'approved', 'rejected');
exception when duplicate_object then null; end $$;

do $$ begin
  create type schedule_frequency as enum ('daily', 'weekly', 'custom');
exception when duplicate_object then null; end $$;

do $$ begin
  create type schedule_trigger_type as enum ('fixed_time', 'inactivity', 'dynamic_window');
exception when duplicate_object then null; end $$;

do $$ begin
  create type schedule_approval_mode as enum ('auto', 'optional', 'required');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- updated_at trigger function (shared)
-- ---------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- =====================================================================
-- TABLES
-- =====================================================================

-- ---------- tenants --------------------------------------------------
create table public.tenants (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  plan        text not null default 'free',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger trg_tenants_updated_at
  before update on public.tenants
  for each row execute function public.set_updated_at();

-- ---------- tenant_members -------------------------------------------
-- M2M users <-> tenants. Relies on Supabase auth.users.
create table public.tenant_members (
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       tenant_member_role not null default 'member',
  joined_at  timestamptz not null default now(),
  created_at timestamptz not null default now(),
  primary key (tenant_id, user_id)
);

create index idx_tenant_members_user_id on public.tenant_members(user_id);
create index idx_tenant_members_tenant_id on public.tenant_members(tenant_id);

-- ---------- whatsapp_instances ---------------------------------------
create table public.whatsapp_instances (
  id                      uuid primary key default gen_random_uuid(),
  tenant_id               uuid not null references public.tenants(id) on delete cascade,
  uazapi_instance_id      text not null,
  uazapi_token_encrypted  text,
  status                  whatsapp_instance_status not null default 'disconnected',
  phone                   text,
  connected_at            timestamptz,
  last_seen_at            timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  unique (tenant_id, uazapi_instance_id)
);

create index idx_whatsapp_instances_tenant_id on public.whatsapp_instances(tenant_id);
create index idx_whatsapp_instances_status    on public.whatsapp_instances(status);

create trigger trg_whatsapp_instances_updated_at
  before update on public.whatsapp_instances
  for each row execute function public.set_updated_at();

-- ---------- groups ---------------------------------------------------
create table public.groups (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants(id) on delete cascade,
  instance_id       uuid not null references public.whatsapp_instances(id) on delete cascade,
  uazapi_group_jid  text not null,
  name              text not null,
  picture_url       text,
  is_monitored      boolean not null default false,
  member_count      integer,
  last_synced_at    timestamptz,
  created_at        timestamptz not null default now(),
  unique (instance_id, uazapi_group_jid)
);

create index idx_groups_tenant_id     on public.groups(tenant_id);
create index idx_groups_instance_id   on public.groups(instance_id);
create index idx_groups_is_monitored  on public.groups(is_monitored) where is_monitored = true;

-- ---------- messages -------------------------------------------------
create table public.messages (
  id                      uuid primary key default gen_random_uuid(),
  tenant_id               uuid not null references public.tenants(id) on delete cascade,
  group_id                uuid not null references public.groups(id) on delete cascade,
  uazapi_message_id       text not null unique,
  sender_jid              text,
  sender_name             text,
  type                    message_type not null,
  content                 text,
  media_url               text,
  media_duration_seconds  integer,
  captured_at             timestamptz not null,
  created_at              timestamptz not null default now()
);

create index idx_messages_tenant_id                 on public.messages(tenant_id);
create index idx_messages_group_captured_at_desc    on public.messages(group_id, captured_at desc);
create index idx_messages_type                      on public.messages(type);
-- uazapi_message_id index is implicit via UNIQUE constraint.

-- ---------- transcripts ----------------------------------------------
-- One transcript per message (STT for audio, vision caption for image).
create table public.transcripts (
  id          uuid primary key default gen_random_uuid(),
  message_id  uuid not null unique references public.messages(id) on delete cascade,
  text        text not null,
  language    text,
  confidence  real,
  model       text,
  created_at  timestamptz not null default now()
);

create index idx_transcripts_message_id on public.transcripts(message_id);

-- ---------- summaries ------------------------------------------------
create table public.summaries (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants(id) on delete cascade,
  group_id         uuid not null references public.groups(id) on delete cascade,
  period_start     timestamptz not null,
  period_end       timestamptz not null,
  text             text not null,
  tone             summary_tone not null default 'fun',
  status           summary_status not null default 'pending_review',
  model            text,
  prompt_version   text,
  approved_by      uuid references auth.users(id) on delete set null,
  approved_at      timestamptz,
  rejected_reason  text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index idx_summaries_tenant_id                 on public.summaries(tenant_id);
create index idx_summaries_group_status_created_desc on public.summaries(group_id, status, created_at desc);
create index idx_summaries_status                    on public.summaries(status);

create trigger trg_summaries_updated_at
  before update on public.summaries
  for each row execute function public.set_updated_at();

-- ---------- audios ---------------------------------------------------
-- One audio per summary (TTS output).
create table public.audios (
  id                       uuid primary key default gen_random_uuid(),
  tenant_id                uuid not null references public.tenants(id) on delete cascade,
  summary_id               uuid not null unique references public.summaries(id) on delete cascade,
  storage_path             text not null,
  duration_seconds         integer,
  voice                    text,
  speed                    real,
  model                    text,
  size_bytes               bigint,
  delivered_to_whatsapp    boolean not null default false,
  delivered_at             timestamptz,
  created_at               timestamptz not null default now()
);

create index idx_audios_tenant_id  on public.audios(tenant_id);
create index idx_audios_summary_id on public.audios(summary_id);

-- ---------- schedules ------------------------------------------------
-- One schedule per group (group_id is UNIQUE per requirement).
create table public.schedules (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  group_id       uuid not null unique references public.groups(id) on delete cascade,
  frequency      schedule_frequency not null default 'daily',
  time_of_day    time,
  day_of_week    smallint check (day_of_week is null or (day_of_week between 0 and 6)),
  trigger_type   schedule_trigger_type not null default 'fixed_time',
  approval_mode  schedule_approval_mode not null default 'required',
  voice          text,
  tone           summary_tone not null default 'fun',
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index idx_schedules_tenant_id on public.schedules(tenant_id);
create index idx_schedules_is_active on public.schedules(is_active) where is_active = true;

create trigger trg_schedules_updated_at
  before update on public.schedules
  for each row execute function public.set_updated_at();

-- =====================================================================
-- ROW LEVEL SECURITY
-- =====================================================================
-- Strategy: every tenant-scoped table filters rows by
--   tenant_id in (select tenant_id from tenant_members where user_id = auth.uid())
--
-- For tables without a tenant_id column (transcripts) we join through
-- the parent table (messages -> tenant_id).
--
-- NOTE: service_role key bypasses RLS by default. Background workers
-- (Inngest) should use the service_role client. App/browser/server
-- clients use anon/authenticated keys and are subject to these policies.
-- ---------------------------------------------------------------------

alter table public.tenants             enable row level security;
alter table public.tenant_members      enable row level security;
alter table public.whatsapp_instances  enable row level security;
alter table public.groups              enable row level security;
alter table public.messages            enable row level security;
alter table public.transcripts         enable row level security;
alter table public.summaries           enable row level security;
alter table public.audios              enable row level security;
alter table public.schedules           enable row level security;

-- Helper expression repeated inline per policy to keep things explicit.

-- ---------- tenants ---------------------------------------------------
create policy tenants_select on public.tenants
  for select using (
    id in (select tenant_id from public.tenant_members where user_id = auth.uid())
  );

-- Inserts happen via trusted server (signup flow / service_role) — we keep
-- a permissive insert for authenticated users so the signup-creates-tenant
-- path also works from the browser if ever needed.
create policy tenants_insert on public.tenants
  for insert with check (auth.uid() is not null);

create policy tenants_update on public.tenants
  for update using (
    id in (
      select tenant_id from public.tenant_members
      where user_id = auth.uid() and role in ('owner', 'admin')
    )
  );

create policy tenants_delete on public.tenants
  for delete using (
    id in (
      select tenant_id from public.tenant_members
      where user_id = auth.uid() and role = 'owner'
    )
  );

-- ---------- tenant_members -------------------------------------------
create policy tenant_members_select on public.tenant_members
  for select using (
    tenant_id in (select tenant_id from public.tenant_members where user_id = auth.uid())
    or user_id = auth.uid()
  );

create policy tenant_members_insert on public.tenant_members
  for insert with check (
    -- Either user is joining their own brand-new tenant (self-insert),
    -- or an owner/admin is adding them.
    user_id = auth.uid()
    or tenant_id in (
      select tenant_id from public.tenant_members
      where user_id = auth.uid() and role in ('owner', 'admin')
    )
  );

create policy tenant_members_update on public.tenant_members
  for update using (
    tenant_id in (
      select tenant_id from public.tenant_members
      where user_id = auth.uid() and role in ('owner', 'admin')
    )
  );

create policy tenant_members_delete on public.tenant_members
  for delete using (
    tenant_id in (
      select tenant_id from public.tenant_members
      where user_id = auth.uid() and role in ('owner', 'admin')
    )
    or user_id = auth.uid()
  );

-- ---------- generic tenant-scoped tables -----------------------------
-- Macro-like block: one SELECT/INSERT/UPDATE/DELETE policy per table.

-- whatsapp_instances
create policy whatsapp_instances_all on public.whatsapp_instances
  for all using (
    tenant_id in (select tenant_id from public.tenant_members where user_id = auth.uid())
  ) with check (
    tenant_id in (select tenant_id from public.tenant_members where user_id = auth.uid())
  );

-- groups
create policy groups_all on public.groups
  for all using (
    tenant_id in (select tenant_id from public.tenant_members where user_id = auth.uid())
  ) with check (
    tenant_id in (select tenant_id from public.tenant_members where user_id = auth.uid())
  );

-- messages
create policy messages_all on public.messages
  for all using (
    tenant_id in (select tenant_id from public.tenant_members where user_id = auth.uid())
  ) with check (
    tenant_id in (select tenant_id from public.tenant_members where user_id = auth.uid())
  );

-- transcripts (no tenant_id column — join via messages)
create policy transcripts_all on public.transcripts
  for all using (
    message_id in (
      select id from public.messages
      where tenant_id in (select tenant_id from public.tenant_members where user_id = auth.uid())
    )
  ) with check (
    message_id in (
      select id from public.messages
      where tenant_id in (select tenant_id from public.tenant_members where user_id = auth.uid())
    )
  );

-- summaries
create policy summaries_all on public.summaries
  for all using (
    tenant_id in (select tenant_id from public.tenant_members where user_id = auth.uid())
  ) with check (
    tenant_id in (select tenant_id from public.tenant_members where user_id = auth.uid())
  );

-- audios
create policy audios_all on public.audios
  for all using (
    tenant_id in (select tenant_id from public.tenant_members where user_id = auth.uid())
  ) with check (
    tenant_id in (select tenant_id from public.tenant_members where user_id = auth.uid())
  );

-- schedules
create policy schedules_all on public.schedules
  for all using (
    tenant_id in (select tenant_id from public.tenant_members where user_id = auth.uid())
  ) with check (
    tenant_id in (select tenant_id from public.tenant_members where user_id = auth.uid())
  );

-- =====================================================================
-- TODO (next migration): auto-create a tenant on first signup.
-- =====================================================================
-- Suggested approach (future 0002 migration):
--
--   create or replace function public.handle_new_user()
--   returns trigger
--   language plpgsql
--   security definer
--   set search_path = public
--   as $$
--   declare
--     new_tenant_id uuid;
--   begin
--     insert into public.tenants (name)
--     values (coalesce(new.raw_user_meta_data->>'tenant_name', new.email, 'My workspace'))
--     returning id into new_tenant_id;
--
--     insert into public.tenant_members (tenant_id, user_id, role)
--     values (new_tenant_id, new.id, 'owner');
--
--     return new;
--   end;
--   $$;
--
--   create trigger on_auth_user_created
--     after insert on auth.users
--     for each row execute function public.handle_new_user();
--
-- Deferred: the PRD allows a user to belong to multiple tenants, and the
-- signup UX is not finalized (invite-first vs. create-tenant-first). Keeping
-- this out of 0001 avoids committing to a flow we may rework in Fase 1.
-- =====================================================================
