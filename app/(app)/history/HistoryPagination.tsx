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
 * Paginação stateless sobre `/history`. Estado vive na URL (?page=N, ?group=X)
 * para que refresh / back-forward continuem funcionando.
 *
 * Não renderiza nada quando há só uma página — evita clutter visual quando o
 * tenant ainda tem poucas mensagens. Os botões prev/next ficam desabilitados
 * nas extremidades; clicar em "página N de M" não faz nada (puro display).
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
    if (next < 1 || next > pageCount) return;
    router.push(buildHref(next));
  };

  const wrapperStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    padding: '14px 16px',
    border: '2.5px solid var(--stroke)',
    borderRadius: 'var(--r-md)',
    background: 'var(--bg-1)',
    boxShadow: '2px 2px 0 var(--stroke)',
    flexWrap: 'wrap',
  };

  const labelStyle: CSSProperties = {
    fontFamily: 'var(--font-mono)',
    fontSize: 12,
    fontWeight: 700,
    color: 'var(--text-dim)',
    whiteSpace: 'nowrap',
  };

  const btnStyle = (enabled: boolean): CSSProperties => ({
    border: '2.5px solid var(--stroke)',
    opacity: enabled ? 1 : 0.45,
    cursor: enabled ? 'pointer' : 'not-allowed',
  });

  return (
    <nav
      style={wrapperStyle}
      aria-label="paginação do histórico de mensagens"
    >
      <button
        type="button"
        className="btn btn-ghost"
        onClick={() => go(page - 1)}
        disabled={!hasPrev}
        aria-label="página anterior"
        style={btnStyle(hasPrev)}
      >
        ← anterior
      </button>

      <span style={labelStyle}>
        página {page} de {pageCount} · {total} msg{total === 1 ? '' : 's'}
      </span>

      <button
        type="button"
        className="btn btn-ghost"
        onClick={() => go(page + 1)}
        disabled={!hasNext}
        aria-label="próxima página"
        style={btnStyle(hasNext)}
      >
        próxima →
      </button>
    </nav>
  );
}

export default HistoryPagination;
