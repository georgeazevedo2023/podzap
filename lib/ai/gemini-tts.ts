/**
 * Gemini TTS — text-to-speech wrapper.
 *
 * Required env: GEMINI_API_KEY, GEMINI_TTS_MODEL (default gemini-3.8-flash-tts)
 *
 * Dois caminhos, escolhidos pelo nome do modelo:
 * - `gemini-3.8-*` → Interactions API (`POST /v1beta/interactions`). O texto
 *   é transcrição LITERAL: direção de fala vai em `speech_metadata.style`
 *   por turno, e no modo duo cada turno precisa de `speaker` explícito.
 *   Resposta vem como WAV (RIFF) 24 kHz mono 16-bit.
 * - legado (`gemini-2.5-flash-preview-tts`) → generateContent via
 *   @google/genai, PCM cru que embrulhamos em WAV aqui.
 *
 * Guia: https://aistudio.google.com/learn/gemini-3-8-flash-tts-developer-guide
 */

import { GoogleGenAI } from '@google/genai';
import { AiError, requireEnv } from './errors';

export type TtsVoice = 'male' | 'female';
export type TtsMode = 'single' | 'duo';

/**
 * When `mode: 'duo'`, the text must contain `Ana:` / `Beto:` line prefixes
 * (case-sensitive). Gemini's multi-speaker TTS reads the prefix to route
 * each utterance to the right voice. Speakers not matched in the prefix
 * are inherited from the previous speaker (per Gemini's spec), so malformed
 * dialog still produces audio — it just alternates oddly.
 *
 * We pin the names "Ana" (female/Kore) and "Beto" (male/Charon) in the
 * prompt so the LLM always emits the same labels the TTS expects.
 */
export type TtsInput = {
  text: string;
  /** Solo mode: which prebuilt voice. Ignored when `mode === 'duo'`. */
  voice?: TtsVoice;
  /** Narration speed hint injected into the prompt (Gemini TTS has no `speed` param). */
  speed?: number;
  /** Locution format. Default 'single'. */
  mode?: TtsMode;
  /**
   * Override do mapping speaker→voiceName em modo duo (Pacote 4 voice
   * picker). Cada item: `speaker` precisa bater EXATAMENTE com o prefixo
   * que o LLM emitiu no `text` ("Ana:", "Maria:", etc.); `voiceName` é
   * o id de voz do Gemini (Kore/Charon/Leda/Puck/...).
   *
   * Quando ausente, cai no default legado (Ana=Kore, Beto=Charon) — esse
   * caminho ainda é necessário porque resumos antigos têm prefixos
   * "Ana:"/"Beto:" e nenhum group config gravado.
   */
  speakers?: ReadonlyArray<{ speaker: string; voiceName: string }>;
};

export type TtsResult = {
  audio: Buffer;
  mimeType: string;
  durationSeconds?: number;
  model: string;
};

// Voice selection based on Gemini TTS prebuilt voices.
// Full catalog: https://ai.google.dev/gemini-api/docs/speech-generation
const VOICE_MAP: Record<TtsVoice, string> = {
  male: 'Charon',    // firm, low-pitched
  female: 'Kore',    // warm, mid-pitched
};

/**
 * Fixed speaker names for duo mode. The prompt in `lib/summary/prompt.ts`
 * instructs the LLM to prefix each line with `Ana:` or `Beto:`. Mapped
 * here to the matching prebuilt voices; keep these strings identical at
 * both ends of the pipeline.
 */
const DUO_SPEAKERS = [
  { speaker: 'Ana', voiceName: VOICE_MAP.female },  // Kore
  { speaker: 'Beto', voiceName: VOICE_MAP.male },   // Charon
] as const;

const DEFAULT_TTS_MODEL = 'gemini-3.8-flash-tts';

const SAMPLE_RATE_HZ = 24_000;
const CHANNELS = 1;
const BITS_PER_SAMPLE = 16;

let cachedClient: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  if (cachedClient) return cachedClient;
  cachedClient = new GoogleGenAI({ apiKey: requireEnv('GEMINI_API_KEY') });
  return cachedClient;
}

/**
 * Wrap a raw PCM buffer in a RIFF/WAV container.
 */
function pcmToWav(pcm: Buffer, sampleRate: number = SAMPLE_RATE_HZ): Buffer {
  const byteRate = (sampleRate * CHANNELS * BITS_PER_SAMPLE) / 8;
  const blockAlign = (CHANNELS * BITS_PER_SAMPLE) / 8;
  const dataSize = pcm.length;

  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);           // PCM chunk size
  header.writeUInt16LE(1, 20);            // PCM format
  header.writeUInt16LE(CHANNELS, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(BITS_PER_SAMPLE, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, pcm]);
}

function buildPromptText(input: TtsInput): string {
  // Duo mode: as linhas já vêm com prefixos `Ana:` / `Beto:` e cues de
  // emoção entre parênteses (ex.: "(rindo)", "(animada)"). Prefixamos o
  // texto com uma instrução natural pra Gemini TTS modular energia +
  // interpretar as marcações como estilo, em vez de lê-las literalmente.
  if (input.mode === 'duo') {
    return [
      'Leia em português do Brasil a conversa entre Ana e Beto abaixo,',
      'duas apresentadoras de podcast com MUITA energia e naturalidade.',
      'Ana é descontraída, risonha, curiosa. Beto é bem-humorado, empolgado,',
      'observador. Quando aparecer uma marcação entre parênteses',
      '(ex.: "(rindo)", "(animada)", "(empolgado)", "(surpreso)",',
      '"(gargalhando)"), interprete como INDICAÇÃO DE ESTILO pra aquela',
      'fala — NÃO leia o parêntese em voz alta. Varie entonação, ritmo,',
      'risadas curtas e reações expressivas. O áudio deve soar vivo, como',
      'dois apresentadores se divertindo ao vivo, nunca monótono:',
      '',
      input.text,
    ].join('\n');
  }
  const styleDirective =
    'Narre em português do Brasil, com tom de locutor de podcast ' +
    'descontraído e ANIMADO. Quando aparecer uma marcação entre ' +
    'parênteses (ex.: "(animado)", "(rindo)", "(empolgado)", "(surpreso)"), ' +
    'interprete como indicação de estilo daquela frase — NÃO leia o ' +
    'parêntese em voz alta. Varie entonação e ritmo pra não soar monótono';
  if (input.speed && input.speed !== 1) {
    const pace = input.speed > 1 ? 'um pouco mais rápido que o normal' : 'em ritmo pausado';
    return `${styleDirective}, ${pace}:\n\n${input.text}`;
  }
  return `${styleDirective}:\n\n${input.text}`;
}

/**
 * Generate narrated audio from text.
 */
export async function generateAudio(input: TtsInput): Promise<TtsResult> {
  if (!input.text || input.text.trim().length === 0) {
    throw new AiError('invalid_input', 'TTS input text is empty');
  }

  const model = process.env.GEMINI_TTS_MODEL ?? DEFAULT_TTS_MODEL;
  if (isInteractionsModel(model)) {
    return generateAudioInteractions(input, model);
  }
  const client = getClient();
  const mode: TtsMode = input.mode ?? 'single';

  // Single-speaker: prebuiltVoiceConfig (comportamento legado).
  // Duo: multiSpeakerVoiceConfig — usa input.speakers se passado, senão
  // cai no DUO_SPEAKERS legado (Ana=Kore, Beto=Charon).
  const duoSpeakers = input.speakers ?? DUO_SPEAKERS;
  const speechConfig =
    mode === 'duo'
      ? {
          multiSpeakerVoiceConfig: {
            speakerVoiceConfigs: duoSpeakers.map((s) => ({
              speaker: s.speaker,
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: s.voiceName },
              },
            })),
          },
        }
      : {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: VOICE_MAP[input.voice ?? 'female'],
            },
          },
        };

  try {
    const response = await client.models.generateContent({
      model,
      contents: [{ role: 'user', parts: [{ text: buildPromptText(input) }] }],
      config: {
        responseModalities: ['AUDIO'],
        speechConfig,
      },
    });

    const inlineData =
      response.candidates?.[0]?.content?.parts?.[0]?.inlineData;

    if (!inlineData?.data) {
      throw new AiError('tts_failed', 'Gemini TTS returned no audio payload');
    }

    const pcm = Buffer.from(inlineData.data, 'base64');
    const wav = pcmToWav(pcm);

    const samples = pcm.length / (BITS_PER_SAMPLE / 8) / CHANNELS;
    const durationSeconds = samples / SAMPLE_RATE_HZ;

    return {
      audio: wav,
      mimeType: 'audio/wav',
      durationSeconds,
      model,
    };
  } catch (err) {
    if (err instanceof AiError) throw err;
    throw new AiError(
      'tts_failed',
      err instanceof Error ? err.message : 'Unknown Gemini TTS error',
      err,
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Gemini 3.8 TTS — Interactions API
// ─────────────────────────────────────────────────────────────────────────

const INTERACTIONS_URL =
  'https://generativelanguage.googleapis.com/v1beta/interactions';

/** Timeout generoso: episódio duo de ~5 min leva dezenas de segundos. */
const INTERACTIONS_TIMEOUT_MS = 5 * 60 * 1000;

function isInteractionsModel(model: string): boolean {
  return /^gemini-3\.8-/.test(model);
}

const BASE_STYLE_DUO =
  'português do Brasil, apresentador de podcast com muita energia e ' +
  'naturalidade, conversa viva e descontraída';
const BASE_STYLE_SOLO =
  'português do Brasil, locutor de podcast descontraído e animado, ' +
  'variando entonação e ritmo';

/** Marcação de emoção inline no roteiro do LLM: "(rindo)", "(animada)". */
const CUE_RE = /\(([^()]{1,40})\)/g;

/**
 * Tira as marcações entre parênteses do texto (o 3.8 leria em voz alta,
 * já que trata `text` como transcrição literal) e devolve-as como direção
 * de estilo pro `speech_metadata.style`.
 */
function extractCues(raw: string): { text: string; cues: string[] } {
  const cues: string[] = [];
  const text = raw
    .replace(CUE_RE, (_m, cue: string) => {
      cues.push(cue.trim());
      return ' ';
    })
    .replace(/\s{2,}/g, ' ')
    .trim();
  return { text, cues };
}

function buildStyle(base: string, cues: string[], extra?: string): string {
  const parts = [base];
  if (cues.length > 0) parts.push(`tom ${[...new Set(cues)].join(', ')}`);
  if (extra) parts.push(extra);
  return parts.join('; ');
}

type Turn = { speaker: string; text: string; cues: string[] };

/**
 * Quebra o roteiro duo em turnos `Nome: fala`. Linhas sem prefixo são
 * continuação do turno anterior. Aceita cue antes do prefixo
 * ("(animada) Ana: ...") porque o LLM às vezes emite assim.
 */
export function parseDuoTurns(
  text: string,
  speakerNames: ReadonlyArray<string>,
): Turn[] {
  const escaped = speakerNames.map((n) =>
    n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
  );
  const lineRe = new RegExp(
    `^\\s*((?:\\([^()]*\\)\\s*)*)\\**(${escaped.join('|')})\\**\\s*:\\s*(.*)$`,
    'i',
  );
  const turns: Turn[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const m = lineRe.exec(line);
    if (m) {
      const speaker =
        speakerNames.find((n) => n.toLowerCase() === m[2].toLowerCase()) ??
        m[2];
      const { text: body, cues } = extractCues(`${m[1]} ${m[3]}`);
      turns.push({ speaker, text: body, cues });
    } else if (turns.length > 0) {
      const { text: body, cues } = extractCues(line);
      const last = turns[turns.length - 1];
      last.text = `${last.text} ${body}`.trim();
      last.cues.push(...cues);
    } else {
      // Texto antes do primeiro prefixo: atribui ao primeiro host.
      const { text: body, cues } = extractCues(line);
      turns.push({ speaker: speakerNames[0], text: body, cues });
    }
  }
  return turns.filter((t) => t.text.length > 0);
}

type SpeechMetadata = {
  type: 'speech_metadata';
  style: string;
  speaker?: string;
};
type TextContent = {
  type: 'text';
  text: string;
  annotations: SpeechMetadata[];
};

function buildInteractionsBody(input: TtsInput, model: string) {
  const mode: TtsMode = input.mode ?? 'single';
  const pace =
    input.speed && input.speed !== 1
      ? input.speed > 1
        ? 'ritmo um pouco mais rápido que o normal'
        : 'ritmo pausado'
      : undefined;

  if (mode === 'duo') {
    const speakers = input.speakers ?? DUO_SPEAKERS;
    const turns = parseDuoTurns(
      input.text,
      speakers.map((s) => s.speaker),
    );
    if (turns.length === 0) {
      throw new AiError('invalid_input', 'Roteiro duo sem falas reconhecíveis');
    }
    const content: TextContent[] = turns.map((t) => ({
      type: 'text',
      text: t.text,
      annotations: [
        {
          type: 'speech_metadata',
          speaker: t.speaker,
          style: buildStyle(BASE_STYLE_DUO, t.cues, pace),
        },
      ],
    }));
    return {
      model,
      input: [{ type: 'user_input', content }],
      response_format: { type: 'audio' },
      generation_config: {
        speech_config: {
          mode: 'conversational',
          speakers: speakers.map((s) => ({
            speaker: s.speaker,
            voice: s.voiceName,
          })),
        },
      },
    };
  }

  const { text, cues } = extractCues(input.text);
  const content: TextContent[] = [
    {
      type: 'text',
      text,
      annotations: [
        {
          type: 'speech_metadata',
          style: buildStyle(BASE_STYLE_SOLO, cues, pace),
        },
      ],
    },
  ];
  return {
    model,
    input: [{ type: 'user_input', content }],
    response_format: { type: 'audio' },
    generation_config: {
      speech_config: [{ voice: VOICE_MAP[input.voice ?? 'female'] }],
    },
  };
}

/**
 * Lê um WAV (RIFF) e devolve o PCM + sample rate. Sem header (ex.:
 * `audio/l16`), trata o buffer inteiro como PCM 24 kHz.
 */
export function splitWav(buf: Buffer): { pcm: Buffer; sampleRate: number } {
  if (buf.length < 12 || buf.toString('ascii', 0, 4) !== 'RIFF') {
    return { pcm: buf, sampleRate: SAMPLE_RATE_HZ };
  }
  let sampleRate = SAMPLE_RATE_HZ;
  let offset = 12;
  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === 'fmt ') {
      sampleRate = buf.readUInt32LE(body + 4);
    } else if (id === 'data') {
      // Alguns encoders gravam size 0/0xFFFFFFFF — usa até o fim do buffer.
      const end =
        size === 0 || body + size > buf.length ? buf.length : body + size;
      return { pcm: buf.subarray(body, end), sampleRate };
    }
    offset = body + size + (size % 2);
  }
  throw new AiError('tts_failed', 'WAV do Gemini sem chunk de dados');
}

type InteractionsResponse = {
  steps?: Array<{
    type?: string;
    content?: Array<{ type?: string; data?: string }>;
  }>;
  error?: { message?: string };
};

async function generateAudioInteractions(
  input: TtsInput,
  model: string,
): Promise<TtsResult> {
  const body = buildInteractionsBody(input, model);

  let res: Response;
  try {
    res = await fetch(INTERACTIONS_URL, {
      method: 'POST',
      headers: {
        'x-goog-api-key': requireEnv('GEMINI_API_KEY'),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(INTERACTIONS_TIMEOUT_MS),
    });
  } catch (err) {
    throw new AiError(
      'tts_failed',
      err instanceof Error ? err.message : 'Gemini TTS request failed',
      err,
    );
  }

  const json = (await res.json().catch(() => ({}))) as InteractionsResponse;
  if (!res.ok) {
    throw new AiError(
      'tts_failed',
      `Gemini TTS HTTP ${res.status}: ${json.error?.message ?? 'sem detalhe'}`,
    );
  }

  const audioParts = (json.steps ?? [])
    .filter((s) => s.type === 'model_output')
    .flatMap((s) => s.content ?? [])
    .filter((c) => c.type === 'audio' && c.data);
  const last = audioParts[audioParts.length - 1];
  if (!last?.data) {
    throw new AiError('tts_failed', 'Gemini TTS returned no audio payload');
  }

  const { pcm, sampleRate } = splitWav(Buffer.from(last.data, 'base64'));
  const samples = pcm.length / (BITS_PER_SAMPLE / 8) / CHANNELS;

  return {
    audio: pcmToWav(pcm, sampleRate),
    mimeType: 'audio/wav',
    durationSeconds: samples / sampleRate,
    model,
  };
}
