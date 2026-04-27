-- =====================================================================
-- podZAP — 0019_group_voices
-- =====================================================================
-- Voice picker per host. Cada grupo escolhe a voz de cada apresentador
-- separadamente do catálogo Gemini TTS prebuilt voices. Defaults
-- preservam o comportamento pré-Pacote 4 (Kore + Charon).
--
-- Catálogo enumerado em lib/audios/voices.ts. Mantemos sincronizado:
-- adicionar voz nova exige migration nova ampliando o CHECK constraint.
-- =====================================================================

alter table public.groups
  add column if not exists voice1_id text not null default 'Kore'
    check (voice1_id in (
      'Kore', 'Leda', 'Sadachbia', 'Aoede',
      'Charon', 'Puck', 'Orus', 'Fenrir'
    )),
  add column if not exists voice2_id text not null default 'Charon'
    check (voice2_id in (
      'Kore', 'Leda', 'Sadachbia', 'Aoede',
      'Charon', 'Puck', 'Orus', 'Fenrir'
    ));

comment on column public.groups.voice1_id is
  'Prebuilt voice do Gemini TTS pro host 1. Catálogo em '
  'lib/audios/voices.ts. Default ''Kore'' (feminina, warm) preserva '
  'comportamento pré-Pacote 4.';
comment on column public.groups.voice2_id is
  'Prebuilt voice pro host 2. Default ''Charon'' (masculino, firme).';

-- =====================================================================
-- End of 0019_group_voices.
-- =====================================================================
