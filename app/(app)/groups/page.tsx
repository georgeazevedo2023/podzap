// NOTE: `@/lib/groups/service` and `@/app/api/groups/*` are authored in
// parallel by other Fase 3 agents. This page imports `listGroups` and
// `GroupView` from the service module — builds will fail until that module
// lands, same pattern as the Fase 2 onboarding page.

import Link from 'next/link';
import { redirect } from 'next/navigation';

import { TopBar } from '@/components/shell/TopBar';
import { Sticker } from '@/components/ui/Sticker';
import { getCurrentUserAndTenant } from '@/lib/tenant';
import { listGroups, type GroupView } from '@/lib/groups/service';
import { getCurrentInstance } from '@/lib/whatsapp/service';

import { GroupsList } from './GroupsList';
import { SyncButton } from './SyncButton';

/**
 * Groups screen — Fase 3.
 *
 * Pure server component: resolves the tenant, loads the current WhatsApp
 * instance (to detect the "not connected" empty state), then loads the
 * tenant's group list. Everything interactive (search, toggle-monitor,
 * "sync now") lives in `GroupsList` / `GroupCard` / `SyncButton` client
 * components.
 *
 * Three render branches:
 *   1. No instance                → "connect WhatsApp first" empty state.
 *   2. Instance but 0 groups      → "no groups yet" + sync CTA.
 *   3. Groups                     → interactive list with toolbar.
 *
 * Auth is enforced by `(app)/layout.tsx`; we still re-fetch the context
 * here because we need the tenant id locally.
 */
const PAGE_SIZE = 20;

type GroupsPageProps = {
  searchParams: Promise<{ page?: string; q?: string; only?: string }>;
};

export default async function GroupsPage({ searchParams }: GroupsPageProps) {
  const context = await getCurrentUserAndTenant();
  if (!context) {
    redirect('/login?error=Faça login para continuar');
  }

  const { tenant } = context;
  const params = await searchParams;
  const page = Math.max(0, Number.parseInt(params.page ?? '0', 10) || 0);
  const search = (params.q ?? '').trim();
  const monitoredOnly = params.only === '1';

  // Also fetch the monitored count separately — the paged result gives us
  // only rows for this page, but the subtitle needs the full count.
  const [instance, groupsPage, monitoredCountResult] = await Promise.all([
    getCurrentInstance(tenant.id),
    listGroups(tenant.id, { page, pageSize: PAGE_SIZE, search, monitoredOnly }),
    listGroups(tenant.id, { monitoredOnly: true, pageSize: 1 }),
  ]);

  const monitoredCount = monitoredCountResult.total;
  const hasInstance = instance !== null;
  const hasConnectedInstance =
    hasInstance && instance.status === 'connected';

  return (
    <div style={{ minHeight: '100vh' }}>
      <TopBar
        title="Grupos"
        subtitle={
          hasInstance
            ? `${monitoredCount} monitorados de ${groupsPage.total}`
            : 'conecta o WhatsApp pra listar seus grupos'
        }
        accent="purple"
        breadcrumb="podZAP · Fase 3"
        actions={hasConnectedInstance ? <SyncButton /> : null}
      />

      <div
        style={{
          padding: '28px 36px 40px',
          display: 'flex',
          flexDirection: 'column',
          gap: 20,
          maxWidth: 1240,
        }}
      >
        {!hasInstance && <NoInstanceEmptyState />}

        {hasInstance && !hasConnectedInstance && (
          <NotConnectedYetEmptyState />
        )}

        {hasConnectedInstance && groupsPage.total === 0 && !search && !monitoredOnly && (
          <NoGroupsEmptyState />
        )}

        {hasConnectedInstance && (groupsPage.total > 0 || search || monitoredOnly) && (
          <GroupsList
            initial={groupsPage.rows}
            total={groupsPage.total}
            page={groupsPage.page}
            pageSize={groupsPage.pageSize}
            initialSearch={search}
            initialMonitoredOnly={monitoredOnly}
          />
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Empty states                                                               */
/* -------------------------------------------------------------------------- */

function NoInstanceEmptyState() {
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
          📵 sem whatsapp conectado
        </Sticker>
        <h2
          style={{
            margin: '8px 0 10px',
            fontFamily: 'var(--font-display)',
            fontSize: 34,
            fontWeight: 800,
            lineHeight: 1.05,
            letterSpacing: '-0.02em',
          }}
        >
          conecta o whatsapp primeiro
        </h2>
        <p
          style={{
            margin: '0 0 18px',
            fontSize: 14,
            lineHeight: 1.5,
            color: 'var(--text-dim)',
            maxWidth: 480,
          }}
        >
          sem instância, não tem grupo pra listar. escaneia o QR no
          onboarding e a gente puxa tudo daqui.
        </p>
        <Link href="/onboarding" className="btn btn-zap">
          ⚡ ir pro onboarding
        </Link>
      </div>
      <div
        aria-hidden
        style={{
          width: 140,
          height: 140,
          borderRadius: 'var(--radius-lg)',
          background: 'var(--bg-2)',
          border: '3px solid var(--stroke)',
          boxShadow: 'var(--shadow-chunk-lg)',
          display: 'grid',
          placeItems: 'center',
          fontSize: 64,
        }}
      >
        📱
      </div>
    </div>
  );
}

function NotConnectedYetEmptyState() {
  return (
    <div
      className="card"
      style={{
        padding: 28,
        display: 'flex',
        gap: 18,
        alignItems: 'center',
        flexWrap: 'wrap',
      }}
    >
      <div aria-hidden style={{ fontSize: 42 }}>
        ⏳
      </div>
      <div style={{ flex: 1, minWidth: 260 }}>
        <h2
          style={{
            margin: '0 0 6px',
            fontFamily: 'var(--font-display)',
            fontSize: 24,
            fontWeight: 800,
            letterSpacing: '-0.02em',
          }}
        >
          instância ainda conectando
        </h2>
        <p
          style={{
            margin: 0,
            fontSize: 14,
            color: 'var(--text-dim)',
            lineHeight: 1.5,
          }}
        >
          volta pro onboarding, escaneia o QR e assim que ficar verde a
          gente mostra os grupos por aqui.
        </p>
      </div>
      <Link href="/onboarding" className="btn btn-purple">
        voltar pro onboarding →
      </Link>
    </div>
  );
}

function NoGroupsEmptyState() {
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
        <Sticker variant="yellow" style={{ marginBottom: 12 }}>
          📡 nenhum grupo ainda
        </Sticker>
        <h2
          style={{
            margin: '8px 0 10px',
            fontFamily: 'var(--font-display)',
            fontSize: 32,
            fontWeight: 800,
            lineHeight: 1.05,
            letterSpacing: '-0.02em',
          }}
        >
          seu whatsapp tá conectado, mas nenhum grupo foi sincronizado
          ainda
        </h2>
        <p
          style={{
            margin: '0 0 18px',
            fontSize: 14,
            lineHeight: 1.5,
            color: 'var(--text-dim)',
            maxWidth: 520,
          }}
        >
          clica em sincronizar pra gente puxar a lista direto da UAZAPI.
          depois disso você escolhe o que vira podcast.
        </p>
        <SyncButton />
      </div>
      <div
        aria-hidden
        style={{
          width: 140,
          height: 140,
          borderRadius: 'var(--radius-lg)',
          background: 'var(--bg-2)',
          border: '3px solid var(--stroke)',
          boxShadow: 'var(--shadow-chunk-lg)',
          display: 'grid',
          placeItems: 'center',
          fontSize: 64,
        }}
      >
        👥
      </div>
    </div>
  );
}

// Re-exported for callers that want the server-side type without pulling it
// through the service directly.
export type { GroupView };
