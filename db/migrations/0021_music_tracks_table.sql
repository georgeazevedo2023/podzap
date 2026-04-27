-- =====================================================================
-- podZAP — 0021_music_tracks_table
-- =====================================================================
-- Catálogo dinâmico de músicas de fundo. Antes deste step, o catálogo
-- vivia hardcoded em `lib/audios/music.ts` + CHECK constraint em
-- `groups.background_music` (migration 0020). Pra permitir o superadmin
-- subir tracks novas via UI (`/admin/music`), promove o catálogo pra
-- tabela e dropa o CHECK.
--
-- Tipos de track:
--   - sentinel ('none'): sem arquivo, mixer pula música.
--   - builtin (`builtin_filename` set, `storage_path` null): arquivo
--     em `assets/<filename>` baked na imagem Docker (fluxo legado dos
--     6 IDs da migration 0020). Mantido pra preservar 'default'.
--   - upload (`storage_path` set): arquivo subido pro bucket `music`
--     do Supabase Storage (criado via `scripts/create-music-bucket.mjs`).
--     UI admin gera ID sluggified do label.
--
-- Soft delete via `is_active=false`. Pra não quebrar grupos que
-- referenciam um id inativo, o resolver do mixer faz fallback pra
-- 'default' silenciosamente. `groups.background_music` deixa de ter
-- FK enforced — qualquer string passa, com fallback no resolve.
--
-- Sentinels ('none' e 'default') NUNCA devem ser deletados/desativados;
-- a UI esconde os botões e a API valida.
-- =====================================================================

create table if not exists public.music_tracks (
  id text primary key,
  label text not null,
  description text not null default '',
  emoji text not null default '🎵',
  storage_path text,
  builtin_filename text,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- exatamente um dos modos: sentinel (id='none'), builtin, ou upload.
  constraint music_tracks_kind_check check (
    (id = 'none' and storage_path is null and builtin_filename is null)
    or (id <> 'none' and (storage_path is not null) <> (builtin_filename is not null))
  )
);

create index if not exists idx_music_tracks_active_order
  on public.music_tracks (is_active, sort_order)
  where is_active = true;

comment on table public.music_tracks is
  'Catálogo de tracks de fundo do podcast. Gerenciado via /admin/music. '
  'Tracks builtin são bake-in (assets/), uploads vão pro bucket Storage music.';
comment on column public.music_tracks.storage_path is
  'Caminho dentro do bucket `music` (ex: "tenant-uploads/upbeat-2026.mp3"). '
  'Mutuamente exclusivo com builtin_filename.';
comment on column public.music_tracks.builtin_filename is
  'Nome do arquivo em assets/ (ex: "podcast-music.mp3"). Mutuamente '
  'exclusivo com storage_path. Usado só pelos seeds legados.';
comment on column public.music_tracks.is_active is
  'Soft delete. Track inativa some da UI dos grupos mas grupos que já '
  'apontam pra ela continuam resolvendo (com fallback pra default se '
  'o arquivo sumir).';
comment on column public.music_tracks.sort_order is
  'Ordem na UI. Menor = mais cedo. Sentinel "none" = 0, default = 1.';

-- Seed: porta os 6 IDs do catálogo hardcoded antigo (lib/audios/music.ts)
-- preservando label/description/emoji. Tracks chillout/upbeat/epic/lofi
-- ainda apontam pra arquivos que NÃO existem em assets/ — o resolver
-- faz fallback pro default e warn no console (igual comportamento atual).
insert into public.music_tracks
  (id, label, description, emoji, builtin_filename, sort_order)
values
  ('none',     'Sem música',
    'só a voz, sem trilha de fundo. áudio mais limpo.',
    '🔇',  null,                              0),
  ('default',  'Padrão',
    'trilha do podZAP — quente, neutra, funciona bem em qualquer tom.',
    '🎵',  'podcast-music.mp3',               1),
  ('chillout', 'Chillout',
    'ambiente relaxado, ritmo lento. casa com tom descontraído.',
    '🌊',  'podcast-music-chillout.mp3',      2),
  ('upbeat',   'Upbeat',
    'energético, animado. boa pra fofoca e divertido.',
    '⚡',  'podcast-music-upbeat.mp3',        3),
  ('epic',     'Épico',
    'cinematográfico, dramático. funciona em narração séria/esportiva.',
    '🎬',  'podcast-music-epic.mp3',          4),
  ('lofi',     'Lo-fi',
    'beats relaxados, study mood. casual.',
    '☕',  'podcast-music-lofi.mp3',          5)
on conflict (id) do nothing;

-- Dropa CHECK constraint da migration 0020 — agora qualquer id passa,
-- com soft fallback no mixer pra default.
alter table public.groups
  drop constraint if exists groups_background_music_check;

-- =====================================================================
-- End of 0021_music_tracks_table.
-- =====================================================================
