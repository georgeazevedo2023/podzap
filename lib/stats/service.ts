/**
 * `lib/stats/service.ts` — Fase 12 (redesign da home).
 *
 * Single-shot aggregator for the `/home` dashboard. Assembles all the
 * numbers the hero, stat cards, "últimos eps" grid and "episódio atual"
 * panel need in one call so the page can render in a single round-trip.
 *
 * Design notes:
 *   - Service-role admin client, all queries filtered by `tenant_id`
 *     (belt-and-suspenders — the route layer already authenticated).
 *   - Every independent query is fired in parallel with `Promise.all` so
 *     latency is max(query) rather than sum(query).
 *   - Signed URLs for audio previews default to 1h. We also return the
 *     matching `audioExpiresAt` ISO string so the client can re-fetch
 *     before playback breaks mid-listen (audit adição #5).
 *   - `coverVariant` is a deterministic djb2 hash of `groupId` mapped to
 *     [0, 5] — same group always gets the same cover across sessions and
 *     across devices without needing a DB column.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { getSignedUrl } from "@/lib/media/signedUrl";
import type { Database } from "@/lib/supabase/types";

type SummaryTone = Database["public"]["Enums"]["summary_tone"];

const SIGNED_URL_TTL_SECONDS = 3600;
const LATEST_EPISODES_LIMIT = 4;

/** Max title length extracted from `summary.text` first line. */
const MAX_TITLE_LEN = 60;

/** Known summary tones — used to narrow the `currentEpisode.tone` type. */
const VALID_TONES: readonly SummaryTone[] = [
  "formal",
  "fun",
  "corporate",
] as const;

export type HomeStatsEpisode = {
  summaryId: string;
  groupName: string;
  createdAt: string;
  durationSeconds: number | null;
  /** Deterministic 0-5 hash of `groupId`. Always same for same group. */
  coverVariant: number;
  /** Short-lived signed URL (1h). `null` when storage signing failed. */
  audioSignedUrl: string | null;
  /** ISO timestamp after which `audioSignedUrl` stops working. */
  audioExpiresAt: string | null;
};

export type HomeStatsCurrent = HomeStatsEpisode & {
  messagesCount: number;
  audiosCount: number;
  imagesCount: number;
  /** First sentence of `summary.text` (<=60 chars), else `"ep. N"`. */
  title: string;
  episodeNumber: number;
  tone: SummaryTone;
};

export type HomeStats = {
  summariesThisWeek: number;
  minutesListened: number;
  activeGroupsCount: number;
  /** 0-1. UI multiplies by 100 for the percentage display. */
  approvalRate: number;
  pendingApprovalsCount: number;
  /** Up to 4 most recent approved summaries with an audio row. */
  latestEpisodes: HomeStatsEpisode[];
  /** First entry of `latestEpisodes` enriched with per-group counts, or
   *  `null` when the tenant has no approved+audio episodes yet. */
  currentEpisode: HomeStatsCurrent | null;
  /**
   * Onboarding-stage signals — used by the hero empty state to pick the
   * right CTA. Without these the empty state would always push the user
   * to `/onboarding` even when they're already past that step. All three
   * are cheap scalar queries so they ride the same `Promise.all`.
   */
  whatsappConnected: boolean;
  monitoredGroupsCount: number;
  capturedMessagesCount: number;
};

// ──────────────────────────────────────────────────────────────────────────
//  Hash helper
// ──────────────────────────────────────────────────────────────────────────

/**
 * djb2-style string hash → integer in [0, 5]. Chosen over `crypto.createHash`
 * because it's 10x faster, no Node-only import, and for a 6-bucket mapping
 * the extra cryptographic distribution buys us nothing. Deterministic —
 * same input always yields the same output across runs/machines.
 */
export function hashToVariant(id: string): number {
  let h = 5381;
  for (let i = 0; i < id.length; i++) {
    // The `| 0` keeps us in signed-32-bit int land so the value doesn't
    // drift into floating-point precision territory on long ids.
    h = ((h << 5) + h + id.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % 6;
}

// ──────────────────────────────────────────────────────────────────────────
//  Internals
// ──────────────────────────────────────────────────────────────────────────

/** ISO timestamp for `now - <days> days`. */
function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

/** Extract a display title from a raw summary body. */
function extractTitle(text: string, episodeNumber: number): string {
  const firstLine = text.split("\n").map((l) => l.trim()).find((l) => l) ?? "";
  if (!firstLine) return `ep. ${episodeNumber}`;
  // Prefer cutting at sentence boundary if it lands before the hard cap.
  const sentenceEnd = firstLine.search(/[.!?]\s|$/);
  const candidate =
    sentenceEnd > 0 && sentenceEnd < MAX_TITLE_LEN
      ? firstLine.slice(0, sentenceEnd)
      : firstLine;
  return candidate.length > MAX_TITLE_LEN
    ? `${candidate.slice(0, MAX_TITLE_LEN - 1).trimEnd()}…`
    : candidate;
}

type AdminClient = ReturnType<typeof createAdminClient>;

/**
 * `select('*', { count: 'exact', head: true })` returns just the row count
 * — no row bodies transferred. Used for all our tally queries.
 */
async function countWhere(
  admin: AdminClient,
  table: "summaries" | "audios" | "messages" | "groups",
  build: (
    q: ReturnType<AdminClient["from"]>,
  ) => ReturnType<AdminClient["from"]>,
): Promise<number> {
  const base = admin.from(table).select("*", { count: "exact", head: true });
  const { count, error } = await build(base as unknown as ReturnType<AdminClient["from"]>);
  if (error) {
    throw new Error(`stats count(${table}) failed: ${error.message}`);
  }
  return count ?? 0;
}

type LatestEpisodeRow = {
  summary_id: string;
  created_at: string;
  group_id: string;
  group_name: string;
  tone: SummaryTone;
  text: string;
  duration_seconds: number | null;
  storage_path: string;
  audio_created_at: string;
};

/**
 * Fetch up to N latest approved summaries that already have an audio.
 * Ordered by audio `created_at` desc — matches what users expect on the
 * hero (most recent podcast first).
 */
async function loadLatestEpisodeRows(
  admin: AdminClient,
  tenantId: string,
  limit: number,
): Promise<LatestEpisodeRow[]> {
  const { data, error } = await admin
    .from("audios")
    .select(
      `
      created_at,
      duration_seconds,
      storage_path,
      summaries!inner (
        id,
        status,
        tone,
        text,
        created_at,
        group_id,
        groups:group_id ( id, name )
      )
      `,
    )
    .eq("tenant_id", tenantId)
    .eq("summaries.status", "approved")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(`stats latestEpisodes failed: ${error.message}`);
  }

  type RawAudioWithSummary = {
    created_at: string;
    duration_seconds: number | null;
    storage_path: string;
    summaries:
      | {
          id: string;
          status: string;
          tone: SummaryTone;
          text: string;
          created_at: string;
          group_id: string;
          groups:
            | { id: string; name: string }
            | { id: string; name: string }[]
            | null;
        }
      | Array<{
          id: string;
          status: string;
          tone: SummaryTone;
          text: string;
          created_at: string;
          group_id: string;
          groups:
            | { id: string; name: string }
            | { id: string; name: string }[]
            | null;
        }>
      | null;
  };

  const rows = (data ?? []) as RawAudioWithSummary[];
  const out: LatestEpisodeRow[] = [];
  for (const r of rows) {
    const s = Array.isArray(r.summaries) ? r.summaries[0] : r.summaries;
    if (!s) continue;
    const g = Array.isArray(s.groups) ? s.groups[0] : s.groups;
    if (!g) continue;
    out.push({
      summary_id: s.id,
      created_at: s.created_at,
      group_id: g.id,
      group_name: g.name,
      tone: s.tone,
      text: s.text,
      duration_seconds: r.duration_seconds,
      storage_path: r.storage_path,
      audio_created_at: r.created_at,
    });
  }
  return out;
}

/**
 * Sign `storage_path` in the `audios` bucket. Returns `{ url, expiresAt }`
 * or `{ url: null, expiresAt: null }` on failure — the dashboard still
 * renders the card, just without a playable URL.
 */
async function signEpisodeUrl(
  storagePath: string,
  signedAt: number,
): Promise<{ url: string | null; expiresAt: string | null }> {
  try {
    const url = await getSignedUrl(storagePath, {
      bucket: "audios",
      expiresInSeconds: SIGNED_URL_TTL_SECONDS,
    });
    const expiresAt = new Date(
      signedAt + SIGNED_URL_TTL_SECONDS * 1000,
    ).toISOString();
    return { url, expiresAt };
  } catch {
    return { url: null, expiresAt: null };
  }
}

/**
 * Per-group counts for messages in the last 24h, plus the episode number
 * (= count of approved summaries for this group up to and including the
 * current one). Fires both queries in parallel.
 */
async function loadCurrentEpisodeExtras(
  admin: AdminClient,
  tenantId: string,
  groupId: string,
  summaryCreatedAt: string,
): Promise<{
  messagesCount: number;
  audiosCount: number;
  imagesCount: number;
  episodeNumber: number;
}> {
  const since24h = isoDaysAgo(1);

  const [messagesResult, episodeCountResult] = await Promise.all([
    admin
      .from("messages")
      .select("type")
      .eq("tenant_id", tenantId)
      .eq("group_id", groupId)
      .gte("captured_at", since24h),
    admin
      .from("summaries")
      .select("*", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("group_id", groupId)
      .eq("status", "approved")
      .lte("created_at", summaryCreatedAt),
  ]);

  if (messagesResult.error) {
    throw new Error(
      `stats currentEpisode messages failed: ${messagesResult.error.message}`,
    );
  }
  if (episodeCountResult.error) {
    throw new Error(
      `stats currentEpisode episodeNumber failed: ${episodeCountResult.error.message}`,
    );
  }

  const rows = (messagesResult.data ?? []) as Array<{
    type: Database["public"]["Enums"]["message_type"];
  }>;
  let messagesCount = 0;
  let audiosCount = 0;
  let imagesCount = 0;
  for (const r of rows) {
    messagesCount += 1;
    if (r.type === "audio") audiosCount += 1;
    else if (r.type === "image") imagesCount += 1;
  }

  return {
    messagesCount,
    audiosCount,
    imagesCount,
    episodeNumber: episodeCountResult.count ?? 0,
  };
}

function narrowTone(tone: SummaryTone): SummaryTone {
  return (VALID_TONES as readonly string[]).includes(tone) ? tone : "fun";
}

// ──────────────────────────────────────────────────────────────────────────
//  Public API
// ──────────────────────────────────────────────────────────────────────────

/**
 * Load every stat the /home dashboard needs for one tenant, in parallel.
 *
 * Failure policy: DB errors bubble (the page shows an error boundary).
 * Signed-URL failures are swallowed per-episode so one bad storage row
 * doesn't zero out the whole hero.
 */
export async function getHomeStats(tenantId: string): Promise<HomeStats> {
  const admin = createAdminClient();

  const sevenDaysAgo = isoDaysAgo(7);
  const thirtyDaysAgo = isoDaysAgo(30);

  // All independent queries in one Promise.all. Each returns its own
  // shape; we destructure in order below.
  const [
    summariesThisWeek,
    minutesListenedRows,
    activeGroupsRows,
    approvalRateRows,
    pendingApprovalsCount,
    latestRows,
    whatsappConnected,
    monitoredGroupsCount,
    capturedMessagesCount,
  ] = await Promise.all([
    // 1. summariesThisWeek
    countWhere(admin, "summaries", (q) =>
      q
        .eq("tenant_id", tenantId)
        .eq("status", "approved")
        .gte("created_at", sevenDaysAgo),
    ),

    // 2. minutesListened — sum duration_seconds of delivered audios (7d).
    //    We pull the rows and aggregate in-process; avoids needing an RPC.
    (async () => {
      const { data, error } = await admin
        .from("audios")
        .select("duration_seconds")
        .eq("tenant_id", tenantId)
        .eq("delivered_to_whatsapp", true)
        .gte("delivered_at", sevenDaysAgo);
      if (error) {
        throw new Error(`stats minutesListened failed: ${error.message}`);
      }
      return (data ?? []) as Array<{ duration_seconds: number | null }>;
    })(),

    // 3. activeGroupsCount — distinct group_id over messages(7d).
    //    We fetch the column and de-dupe client-side; at typical tenant
    //    volumes this is a few hundred rows max.
    (async () => {
      const { data, error } = await admin
        .from("messages")
        .select("group_id")
        .eq("tenant_id", tenantId)
        .gte("captured_at", sevenDaysAgo);
      if (error) {
        throw new Error(`stats activeGroupsCount failed: ${error.message}`);
      }
      return (data ?? []) as Array<{ group_id: string }>;
    })(),

    // 4. approvalRate — approved / total over 30d.
    (async () => {
      const { data, error } = await admin
        .from("summaries")
        .select("status")
        .eq("tenant_id", tenantId)
        .gte("created_at", thirtyDaysAgo);
      if (error) {
        throw new Error(`stats approvalRate failed: ${error.message}`);
      }
      return (data ?? []) as Array<{ status: string }>;
    })(),

    // 5. pendingApprovalsCount
    countWhere(admin, "summaries", (q) =>
      q.eq("tenant_id", tenantId).eq("status", "pending_review"),
    ),

    // 6. latestEpisodes — same rows feed `currentEpisode` below.
    loadLatestEpisodeRows(admin, tenantId, LATEST_EPISODES_LIMIT),

    // 7. whatsappConnected — any row in whatsapp_instances for the tenant
    //    whose status is 'connected'. 0..1 row per tenant (MVP rule).
    (async () => {
      const { data, error } = await admin
        .from("whatsapp_instances")
        .select("status")
        .eq("tenant_id", tenantId)
        .eq("status", "connected")
        .limit(1);
      if (error) {
        throw new Error(`stats whatsappConnected failed: ${error.message}`);
      }
      return (data ?? []).length > 0;
    })(),

    // 8. monitoredGroupsCount — active coverage for the tenant.
    countWhere(admin, "groups", (q) =>
      q.eq("tenant_id", tenantId).eq("is_monitored", true),
    ),

    // 9. capturedMessagesCount — all-time; we just need "has any" to pick
    //    the right onboarding CTA, so a count is enough. The column has
    //    a `(tenant_id, captured_at)` index so head-count is cheap.
    countWhere(admin, "messages", (q) => q.eq("tenant_id", tenantId)),
  ]);

  // ── Aggregations ───────────────────────────────────────────────────
  const minutesListened = Math.floor(
    minutesListenedRows.reduce(
      (sum, r) => sum + (r.duration_seconds ?? 0),
      0,
    ) / 60,
  );

  const activeGroupsCount = new Set(
    activeGroupsRows.map((r) => r.group_id),
  ).size;

  const approvalTotal = approvalRateRows.length;
  const approvedCount = approvalRateRows.filter(
    (r) => r.status === "approved",
  ).length;
  // null-safe: denom=0 → rate=0 (UI shows "—%" when total is 0).
  const approvalRate = approvalTotal === 0 ? 0 : approvedCount / approvalTotal;

  // ── Sign audio URLs in parallel ────────────────────────────────────
  const signedAt = Date.now();
  const signed = await Promise.all(
    latestRows.map((r) => signEpisodeUrl(r.storage_path, signedAt)),
  );

  const latestEpisodes: HomeStatsEpisode[] = latestRows.map((r, i) => ({
    summaryId: r.summary_id,
    groupName: r.group_name,
    createdAt: r.created_at,
    durationSeconds: r.duration_seconds,
    coverVariant: hashToVariant(r.group_id),
    audioSignedUrl: signed[i].url,
    audioExpiresAt: signed[i].expiresAt,
  }));

  // ── currentEpisode = latestRows[0] + per-group counts + episode# ───
  let currentEpisode: HomeStatsCurrent | null = null;
  if (latestRows.length > 0) {
    const head = latestRows[0];
    const extras = await loadCurrentEpisodeExtras(
      admin,
      tenantId,
      head.group_id,
      head.created_at,
    );
    const base = latestEpisodes[0];
    const episodeNumber = Math.max(1, extras.episodeNumber);
    currentEpisode = {
      ...base,
      messagesCount: extras.messagesCount,
      audiosCount: extras.audiosCount,
      imagesCount: extras.imagesCount,
      title: extractTitle(head.text, episodeNumber),
      episodeNumber,
      tone: narrowTone(head.tone),
    };
  }

  return {
    summariesThisWeek,
    minutesListened,
    activeGroupsCount,
    approvalRate,
    pendingApprovalsCount,
    latestEpisodes,
    currentEpisode,
    whatsappConnected,
    monitoredGroupsCount,
    capturedMessagesCount,
  };
}
