#!/usr/bin/env node
/**
 * Converte os áudios legados do bucket `audios` de WAV pra OGG/Opus 32k.
 *
 * Contexto: até jun/2026 o pipeline TTS subia WAV cru (~10 MB por episódio)
 * — inviável no plano free do Supabase (storage 1 GB). O pipeline novo
 * (lib/audios/mix.ts::transcodeToOpusOgg) já sobe .ogg; este script migra
 * o acervo antigo uma única vez.
 *
 * Por arquivo: baixa o .wav → ffmpeg → sobe o .ogg no mesmo path (extensão
 * trocada) → atualiza `audios.storage_path` + `size_bytes` → apaga o .wav.
 * Ordem garante consistência: se algo falhar no meio, a row continua
 * apontando pro arquivo que existe. Re-rodar é seguro (upsert no upload).
 *
 * Arquivos .wav sem row correspondente (órfãos de inserts falhos) são
 * listados; passe --delete-orphans pra removê-los.
 *
 * Usage:
 *   node --env-file=.env.local scripts/convert-audios-to-ogg.mjs [--delete-orphans]
 *
 * Requires: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ffmpeg no PATH.
 */
import { createClient } from '@supabase/supabase-js';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const BUCKET = 'audios';
const OPUS_BITRATE = '32k';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceRole) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env');
  process.exit(1);
}
const deleteOrphans = process.argv.includes('--delete-orphans');

const admin = createClient(url, serviceRole, { auth: { persistSession: false } });

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', (c) => { stderr += c.toString('utf8'); });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exit ${code}: ${stderr.trim().split('\n').slice(-5).join('\n')}`));
    });
  });
}

async function transcode(wavBuffer, workDir, name) {
  const inPath = path.join(workDir, `${name}.wav`);
  const outPath = path.join(workDir, `${name}.ogg`);
  await writeFile(inPath, wavBuffer);
  await runFfmpeg([
    '-hide_banner', '-loglevel', 'error', '-y',
    '-i', inPath,
    '-c:a', 'libopus', '-b:a', OPUS_BITRATE, '-ac', '1',
    outPath,
  ]);
  return readFile(outPath);
}

/** Lista recursiva do bucket (2 níveis: tenant/yyyy/arquivo). */
async function listAllFiles() {
  const files = [];
  const { data: tenants, error: e1 } = await admin.storage.from(BUCKET).list('');
  if (e1) throw e1;
  for (const t of tenants ?? []) {
    if (t.id) { files.push(t.name); continue; } // arquivo solto na raiz
    const { data: years, error: e2 } = await admin.storage.from(BUCKET).list(t.name);
    if (e2) throw e2;
    for (const y of years ?? []) {
      if (y.id) { files.push(`${t.name}/${y.name}`); continue; }
      const { data: objs, error: e3 } = await admin.storage.from(BUCKET).list(`${t.name}/${y.name}`);
      if (e3) throw e3;
      for (const o of objs ?? []) {
        if (o.id) files.push(`${t.name}/${y.name}/${o.name}`);
      }
    }
  }
  return files;
}

async function main() {
  const { data: rows, error } = await admin
    .from('audios')
    .select('id, tenant_id, summary_id, storage_path, size_bytes')
    .like('storage_path', '%.wav');
  if (error) throw error;

  console.log(`${rows.length} áudio(s) WAV com row no banco.`);
  const workDir = await mkdtemp(path.join(tmpdir(), 'podzap-convert-'));
  let savedBytes = 0;

  try {
    for (const row of rows) {
      const oggPath = row.storage_path.replace(/\.wav$/, '.ogg');
      process.stdout.write(`→ ${row.storage_path} ... `);

      const { data: blob, error: dlErr } = await admin.storage.from(BUCKET).download(row.storage_path);
      if (dlErr) { console.log(`SKIP (download falhou: ${dlErr.message})`); continue; }
      const wav = Buffer.from(await blob.arrayBuffer());

      const ogg = await transcode(wav, workDir, row.id);

      const { error: upErr } = await admin.storage.from(BUCKET)
        .upload(oggPath, ogg, { contentType: 'audio/ogg', upsert: true });
      if (upErr) { console.log(`FAIL (upload: ${upErr.message})`); continue; }

      const { error: dbErr } = await admin.from('audios')
        .update({ storage_path: oggPath, size_bytes: ogg.byteLength })
        .eq('id', row.id);
      if (dbErr) { console.log(`FAIL (update row: ${dbErr.message})`); continue; }

      const { error: rmErr } = await admin.storage.from(BUCKET).remove([row.storage_path]);
      const rmNote = rmErr ? ` (wav antigo NÃO removido: ${rmErr.message})` : '';

      savedBytes += wav.byteLength - ogg.byteLength;
      console.log(`OK ${(wav.byteLength / 1e6).toFixed(1)}MB → ${(ogg.byteLength / 1e6).toFixed(1)}MB${rmNote}`);
    }
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }

  // Órfãos: .wav no bucket sem row apontando pra eles
  const allFiles = await listAllFiles();
  const { data: freshRows } = await admin.from('audios').select('storage_path');
  const referenced = new Set((freshRows ?? []).map((r) => r.storage_path));
  const orphans = allFiles.filter((f) => f.endsWith('.wav') && !referenced.has(f));

  if (orphans.length > 0) {
    console.log(`\n${orphans.length} órfão(s) .wav sem row:`);
    for (const o of orphans) console.log(`  - ${o}`);
    if (deleteOrphans) {
      const { error: delErr } = await admin.storage.from(BUCKET).remove(orphans);
      console.log(delErr ? `Falha ao remover: ${delErr.message}` : 'Órfãos removidos.');
    } else {
      console.log('(re-rode com --delete-orphans pra removê-los)');
    }
  }

  console.log(`\nEconomia total: ${(savedBytes / 1e6).toFixed(1)} MB`);
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
