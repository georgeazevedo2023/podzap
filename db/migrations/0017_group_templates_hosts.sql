-- =====================================================================
-- podZAP — 0017_group_templates_hosts
-- =====================================================================
-- Continuação da Fase A (migration 0016): adiciona configuração rica por
-- grupo pro novo modal "Editar grupo".
--
--   - prompt_template_id : qual template do catálogo
--                          (lib/summary/templates.ts) usar. 'default-duo'
--                          mantém o comportamento atual; 'divertido',
--                          'informativo', 'fofoca', 'esportivo', 'rapido'
--                          são presets novos.
--   - host1_name         : nome do apresentador 1 (era hardcoded "Ana").
--   - host2_name         : nome do apresentador 2 (era hardcoded "Beto").
--
-- Rationale: o usuário quer 1) escolher TOM/FORMATO sem reescrever prompt
-- e 2) personalizar nomes dos apresentadores ("Maria & João" ao invés
-- de "Ana & Beto"). Antes desta migration, ambos viviam dentro de
-- `lib/summary/prompt.ts` como literais.
--
-- Compatibilidade: rows existentes ficam com 'default-duo' / 'Ana' /
-- 'Beto', então o output do LLM fica idêntico ao que era antes da
-- mudança até o usuário editar.
-- =====================================================================

alter table public.groups
  add column if not exists prompt_template_id text not null default 'default-duo'
    check (prompt_template_id in (
      'default-duo',
      'default-solo',
      'divertido',
      'informativo',
      'fofoca',
      'esportivo',
      'rapido'
    )),
  add column if not exists host1_name text not null default 'Ana'
    check (length(host1_name) between 1 and 60),
  add column if not exists host2_name text not null default 'Beto'
    check (length(host2_name) between 1 and 60);

comment on column public.groups.prompt_template_id is
  'ID do template de prompt usado pelo Gemini ao gerar resumos deste '
  'grupo. Catálogo definido em lib/summary/templates.ts.';
comment on column public.groups.host1_name is
  'Nome do apresentador 1 (substitui {{host1_name}} nos templates). '
  'No modo duo é a voz feminina por convenção; voz é decidida pelo '
  'voice_mode + posição (host1 = Sadachbia/Leda; host2 = Kore/Puck no '
  'mapa de TTS).';
comment on column public.groups.host2_name is
  'Nome do apresentador 2 (substitui {{host2_name}} nos templates).';

-- =====================================================================
-- End of 0017_group_templates_hosts.
-- =====================================================================
