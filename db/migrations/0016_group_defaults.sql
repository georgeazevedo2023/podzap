-- =====================================================================
-- podZAP — 0016_group_defaults
-- =====================================================================
-- Defaults por grupo pra reduzir cliques no /groups → "✨ gerar resumo".
--
-- Antes desta migration, toda geração on-demand exigia 4 cliques no
-- GenerateNowModal (grupo + tom + período + voiceMode). Com defaults
-- guardados no próprio grupo, o card de /groups dispara POST direto:
-- 1 clique. O modal só é necessário quando o usuário quer override.
--
-- Defaults sensatos:
--   - default_tone        = 'fun'       (era o default visual)
--   - default_voice_mode  = 'duo'       (Ana+Beto = diferencial do produto)
--   - default_period      = '24h'       (cobre o uso diário)
--
-- Migrations futuras (Fases B/C) adicionarão: host1_name/host2_name,
-- prompt_template_id/prompt_override, background_music. Mantenho ESTA
-- migration enxuta — só os 3 campos que a Fase A consome.
-- =====================================================================

alter table public.groups
  add column if not exists default_tone summary_tone not null default 'fun',
  add column if not exists default_voice_mode text not null default 'duo'
    check (default_voice_mode in ('single', 'duo')),
  add column if not exists default_period text not null default '24h'
    check (default_period in ('24h', '7d'));

comment on column public.groups.default_tone is
  'Tom default usado quando "✨ gerar" no /groups card é clicado sem '
  'override. Sobrescrito por body.tone na API /api/summaries/generate.';
comment on column public.groups.default_voice_mode is
  'Formato de áudio default (single|duo). Mesma semântica de '
  'summaries.voice_mode mas decidido no tempo da request a partir do grupo.';
comment on column public.groups.default_period is
  'Janela default ("24h"|"7d") usada pelo 1-click gerar. A API '
  'converte em periodStart/periodEnd no momento da request.';

-- =====================================================================
-- End of 0016_group_defaults.
-- =====================================================================
