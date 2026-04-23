/**
 * Groq Whisper Large v3 — speech-to-text wrapper.
 *
 * Required env: GROQ_API_KEY, GROQ_STT_MODEL (defaults to whisper-large-v3)
 * Package: groq-sdk ^1.1.x
 */

import Groq from 'groq-sdk';
import { toFile } from 'groq-sdk/uploads';
import { AiError, requireEnv } from './errors';

export type TranscribeAudioInput =
  | Buffer
  | Blob
  | { url: string };

export type TranscribeAudioOptions = {
  /** ISO-639-1 code. Defaults to 'pt' (PT-BR) for podZAP. */
  language?: string;
  /** Optional biasing prompt (<= 224 tokens) to hint domain vocabulary. */
  prompt?: string;
};

export type TranscribeAudioResult = {
  text: string;
  language: string;
  durationSeconds?: number;
  model: string;
};

let cachedClient: Groq | null = null;

function getClient(): Groq {
  if (cachedClient) return cachedClient;
  cachedClient = new Groq({ apiKey: requireEnv('GROQ_API_KEY') });
  return cachedClient;
}

async function toUploadable(
  audio: TranscribeAudioInput,
): Promise<Awaited<ReturnType<typeof toFile>>> {
  if (Buffer.isBuffer(audio)) {
    return toFile(audio, 'audio.ogg');
  }
  if (typeof Blob !== 'undefined' && audio instanceof Blob) {
    return toFile(audio, 'audio.ogg');
  }
  if (typeof audio === 'object' && audio !== null && 'url' in audio) {
    const res = await fetch(audio.url);
    if (!res.ok) {
      throw new AiError(
        'invalid_input',
        `Failed to fetch audio URL (${res.status} ${res.statusText})`,
      );
    }
    const arrayBuffer = await res.arrayBuffer();
    return toFile(Buffer.from(arrayBuffer), 'audio.ogg');
  }
  throw new AiError('invalid_input', 'Unsupported audio input type');
}

/**
 * Transcribe an audio clip using Groq's hosted Whisper Large v3.
 *
 * Uses `verbose_json` response format so we can surface `duration` and
 * detected `language` alongside the plain text.
 */
export async function transcribeAudio(
  audio: TranscribeAudioInput,
  options?: TranscribeAudioOptions,
): Promise<TranscribeAudioResult> {
  const model = process.env.GROQ_STT_MODEL ?? 'whisper-large-v3';
  const client = getClient();
  const file = await toUploadable(audio);

  try {
    const response = await client.audio.transcriptions.create({
      file,
      model,
      language: options?.language ?? 'pt',
      prompt: options?.prompt,
      response_format: 'verbose_json',
      temperature: 0,
    });

    // verbose_json returns { text, language, duration, segments, ... }
    const verbose = response as unknown as {
      text: string;
      language?: string;
      duration?: number;
    };

    return {
      text: verbose.text,
      language: verbose.language ?? options?.language ?? 'pt',
      durationSeconds: verbose.duration,
      model,
    };
  } catch (err) {
    throw new AiError(
      'transcription_failed',
      err instanceof Error ? err.message : 'Unknown Groq transcription error',
      err,
    );
  }
}
