-- =====================================================================
-- podZAP — 0005_audios_bucket (Fase 9)
-- =====================================================================
-- RLS policies for the private `audios` Storage bucket. Mirrors the
-- pattern in 0003_webhooks.sql for the `media` bucket:
--
--   * tenant-scoped SELECT for authenticated users, filtered by the
--     first path segment (<tenant_id>/<yyyy>/<summary_id>.wav).
--   * service_role-only INSERT / UPDATE / DELETE. The TTS worker uses
--     the service client so this is belt-and-suspenders — the actual
--     isolation comes from the fact that no anon/authenticated code path
--     writes to `audios`.
--
-- The `public.safe_uuid(text)` helper already exists (created in 0003).
-- =====================================================================

-- F9: audios bucket RLS
drop policy if exists "audios_tenant_read" on storage.objects;
create policy "audios_tenant_read"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'audios'
    and public.safe_uuid((storage.foldername(name))[1]) is not null
    and public.safe_uuid((storage.foldername(name))[1]) in (select public.current_tenant_ids())
  );

drop policy if exists "audios_service_write" on storage.objects;
create policy "audios_service_write"
  on storage.objects for insert to service_role
  with check (bucket_id = 'audios');

drop policy if exists "audios_service_update" on storage.objects;
create policy "audios_service_update"
  on storage.objects for update to service_role
  using (bucket_id = 'audios');

drop policy if exists "audios_service_delete" on storage.objects;
create policy "audios_service_delete"
  on storage.objects for delete to service_role
  using (bucket_id = 'audios');

-- =====================================================================
-- End of 0005_audios_bucket.
-- =====================================================================
