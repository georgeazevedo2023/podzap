/**
 * podZAP AI integration barrel.
 *
 * Providers:
 *  - Groq Whisper Large v3      → speech-to-text
 *  - Gemini 2.5 Flash           → image understanding / OCR
 *  - Gemini 2.5 Pro             → podcast-style summaries
 *  - Gemini 2.5 Flash Preview   → text-to-speech
 */

export { AiError, requireEnv } from './errors';
export type { AiErrorCode } from './errors';

export { transcribeAudio } from './groq';
export type {
  TranscribeAudioInput,
  TranscribeAudioOptions,
  TranscribeAudioResult,
} from './groq';

export { describeImage } from './gemini-vision';
export type { DescribeImageInput, DescribeImageResult } from './gemini-vision';

export { generateSummary, SUMMARY_PROMPT_VERSION } from './gemini-llm';
export type {
  SummaryTone,
  SummaryMessage,
  SummaryInput,
  SummaryResult,
} from './gemini-llm';

export { generateAudio } from './gemini-tts';
export type { TtsVoice, TtsInput, TtsResult } from './gemini-tts';
