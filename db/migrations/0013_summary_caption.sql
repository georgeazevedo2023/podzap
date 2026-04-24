-- =====================================================================
-- Adiciona `caption` ao summary — texto curto com emojis usado como
-- legenda do áudio no WhatsApp e como preview na UI.
-- =====================================================================
-- Diferença com `summaries.text`:
--   - `text`: roteiro narrativo completo (~500-900 palavras) que vai pro
--     TTS virar áudio.
--   - `caption`: teaser curto (~3-6 linhas, emoji-rich, estilo "🎙 A HORA
--     MAIS AGUARDADA DO DIA CHEGOU!") que acompanha o áudio no zap ou
--     aparece como preview. Vale ser editado manualmente.
--
-- Opcional — rows antigas ficam com caption=NULL e a UI/delivery caem
-- no fallback (usar uma slice de `text` ou ocultar o preview).
-- =====================================================================

alter table public.summaries
  add column if not exists caption text;
