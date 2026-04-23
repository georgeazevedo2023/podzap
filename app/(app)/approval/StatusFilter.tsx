'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

/**
 * Approval list filter — Fase 8.
 *
 * Client-side pill selector for the approval page's status facet. Clicking a
 * pill pushes `?status=<value>` to the server-rendered page which re-queries
 * `listSummaries` with the matching filter. `all` omits the status query
 * entirely (service falls back to "no status filter").
 *
 * Kept deliberately tiny — no local state, no URL parsing — because the
 * server page is the single source of truth for which tab is active and
 * passes it back in via `current`. That also means browser back/forward
 * "just works" without extra sync code.
 */
export type ApprovalStatusFilter =
  | 'pending_review'
  | 'approved'
  | 'rejected'
  | 'all';

export interface StatusFilterProps {
  current: ApprovalStatusFilter;
}

interface Option {
  value: ApprovalStatusFilter;
  label: string;
  /** Emoji prefix — separate so we can keep it decorative-only. */
  emoji: string;
  /** CSS background (design-token var) for the active pill. */
  activeBg: string;
  /** Text color when active. */
  activeFg: string;
}

const OPTIONS: readonly Option[] = [
  {
    value: 'pending_review',
    label: 'pendentes',
    emoji: '⏳',
    activeBg: 'var(--yellow-500)',
    activeFg: 'var(--ink-900)',
  },
  {
    value: 'approved',
    label: 'aprovados',
    emoji: '✅',
    activeBg: 'var(--zap-500)',
    activeFg: '#fff',
  },
  {
    value: 'rejected',
    label: 'rejeitados',
    emoji: '❌',
    activeBg: 'var(--pink-500)',
    activeFg: '#fff',
  },
  {
    value: 'all',
    label: 'todos',
    emoji: '🗂',
    activeBg: 'var(--purple-600)',
    activeFg: '#fff',
  },
];

export function StatusFilter({ current }: StatusFilterProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const handleSelect = (value: ApprovalStatusFilter): void => {
    if (value === current) return;
    const qs = value === 'all' ? '' : `?status=${value}`;
    startTransition(() => {
      router.push(`/approval${qs}`);
    });
  };

  return (
    <div
      role="tablist"
      aria-label="Filtro por status"
      style={{
        display: 'flex',
        gap: 8,
        flexWrap: 'wrap',
        alignItems: 'center',
        opacity: isPending ? 0.7 : 1,
        transition: 'opacity 0.12s',
      }}
    >
      {OPTIONS.map((opt) => {
        const active = opt.value === current;
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => handleSelect(opt.value)}
            style={{
              padding: '8px 14px',
              background: active ? opt.activeBg : 'var(--surface)',
              color: active ? opt.activeFg : 'var(--text)',
              border: '2.5px solid var(--stroke)',
              borderRadius: 999,
              fontFamily: 'var(--font-body)',
              fontWeight: 700,
              fontSize: 12,
              letterSpacing: '0.02em',
              cursor: 'pointer',
              boxShadow: active ? '3px 3px 0 var(--stroke)' : 'none',
              transition:
                'transform 0.08s ease, box-shadow 0.08s ease, background 0.12s',
              whiteSpace: 'nowrap',
            }}
          >
            <span aria-hidden style={{ marginRight: 6 }}>
              {opt.emoji}
            </span>
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

export default StatusFilter;
