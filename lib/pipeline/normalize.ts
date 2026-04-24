/**
 * Phase 6 — Normalized conversation orchestrator.
 *
 * Glue between the DB and the pure-function pipeline:
 *   1. Pull all messages (+ transcript JOIN + group JOIN) in a given
 *      [periodStart, periodEnd] window for (tenantId, groupId).
 *   2. Shape rows into the `FilterInput` contract.
 *   3. Run `filterMessages` → keep/discard + weighted `NormalizedMessage[]`.
 *   4. Run `clusterByTopic` → `Topic[]`.
 *   5. Wrap into a `NormalizedConversation` ready for the Phase 7 LLM prompt.
 *
 * Uses the admin client (service-role), so this module must NEVER be imported
 * from client components. See `docs/plans/fase-6-plan.md`.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/types";
import {
  filterMessages,
  type FilterInput,
  type NormalizedMessage,
} from "./filter";
import { clusterByTopic, type Topic } from "./cluster";

// Re-export the upstream types so callers can import everything they need
// from one orchestrator module without reaching into filter/cluster directly.
export type { NormalizedMessage, Topic };

export type NormalizedConversation = {
  tenantId: string;
  groupId: string;
  groupName: string;
  periodStart: Date;
  periodEnd: Date;
  topics: Topic[];
  /** Count of messages dropped by `filterMessages`. */
  discarded: number;
  /** Total raw rows pulled from the DB (kept + discarded). */
  total: number;
  /**
   * "Mestres do engajamento" — top participantes por contagem total de
   * mensagens (incluindo as descartadas pelo filtro: pra essa métrica, o
   * que importa é volume bruto, não relevância). Sorted desc por count;
   * ties mantém ordem de aparição. Top 5 — o prompt escolhe os 3 primeiros
   * mas dá margem pra empate.
   */
  topParticipants: Array<{ name: string; count: number }>;
};

type MessageType = Database["public"]["Enums"]["message_type"];

/**
 * Shape of a single row returned by the JOINed select below. Supabase's
 * typed client can't easily express joins as "T & { foo: T2 | null }" without
 * a generated helper, so we declare the narrow shape we actually read.
 */
type JoinedRow = {
  id: string;
  sender_name: string | null;
  sender_jid: string | null;
  captured_at: string;
  type: MessageType;
  content: string | null;
  media_url: string | null;
  media_duration_seconds: number | null;
  transcripts: { text: string } | { text: string }[] | null;
  groups: { name: string } | { name: string }[] | null;
};

/** Supabase returns embeds as objects (to-one) or arrays (to-many) depending
 * on the FK cardinality; normalize to "first object or null". */
function unwrapEmbed<T>(embed: T | T[] | null | undefined): T | null {
  if (embed == null) return null;
  if (Array.isArray(embed)) return embed[0] ?? null;
  return embed;
}

function rowToFilterInput(row: JoinedRow): FilterInput[number] {
  const transcript = unwrapEmbed(row.transcripts);
  return {
    id: row.id,
    senderName: row.sender_name,
    senderJid: row.sender_jid,
    capturedAt: row.captured_at,
    type: row.type,
    content: row.content,
    mediaUrl: row.media_url,
    mediaDurationSeconds: row.media_duration_seconds,
    transcriptText: transcript?.text ?? null,
  };
}

/**
 * Build a normalized conversation for `(tenantId, groupId)` over
 * `[periodStart, periodEnd]` (inclusive on both ends, as that mirrors the
 * upstream scheduler's window semantics).
 *
 * Throws on invalid input (periodEnd < periodStart) or underlying DB errors.
 * Returns an empty-but-shaped conversation when there are no rows — callers
 * can treat `topics.length === 0` as "nothing to summarize".
 */
export async function buildNormalizedConversation(
  tenantId: string,
  groupId: string,
  periodStart: Date,
  periodEnd: Date,
): Promise<NormalizedConversation> {
  if (periodEnd.getTime() < periodStart.getTime()) {
    throw new Error(
      `buildNormalizedConversation: periodEnd (${periodEnd.toISOString()}) < periodStart (${periodStart.toISOString()})`,
    );
  }

  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("messages")
    .select(
      "id, sender_name, sender_jid, captured_at, type, content, media_url, media_duration_seconds, transcripts(text), groups(name)",
    )
    .eq("tenant_id", tenantId)
    .eq("group_id", groupId)
    .gte("captured_at", periodStart.toISOString())
    .lte("captured_at", periodEnd.toISOString())
    .order("captured_at", { ascending: true });

  if (error) {
    throw new Error(
      `buildNormalizedConversation: failed to load messages: ${error.message}`,
    );
  }

  const rows = (data ?? []) as unknown as JoinedRow[];

  if (rows.length === 0) {
    return {
      tenantId,
      groupId,
      // No rows = we can't resolve the group name from the join. Callers
      // that need the name in the empty case should look it up separately.
      groupName: "",
      periodStart,
      periodEnd,
      topics: [],
      discarded: 0,
      total: 0,
      topParticipants: [],
    };
  }

  const groupEmbed = unwrapEmbed(rows[0].groups);
  const groupName = groupEmbed?.name ?? "";

  const filterInput: FilterInput = rows.map(rowToFilterInput);
  const { kept, discarded } = filterMessages(filterInput);
  const topics = clusterByTopic(kept);
  const topParticipants = computeTopParticipants(rows);

  return {
    tenantId,
    groupId,
    groupName,
    periodStart,
    periodEnd,
    topics,
    discarded,
    total: rows.length,
    topParticipants,
  };
}

/**
 * Conta mensagens por sender_name (raw, antes do filtro — volume bruto)
 * e devolve top 5 desc. Senders sem nome são agrupados em "anônimo".
 * Ordem de aparição preservada em caso de empate, então o prompt pode
 * detectar empates olhando counts iguais.
 */
const TOP_PARTICIPANTS_LIMIT = 5;

function computeTopParticipants(
  rows: JoinedRow[],
): Array<{ name: string; count: number }> {
  // Map preserva insertion order — primeira mensagem de cada sender define
  // a posição que vence empates depois.
  const counts = new Map<string, number>();
  for (const row of rows) {
    const name = (row.sender_name ?? "").trim() || "anônimo";
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_PARTICIPANTS_LIMIT)
    .map(([name, count]) => ({ name, count }));
}
