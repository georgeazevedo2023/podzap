/**
 * Catálogo estático de tracks (lado client-safe).
 *
 * Pós-migration 0021 o catálogo canônico vive em DB (`music_tracks`).
 * Este módulo:
 *   - declara o tipo `MusicId` (string aberta) e a metadata MusicMeta
 *   - mantém o snapshot dos 6 IDs do seed como FALLBACK estático pra:
 *       a) clientes (EditGroupModal) durante carregamento de /api/groups/music
 *       b) servidor quando o DB / Storage falham (resolveMusic síncrono)
 *
 * Importante: este arquivo NÃO usa `node:fs`/`node:os`/etc — assim pode
 * ser importado por componentes "use client" sem quebrar o bundler do
 * Turbopack. Resolver async (com fs+Storage) vive em
 * `lib/audios/music-resolver.ts`.
 */

import path from "node:path";

/** ID de track. Pré-0021 era enum literal; agora é string aberta. */
export type MusicId = string;

export type MusicMeta = {
  id: MusicId;
  label: string;
  description: string;
  emoji: string;
  /** Path local pra builtin (assets/). Null = sentinel 'none'. */
  filePath: string | null;
};

const ASSETS_DIR = path.join(process.cwd(), "assets");

/**
 * Catálogo estático — apenas pros 6 IDs do seed da migration 0021.
 * Uploads do admin NÃO aparecem aqui (vivem em DB+Storage e são
 * resolvidos via `resolveMusicAsync` em `music-resolver.ts`).
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
 * Resolver síncrono — fallback estático. Não conhece uploads do admin;
 * pra isso veja `resolveMusicAsync` em `music-resolver.ts`.
 */
export function resolveMusic(id: string | null | undefined): MusicMeta {
  if (id && id in MUSIC_TRACKS) return MUSIC_TRACKS[id];
  return MUSIC_TRACKS.default;
}

/** Path absoluto pro arquivo de uma builtin track em assets/. */
export function builtinAssetPath(filename: string): string {
  return path.join(ASSETS_DIR, filename);
}
