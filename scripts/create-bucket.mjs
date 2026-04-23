#!/usr/bin/env node
/**
 * Idempotently create the `media` Supabase Storage bucket.
 *
 * Usage:
 *   node --env-file=.env.local scripts/create-bucket.mjs
 *
 * Requires: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *
 * Notes:
 *   * Uses the service_role key so we can manage buckets.
 *   * If the bucket already exists we log + succeed (idempotent).
 *   * Lists buckets at the end so the caller can visually confirm.
 */
import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const BUCKET_ID = 'media';
const OPTIONS = {
  public: false,
  fileSizeLimit: '50MB',
  allowedMimeTypes: ['audio/*', 'image/*', 'video/*'],
};

async function main() {
  console.log(`Ensuring bucket "${BUCKET_ID}" exists…`);

  const { data: existing, error: getErr } = await supabase.storage.getBucket(BUCKET_ID);

  if (existing) {
    console.log(`Bucket "${BUCKET_ID}" already exists. Skipping create.`);
    console.log(`  public: ${existing.public}`);
    console.log(`  fileSizeLimit: ${existing.file_size_limit ?? 'unset'}`);
    console.log(`  allowedMimeTypes: ${JSON.stringify(existing.allowed_mime_types ?? null)}`);
  } else {
    // `getBucket` returns a "not found" error if absent — that's expected.
    if (getErr && !/not found|does not exist/i.test(getErr.message ?? '')) {
      console.warn(`getBucket returned unexpected error (continuing to create): ${getErr.message}`);
    }

    const { data: created, error: createErr } = await supabase.storage.createBucket(BUCKET_ID, OPTIONS);

    if (createErr) {
      // Race-condition fallback: if another run created it between our
      // get and create, treat as success.
      if (/already exists|duplicate/i.test(createErr.message ?? '')) {
        console.log(`Bucket "${BUCKET_ID}" already existed (race). OK.`);
      } else {
        console.error(`Failed to create bucket: ${createErr.message}`);
        process.exitCode = 1;
        return;
      }
    } else {
      console.log(`Created bucket: ${JSON.stringify(created)}`);
    }
  }

  // Verify by listing.
  const { data: all, error: listErr } = await supabase.storage.listBuckets();
  if (listErr) {
    console.error(`listBuckets failed: ${listErr.message}`);
    process.exitCode = 1;
    return;
  }
  console.log('\nAll buckets:');
  for (const b of all ?? []) {
    console.log(`  - ${b.id} (public=${b.public})`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
