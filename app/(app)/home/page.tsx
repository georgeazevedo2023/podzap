import { redirect } from 'next/navigation';

import { getCurrentUserAndTenant } from '@/lib/tenant';
import { getHomeStats } from '@/lib/stats/service';

import { ApprovalQueueCard } from './ApprovalQueueCard';
import { GenerateQuickCard } from './GenerateQuickCard';
import { HeroPlayer } from './HeroPlayer';
import { LastEpisodesGrid } from './LastEpisodesGrid';
import { StatsRow } from './StatsRow';
import { TipCard } from './TipCard';

/**
 * Dashboard landing — ported 1:1 from `podZAP/screen_home.jsx`.
 *
 * Layout:
 *   - Left column: hero player, 4-up stats row, 4-up "últimos eps" grid.
 *   - Right column: "bora" quick-action, approval queue, "sacada" tip.
 *
 * Data comes from `getHomeStats(tenantId)` which batches five tenant-
 * scoped queries (summaries this week, minutes listened, active groups,
 * approval rate, latest episodes + current episode with signed URL).
 *
 * Empty states: when `stats.currentEpisode === null` the hero swaps to
 * a "primeiro passo" variant with a CTA to `/onboarding`, and the
 * episodes grid renders 4 `PodCover` stubs without photos. Both states
 * stay inside the purple-heavy chunky-border aesthetic — we don't fall
 * back to a generic "zero data" card.
 *
 * Mobile: an inline `<style>` block collapses the 1fr/320px layout to a
 * single column below 900px (sidebar content stacks under the left
 * column).
 */
export default async function HomePage() {
  const context = await getCurrentUserAndTenant();
  if (!context) {
    redirect('/login?error=Faça login para continuar');
  }

  const { tenant } = context;
  const stats = await getHomeStats(tenant.id);

  // Layout responsivo: a classe `.home-grid` define mobile-first grid em
  // globals.css (1-col abaixo de md, 1fr/320px em md+). `.home-stats` e
  // `.home-episodes` aplicam-se aos contentores reais (2-up em mobile,
  // 4-up em desktop). A versão anterior usava `display: contents` num
  // wrapper + inline `<style>` — a regra de media query não tinha efeito
  // porque o wrapper não formava box.
  return (
    <div
      className="home-grid"
      style={{
        padding: '24px clamp(16px, 4vw, 36px) 40px',
        display: 'grid',
        gap: 20,
        minHeight: '100%',
      }}
    >
      {/* LEFT */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <HeroPlayer
          episode={stats.currentEpisode}
          tenantName={tenant.name}
          whatsappConnected={stats.whatsappConnected}
          monitoredGroupsCount={stats.monitoredGroupsCount}
          capturedMessagesCount={stats.capturedMessagesCount}
          pendingApprovalsCount={stats.pendingApprovalsCount}
        />
        <StatsRow stats={stats} />
        <LastEpisodesGrid episodes={stats.latestEpisodes} />
      </div>

      {/* RIGHT */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <GenerateQuickCard />
        <ApprovalQueueCard
          tenantId={tenant.id}
          pendingCount={stats.pendingApprovalsCount}
        />
        <TipCard />
      </div>
    </div>
  );
}
