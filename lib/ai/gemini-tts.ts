/**
 * Gemini 2.5 Flash Preview TTS — text-to-speech wrapper.
 *
 * Required env: GEMINI_API_KEY, GEMINI_TTS_MODEL (defaults to gemini-2.5-flash-preview-tts)
 * Package: @google/genai ^1.48.x
 *
 * Output: 24 kHz, mono, signed 16-bit PCM. We wrap it in a WAV container in-memory
 * so callers receive a playable file without a `wav` npm dependency.
 */

import { GoogleGenAI } from '@google/genai';
import { AiError, requireEnv } from './errors';

export type TtsVoice = 'male' | 'female';

export type TtsInput = {
  text: string;
  voice?: TtsVoice;
  /** Narration speed hint injected into the prompt (Gemini TTS has no `speed` param). */
  speed?: number;
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
function pcmToWav(pcm: Buffer): Buffer {
  const byteRate = (SAMPLE_RATE_HZ * CHANNELS * BITS_PER_SAMPLE) / 8;
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
  header.writeUInt32LE(SAMPLE_RATE_HZ, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(BITS_PER_SAMPLE, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, pcm]);
}

function buildPromptText(input: TtsInput): string {
  if (input.speed && input.speed !== 1) {
    const pace = input.speed > 1 ? 'um pouco mais rápido que o normal' : 'em ritmo pausado';
    return `Narre em português do Brasil, com tom natural de locutor de podcast, ${pace}:\n\n${input.text}`;
  }
  return `Narre em português do Brasil, com tom natural de locutor de podcast:\n\n${input.text}`;
}

/**
 * Generate narrated audio from text.
 */
export async function generateAudio(input: TtsInput): Promise<TtsResult> {
  if (!input.text || input.text.trim().length === 0) {
    throw new AiError('invalid_input', 'TTS input text is empty');
  }

  const model = process.env.GEMINI_TTS_MODEL ?? 'gemini-2.5-flash-preview-tts';
  const voiceName = VOICE_MAP[input.voice ?? 'female'];
  const client = getClient();

  try {
    const response = await client.models.generateContent({
      model,
      contents: [{ role: 'user', parts: [{ text: buildPromptText(input) }] }],
      config: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName },
          },
        },
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
