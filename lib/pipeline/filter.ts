/**
 * Phase 6 — Relevance filter + weighting.
 *
 * Pure function: given a batch of messages (already JOINed with transcripts),
 * drop the obvious noise and score the survivors by naïve relevance heuristics
 * so the clusterer + LLM have less junk to reason about.
 *
 * Deliberately rule-based — embeddings are post-MVP. See
 * `docs/plans/fase-6-plan.md`.
 */

export type NormalizedMessage = {
  id: string;
  senderName: string;
  at: Date;
  type: "text" | "audio" | "image" | "video" | "other";
  content: string;
  /** Relevance score in [0, 1]. */
  weight: number;
  hasMedia: boolean;
};

export type FilterInput = Array<{
  id: string;
  senderName: string | null;
  senderJid: string | null;
  capturedAt: string | Date;
  type: "text" | "audio" | "image" | "video" | "other";
  content: string | null;
  mediaUrl: string | null;
  mediaDurationSeconds: number | null;
  /** Text coming from the transcripts table JOIN (audio STT). */
  transcriptText: string | null;
}>;

export type FilterResult = {
  kept: NormalizedMessage[];
  discarded: number;
};

export type FilterOptions = {
  /** Default 0 — keep anything that isn't dropped. Raise to prune low-weight messages. */
  minWeight?: number;
};

/** Stopwords matched against the *whole* (trimmed, lowercased) content. */
const STOPWORDS: ReadonlySet<string> = new Set([
  "ok",
  "kkk",
  "kkkk",
  "kk",
  "k",
  "rsrs",
  "rs",
  "haha",
  "hahaha",
  "haheha",
  "uhum",
  "aham",
  "sim",
  "não",
  "nao",
  "👍",
  "vlw",
  "vlww",
]);

/** Keywords that boost weight (case-insensitive, substring match). */
const KEYWORDS: readonly string[] = [
  "decisão",
  "decisao",
  "atenção",
  "atencao",
  "importante",
  "reunião",
  "reuniao",
  "prazo",
  "problema",
  "erro",
  "falha",
  "bug",
  "deadline",
  "urgente",
  "pedido",
  "proposta",
  "contrato",
];

/**
 * URL-only regex — matches when the *entire* (trimmed) content is a single URL.
 * Covers http(s)://, www., and bare domains like "example.com/path".
 */
const URL_ONLY_RE =
  /^(?:https?:\/\/|www\.)\S+$|^[\w-]+(?:\.[\w-]+)+(?:\/\S*)?$/i;

/**
 * Emoji-only regex — matches strings containing only emoji-ish codepoints
 * (plus whitespace). Uses Unicode property escapes from ES2018.
 */
const EMOJI_ONLY_RE = /^[\s\p{Extended_Pictographic}\p{Emoji_Component}]+$/u;

function clamp01(n: number): number {
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function toDate(value: string | Date): Date {
  return value instanceof Date ? value : new Date(value);
}

function hasVisualMedia(type: NormalizedMessage["type"]): boolean {
  return type === "image" || type === "video";
}

function hasAnyMedia(row: FilterInput[number]): boolean {
  if (row.mediaUrl !== null && row.mediaUrl !== "") return true;
  if (row.type === "audio" || row.type === "image" || row.type === "video") {
    return true;
  }
  return false;
}

/**
 * Should this row be dropped entirely (not just weighted down)?
 * Returns true to drop, false to keep.
 */
function shouldDrop(row: FilterInput[number], content: string): boolean {
  const trimmed = content.trim();
  const media = hasAnyMedia(row);

  // Stickers: modeled as type='other' with "sticker" hint in content.
  if (row.type === "other" && trimmed.toLowerCase().includes("sticker")) {
    return true;
  }

  // Empty / too-short text without any media payload.
  if (trimmed.length < 3 && !media) return true;

  const lower = trimmed.toLowerCase();

  // Stopwords (whole-message match).
  if (STOPWORDS.has(lower)) return true;

  // URL-only content (with no accompanying media).
  if (!media && URL_ONLY_RE.test(trimmed)) return true;

  // Emoji-only content (with no accompanying media).
  if (!media && trimmed.length > 0 && EMOJI_ONLY_RE.test(trimmed)) return true;

  return false;
}

/**
 * Compute a relevance weight in [0, 1] from base 0.3 plus additive boosts.
 * See `docs/plans/fase-6-plan.md` for rule list.
 */
function computeWeight(
  row: FilterInput[number],
  content: string,
): number {
  let weight = 0.3;

  // Long audio transcripts are usually meaty (voice notes).
  if (
    row.type === "audio" &&
    row.mediaDurationSeconds !== null &&
    row.mediaDurationSeconds > 20
  ) {
    weight += 0.3;
  }

  const trimmed = content.trim();

  if (trimmed.length > 100) weight += 0.15;
  if (trimmed.endsWith("?")) weight += 0.15;

  const lower = trimmed.toLowerCase();
  for (const kw of KEYWORDS) {
    if (lower.includes(kw)) {
      weight += 0.3;
      break; // keyword boost applies at most once
    }
  }

  if (hasVisualMedia(row.type)) weight += 0.1;

  return clamp01(weight);
}

/**
 * Pure filter — no IO. Drops obvious noise and annotates survivors with a
 * relevance weight. Ordering of `kept` mirrors input order.
 *
 * @param input  Messages + transcript join (already shaped by caller).
 * @param opts.minWeight  Drop survivors whose weight is below this threshold.
 */
export function filterMessages(
  input: FilterInput,
  opts?: FilterOptions,
): FilterResult {
  const minWeight = opts?.minWeight ?? 0;
  const kept: NormalizedMessage[] = [];
  let discarded = 0;

  for (const row of input) {
    const content = row.transcriptText ?? row.content ?? "";

    if (shouldDrop(row, content)) {
      discarded += 1;
      continue;
    }

    const weight = computeWeight(row, content);
    if (weight < minWeight) {
      discarded += 1;
      continue;
    }

    kept.push({
      id: row.id,
      senderName: row.senderName ?? "Desconhecido",
      at: toDate(row.capturedAt),
      type: row.type,
      content,
      weight,
      hasMedia: hasAnyMedia(row),
    });
  }

  return { kept, discarded };
}
