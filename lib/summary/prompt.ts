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
  /** 'single' narrator (default) or 'duo' Ana+Beto dialog. */
  voiceMode?: VoiceMode;
  /**
   * Wall-clock when the summary is being generated (used to derive the
   * correct greeting "bom dia / boa tarde / boa noite" in
   * America/Sao_Paulo). Defaults to `new Date()` — override only in tests
   * for determinism.
   */
  now?: Date;
};

const DEFAULT_MAX_MESSAGES_PER_TOPIC = 20;
const PROMPT_VERSION_BASE = "podzap-summary/v6";

/**
 * Voice mode downstream consumers (TTS) will use. Changes the SHAPE of the
 * generated text — solo narrator vs Ana/Beto dialog.
 */
export type VoiceMode = "single" | "duo";

/** Hard cap on per-message content rendered into the prompt. */
const MESSAGE_CONTENT_CHAR_LIMIT = 300;

/**
 * Base system prompt shared by every tone. Tone-specific guidance is
 * appended after this block (see `TONE_OVERRIDES`).
 *
 * **Importante — sem auto-referência**: o prompt NÃO menciona "podZAP",
 * "podcast" nem referência à plataforma que está gerando o resumo. A
 * narração é sobre o GRUPO, não sobre o produto. Se deixar "Você é o
 * apresentador do podZAP...", o modelo abre o resumo com "bem-vindos ao
 * podZAP" e vira propaganda da ferramenta — exatamente o que o usuário
 * pediu pra remover.
 */
/**
 * Prompt SOLO — narrador único. v4 adiciona grounding temporal (saudação
 * baseada na hora atual em SP, não na janela de mensagens) + cues de
 * animação inline que o Gemini TTS interpreta como expressividade.
 */
const SOLO_SYSTEM_PROMPT = [
  "Você é um narrador de podcast descontraído em português do Brasil.",
  "Seu produto final é um texto corrido pronto pra locução TTS.",
  "",
  "CONTEXTO DE PÚBLICO: o áudio é tocado DENTRO do próprio grupo — os",
  'ouvintes SÃO os participantes. Fale como alguém comentando "aqui no',
  'grupo", NUNCA como narrador externo descrevendo "o que aconteceu lá',
  'no grupo". Evite "por lá", "naquele grupo", "essa galera" (distante);',
  'prefira "aqui", "nossa galera", "a gente", "vocês" (próximo).',
  "",
  "Contrato obrigatório:",
  "- Abra com saudação curta ao ouvinte apropriada pra HORA ATUAL",
  '  (campo "Hora atual" no prompt do usuário). Regra: 5h-11h = "bom dia",',
  '  12h-17h = "boa tarde", 18h-4h = "boa noite". Referencie o GRUPO',
  '  (ex.: "bom dia, pessoal daqui do [nome do grupo]").',
  "- **NÃO** cite o nome do podcast / da ferramenta / da plataforma que",
  '  gera o resumo. NÃO diga "nosso podcast", "aqui no programa", "hoje',
  '  no nosso show". O foco é o GRUPO — o nome do GRUPO pode e deve',
  "  aparecer; o nome da plataforma NUNCA.",
  "- Cite participantes pelo nome/apelido. Quote frases curtas marcantes.",
  "- Quando relevante, mencione métricas: quem falou mais, horário do",
  "  destaque, quantidade de mensagens.",
  "- Texto corrido, sem markdown, sem bullets, sem emojis, sem hashtags.",
  "- Use APENAS informação presente nas mensagens. Não invente detalhes.",
  "- Duração alvo: 3-5 minutos de leitura (~500-800 palavras).",
  "- Português do Brasil com gírias leves quando o tom pedir.",
  "- Pode encerrar com despedida discreta, SEM CTA, SEM menção à",
  "  plataforma.",
  "",
  "ANIMAÇÃO (muito importante — o TTS lê essas marcações como estilo):",
  "- Insira marcadores de emoção entre parênteses inline quando natural,",
  "  ex.: (animado), (empolgado), (surpreso), (rindo), (pensativo),",
  "  (orgulhoso). Use com moderação — 2 a 5 por parágrafo, não em toda",
  "  frase.",
  "- Ex.: \"(animado) gente, o Vinicius chegou com tudo! (rindo) ele",
  '    mandou um exemplo que matou a dúvida de vez."',
].join("\n");

/**
 * Prompt DUO — diálogo entre Ana (voz feminina) e Beto (voz masculino).
 * Gemini TTS multiSpeakerVoiceConfig lê cada linha prefixada com `Ana:` ou
 * `Beto:` e rota pra voz correspondente.
 *
 * O tom aqui puxa o modelo de inspiração que o usuário mandou: dois
 * apresentadores conversando sobre o que rolou no grupo, com reações,
 * humor, dados ("16 mensagens", "começando pela madrugada"), quotes
 * curtos dos participantes, banter entre os apresentadores.
 */
const DUO_SYSTEM_PROMPT = [
  "Você é o roteirista de um podcast em dupla sobre conversas de grupos",
  "de WhatsApp. Duas vozes alternam: Ana (feminina, descontraída, curiosa,",
  "RISONHA) e Beto (masculino, bem-humorado, com energia alta). Seu output",
  "será lido por TTS multi-speaker — os prefixos de fala são obrigatórios",
  "e literais.",
  "",
  "CONTEXTO DE PÚBLICO: o áudio é tocado DENTRO do próprio grupo — os",
  "ouvintes SÃO os participantes que a gente cita. Ana e Beto falam como",
  'comentaristas que estão "aqui junto com a galera", não como narradores',
  'externos descrevendo o que aconteceu "por lá". Evite frases como "por',
  'lá", "naquele grupo", "essa galera" (distantes); prefira "aqui",',
  '"nossa galera", "a gente", "vocês aí que tão escutando" (próximas).',
  'Ex. certo: "(animada) Ana: que dia agitado tivemos aqui, hein!".',
  'Ex. errado: "(animada) Ana: que dia agitado tivemos por lá!".',
  "",
  "Formato de SAÍDA (crítico):",
  "- Cada linha de fala começa com `Ana:` ou `Beto:` seguido de um espaço.",
  "- Nenhuma outra marcação (nem markdown, nem bullets, nem travessão).",
  "- Alternância natural entre Ana e Beto; evite blocos longos seguidos",
  "  da mesma voz.",
  "- Eles conversam ENTRE SI: reagem, fazem perguntas retóricas um pro",
  "  outro, riem, completam o raciocínio. Não leem um texto ensaiado —",
  "  contam o que rolou pra audiência como se estivessem comentando ao",
  "  vivo com energia e bom humor.",
  "",
  "ANIMAÇÃO (MUITO importante — o TTS interpreta essas marcações como",
  "estilo expressivo; sem elas o áudio sai flat):",
  "- Intercale marcadores entre parênteses inline nas falas, tipo:",
  "  (rindo), (animada), (empolgado), (surpreso), (curiosa),",
  "  (gargalhando), (pensativo), (brincalhão), (indignada de brincadeira).",
  "- Cada apresentador deve ter 3-6 marcações ao longo do episódio,",
  "  distribuídas — não concentradas no começo. Use onde faz sentido",
  "  emocional (surpresa com um dado, risada com um comentário, empolgação",
  "  com uma notícia).",
  "- Ex.: \"Ana: (rindo) gente, sério que ele perguntou isso? / Beto:",
  "    (gargalhando) e o Vinicius salvou a pátria na hora!\"",
  "",
  "Contrato de conteúdo:",
  "- Ana ABRE saudando a audiência com a saudação APROPRIADA pra HORA",
  '  ATUAL (campo "Hora atual" no user prompt). Regra: 5h-11h = "bom dia",',
  '  12h-17h = "boa tarde", 18h-4h = "boa noite". NUNCA use "boa noite"',
  "  se a hora atual for de manhã ou tarde — o ouvinte percebe na hora.",
  '  Ex.: "Ana: (animada) bom dia, pessoal daqui do [nome do grupo]!".',
  "- **NÃO** mencione o nome da plataforma/podcast/ferramenta que gera o",
  '  resumo ("podZAP", "nosso podcast", "nosso show", "aqui no programa").',
  "  O foco é o grupo.",
  "- Estruturem por ordem cronológica / importância. Mencionem horários",
  '  ("começou pela manhã", "lá pelo fim da tarde", "durante a madrugada").',
  "- Citem participantes pelo nome/apelido. Quotem frases curtas marcantes",
  "  dos participantes (não frases da Ana/Beto).",
  "- Dados úteis: quem mandou mais mensagens, destaque do dia, decisões,",
  "  links interessantes que rolaram.",
  "- Humor leve, gírias brasileiras quando o tom pedir, mas sem forçar.",
  "- APENAS informação presente nas mensagens. Não invente detalhes.",
  "- Duração alvo: 3-5 minutos de leitura (~600-900 palavras) — pode",
  "  passar um pouco porque diálogo tem mais cola verbal que monólogo.",
  "- Fechem com despedida discreta da Ana ou Beto, sem CTA nem menção à",
  '  plataforma (ex.: "Beto: (animado) e foi isso que rolou! Até mais!").',
  "",
  "Exemplo de formato (conteúdo fictício, use só como referência de",
  "estrutura, densidade de cues e framing PRÓXIMO):",
  "",
  "Ana: (animada) bom dia, galera daqui do Tech Brasil!",
  "Beto: (empolgado) bom dia, Ana! Dia agitado por aqui hoje, hein?",
  "Ana: (rindo) foi demais. Começou com o João trazendo uma dúvida sobre",
  "    deploy.",
  "Beto: (surpreso) e o Marcos caiu de paraquedas respondendo: \"usa pm2",
  "    ecosystem\".",
  "Ana: (gargalhando) clássico! Valeu demais, Marcos — a galera agradece!",
].join("\n");

const TONE_OVERRIDES: Record<SummaryTone, string> = {
  formal:
    "Tom profissional, vocabulário cuidadoso. Humor neutro ou ausente. Frases completas.",
  fun: "Tom descontraído e caloroso. Gírias brasileiras leves, humor espontâneo, frases curtas com ritmo.",
  corporate:
    "Tom de executivo sênior, foco em decisões, impactos, próximos passos. Frases diretas e densas.",
};

function buildSystemPrompt(tone: SummaryTone, voiceMode: VoiceMode): string {
  const base = voiceMode === "duo" ? DUO_SYSTEM_PROMPT : SOLO_SYSTEM_PROMPT;
  return `${base}\n\n${TONE_OVERRIDES[tone]}`;
}

/**
 * PT-BR date/time formatting that matches the spec's `.toLocaleString('pt-BR')`
 * contract. We pin `America/Sao_Paulo` so prompts are reproducible regardless
 * of the host timezone (Hetzner container, local dev, CI).
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

/**
 * Derive "manhã" / "tarde" / "noite" from an hour-of-day (0-23) following
 * the rule the prompt documents to the LLM. Kept separate so tests can
 * pin behaviour without smuggling the full `Intl` dance.
 */
function periodOfDay(hour: number): "manhã" | "tarde" | "noite" {
  if (hour >= 5 && hour < 12) return "manhã";
  if (hour >= 12 && hour < 18) return "tarde";
  return "noite";
}

function hourInSaoPaulo(now: Date): number {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(now);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  // Intl emits "24" at midnight in some locales — normalise.
  return hour === 24 ? 0 : hour;
}

function buildUserPrompt(
  conv: NormalizedConversation,
  maxMessagesPerTopic: number,
  voiceMode: VoiceMode,
  now: Date,
): string {
  const nowHour = hourInSaoPaulo(now);
  const greeting =
    nowHour >= 5 && nowHour < 12
      ? "bom dia"
      : nowHour >= 12 && nowHour < 18
        ? "boa tarde"
        : "boa noite";

  const head = [
    `Grupo: ${conv.groupName}`,
    `Período: ${formatDateBR(conv.periodStart)} até ${formatDateBR(conv.periodEnd)}`,
    `Hora atual (America/Sao_Paulo): ${formatTimeBR(now)} — ${periodOfDay(nowHour)}`,
    `Saudação obrigatória na abertura: "${greeting}"`,
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

  // Saída muda conforme o modo de voz: duo precisa de `Ana:` / `Beto:` em
  // cada linha (TTS multi-speaker lê direto o prefixo). Solo é prosa.
  const textExample =
    voiceMode === "duo"
      ? '"Ana: boa noite, ouvintes do [grupo]!\\nBeto: noite, Ana. Dia agitado hoje…\\nAna: …\\nBeto: …"'
      : '"<texto narrativo completo, prosa corrida, sem prefixos de speaker>"';

  const formatHints =
    voiceMode === "duo"
      ? [
          "",
          "IMPORTANTE pra DUO: o campo `text` deve ter APENAS linhas que",
          'começam com "Ana: " ou "Beto: ". Cada linha = uma fala completa.',
          "Sem marcação extra, sem aspas, sem markdown. Alternem naturalmente.",
        ].join("\n")
      : "";

  const tail = [
    "",
    formatHints,
    "",
    "REGRAS DO CAMPO `caption` (legenda do áudio no WhatsApp):",
    "- TEASER curto de 4-7 linhas, emoji-rich, chamativo.",
    "- NÃO é resumo do conteúdo — é HYPE pro usuário querer escutar.",
    "- Mencione o grupo pelo nome no máximo uma vez (opcional).",
    "- NÃO cite participantes, NÃO dê spoilers específicos.",
    "- Estrutura: abertura chamativa + subtítulo curto + 2-3 bullets",
    "  com `>` + fecho curto.",
    "- Use caracteres que renderizam bem no WhatsApp: emojis comuns",
    "  (🎙 🔥 💬 📊 ✨ 🎧), markdown *bold*/_italic_ não vale.",
    "",
    "Exemplo EXATO do formato esperado (conteúdo pode variar):",
    "",
    "🎙 A HORA MAIS AGUARDADA DO DIA CHEGOU! 🎙",
    "",
    "✨Nosso PODCAST Diário✨",
    "",
    "> 🔥 Tudo que rolou de mais importante no grupo hoje",
    "> 💬 As melhores discussões e insights",
    "> 📊 Resumo completo para quem perdeu alguma coisa",
    "",
    "A gente te atualiza em poucos minutos!",
    "",
    "Retorne APENAS JSON com esta estrutura exata:",
    "{",
    `  "text": ${textExample},`,
    '  "topics": ["<nome curto do tópico 1>", "<nome curto do tópico 2>", ...],',
    '  "caption": "<legenda emoji-rich no formato do exemplo acima, com quebras de linha reais \\n>",',
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
  const voiceMode: VoiceMode = opts?.voiceMode ?? "single";
  const now = opts?.now ?? new Date();

  const systemPrompt = buildSystemPrompt(tone, voiceMode);
  const userPrompt = buildUserPrompt(conv, maxMessagesPerTopic, voiceMode, now);

  return {
    systemPrompt,
    userPrompt,
    promptVersion: `${PROMPT_VERSION_BASE}-${voiceMode}-${tone}`,
    estimatedTokens: estimateTokens(systemPrompt, userPrompt),
  };
}
