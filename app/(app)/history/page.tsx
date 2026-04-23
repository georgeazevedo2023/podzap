// NOTE: `@/lib/media/signedUrl` is authored in parallel by Fase 4 Agent 4.
// This page imports `getSignedUrl` from it — once that module lands the
// build type-checks without changes. Same pattern as Fase 3's parallel
// agent dance.

import { redirect } from 'next/navigation';

import { TopBar } from '@/components/shell/TopBar';
import { Sticker } from '@/components/ui/Sticker';
import { createAdminClient } from '@/lib/supabase/admin';
import { getCurrentUserAndTenant } from '@/lib/tenant';
import { getSignedUrl } from '@/lib/media/signedUrl';

import { MessagesList, type HistoryItem } from './MessagesList';
import { RefreshButton } from './RefreshButton';

/** Upper bound of messages shown on first render. Matches `GET /api/history`. */
const HISTORY_LIMIT = 50;

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
async function loadHistory(tenantId: string): Promise<HistoryItem[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
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
      groups:group_id ( name, picture_url )
      `,
    )
    .eq('tenant_id', tenantId)
    .order('captured_at', { ascending: false })
    .limit(HISTORY_LIMIT);

  if (error || !data) return [];

  const items: HistoryItem[] = await Promise.all(
    data.map(async (row) => {
      const group = Array.isArray(row.groups) ? row.groups[0] : row.groups;
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
      };
    }),
  );

  return items;
}

/**
 * `/history` — scrollable feed of the latest captured messages for this
 * tenant. Intentionally read-only; all interactivity (refresh, preview) is
 * owned by the client sub-component.
 */
export default async function HistoryPage() {
  const context = await getCurrentUserAndTenant();
  if (!context) {
    redirect('/login?error=Faça login para continuar');
  }

  const { tenant } = context;
  const items = await loadHistory(tenant.id);

  return (
    <div style={{ minHeight: '100vh' }}>
      <TopBar
        title="Histórico"
        subtitle="Últimas mensagens capturadas"
        accent="pink"
        breadcrumb="podZAP · Fase 4"
        actions={<RefreshButton />}
      />

      <div
        style={{
          padding: '28px clamp(16px, 4vw, 36px) 40px',
          display: 'flex',
          flexDirection: 'column',
          gap: 18,
          maxWidth: 960,
        }}
      >
        {items.length === 0 ? <EmptyState /> : <MessagesList initial={items} />}
      </div>
    </div>
  );
}

function EmptyState() {
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
          📭 sem mensagens ainda
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
          nenhuma mensagem ainda
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
          verifica se o WhatsApp está conectado e se os grupos que você quer
          ouvir estão monitorados. assim que o primeiro áudio cair por aqui
          ele aparece nessa lista.
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
