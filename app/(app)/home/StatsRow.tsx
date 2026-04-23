import { StatCard } from '@/components/ui/StatCard';

/**
 * 4-up stat row rendered under the hero. Pure server component —
 * numbers come from `HomeStats` (see `lib/stats/service.ts`).
 *
 * Formatters are deliberately simple: when there is literally no
 * activity (zero summaries + zero rate) we replace `0%` with an em-
 * dash so the card reads "ainda sem dado" instead of suggesting a
 * real failure rate.
 */
export type StatsRowProps = {
  stats: {
    summariesThisWeek: number;
    minutesListened: number;
    activeGroupsCount: number;
    approvalRate: number;
  };
};

export function fmtMinutes(n: number): string {
  const total = Math.max(0, Math.floor(n));
  if (total >= 60) {
    const h = Math.floor(total / 60);
    const m = total % 60;
    return `${h}h ${m}m`;
  }
  return `${total}m`;
}

export function fmtPercent(rate: number, summariesThisWeek: number): string {
  if (rate === 0 && summariesThisWeek === 0) return '—';
  return `${Math.round(rate * 100)}%`;
}

export function StatsRow({ stats }: StatsRowProps): React.ReactElement {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: 12,
      }}
    >
      <StatCard
        label="resumos na semana"
        value={String(stats.summariesThisWeek)}
        accent="lime"
        icon="🎙"
      />
      <StatCard
        label="minutos ouvidos"
        value={fmtMinutes(stats.minutesListened)}
        accent="pink"
        icon="👂"
      />
      <StatCard
        label="grupos ativos"
        value={String(stats.activeGroupsCount)}
        accent="yellow"
        icon="💬"
      />
      <StatCard
        label="taxa aprovação"
        value={fmtPercent(stats.approvalRate, stats.summariesThisWeek)}
        accent="purple"
        icon="✅"
      />
    </div>
  );
}

export default StatsRow;
