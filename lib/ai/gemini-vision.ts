/**
 * Gemini 2.5 Flash — image understanding / OCR wrapper.
 *
 * Required env: GEMINI_API_KEY, GEMINI_VISION_MODEL (defaults to gemini-2.5-flash)
 * Package: @google/genai ^1.48.x  (NOTE: replaces legacy @google/generative-ai)
 */

import { GoogleGenAI } from '@google/genai';
import { AiError, requireEnv } from './errors';

export type DescribeImageInput = Buffer | { url: string };

export type DescribeImageResult = {
  description: string;
  model: string;
};

const DEFAULT_PROMPT =
  'Descreva o conteúdo desta imagem em português, focando em texto visível ' +
  '(OCR literal quando houver) e em elementos relevantes para o resumo de ' +
  'uma conversa de WhatsApp. Seja conciso (2-4 frases) e objetivo.';

let cachedClient: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  if (cachedClient) return cachedClient;
  cachedClient = new GoogleGenAI({ apiKey: requireEnv('GEMINI_API_KEY') });
  return cachedClient;
}

type ImagePart = {
  inlineData: { mimeType: string; data: string };
};

async function toImagePart(image: DescribeImageInput): Promise<ImagePart> {
  if (Buffer.isBuffer(image)) {
    return {
      inlineData: {
        mimeType: sniffMimeType(image) ?? 'image/jpeg',
        data: image.toString('base64'),
      },
    };
  }
  if (typeof image === 'object' && image !== null && 'url' in image) {
    const res = await fetch(image.url);
    if (!res.ok) {
      throw new AiError(
        'invalid_input',
        `Failed to fetch image URL (${res.status} ${res.statusText})`,
      );
    }
    const contentType = res.headers.get('content-type') ?? 'image/jpeg';
    const arrayBuffer = await res.arrayBuffer();
    return {
      inlineData: {
        mimeType: contentType.split(';')[0] ?? 'image/jpeg',
        data: Buffer.from(arrayBuffer).toString('base64'),
      },
    };
  }
  throw new AiError('invalid_input', 'Unsupported image input type');
}

function sniffMimeType(buf: Buffer): string | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47
  ) return 'image/png';
  if (buf.length >= 4 && buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return 'image/gif';
  if (
    buf.length >= 12 &&
    buf.slice(0, 4).toString('ascii') === 'RIFF' &&
    buf.slice(8, 12).toString('ascii') === 'WEBP'
  ) return 'image/webp';
  return null;
}

/**
 * Describe/OCR an image using Gemini 2.5 Flash.
 */
export async function describeImage(
  image: DescribeImageInput,
  prompt?: string,
): Promise<DescribeImageResult> {
  const model = process.env.GEMINI_VISION_MODEL ?? 'gemini-2.5-flash';
  const client = getClient();
  const imagePart = await toImagePart(image);
  const textPart = { text: prompt ?? DEFAULT_PROMPT };

  try {
    const response = await client.models.generateContent({
      model,
      contents: [{ role: 'user', parts: [imagePart, textPart] }],
    });

    const description = (response.text ?? '').trim();
    if (description.length === 0) {
      throw new AiError('vision_failed', 'Gemini returned empty description');
    }

    return { description, model };
  } catch (err) {
    if (err instanceof AiError) throw err;
    throw new AiError(
      'vision_failed',
      err instanceof Error ? err.message : 'Unknown Gemini vision error',
      err,
    );
  }
}
