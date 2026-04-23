-- =====================================================================
-- podZAP — 0003_webhooks
-- =====================================================================
-- Prepares the data layer for Fase 4 (webhook message capture).
--   * Extra columns on `messages` to track media download state and the
--     raw UAZAPI payload for debugging.
--   * Indexes that support the pending-download worker and the history
--     screen.
--   * Storage RLS policies on the `media` bucket so authenticated users
--     only see objects under their own tenant folder, while the service
--     role (used by the webhook handler / media downloader) gets an
--     explicit write policy for defense in depth.
--
-- Scope: additive only. No data rewrite, no drops of existing objects.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) messages — extra columns for media + raw payload capture.
-- ---------------------------------------------------------------------

-- F4: MIME type reported by UAZAPI (or sniffed from magic bytes), so the
-- downloader and the UI can pick the right player/icon without re-probing.
alter table public.messages
  add column if not exists media_mime_type text;

-- F4: media size in bytes, tracked separately from the byte stream so we
-- can enforce per-tenant quotas and surface weight in the history view.
alter table public.messages
  add column if not exists media_size_bytes bigint;

-- F4: path inside the `media` Storage bucket. Convention:
--   <tenant_id>/<yyyy>/<mm>/<message_id>.<ext>
-- NULL until the media downloader succeeds.
alter table public.messages
  add column if not exists media_storage_path text;

-- F4: lifecycle of the media fetch. Rows start as `pending`; the
-- downloader flips to `downloaded` or `failed`. `skipped` is for
-- message types that intentionally never had media (text messages,
-- unsupported payloads) — keeps the partial index small.
alter table public.messages
  add column if not exists media_download_status text
    default 'pending'
    check (media_download_status in ('pending','downloaded','failed','skipped'));

-- F4: original UAZAPI payload, stored verbatim. Tiny (a few KB), but
-- invaluable for reproducing bugs, reverse-engineering new event types,
-- and eyeballing what UAZAPI actually sent when the parse fails.
alter table public.messages
  add column if not exists raw_payload jsonb;


-- ---------------------------------------------------------------------
-- 2) Indexes.
-- ---------------------------------------------------------------------

-- F4: partial index — only `pending` rows are relevant to the media
-- downloader worker sweep. Keeps the index footprint small even as the
-- messages table grows to millions of rows.
create index if not exists idx_messages_media_status
  on public.messages(media_download_status)
  where media_download_status = 'pending';

-- F4: (tenant_id, created_at desc) is the exact shape the /history
-- screen queries (latest N messages for the current tenant). An index
-- on tenant_id alone already exists (idx_messages_tenant_id), but this
-- composite lets the planner stream rows in order without a sort.
create index if not exists idx_messages_tenant_created_at
  on public.messages(tenant_id, created_at desc);


-- ---------------------------------------------------------------------
-- 3) Storage RLS — policies on the `media` bucket.
-- ---------------------------------------------------------------------
-- The Supabase `storage.objects` table already has RLS enabled by the
-- platform; we just add bucket-scoped policies.
--
-- Path convention: <tenant_id>/<yyyy>/<mm>/<message_id>.<ext>
-- storage.foldername('abc/def/ghi.jpg') -> {'abc','def'}  (text[])
--
-- Cast the first path segment to uuid. A naive cast would throw on a
-- malformed path; wrap in a SAFE cast helper so a bad object name just
-- denies access instead of erroring the whole query.
-- ---------------------------------------------------------------------

-- F4: safe uuid cast — returns NULL instead of raising on bad input.
-- Used by the storage select policy to tolerate paths that don't match
-- the expected <tenant_id>/... convention (e.g. legacy or test data).
create or replace function public.safe_uuid(value text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
begin
  return value::uuid;
exception when others then
  return null;
end;
$$;

grant execute on function public.safe_uuid(text) to authenticated;
grant execute on function public.safe_uuid(text) to anon;
grant execute on function public.safe_uuid(text) to service_role;

-- F4: authenticated users can read objects only when the first folder
-- segment matches a tenant they're a member of. The service role
-- bypasses RLS entirely, so the webhook handler / workers are unaffected.
drop policy if exists "media_tenant_read" on storage.objects;
create policy "media_tenant_read"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'media'
    and public.safe_uuid((storage.foldername(name))[1]) is not null
    and public.safe_uuid((storage.foldername(name))[1])
        in (select public.current_tenant_ids())
  );

-- F4: explicit insert policy for service_role. The service role already
-- bypasses RLS, so this is belt-and-suspenders for the case where a
-- future client impersonation path ever passes through RLS.
drop policy if exists "media_service_write" on storage.objects;
create policy "media_service_write"
  on storage.objects for insert
  to service_role
  with check (bucket_id = 'media');

-- F4: same for update + delete, also service_role only. Keeps writes
-- scoped to the webhook/worker surface. Authenticated users have no
-- way to mutate media objects — uploads and deletes flow through
-- server code running with the service role key.
drop policy if exists "media_service_update" on storage.objects;
create policy "media_service_update"
  on storage.objects for update
  to service_role
  using (bucket_id = 'media')
  with check (bucket_id = 'media');

drop policy if exists "media_service_delete" on storage.objects;
create policy "media_service_delete"
  on storage.objects for delete
  to service_role
  using (bucket_id = 'media');

-- =====================================================================
-- End of 0003_webhooks.
-- =====================================================================
