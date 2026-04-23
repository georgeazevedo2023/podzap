/**
 * Gemini 2.5 Pro — podcast-style summary generator.
 *
 * Required env: GEMINI_API_KEY, GEMINI_LLM_MODEL (defaults to gemini-2.5-pro)
 * Package: @google/genai ^1.48.x
 */

import { GoogleGenAI, Type } from '@google/genai';
import { AiError, requireEnv } from './errors';

export type SummaryTone = 'formal' | 'fun' | 'corporate';

export type SummaryMessage = {
  sender: string;
  content: string;
  type: 'text' | 'audio' | 'image';
  at: Date;
};

export type SummaryInput = {
  groupName: string;
  periodStart: Date;
  periodEnd: Date;
  messages: SummaryMessage[];
  tone: SummaryTone;
};

export type SummaryResult = {
  text: string;
  topics: string[];
  model: string;
  promptVersion: string;
};

export const SUMMARY_PROMPT_VERSION = 'podzap-summary/v1';

const TONE_GUIDE: Record<SummaryTone, string> = {
  formal:
    'Tom jornalístico e sóbrio, frases bem construídas, sem gírias. ' +
    'Imagine um locutor de rádio cultural narrando os fatos.',
  fun:
    'Tom leve, descontraído e bem-humorado, como um podcast de bate-papo entre amigos. ' +
    'Pode usar expressões coloquiais em PT-BR, mas sem perder a clareza.',
  corporate:
    'Tom executivo, direto ao ponto, orientado a decisões e próximos passos. ' +
    'Evite piadas; priorize síntese, pendências e donos de ação.',
};

let cachedClient: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  if (cachedClient) return cachedClient;
  cachedClient = new GoogleGenAI({ apiKey: requireEnv('GEMINI_API_KEY') });
  return cachedClient;
}

function formatDateBR(d: Date): string {
  return d.toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function renderMessages(messages: SummaryMessage[]): string {
  return messages
    .map((m) => {
      const tag =
        m.type === 'audio' ? '[audio transcrito]' :
        m.type === 'image' ? '[imagem descrita]' : '';
      const ts = formatDateBR(m.at);
      return `- (${ts}) ${m.sender}${tag ? ' ' + tag : ''}: ${m.content}`;
    })
    .join('\n');
}

function buildPrompt(input: SummaryInput): string {
  const { groupName, periodStart, periodEnd, messages, tone } = input;
  return [
    `Você é o roteirista-apresentador do podZAP, um podcast diário em português do Brasil`,
    `que resume conversas de grupos de WhatsApp. Narre em primeira pessoa plural ("hoje no grupo...")`,
    `e cite participantes pelo nome/apelido.`,
    ``,
    `### Grupo`,
    `Nome: ${groupName}`,
    `Período: ${formatDateBR(periodStart)} até ${formatDateBR(periodEnd)}`,
    `Total de mensagens: ${messages.length}`,
    ``,
    `### Tom solicitado: ${tone}`,
    TONE_GUIDE[tone],
    ``,
    `### Diretrizes de redação`,
    `- Português do Brasil, texto corrido pronto para locução (TTS), sem markdown nem bullets na narrativa.`,
    `- Duração alvo: 3 a 5 minutos de leitura (~500 a 800 palavras).`,
    `- Abra apresentando grupo e janela temporal; feche com um gancho curto.`,
    `- Agrupe por tópicos; cite quem levantou o quê; respeite tom pedido.`,
    `- Evite números de telefone, links crus e dados sensíveis; prefira parafrasear.`,
    `- Se houver áudios/imagens marcados, incorpore a informação naturalmente sem mencionar o rótulo.`,
    ``,
    `### Saída`,
    `Retorne APENAS JSON com as chaves:`,
    `  "text":   string — o roteiro narrado final.`,
    `  "topics": string[] — 3 a 7 tópicos principais, frases curtas em PT-BR.`,
    ``,
    `### Mensagens`,
    renderMessages(messages),
  ].join('\n');
}

/**
 * Generate a podcast-style summary for a WhatsApp group period.
 */
export async function generateSummary(input: SummaryInput): Promise<SummaryResult> {
  if (input.messages.length === 0) {
    throw new AiError('invalid_input', 'Cannot summarise an empty message list');
  }

  const model = process.env.GEMINI_LLM_MODEL ?? 'gemini-2.5-pro';
  const client = getClient();
  const prompt = buildPrompt(input);

  try {
    const response = await client.models.generateContent({
      model,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: {
        temperature: 0.7,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            text: { type: Type.STRING },
            topics: { type: Type.ARRAY, items: { type: Type.STRING } },
          },
          required: ['text', 'topics'],
        },
      },
    });

    const raw = response.text ?? '';
    let parsed: { text?: unknown; topics?: unknown };
    try {
      parsed = JSON.parse(raw) as { text?: unknown; topics?: unknown };
    } catch (parseErr) {
      throw new AiError('summary_failed', 'Model returned non-JSON response', parseErr);
    }

    if (typeof parsed.text !== 'string' || parsed.text.trim().length === 0) {
      throw new AiError('summary_failed', 'Missing or empty "text" in model response');
    }
    if (!Array.isArray(parsed.topics) || !parsed.topics.every((t) => typeof t === 'string')) {
      throw new AiError('summary_failed', 'Missing or invalid "topics" in model response');
    }

    return {
      text: parsed.text.trim(),
      topics: parsed.topics,
      model,
      promptVersion: SUMMARY_PROMPT_VERSION,
    };
  } catch (err) {
    if (err instanceof AiError) throw err;
    throw new AiError(
      'summary_failed',
      err instanceof Error ? err.message : 'Unknown Gemini LLM error',
      err,
    );
  }
}
