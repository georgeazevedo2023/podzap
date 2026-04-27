/**
 * Catálogo de vozes Gemini TTS exposto pro voice picker per host.
 *
 * Lista derivada da prebuilt voice catalog do Gemini TTS:
 *   https://ai.google.dev/gemini-api/docs/speech-generation
 *
 * Cada entry tem:
 *   - id          : string que vai literalmente pra `voiceName` na request
 *                   da API. Mantém em sync com o CHECK constraint da
 *                   migration 0019.
 *   - label       : nome amigável pra UI.
 *   - gender      : "feminina" | "masculino" — só pra organizar/filtrar
 *                   no picker, NÃO afeta o output.
 *   - description : 1 linha curta sobre o "tom" da voz (perceptual,
 *                   baseado nos demos da Google).
 *   - emoji       : pequeno marcador visual no card.
 *
 * Gender association no DB é convenção:
 *   host1 = voz feminina (Kore/Leda/Sadachbia/Aoede)
 *   host2 = voz masculina (Charon/Puck/Orus/Fenrir)
 *
 * Nada impede o user trocar (modal aceita qualquer combinação), mas o
 * default + UI ordering reforça essa convenção pra reduzir confusão.
 */

export type VoiceId =
  | 'Kore'
  | 'Leda'
  | 'Sadachbia'
  | 'Aoede'
  | 'Charon'
  | 'Puck'
  | 'Orus'
  | 'Fenrir';

export type VoiceMeta = {
  id: VoiceId;
  label: string;
  gender: 'feminina' | 'masculino';
  description: string;
  emoji: string;
};

export const VOICES: Record<VoiceId, VoiceMeta> = {
  // Femininas — convencionalmente host1
  Kore: {
    id: 'Kore',
    label: 'Kore',
    gender: 'feminina',
    description: 'warm, mid-pitched. tom acolhedor — default.',
    emoji: '🎙️',
  },
  Leda: {
    id: 'Leda',
    label: 'Leda',
    gender: 'feminina',
    description: 'jovial, brilhante. boa pra tom descontraído.',
    emoji: '✨',
  },
  Sadachbia: {
    id: 'Sadachbia',
    label: 'Sadachbia',
    gender: 'feminina',
    description: 'profissional, clara. boa pra informativo.',
    emoji: '📰',
  },
  Aoede: {
    id: 'Aoede',
    label: 'Aoede',
    gender: 'feminina',
    description: 'suave, melódica. funciona bem em fofoca/dramático.',
    emoji: '🎵',
  },
  // Masculinos — convencionalmente host2
  Charon: {
    id: 'Charon',
    label: 'Charon',
    gender: 'masculino',
    description: 'firme, low-pitched. tom autoritário — default.',
    emoji: '🎙️',
  },
  Puck: {
    id: 'Puck',
    label: 'Puck',
    gender: 'masculino',
    description: 'jovem, brincalhão. casa com tom divertido.',
    emoji: '🃏',
  },
  Orus: {
    id: 'Orus',
    label: 'Orus',
    gender: 'masculino',
    description: 'ressonante, sério. ideal pra esportivo/formal.',
    emoji: '🎤',
  },
  Fenrir: {
    id: 'Fenrir',
    label: 'Fenrir',
    gender: 'masculino',
    description: 'profundo, dramático. funciona em narração épica.',
    emoji: '🐺',
  },
};

export const VOICE_IDS: VoiceId[] = Object.keys(VOICES) as VoiceId[];

export const FEMININE_VOICES: VoiceId[] = VOICE_IDS.filter(
  (id) => VOICES[id].gender === 'feminina',
);

export const MASCULINE_VOICES: VoiceId[] = VOICE_IDS.filter(
  (id) => VOICES[id].gender === 'masculino',
);

/**
 * Lookup defensivo: aceita qualquer string, retorna 'Kore' quando não
 * casar (mesmo padrão de `resolveTemplate` em lib/summary/templates.ts).
 */
export function resolveVoice(id: string | null | undefined): VoiceMeta {
  if (id && id in VOICES) return VOICES[id as VoiceId];
  return VOICES.Kore;
}
