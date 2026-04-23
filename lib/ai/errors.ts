/**
 * Shared error type and env helper for the AI integration layer.
 */

export type AiErrorCode =
  | 'missing_env'
  | 'invalid_input'
  | 'transcription_failed'
  | 'vision_failed'
  | 'summary_failed'
  | 'tts_failed'
  | 'upstream_error';

export class AiError extends Error {
  public readonly code: AiErrorCode;
  public readonly cause?: unknown;

  constructor(code: AiErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = 'AiError';
    this.code = code;
    this.cause = cause;
  }
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (typeof value !== 'string' || value.length === 0) {
    throw new AiError('missing_env', `Required environment variable ${name} is not set`);
  }
  return value;
}
