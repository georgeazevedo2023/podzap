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

  return (
    <div
      className="home-grid"
      style={{
        padding: '24px 36px 40px',
        display: 'grid',
        gap: 20,
        gridTemplateColumns: '1fr 320px',
        minHeight: '100%',
      }}
    >
      {/* Collapses sidebar column on narrow viewports. Inline style block
          keeps the rule scoped to this page (no globals.css edits). */}
      <style>
        {`@media (max-width: 900px) {
            .home-grid { grid-template-columns: 1fr !important; }
            .home-stats { grid-template-columns: repeat(2, 1fr) !important; }
            .home-episodes { grid-template-columns: repeat(2, 1fr) !important; }
          }`}
      </style>

      {/* LEFT */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <HeroPlayer
          episode={stats.currentEpisode}
          tenantName={tenant.name}
        />
        <div className="home-stats" style={{ display: 'contents' }}>
          <StatsRow stats={stats} />
        </div>
        <div className="home-episodes" style={{ display: 'contents' }}>
          <LastEpisodesGrid episodes={stats.latestEpisodes} />
        </div>
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
