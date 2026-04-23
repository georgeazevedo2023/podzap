-- =====================================================================
-- Fase 10 — Tenant-level delivery settings (0006_tenant_settings)
-- =====================================================================
-- Adds two per-tenant knobs used by the WhatsApp delivery worker:
--   * `include_caption_on_delivery` — whether the summary text is sent
--     as the caption alongside the audio (true by default).
--   * `delivery_target` — who receives the audio: the original group,
--     the owner's DM, or both. Currently only 'group' is wired, but we
--     ship the column now so the UI can expose the toggle without a
--     second migration later.
--
-- Idempotent: safe to re-apply. Defaults keep existing tenants on the
-- historical behavior (caption on, group delivery).
-- =====================================================================

alter table public.tenants
  add column if not exists include_caption_on_delivery boolean not null default true,
  add column if not exists delivery_target text not null default 'group';

-- `check` constraint is added separately so the `if not exists` on the
-- column above stays idempotent (Postgres doesn't support `if not exists`
-- on inline constraints in an alter table add column).
do $$ begin
  alter table public.tenants
    add constraint tenants_delivery_target_check
    check (delivery_target in ('group', 'owner_dm', 'both'));
exception when duplicate_object then null; end $$;

comment on column public.tenants.include_caption_on_delivery is
  'Whether to include the summary text as WhatsApp caption when sending audio';
comment on column public.tenants.delivery_target is
  'Where generated audio is delivered: group (original WhatsApp group), owner_dm (tenant owner DM), or both';
