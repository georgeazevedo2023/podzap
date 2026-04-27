-- =====================================================================
-- podZAP — 0020_group_background_music
-- =====================================================================
-- Música de fundo por grupo (Pacote 5). Atualmente o mixer
-- (lib/audios/mix.ts) usa um único arquivo `assets/podcast-music.mp3`
-- pra TODOS os tenants. Esta migration permite o cliente escolher entre
-- um catálogo de tracks (id → arquivo no assets/).
--
-- Decisão: catálogo enumerado (`default`, `chillout`, `upbeat`, etc.) —
-- os arquivos físicos vão pro repo via PRs separadas (assets/ está no
-- builder da imagem Docker), tipo as outras assets visuais. Catálogo
-- canônico em `lib/audios/music.ts`.
--
-- Compatibilidade: rows existentes ficam com 'default' → resolve no
-- arquivo atual (assets/podcast-music.mp3). Cliente pode escolher
-- 'none' pra desativar a música de fundo (gera só voz).
-- =====================================================================

alter table public.groups
  add column if not exists background_music text not null default 'default'
    check (background_music in (
      'none',
      'default',
      'chillout',
      'upbeat',
      'epic',
      'lofi'
    ));

comment on column public.groups.background_music is
  'Track de fundo do podcast deste grupo. ''none'' = só voz, sem música. '
  'IDs mapeados pra arquivos físicos em lib/audios/music.ts.';

-- =====================================================================
-- End of 0020_group_background_music.
-- =====================================================================
