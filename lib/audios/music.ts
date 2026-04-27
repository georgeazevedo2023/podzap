/**
 * Catálogo de tracks de fundo. Mapeia o `background_music` enum (DB)
 * pra arquivos físicos em `assets/` que são copiados pra image Docker
 * (COPY . . no builder stage).
 *
 * Pra adicionar uma track nova:
 *   1) sobe o .mp3 pra `assets/podcast-music-<id>.mp3` no repo
 *   2) adiciona o id no CHECK constraint da migration 0020 (ou cria
 *      migration nova ampliando)
 *   3) adiciona entry aqui com label/description/file
 *
 * Tracks atuais (rationale):
 *   - none      → user opta por sair com só voz, sem música
 *   - default   → aponta pro `podcast-music.mp3` original (compat)
 *   - chillout  → ambiente, mood relax
 *   - upbeat    → energético, marketing/podcast pop
 *   - epic      → cinematográfico, narração séria
 *   - lofi      → study-beats, casual
 *
 * Pendência: os arquivos chillout/upbeat/epic/lofi precisam ser
 * uploaded como PR separada — o catálogo permite gravar a escolha do
 * user no DB, mas se o arquivo não existir o mixer cai no fallback
 * legado (silently warn no console + voz pura).
 */

import path from 'node:path';

export type MusicId =
  | 'none'
  | 'default'
  | 'chillout'
  | 'upbeat'
  | 'epic'
  | 'lofi';

export type MusicMeta = {
  id: MusicId;
  label: string;
  description: string;
  emoji: string;
  /**
   * Path absoluto pro arquivo no container, ou `null` quando id='none'.
   * Build via path.join pra cross-platform (dev macOS/win, prod Linux).
   */
  filePath: string | null;
};

const ASSETS_DIR = path.join(process.cwd(), 'assets');

export const MUSIC_TRACKS: Record<MusicId, MusicMeta> = {
  none: {
    id: 'none',
    label: 'Sem música',
    description: 'só a voz, sem trilha de fundo. áudio mais limpo.',
    emoji: '🔇',
    filePath: null,
  },
  default: {
    id: 'default',
    label: 'Padrão',
    description:
      'trilha do podZAP — quente, neutra, funciona bem em qualquer tom.',
    emoji: '🎵',
    filePath: path.join(ASSETS_DIR, 'podcast-music.mp3'),
  },
  chillout: {
    id: 'chillout',
    label: 'Chillout',
    description: 'ambiente relaxado, ritmo lento. casa com tom descontraído.',
    emoji: '🌊',
    filePath: path.join(ASSETS_DIR, 'podcast-music-chillout.mp3'),
  },
  upbeat: {
    id: 'upbeat',
    label: 'Upbeat',
    description: 'energético, animado. boa pra fofoca e divertido.',
    emoji: '⚡',
    filePath: path.join(ASSETS_DIR, 'podcast-music-upbeat.mp3'),
  },
  epic: {
    id: 'epic',
    label: 'Épico',
    description:
      'cinematográfico, dramático. funciona em narração séria/esportiva.',
    emoji: '🎬',
    filePath: path.join(ASSETS_DIR, 'podcast-music-epic.mp3'),
  },
  lofi: {
    id: 'lofi',
    label: 'Lo-fi',
    description: 'beats relaxados, study mood. casual.',
    emoji: '☕',
    filePath: path.join(ASSETS_DIR, 'podcast-music-lofi.mp3'),
  },
};

export const MUSIC_IDS: MusicId[] = Object.keys(MUSIC_TRACKS) as MusicId[];

export function resolveMusic(id: string | null | undefined): MusicMeta {
  if (id && id in MUSIC_TRACKS) return MUSIC_TRACKS[id as MusicId];
  return MUSIC_TRACKS.default;
}
