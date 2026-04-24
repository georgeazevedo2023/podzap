'use client';

import { useRouter } from 'next/navigation';
import type { CSSProperties } from 'react';

export interface HistoryPaginationProps {
  /** 1-indexed current page. */
  page: number;
  /** Total count across all pages (AFTER filters). */
  total: number;
  /** Page size used to compute `pageCount`. */
  pageSize: number;
  /** Optional group id filter — preserved when changing pages. */
  groupId: string | null;
}

/**
 * Paginação numerada no padrão clássico "anterior · 1 · 2 · 3 … · próxima".
 *
 * Estado vive na URL (`?page=N`, `?group=X`) — refresh / back-forward OK.
 *
 * Regras de exibição do range:
 *   - Até 7 páginas: mostra todas.
 *   - Mais de 7: mostra primeira, última, atual ±1 e preenche com ellipses.
 *
 * Não renderiza nada quando há só uma página.
 */
export function HistoryPagination({
  page,
  total,
  pageSize,
  groupId,
}: HistoryPaginationProps) {
  const router = useRouter();
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  if (pageCount <= 1) return null;

  const hasPrev = page > 1;
  const hasNext = page < pageCount;

  const buildHref = (next: number): string => {
    const params = new URLSearchParams();
    if (groupId) params.set('group', groupId);
    if (next > 1) params.set('page', String(next));
    const qs = params.toString();
    return qs ? `/history?${qs}` : '/history';
  };

  const go = (next: number) => {
    if (next < 1 || next > pageCount || next === page) return;
    router.push(buildHref(next));
  };

  const pages = buildPageRange(page, pageCount);

  // ── Styles ──────────────────────────────────────────────────────────────
  const wrapperStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    padding: '16px 12px',
    flexWrap: 'wrap',
  };

  const baseBtnStyle: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 38,
    height: 38,
    padding: '0 12px',
    borderRadius: 10,
    border: '2px solid var(--stroke)',
    fontFamily: 'var(--font-body)',
    fontWeight: 700,
    fontSize: 13,
    cursor: 'pointer',
    transition: 'transform 0.08s ease, background-color 0.12s ease',
    userSelect: 'none',
  };

  const navBtnStyle = (enabled: boolean): CSSProperties => ({
    ...baseBtnStyle,
    background: enabled ? '#5B2BE8' : 'var(--bg-2)',
    color: enabled ? '#fff' : 'var(--text-dim)',
    cursor: enabled ? 'pointer' : 'not-allowed',
    opacity: enabled ? 1 : 0.6,
    padding: '0 14px',
    gap: 6,
  });

  const numberBtnStyle = (isCurrent: boolean): CSSProperties => ({
    ...baseBtnStyle,
    background: isCurrent ? '#5B2BE8' : 'transparent',
    color: isCurrent ? '#fff' : 'var(--text)',
    borderColor: isCurrent ? '#5B2BE8' : 'var(--stroke)',
    fontFamily: 'var(--font-mono)',
    cursor: isCurrent ? 'default' : 'pointer',
  });

  const ellipsisStyle: CSSProperties = {
    ...baseBtnStyle,
    background: 'transparent',
    border: 'none',
    color: 'var(--text-dim)',
    cursor: 'default',
    minWidth: 24,
    padding: 0,
  };

  return (
    <nav style={wrapperStyle} aria-label="paginação do histórico">
      <button
        type="button"
        onClick={() => go(page - 1)}
        disabled={!hasPrev}
        aria-label="página anterior"
        style={navBtnStyle(hasPrev)}
      >
        ← anterior
      </button>

      {pages.map((p, idx) =>
        p === 'ellipsis' ? (
          <span
            key={`ellipsis-${idx}`}
            aria-hidden
            style={ellipsisStyle}
          >
            ···
          </span>
        ) : (
          <button
            key={p}
            type="button"
            onClick={() => go(p)}
            aria-label={`ir para página ${p}`}
            aria-current={p === page ? 'page' : undefined}
            style={numberBtnStyle(p === page)}
          >
            {p}
          </button>
        ),
      )}

      <button
        type="button"
        onClick={() => go(page + 1)}
        disabled={!hasNext}
        aria-label="próxima página"
        style={navBtnStyle(hasNext)}
      >
        próxima →
      </button>
    </nav>
  );
}

/**
 * Build the rendered page range with ellipses.
 *
 * Returns a mix of numbers (clickable) and the literal `'ellipsis'` sentinel
 * (decorative). Guarantees: always includes page 1, current page, and
 * `pageCount`; fills with current ±1 and ellipses where there are gaps.
 *
 *  - 7 pages or fewer: [1, 2, 3, 4, 5, 6, 7]
 *  - current 1 / 12:  [1, 2, 3, …, 12]
 *  - current 6 / 12:  [1, …, 5, 6, 7, …, 12]
 *  - current 12 / 12: [1, …, 10, 11, 12]
 */
function buildPageRange(
  current: number,
  pageCount: number,
): Array<number | 'ellipsis'> {
  if (pageCount <= 7) {
    return Array.from({ length: pageCount }, (_, i) => i + 1);
  }

  const out: Array<number | 'ellipsis'> = [1];
  const left = Math.max(2, current - 1);
  const right = Math.min(pageCount - 1, current + 1);

  if (left > 2) out.push('ellipsis');
  for (let p = left; p <= right; p++) out.push(p);
  if (right < pageCount - 1) out.push('ellipsis');

  out.push(pageCount);
  return out;
}

export default HistoryPagination;
