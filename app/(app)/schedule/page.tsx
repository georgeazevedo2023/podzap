// NOTE: The `/api/schedules` routes are authored in parallel by another
// Fase 11 agent. This server page only depends on the schedules + groups
// service contracts, which already exist; the client components fetch the
// API endpoints at interaction time.

import Link from 'next/link';
import { redirect } from 'next/navigation';

import { TopBar } from '@/components/shell/TopBar';
import { Sticker } from '@/components/ui/Sticker';
import { getCurrentUserAndTenant } from '@/lib/tenant';
import { listGroups, type GroupView } from '@/lib/groups/service';
import {
  listSchedules,
  type ScheduleView,
} from '@/lib/schedules/service';

import { NewScheduleButton } from './NewScheduleButton';
import { ScheduleList } from './ScheduleList';

/**
 * Agenda screen — Fase 11.
 *
 * Pure server component: resolves the tenant, loads both the active
 * schedules and the list of monitored groups (the only ones eligible to
 * receive a schedule), and renders either:
 *
 *   1. "conecta um grupo monitorado primeiro" empty state when the tenant
 *      has no monitored groups — there's nothing to schedule against.
 *   2. "nenhuma agenda ainda" empty state when there are monitored groups
 *      but no schedules yet, pointing at the "+ nova agenda" action.
 *   3. The list of `<ScheduleCard>` instances, one per existing schedule.
 *
 * The create button is always mounted in the TopBar actions slot (when at
 * least one monitored group exists) so users can add schedules from any
 * state. It internally dedupes groups that already have a schedule so the
 * one-schedule-per-group UNIQUE constraint in `schedules` is never hit
 * from the UI.
 */
export default async function SchedulePage() {
  const context = await getCurrentUserAndTenant();
  if (!context) {
    redirect('/login?error=Faça login para continuar');
  }

  const { tenant } = context;

  const [schedules, groups]: [ScheduleView[], GroupView[]] =
    await Promise.all([
      listSchedules(tenant.id),
      listGroups(tenant.id, { monitoredOnly: true, pageSize: 100 }).then((r) => r.rows),
    ]);

  const hasMonitoredGroups = groups.length > 0;
  const activeCount = schedules.filter((s) => s.isActive).length;

  return (
    <div style={{ minHeight: '100vh' }}>
      <TopBar
        title="Agenda"
        subtitle={
          hasMonitoredGroups
            ? `${activeCount} ativa${activeCount === 1 ? '' : 's'} de ${schedules.length}`
            : 'Resumos automáticos por grupo'
        }
        accent="purple"
        breadcrumb="podZAP · Fase 11"
        actions={
          hasMonitoredGroups ? (
            <NewScheduleButton groups={groups} existing={schedules} />
          ) : null
        }
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
        {!hasMonitoredGroups && <NoMonitoredGroupsEmptyState />}

        {hasMonitoredGroups && schedules.length === 0 && (
          <NoSchedulesEmptyState />
        )}

        {hasMonitoredGroups && schedules.length > 0 && (
          <ScheduleList initial={schedules} groups={groups} />
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Empty states                                                               */
/* -------------------------------------------------------------------------- */

function NoMonitoredGroupsEmptyState() {
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
          🫥 nenhum grupo monitorado
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
          liga o monitoramento de algum grupo primeiro
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
          agendas só existem em cima de grupos monitorados. vai lá, liga um
          toggle, volta aqui e a gente agenda o resumo diário.
        </p>
        <Link href="/groups" className="btn btn-purple">
          ir pros grupos →
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
        📅
      </div>
    </div>
  );
}

function NoSchedulesEmptyState() {
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
          ⏰ nenhuma agenda ainda
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
          agenda um resumo automático
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
          escolhe um grupo, hora e frequência — a gente gera o podcast
          todo dia sem você levantar um dedo.
        </p>
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
        🗓️
      </div>
    </div>
  );
}
