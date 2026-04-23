/**
 * Phase 6 — Topic clustering.
 *
 * Pure function: given a flat list of normalized messages, split them into
 * "topics" based on temporal proximity and participant overlap. The goal is
 * to hand the LLM coherent slices of conversation rather than a flat dump.
 *
 * Deliberately rule-based (no embeddings). See `docs/plans/fase-6-plan.md`.
 */

import { createHash } from "node:crypto";
import type { NormalizedMessage } from "./filter";

export type Topic = {
  /** Short stable hash derived from start timestamp + participants. */
  id: string;
  startAt: Date;
  endAt: Date;
  messages: NormalizedMessage[];
  /** Unique senderNames in appearance order. */
  participants: string[];
  /** Top 3-5 lowercase tokens across the topic's content. */
  dominantKeywords: string[];
};

export type ClusterOptions = {
  /** Max allowed gap between consecutive messages before starting a new topic. */
  gapMinutes?: number;
  /** Minimum Jaccard overlap between recent senders and topic participants. */
  minParticipantOverlap?: number;
};

const DEFAULT_GAP_MINUTES = 30;
const DEFAULT_MIN_OVERLAP = 0.3;
/** Size of the sliding window of "recent senders" used to compute overlap. */
const RECENT_WINDOW = 5;
/** Soft floor: even if overlap tanks, don't split messages this close together. */
const MIN_SPLIT_GAP_MINUTES = 5;

/**
 * PT-BR + generic stopwords filtered out of keyword extraction. Kept small
 * and hand-curated — this is a heuristic, not a language model.
 */
const KEYWORD_STOPWORDS: ReadonlySet<string> = new Set([
  "para",
  "mais",
  "tudo",
  "como",
  "quando",
  "então",
  "entao",
  "agora",
  "estou",
  "estava",
  "muito",
  "também",
  "tambem",
  "mesmo",
  "porque",
  "porém",
  "porem",
  "pouco",
  "bastante",
  "gente",
  "pessoal",
  "hoje",
  "ontem",
  "amanhã",
  "amanha",
  "aqui",
  "certo",
  "vamos",
  "todos",
  "todas",
  "qualquer",
  "aquele",
  "aquela",
  "aquilo",
  "esse",
  "essa",
  "isso",
  "isto",
  "já",
  "ja",
  "mas",
  "ainda",
  "sendo",
  "pode",
  "poder",
  "pois",
  "sobre",
  "tem",
  "tenho",
  "tinha",
  "ter",
  "foi",
  "sou",
  "são",
  "sao",
  "ele",
  "ela",
  "eles",
  "elas",
]);

function minutesBetween(a: Date, b: Date): number {
  return Math.abs(b.getTime() - a.getTime()) / 60_000;
}

/**
 * Jaccard similarity of two string sets: |A ∩ B| / |A ∪ B|.
 * Returns 1 when both sets are empty (degenerate but safe).
 */
function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  for (const x of a) if (b.has(x)) intersection += 1;
  const union = a.size + b.size - intersection;
  return union === 0 ? 1 : intersection / union;
}

/**
 * Tokenize content for keyword extraction: lowercase, split on non-word,
 * drop short tokens + stopwords + pure-digit tokens.
 */
function tokenize(content: string): string[] {
  const lower = content.toLowerCase();
  // \W with the Unicode flag still splits on accented word chars in Node's
  // default engine, so we use an explicit negated class that preserves
  // Latin letters + digits + the common PT accented vowels.
  const raw = lower.split(/[^0-9a-zà-ÿ]+/u);
  const out: string[] = [];
  for (const tok of raw) {
    if (tok.length < 4) continue;
    if (KEYWORD_STOPWORDS.has(tok)) continue;
    if (/^\d+$/.test(tok)) continue;
    out.push(tok);
  }
  return out;
}

function topKeywords(messages: NormalizedMessage[], limit = 5): string[] {
  const counts = new Map<string, number>();
  for (const m of messages) {
    for (const tok of tokenize(m.content)) {
      counts.set(tok, (counts.get(tok) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1];
      return a[0].localeCompare(b[0]);
    })
    .slice(0, limit)
    .map(([tok]) => tok);
}

function topicHash(startAt: Date, participants: readonly string[]): string {
  const h = createHash("sha1");
  h.update(startAt.toISOString());
  h.update("|");
  h.update(participants.join(","));
  return h.digest("hex").slice(0, 8);
}

/** Internal mutable accumulator; we freeze into `Topic` at close time. */
type Draft = {
  startAt: Date;
  endAt: Date;
  messages: NormalizedMessage[];
  participants: string[];
  participantSet: Set<string>;
  recentSenders: string[]; // sliding window, most-recent-last
};

function newDraft(msg: NormalizedMessage): Draft {
  return {
    startAt: msg.at,
    endAt: msg.at,
    messages: [msg],
    participants: [msg.senderName],
    participantSet: new Set([msg.senderName]),
    recentSenders: [msg.senderName],
  };
}

function pushIntoDraft(draft: Draft, msg: NormalizedMessage): void {
  draft.endAt = msg.at;
  draft.messages.push(msg);
  if (!draft.participantSet.has(msg.senderName)) {
    draft.participantSet.add(msg.senderName);
    draft.participants.push(msg.senderName);
  }
  draft.recentSenders.push(msg.senderName);
  if (draft.recentSenders.length > RECENT_WINDOW) {
    draft.recentSenders.shift();
  }
}

function finalizeDraft(draft: Draft): Topic {
  const participants = [...draft.participants];
  return {
    id: topicHash(draft.startAt, participants),
    startAt: draft.startAt,
    endAt: draft.endAt,
    messages: draft.messages,
    participants,
    dominantKeywords: topKeywords(draft.messages),
  };
}

/**
 * Split a flat timeline of messages into topics by temporal + participant
 * heuristics.
 *
 * Invariants:
 * - Input is never mutated (we sort a copy).
 * - `messages` within a topic are ascending by `at`.
 * - `topics[n].endAt <= topics[n+1].startAt` modulo ties.
 *
 * @param messages  Flat, unsorted (or sorted) list of `NormalizedMessage`.
 * @param opts.gapMinutes            Hard gap: > this → force split. Default 30.
 * @param opts.minParticipantOverlap Soft split: if Jaccard of recent senders
 *   vs topic participants falls below this AND the gap exceeds
 *   `MIN_SPLIT_GAP_MINUTES`, start a new topic. Default 0.3.
 */
export function clusterByTopic(
  messages: NormalizedMessage[],
  opts?: ClusterOptions,
): Topic[] {
  if (messages.length === 0) return [];

  const gapMinutes = opts?.gapMinutes ?? DEFAULT_GAP_MINUTES;
  const minOverlap = opts?.minParticipantOverlap ?? DEFAULT_MIN_OVERLAP;

  // Copy before sort — never mutate the caller's array.
  const sorted = [...messages].sort((a, b) => {
    const t = a.at.getTime() - b.at.getTime();
    if (t !== 0) return t;
    // Stable tiebreaker: id keeps output deterministic regardless of input order.
    return a.id.localeCompare(b.id);
  });

  const topics: Topic[] = [];
  let current: Draft = newDraft(sorted[0]);

  for (let i = 1; i < sorted.length; i += 1) {
    const msg = sorted[i];
    const gap = minutesBetween(current.endAt, msg.at);

    let split = false;

    if (gap > gapMinutes) {
      split = true;
    } else if (gap > MIN_SPLIT_GAP_MINUTES) {
      // Participant-overlap check: compare the rolling window of recent
      // senders (including this new msg) against the topic's full participant
      // set. If the conversation has drifted to a fresh crowd, split.
      const windowSet = new Set<string>(current.recentSenders);
      windowSet.add(msg.senderName);
      const overlap = jaccard(windowSet, current.participantSet);
      if (overlap < minOverlap) split = true;
    }

    if (split) {
      topics.push(finalizeDraft(current));
      current = newDraft(msg);
    } else {
      pushIntoDraft(current, msg);
    }
  }

  topics.push(finalizeDraft(current));
  return topics;
}
