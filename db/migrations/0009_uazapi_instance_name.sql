-- =====================================================================
-- podZAP — 0009_uazapi_instance_name
-- =====================================================================
-- F14 bugfix: webhook lookup never matched UAZAPI's payload shape.
--
-- The UAZAPI webhook at `wsmart.uazapi.com` delivers events whose body
-- carries `instanceName` (e.g. `podzap-13d4eb57-1776932610527`), `token`
-- and `owner` — but NOT the short internal id (e.g. `r096894b4a51062`)
-- that we had been storing as `whatsapp_instances.uazapi_instance_id`.
-- As a result `lib/webhooks/persist.ts` could never resolve the instance
-- for an incoming webhook and silently dropped every message.
--
-- This migration adds `uazapi_instance_name` as a nullable secondary
-- lookup key. It is populated at attach/create time from the UAZAPI
-- `Instance.name` field so webhook traffic can be routed by
-- `instanceName`. Legacy rows (attached before this column existed) are
-- left nullable and can be backfilled manually; the column ships with a
-- one-off backfill for the single production row that exists today.
--
-- Scope: additive column + partial unique index + targeted backfill. No
-- change to the existing `uniq_whatsapp_instances_tenant` constraint
-- from 0008; both keys coexist so lookups by short id remain valid.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Add the column (nullable — legacy rows may not have it yet).
-- ---------------------------------------------------------------------
alter table public.whatsapp_instances
  add column if not exists uazapi_instance_name text;

comment on column public.whatsapp_instances.uazapi_instance_name is
  'UAZAPI instanceName (e.g. "podzap-<uuid>-<epoch>") returned on the '
  'webhook payload. Used in lib/webhooks/persist.ts as an alternative '
  'lookup key to uazapi_instance_id, since the webhook body does not '
  'include the short internal id. Nullable for backward compatibility '
  'with rows attached before this column existed.';


-- ---------------------------------------------------------------------
-- 2) Partial unique index. UAZAPI's instanceName is globally unique on
--    the server, so once we've stored it we want to enforce that same
--    invariant locally. NULLs are permitted duplicates (legacy rows).
-- ---------------------------------------------------------------------
create unique index if not exists uniq_whatsapp_instances_uazapi_name
  on public.whatsapp_instances (uazapi_instance_name)
  where uazapi_instance_name is not null;


-- ---------------------------------------------------------------------
-- 3) One-off backfill for the single production row that pre-dates this
--    migration. Guarded by WHERE on uazapi_instance_id so this is a
--    no-op on every other environment (and safe to re-run).
-- ---------------------------------------------------------------------
update public.whatsapp_instances
  set uazapi_instance_name = 'podzap-13d4eb57-1776932610527'
  where uazapi_instance_id = 'r096894b4a51062';

-- =====================================================================
-- End of 0009_uazapi_instance_name.
-- =====================================================================
