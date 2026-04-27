/**
 * Resolver assíncrono server-only — bate em DB (`music_tracks`) + baixa
 * blob de Supabase Storage pra cache em /tmp quando track é upload do
 * admin.
 *
 * Mantido SEPARADO de `lib/audios/music.ts` porque importa `node:fs`/
 * `node:os`/`node:crypto`, e o catálogo estático é importado por
 * client components (EditGroupModal) — Turbopack rejeita node:* no
 * client bundle.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { createAdminClient } from "@/lib/supabase/admin";

import { builtinAssetPath, MUSIC_TRACKS } from "./music";

const BUCKET = "music";
const CACHE_DIR = path.join(tmpdir(), "podzap-music-cache");

/** In-memory dedupe — mesma track requested em paralelo só baixa uma vez. */
const inFlight = new Map<string, Promise<string>>();

function ensureCacheDir(): void {
  if (!existsSync(CACHE_DIR)) {
    mkdirSync(CACHE_DIR, { recursive: true });
  }
}

function cachePathFor(storagePath: string): string {
  const hash = createHash("sha256").update(storagePath).digest("hex").slice(0, 16);
  const ext = path.extname(storagePath) || ".mp3";
  return path.join(CACHE_DIR, `${hash}${ext}`);
}

/**
 * Baixa blob de Storage pra cache em /tmp. Cache é per-storage_path:
 * tracks atualizadas (admin sobe novo arquivo, hash do storage_path
 * muda) viram entradas novas no cache; arquivos antigos ficam até OS
 * limpar /tmp (aceitável — tracks são ≤15MB).
 */
async function downloadToCache(storagePath: string): Promise<string> {
  const cached = cachePathFor(storagePath);
  if (existsSync(cached)) return cached;

  const existing = inFlight.get(storagePath);
  if (existing) return existing;

  const promise = (async () => {
    ensureCacheDir();
    const admin = createAdminClient();
    const { data, error } = await admin.storage.from(BUCKET).download(storagePath);
    if (error || !data) {
      throw new Error(
        `Failed to download music from Storage (${storagePath}): ${
          error?.message ?? "no body"
        }`,
      );
    }
    const buf = Buffer.from(await data.arrayBuffer());
    await writeFile(cached, buf);
    return cached;
  })();

  inFlight.set(storagePath, promise);
  try {
    return await promise;
  } finally {
    inFlight.delete(storagePath);
  }
}

export type ResolvedMusic = {
  id: string;
  /** Path local pronto pro ffmpeg. Null = sentinel 'none' ou fallback sumiu. */
  filePath: string | null;
};

/**
 * Resolve track pra um path local, async.
 *
 * Ordem:
 *   1. id='none' → { filePath: null } (mixer pula)
 *   2. row em music_tracks com storage_path → download cached
 *   3. row em music_tracks com builtin_filename → assets/<filename>
 *   4. fallback estático (catálogo MUSIC_TRACKS, ids legados)
 *   5. fallback final default → assets/podcast-music.mp3 (só se existir)
 *
 * Best-effort: qualquer falha (DB, Storage, FS) cai pro fallback default
 * silenciosamente + warn no console. Mixer sempre recebe um path
 * utilizável OU null — nunca lança.
 */
export async function resolveMusicAsync(
  id: string | null | undefined,
): Promise<ResolvedMusic> {
  const trackId = (id ?? "default").trim() || "default";
  if (trackId === "none") {
    return { id: "none", filePath: null };
  }

  // 1. Tenta DB
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("music_tracks")
      .select("id, storage_path, builtin_filename, is_active")
      .eq("id", trackId)
      .maybeSingle();

    if (!error && data && data.is_active) {
      const row = data as {
        id: string;
        storage_path: string | null;
        builtin_filename: string | null;
      };
      if (row.storage_path) {
        try {
          const localPath = await downloadToCache(row.storage_path);
          return { id: row.id, filePath: localPath };
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn(
            `[music] Storage download failed for ${trackId}, falling back to default: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      } else if (row.builtin_filename) {
        const filePath = builtinAssetPath(row.builtin_filename);
        if (existsSync(filePath)) {
          return { id: row.id, filePath };
        }
        // builtin file missing — cai pro fallback abaixo
      }
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      `[music] DB lookup failed for ${trackId}, using static fallback: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  // 2. Fallback catálogo estático
  const staticMeta = MUSIC_TRACKS[trackId];
  if (staticMeta?.filePath && existsSync(staticMeta.filePath)) {
    return { id: trackId, filePath: staticMeta.filePath };
  }

  // 3. Fallback default
  const fallback = MUSIC_TRACKS.default;
  if (fallback?.filePath && existsSync(fallback.filePath)) {
    // eslint-disable-next-line no-console
    console.warn(
      `[music] Track "${trackId}" não resolveu, usando default.`,
    );
    return { id: "default", filePath: fallback.filePath };
  }

  // 4. Sem fallback — mixer cai pra voz pura
  return { id: trackId, filePath: null };
}
