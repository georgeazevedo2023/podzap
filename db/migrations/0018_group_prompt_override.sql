-- =====================================================================
-- podZAP — 0018_group_prompt_override
-- =====================================================================
-- Power-user override: textarea livre que substitui o template do
-- catálogo quando preenchido. Pra cliente "padrão" continua null e o
-- fluxo Fase B+C (template_id) prevalece.
--
-- Validação:
--   - 100..6000 chars (LLM context cap + UI sanity)
--   - precisa conter ao menos um placeholder de host pra modo duo
--     funcionar (validado em prompt.ts, não em check constraint —
--     check constraint não consegue olhar prompt_template_id sem
--     trigger, e isso é overkill).
--
-- Quando set:
--   - lib/summary/prompt.ts ignora o template_id e usa prompt_override
--     como systemPrompt diretamente (com a mesma var substitution).
--   - O voiceMode é decidido pelo `default_voice_mode` do grupo
--     (fallback) ou pelo body da request (override).
--
-- Trade-off conhecido: prompt injection é ATTACKABLE (cliente loga
-- arbitrário no prompt do sistema). Mitigações:
--   1) campo é PRIVATE pro tenant — não vaza pra outros
--   2) custos do Gemini são rate-limited pelo /api/summaries/generate
--      (10/h/tenant, 0007 em adiante)
--   3) length cap (6000) limita explosão
-- =====================================================================

alter table public.groups
  add column if not exists prompt_override text
    check (
      prompt_override is null
      or (
        char_length(prompt_override) between 100 and 6000
      )
    );

comment on column public.groups.prompt_override is
  'System prompt customizado (power user). Quando preenchido, '
  'sobrescreve prompt_template_id no fluxo de geração. NULL = usa '
  'template do catálogo. Length 100-6000 chars.';

-- =====================================================================
-- End of 0018_group_prompt_override.
-- =====================================================================
