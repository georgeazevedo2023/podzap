-- =====================================================================
-- podZAP — 0010_summary_voice_mode
-- =====================================================================
-- Adiciona `voice_mode` em summaries. Valores: 'single' (locução solo,
-- comportamento atual) ou 'duo' (dialogo entre 2 apresentadores, Gemini
-- multiSpeakerVoiceConfig).
--
-- Por que em summaries e não em audios: a decisão afeta o PROMPT (o LLM
-- precisa gerar texto em formato `Speaker: ...` quando duo) e tem que
-- estar gravada no row antes do TTS rodar. O áudio resultante herda a
-- escolha via JOIN.
--
-- Compatibilidade: rows existentes ficam com 'single' (default). A UI e
-- a API aceitam o campo opcionalmente; omitir = single.
-- =====================================================================

alter table public.summaries
  add column if not exists voice_mode text not null default 'single'
  check (voice_mode in ('single', 'duo'));

comment on column public.summaries.voice_mode is
  'Formato de locução: ''single'' (1 voz, prebuiltVoiceConfig do Gemini) '
  'ou ''duo'' (diálogo Speaker1/Speaker2 via multiSpeakerVoiceConfig). '
  'Gravado no tempo da request pra o TTS downstream saber qual modo usar.';

-- =====================================================================
-- End of 0010_summary_voice_mode.
-- =====================================================================
