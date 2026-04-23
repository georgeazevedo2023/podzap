/**
 * Phase 7 — Summary prompt builder.
 *
 * Pure function: given a `NormalizedConversation` (from Phase 6) and a
 * requested tone, produce the exact `systemPrompt` / `userPrompt` pair
 * that the Gemini 2.5 Pro caller will send, plus metadata (version,
 * rough token estimate) the caller uses for tracking + context checks.
 *
 * Ethos mirrors `lib/ai/gemini-llm.ts`:
 * - Roteirista-apresentador do podZAP, PT-BR, primeira pessoa plural.
 * - Texto corrido pronto para TTS (sem markdown, sem bullets, sem emojis).
 * - Só use informação presente nas mensagens; não invente detalhes.
 *
 * No IO, no DB, no env access. Safe to call from any runtime.
 * See `docs/plans/fase-7-plan.md`.
 */

import type { NormalizedConversation, Topic } from "@/lib/pipeline/normalize";

export type SummaryTone = "formal" | "fun" | "corporate";

export type BuiltPrompt = {
  systemPrompt: string;
  userPrompt: string;
  /** Stable identifier for the exact prompt revision used for this call. */
  promptVersion: string;
  /** Rough token estimate (chars / 4). For context-window sizing only. */
  estimatedTokens: number;
};

export type BuildPromptOptions = {
  /** Truncation limit per topic. Default 20. */
  maxMessagesPerTopic?: number;
};

const DEFAULT_MAX_MESSAGES_PER_TOPIC = 20;
const PROMPT_VERSION_BASE = "podzap-summary/v1";

/** Hard cap on per-message content rendered into the prompt. */
const MESSAGE_CONTENT_CHAR_LIMIT = 300;

/**
 * Base system prompt shared by every tone. Tone-specific guidance is
 * appended after this block (see `TONE_OVERRIDES`).
 */
const BASE_SYSTEM_PROMPT = [
  "Você é o roteirista-apresentador do podZAP, um podcast diário em português",
  "do Brasil que resume conversas de grupos de WhatsApp. Regras obrigatórias:",
  '- Narre em primeira pessoa plural ("hoje no grupo...")',
  "- Cite participantes pelo nome/apelido quando aparecerem mensagens deles",
  "- Texto corrido, pronto para locução TTS (sem markdown, sem bullets, sem",
  "  emojis)",
  "- Use APENAS informação presente nas mensagens. Não invente detalhes.",
  "- Duração alvo: 3-5 minutos de leitura (~500-800 palavras)",
  "- Português do Brasil",
].join("\n");

const TONE_OVERRIDES: Record<SummaryTone, string> = {
  formal:
    "Use tom profissional, vocabulário formal, mas evite jargão corporativo.",
  fun: "Use tom descontraído e caloroso, leve senso de humor sem forçar, frases curtas com ritmo.",
  corporate:
    "Use tom de executivo sênior, foco em decisões, impactos, próximos passos. Frases diretas.",
};

function buildSystemPrompt(tone: SummaryTone): string {
  return `${BASE_SYSTEM_PROMPT}\n\n${TONE_OVERRIDES[tone]}`;
}

/**
 * PT-BR date/time formatting that matches the spec's `.toLocaleString('pt-BR')`
 * contract. We pin `America/Sao_Paulo` so prompts are reproducible regardless
 * of the host timezone (Vercel, local dev, CI).
 */
function formatDateBR(d: Date): string {
  return d.toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatTimeBR(d: Date): string {
  return d.toLocaleTimeString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function truncateContent(content: string): string {
  if (content.length <= MESSAGE_CONTENT_CHAR_LIMIT) return content;
  return content.slice(0, MESSAGE_CONTENT_CHAR_LIMIT);
}

function renderTopic(topic: Topic, index: number, maxMessages: number): string {
  const header = `=== Tópico ${index + 1} — ${formatTimeBR(topic.startAt)} a ${formatTimeBR(topic.endAt)} ===`;
  const participants = `Participantes: ${topic.participants.join(", ")}`;
  const keywords = `Palavras-chave: ${topic.dominantKeywords.join(", ")}`;

  const rendered = topic.messages
    .slice(0, maxMessages)
    .map(
      (m) =>
        `- [${m.senderName}, ${m.type}]: ${truncateContent(m.content)}`,
    )
    .join("\n");

  return [
    header,
    participants,
    keywords,
    "Mensagens (em ordem):",
    rendered,
  ].join("\n");
}

function buildUserPrompt(
  conv: NormalizedConversation,
  maxMessagesPerTopic: number,
): string {
  const head = [
    `Grupo: ${conv.groupName}`,
    `Período: ${formatDateBR(conv.periodStart)} até ${formatDateBR(conv.periodEnd)}`,
    `Total de mensagens: ${conv.total}`,
    `Mensagens descartadas (ruído): ${conv.discarded}`,
    `Tópicos identificados: ${conv.topics.length}`,
    "",
    "Para cada tópico abaixo, gere uma seção narrativa fluida.",
    "",
  ].join("\n");

  const topicsBlock = conv.topics
    .map((t, i) => renderTopic(t, i, maxMessagesPerTopic))
    .join("\n\n");

  const tail = [
    "",
    "Retorne APENAS JSON com esta estrutura exata:",
    "{",
    '  "text": "<texto narrativo completo, 500-800 palavras, pronto para TTS>",',
    '  "topics": ["<nome curto do tópico 1>", "<nome curto do tópico 2>", ...],',
    '  "estimatedMinutes": <number>',
    "}",
  ].join("\n");

  return `${head}${topicsBlock}\n${tail}`;
}

function estimateTokens(systemPrompt: string, userPrompt: string): number {
  // Rough heuristic: ~4 chars/token across PT-BR + JSON scaffolding. Used only
  // for context-window checks (Gemini 2.5 Pro has 1M tokens), never billing.
  return Math.ceil((systemPrompt.length + userPrompt.length) / 4);
}

/**
 * Build the full prompt bundle for a given conversation + tone.
 *
 * Invariants:
 * - `systemPrompt` varies by tone (every tone yields a distinct string).
 * - `userPrompt` always includes group name, period, and every topic, even
 *   when `conv.topics` is empty (the topics block is simply empty).
 * - `promptVersion` is deterministic: `podzap-summary/v1-<tone>`.
 * - Pure — no IO, no randomness, safe to memoize by (conv, tone).
 */
export function buildSummaryPrompt(
  conv: NormalizedConversation,
  tone: SummaryTone,
  opts?: BuildPromptOptions,
): BuiltPrompt {
  const maxMessagesPerTopic =
    opts?.maxMessagesPerTopic ?? DEFAULT_MAX_MESSAGES_PER_TOPIC;

  const systemPrompt = buildSystemPrompt(tone);
  const userPrompt = buildUserPrompt(conv, maxMessagesPerTopic);

  return {
    systemPrompt,
    userPrompt,
    promptVersion: `${PROMPT_VERSION_BASE}-${tone}`,
    estimatedTokens: estimateTokens(systemPrompt, userPrompt),
  };
}
