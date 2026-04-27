#!/usr/bin/env node
/**
 * Idempotently create the `music` Supabase Storage bucket — uploads
 * de tracks de fundo via /admin/music vivem aqui.
 *
 * Usage:
 *   node --env-file=.env.local scripts/create-music-bucket.mjs
 *
 * Requires: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *
 * Bucket privado (signed URL pra preview), audio/* only, 15MB cap
 * (mais largo que validação da API em 10MB pra deixar margem se a
 * UI permitir formatos maiores no futuro).
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

const BUCKET_ID = 'music';
const OPTIONS = {
  public: false,
  fileSizeLimit: '15MB',
  allowedMimeTypes: ['audio/mpeg', 'audio/mp3', 'audio/x-mpeg'],
};

async function main() {
  console.log(`Ensuring bucket "${BUCKET_ID}" exists…`);

  const { data: existing, error: getErr } = await supabase.storage.getBucket(BUCKET_ID);

  if (existing) {
    console.log(`Bucket "${BUCKET_ID}" already exists. Skipping create.`);
    return;
  }
  if (getErr && !/not found|does not exist/i.test(getErr.message ?? '')) {
    console.warn(`getBucket returned unexpected error (continuing to create): ${getErr.message}`);
  }

  const { data: created, error: createErr } = await supabase.storage.createBucket(BUCKET_ID, OPTIONS);

  if (createErr) {
    if (/already exists|duplicate/i.test(createErr.message ?? '')) {
      console.log(`Bucket "${BUCKET_ID}" already existed (race). OK.`);
      return;
    }
    console.error(`Failed to create bucket: ${createErr.message}`);
    process.exitCode = 1;
    return;
  }
  console.log(`Created bucket: ${JSON.stringify(created)}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
