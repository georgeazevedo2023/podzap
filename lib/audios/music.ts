/**
 * Catálogo de tracks de fundo. Pós-migration 0021 o catálogo vive em DB
 * (`music_tracks`) e o admin gerencia via /admin/music. Este módulo:
 *
 *   1. Mantém o catálogo legado (`MUSIC_TRACKS`) como FALLBACK estático
 *      pro mixer — se o DB falhar / track sumir, o resolver volta pra
 *      assets/ baked. Garante que o áudio sai mesmo com Storage offline.
 *
 *   2. Expõe `resolveMusicAsync(id)` — async, hits DB + baixa blob de
 *      Supabase Storage pra cache local em `/tmp` quando track é upload.
 *      Retorna `{ id, filePath: string | null }`. `filePath=null` = sem
 *      música (sentinel 'none'). Mixer aceita null e gera voz pura.
 *
 * Pra adicionar uma track nova:
 *   - via UI /admin/music (recomendado): upload .mp3 + label
 *   - via repo (legado): coloca em assets/podcast-music-<id>.mp3 e
 *     adiciona seed na próxima migration
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { createAdminClient } from "@/lib/supabase/admin";

// ──────────────────────────────────────────────────────────────────────────
//  Catálogo estático (fallback)
// ──────────────────────────────────────────────────────────────────────────

/** ID de track. Pré-0021 era enum literal; agora é string aberta. */
export type MusicId = string;

export type MusicMeta = {
  id: MusicId;
  label: string;
  description: string;
  emoji: string;
  /** Path local pra builtin (assets/). Null = sentinel 'none' ou upload sem fallback. */
  filePath: string | null;
};

const ASSETS_DIR = path.join(process.cwd(), "assets");

/**
 * Catálogo estático — apenas pros 6 IDs do seed da migration 0021.
 * Uploads do admin NÃO aparecem aqui (vivem em DB+Storage e são
 * resolvidos via `resolveMusicAsync`).
 */
export const MUSIC_TRACKS: Record<string, MusicMeta> = {
  none: {
    id: "none",
    label: "Sem música",
    description: "só a voz, sem trilha de fundo. áudio mais limpo.",
    emoji: "🔇",
    filePath: null,
  },
  default: {
    id: "default",
    label: "Padrão",
    description:
      "trilha do podZAP — quente, neutra, funciona bem em qualquer tom.",
    emoji: "🎵",
    filePath: path.join(ASSETS_DIR, "podcast-music.mp3"),
  },
  chillout: {
    id: "chillout",
    label: "Chillout",
    description: "ambiente relaxado, ritmo lento. casa com tom descontraído.",
    emoji: "🌊",
    filePath: path.join(ASSETS_DIR, "podcast-music-chillout.mp3"),
  },
  upbeat: {
    id: "upbeat",
    label: "Upbeat",
    description: "energético, animado. boa pra fofoca e divertido.",
    emoji: "⚡",
    filePath: path.join(ASSETS_DIR, "podcast-music-upbeat.mp3"),
  },
  epic: {
    id: "epic",
    label: "Épico",
    description:
      "cinematográfico, dramático. funciona em narração séria/esportiva.",
    emoji: "🎬",
    filePath: path.join(ASSETS_DIR, "podcast-music-epic.mp3"),
  },
  lofi: {
    id: "lofi",
    label: "Lo-fi",
    description: "beats relaxados, study mood. casual.",
    emoji: "☕",
    filePath: path.join(ASSETS_DIR, "podcast-music-lofi.mp3"),
  },
};

export const MUSIC_IDS = Object.keys(MUSIC_TRACKS);

/**
 * Resolver síncrono — usado em fallback paths (mixer com DB offline).
 * Não conhece uploads do admin; pra isso veja `resolveMusicAsync`.
 */
export function resolveMusic(id: string | null | undefined): MusicMeta {
  if (id && id in MUSIC_TRACKS) return MUSIC_TRACKS[id];
  return MUSIC_TRACKS.default;
}

// ──────────────────────────────────────────────────────────────────────────
//  Resolver assíncrono (DB-aware)
// ──────────────────────────────────────────────────────────────────────────

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
        const filePath = path.join(ASSETS_DIR, row.builtin_filename);
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
