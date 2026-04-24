'use client';

import { useMemo, useState, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';

import { Icons } from '@/components/icons/Icons';
import { Select } from '@/components/ui/Select';

import { GenerateNowModal } from '../home/GenerateNowModal';

export interface HistoryFilterBarProps {
  /** Monitored groups for this tenant (already sorted by the server). */
  groups: { id: string; name: string }[];
  /** Currently selected group id (from `?group=` in the URL), or `""` for all. */
  selectedGroupId: string;
  /** Total rows shown after filtering — matches `MessagesList`'s count badge. */
  totalCount: number;
}

/**
 * Control strip above the history feed: group filter + "gerar resumo agora".
 *
 * Filter state is persisted in the URL as `?group=<uuid>` so it survives page
 * refresh / deep-linking. Changing the select does a `router.push` — the
 * server component re-runs, re-queries `messages`, and the feed swaps in.
 *
 * The generate-now button reuses the existing `/home` modal with the current
 * filter's group pre-selected (if any). When no filter is active the modal
 * falls back to its default behaviour (first monitored group).
 */
export function HistoryFilterBar({
  groups,
  selectedGroupId,
  totalCount,
}: HistoryFilterBarProps) {
  const router = useRouter();
  const [modalOpen, setModalOpen] = useState(false);

  const options = useMemo(
    () => [
      { value: '', label: 'todos os grupos' },
      ...groups.map((g) => ({ value: g.id, label: g.name })),
    ],
    [groups],
  );

  const handleChange = (next: string) => {
    // Reset pagination when changing filter — otherwise a user on page 3 of
    // group A landing on page 3 of group B would see an empty feed and
    // disabled "next" even though group B has only 1 page.
    const url = next ? `/history?group=${encodeURIComponent(next)}` : '/history';
    router.push(url);
  };

  const wrapperStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'flex-end',
    gap: 12,
    flexWrap: 'wrap',
    padding: 14,
    border: '2.5px solid var(--stroke)',
    borderRadius: 'var(--r-md)',
    background: 'var(--bg-1)',
    boxShadow: '2px 2px 0 var(--stroke)',
  };

  const filterColStyle: CSSProperties = {
    flex: '1 1 260px',
    minWidth: 220,
  };

  const countStyle: CSSProperties = {
    fontSize: 11,
    fontFamily: 'var(--font-mono)',
    color: 'var(--text-dim)',
    fontWeight: 700,
    alignSelf: 'center',
    whiteSpace: 'nowrap',
  };

  return (
    <>
      <div style={wrapperStyle}>
        <div style={filterColStyle}>
          <Select
            label="filtrar por grupo"
            id="history-group-filter"
            value={selectedGroupId}
            onChange={handleChange}
            options={options}
          />
        </div>
        <span style={countStyle}>
          {totalCount} msg{totalCount === 1 ? '' : 's'}
        </span>
        <button
          type="button"
          className="btn btn-purple"
          onClick={() => setModalOpen(true)}
          disabled={groups.length === 0}
          style={{
            border: '2.5px solid var(--stroke)',
            cursor: groups.length === 0 ? 'not-allowed' : 'pointer',
            opacity: groups.length === 0 ? 0.5 : 1,
            whiteSpace: 'nowrap',
          }}
          aria-label="gerar resumo agora com o grupo filtrado"
        >
          <Icons.Sparkle /> gerar resumo agora
        </button>
      </div>

      <GenerateNowModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        initialGroupId={selectedGroupId || undefined}
      />
    </>
  );
}

export default HistoryFilterBar;
