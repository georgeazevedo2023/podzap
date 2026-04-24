// NOTE: `@/lib/media/signedUrl` is authored in parallel by Fase 4 Agent 4.
// This page imports `getSignedUrl` from it — once that module lands the
// build type-checks without changes. Same pattern as Fase 3's parallel
// agent dance.
//
// Fase 5: the `messages` query now pulls nested `transcripts(…)` rows so
// each row carries the transcription text produced by the Inngest pipeline
// (Groq Whisper for audio, Gemini Vision for images). Rows without a
// matching transcript surface as `null` and the UI renders a "transcribing"
// state so operators can see which messages are still in flight.

import { redirect } from 'next/navigation';

import { TopBar } from '@/components/shell/TopBar';
import { Sticker } from '@/components/ui/Sticker';
import { createAdminClient } from '@/lib/supabase/admin';
import { getCurrentUserAndTenant } from '@/lib/tenant';
import { getSignedUrl } from '@/lib/media/signedUrl';

import { HistoryFilterBar } from './HistoryFilterBar';
import { HistoryPagination } from './HistoryPagination';
import { MessagesListClient } from './MessagesListClient';
import type { HistoryItem, HistoryTranscript } from './MessagesList';
import { RefreshButton } from './RefreshButton';

/**
 * Page size for the history feed. Fixed (not exposed on UI) — matches the
 * `.range()` window in `loadHistory` and the "N msgs" badge in the filter
 * bar. Bump if you want fatter pages; the `signEpisodeUrl`-per-row cost
 * scales linearly with this (~30-50 parallel signs still fine).
 */
const HISTORY_PAGE_SIZE = 20;

interface GroupOption {
  id: string;
  name: string;
}

/**
 * Fetch monitored groups for the current tenant. Used to populate the
 * `<HistoryFilterBar>` dropdown. Groups without a human name fall back to
 * `"(sem nome)"` so the select never shows an empty label.
 */
async function loadMonitoredGroups(tenantId: string): Promise<GroupOption[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('groups')
    .select('id, name')
    .eq('tenant_id', tenantId)
    .eq('is_monitored', true)
    .order('name', { ascending: true });
  if (error || !data) return [];
  return data.map((g) => ({
    id: g.id,
    name: (g.name ?? '').trim() || '(sem nome)',
  }));
}

/**
 * Fetch the last N captured messages for this tenant, joined with the group
 * they belong to. Uses the admin client + manual `tenant_id` scoping rather
 * than the auth client + RLS because the webhook writes rows as service_role
 * and we want the same read path on server render as on `/api/history`.
 *
 * Media rows also get a fresh Supabase signed URL resolved here so the client
 * never needs service-role access. `getSignedUrl` is best-effort — we
 * swallow failures and fall back to `null` (the UI renders a placeholder).
 */
async function loadHistory(
  tenantId: string,
  groupId: string | null,
  page: number,
): Promise<{ items: HistoryItem[]; total: number }> {
  const admin = createAdminClient();
  const from = (page - 1) * HISTORY_PAGE_SIZE;
  const to = from + HISTORY_PAGE_SIZE - 1;
  // Nested `transcripts(…)` is a left-join — messages without a transcript
  // come back with an empty array (or `null` depending on postgrest), so we
  // normalise to a single object or `null` in the mapper below. Pulling the
  // transcript inline avoids an N+1 round-trip against the page-size cap.
  //
  // `{ count: 'exact' }` piggybacks the total row count on the same request
  // so the pagination footer doesn't need a second round-trip. Slightly
  // heavier at the Postgres level but negligible for a tenant-scoped table
  // with a `(tenant_id, captured_at)` index.
  let query = admin
    .from('messages')
    .select(
      `
      id,
      tenant_id,
      group_id,
      captured_at,
      sender_name,
      sender_jid,
      type,
      content,
      media_storage_path,
      media_mime_type,
      media_duration_seconds,
      groups:group_id ( name, picture_url ),
      transcripts ( text, language, model, created_at )
      `,
      { count: 'exact' },
    )
    .eq('tenant_id', tenantId);
  if (groupId) {
    query = query.eq('group_id', groupId);
  }
  const { data, error, count } = await query
    .order('captured_at', { ascending: false })
    .range(from, to);

  if (error || !data) return { items: [], total: 0 };

  const items: HistoryItem[] = await Promise.all(
    data.map(async (row) => {
      const group = Array.isArray(row.groups) ? row.groups[0] : row.groups;
      const transcriptRow = Array.isArray(row.transcripts)
        ? row.transcripts[0]
        : row.transcripts;
      const transcript: HistoryTranscript | null = transcriptRow
        ? {
            text: transcriptRow.text,
            language: transcriptRow.language ?? null,
            model: transcriptRow.model ?? null,
            createdAt: transcriptRow.created_at,
          }
        : null;
      let mediaSignedUrl: string | null = null;
      if (row.media_storage_path) {
        try {
          mediaSignedUrl = await getSignedUrl(row.media_storage_path);
        } catch {
          mediaSignedUrl = null;
        }
      }
      return {
        id: row.id,
        capturedAt: row.captured_at,
        type: row.type,
        content: row.content,
        senderName: row.sender_name ?? null,
        senderJid: row.sender_jid ?? null,
        groupName: group?.name ?? 'grupo sem nome',
        groupPictureUrl: group?.picture_url ?? null,
        mediaMimeType: row.media_mime_type ?? null,
        mediaDurationSeconds: row.media_duration_seconds ?? null,
        mediaSignedUrl,
        transcript,
      };
    }),
  );

  return { items, total: count ?? items.length };
}

/**
 * Parse a `?page=N` param safely — clamped to `[1, Infinity]`. Anything
 * non-numeric / negative falls back to page 1. Upper bound is enforced
 * later against the actual row count (out-of-range pages render an empty
 * feed with the "no messages" state and working prev/next).
 */
function parsePage(raw: string | string[] | undefined): number {
  const s = Array.isArray(raw) ? raw[0] : raw;
  const n = Number.parseInt(s ?? '', 10);
  if (!Number.isFinite(n) || n < 1) return 1;
  return n;
}

/**
 * `/history` — paginated feed of captured messages for this tenant.
 * Supports:
 *   - `?group=<uuid>` — filter by a monitored group (validated against
 *     this tenant's groups; invalid ids silently fall back to "todos").
 *   - `?page=<N>` — 1-indexed page, default 1. Page size fixed at
 *     `HISTORY_PAGE_SIZE`.
 *
 * `searchParams` is a Promise in Next 15 — awaited in parallel with the
 * monitored-groups query so the two network hops overlap.
 */
export default async function HistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ group?: string | string[]; page?: string | string[] }>;
}) {
  const context = await getCurrentUserAndTenant();
  if (!context) {
    redirect('/login?error=Faça login para continuar');
  }

  const { tenant } = context;
  const [groups, resolvedParams] = await Promise.all([
    loadMonitoredGroups(tenant.id),
    searchParams,
  ]);

  const rawGroup = Array.isArray(resolvedParams.group)
    ? resolvedParams.group[0]
    : resolvedParams.group;
  // Only honour the filter if the id maps to a monitored group for this
  // tenant. An invalid / cross-tenant id silently falls back to "todos".
  const selectedGroupId = rawGroup && groups.some((g) => g.id === rawGroup)
    ? rawGroup
    : '';

  const page = parsePage(resolvedParams.page);

  const { items, total } = await loadHistory(
    tenant.id,
    selectedGroupId ? selectedGroupId : null,
    page,
  );

  return (
    <div style={{ minHeight: '100vh' }}>
      <TopBar
        title="Histórico"
        subtitle="Últimas mensagens capturadas"
        accent="pink"
        breadcrumb="podZAP · Fase 5"
        actions={<RefreshButton />}
      />

      <div
        style={{
          padding: '28px clamp(16px, 4vw, 36px) 40px',
          display: 'flex',
          flexDirection: 'column',
          gap: 18,
          // 2-column grid de mensagens precisa de mais largura; estava em
          // 960 (confortável pra 1-col). 1320 segura 2 cards de ~620 + gap
          // sem ficar espalhado.
          maxWidth: 1320,
        }}
      >
        <HistoryFilterBar
          groups={groups}
          selectedGroupId={selectedGroupId}
          totalCount={total}
        />
        {items.length === 0 ? (
          <EmptyState filtered={!!selectedGroupId} />
        ) : (
          <>
            <MessagesListClient initial={items} />
            {/*
              Padrão clássico: paginação só no rodapé. Testamos top+bottom
              e o usuário preferiu a forma limpa (pedido direto — preserva
              o padrão mental de "chegou ao fim → escolho página").
            */}
            <HistoryPagination
              page={page}
              total={total}
              pageSize={HISTORY_PAGE_SIZE}
              groupId={selectedGroupId || null}
            />
          </>
        )}
      </div>
    </div>
  );
}

function EmptyState({ filtered = false }: { filtered?: boolean } = {}) {
  return (
    <div
      className="card"
      style={{
        padding: 32,
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) auto',
        gap: 28,
        alignItems: 'center',
      }}
    >
      <div>
        <Sticker variant="pink" style={{ marginBottom: 12 }}>
          📭 sem mensagens {filtered ? 'nesse grupo' : 'ainda'}
        </Sticker>
        <h2
          style={{
            margin: '8px 0 10px',
            fontFamily: 'var(--font-display)',
            fontSize: 30,
            fontWeight: 800,
            lineHeight: 1.05,
            letterSpacing: '-0.02em',
          }}
        >
          {filtered ? 'nenhuma mensagem nesse grupo' : 'nenhuma mensagem ainda'}
        </h2>
        <p
          style={{
            margin: 0,
            fontSize: 14,
            lineHeight: 1.5,
            color: 'var(--text-dim)',
            maxWidth: 520,
          }}
        >
          {filtered
            ? 'esse grupo ainda não teve mensagens capturadas desde que foi marcado como monitorado. tire o filtro pra ver o histórico geral.'
            : 'verifica se o WhatsApp está conectado e se os grupos que você quer ouvir estão monitorados. assim que o primeiro áudio cair por aqui ele aparece nessa lista.'}
        </p>
      </div>
      <div
        aria-hidden
        style={{
          width: 128,
          height: 128,
          borderRadius: 'var(--radius-lg)',
          background: 'var(--bg-2)',
          border: '3px solid var(--stroke)',
          boxShadow: 'var(--shadow-chunk-lg)',
          display: 'grid',
          placeItems: 'center',
          fontSize: 60,
        }}
      >
        🎙
      </div>
    </div>
  );
}
