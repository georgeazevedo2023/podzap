'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';

import type { GroupView } from '@/lib/groups/service';

import { GenerateNowModal } from '@/app/(app)/home/GenerateNowModal';

import { GroupCard } from './GroupCard';

/** ms of "stop typing" before we update the URL (which triggers a re-fetch). */
const SEARCH_DEBOUNCE_MS = 300;

export interface GroupsListProps {
  initial: GroupView[];
  total: number;
  page: number;           // 0-indexed, current page served by the server
  pageSize: number;
  initialSearch: string;
  initialMonitoredOnly: boolean;
}

/**
 * Groups list with **server-side pagination**. Page / search / filter state
 * lives in the URL (`?page=N&q=…&only=1`), so navigation + refresh + back
 * button all work naturally. Each interaction pushes a new URL and the
 * server component re-renders with the new slice.
 *
 * Optimistic toggle for monitor flag is still client-side: we flip the
 * row locally, POST, then reconcile. A subsequent page navigation will
 * re-seed from server truth anyway.
 */
export function GroupsList({
  initial,
  total,
  page,
  pageSize,
  initialSearch,
  initialMonitoredOnly,
}: GroupsListProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [groups, setGroups] = useState<GroupView[]>(initial);
  const [searchInput, setSearchInput] = useState(initialSearch);
  const [toggling, setToggling] = useState<Set<string>>(() => new Set());
  const [generateGroupId, setGenerateGroupId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Re-seed local state when the server re-renders with new data (new page,
  // new filter, after router.refresh()). The identity change is the signal.
  const lastSeenInitialRef = useRef(initial);
  useEffect(() => {
    if (lastSeenInitialRef.current !== initial) {
      lastSeenInitialRef.current = initial;
      setGroups(initial);
    }
  }, [initial]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : page * pageSize + 1;
  const to = Math.min((page + 1) * pageSize, total);

  // Build a new URL preserving existing params, overriding the ones passed.
  const buildHref = useCallback(
    (patch: { page?: number; q?: string; only?: boolean }): string => {
      const sp = new URLSearchParams(searchParams?.toString() ?? '');
      if (patch.page !== undefined) {
        if (patch.page <= 0) sp.delete('page');
        else sp.set('page', String(patch.page));
      }
      if (patch.q !== undefined) {
        if (!patch.q) sp.delete('q');
        else sp.set('q', patch.q);
        // Reset page when search changes.
        sp.delete('page');
      }
      if (patch.only !== undefined) {
        if (!patch.only) sp.delete('only');
        else sp.set('only', '1');
        sp.delete('page');
      }
      const qs = sp.toString();
      return qs ? `${pathname}?${qs}` : pathname;
    },
    [pathname, searchParams],
  );

  // Debounce search → URL push.
  useEffect(() => {
    if (searchInput === initialSearch) return;
    const id = setTimeout(() => {
      router.push(buildHref({ q: searchInput }));
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [searchInput, initialSearch, buildHref, router]);

  const handleToggle = useCallback(
    async (groupId: string, nextOn: boolean) => {
      setGroups((prev) =>
        prev.map((g) => (g.id === groupId ? { ...g, isMonitored: nextOn } : g)),
      );
      setToggling((prev) => new Set(prev).add(groupId));
      setError(null);
      try {
        const res = await fetch(
          `/api/groups/${encodeURIComponent(groupId)}/monitor`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ on: nextOn }),
            cache: 'no-store',
          },
        );
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as
            | { error?: { message?: string } }
            | null;
          throw new Error(
            body?.error?.message ??
              `Falha ao ${nextOn ? 'ativar' : 'desativar'} monitoramento (${res.status})`,
          );
        }
        const data = (await res.json()) as { group: GroupView };
        setGroups((prev) =>
          prev.map((g) => (g.id === groupId ? data.group : g)),
        );
      } catch (err) {
        setGroups((prev) =>
          prev.map((g) =>
            g.id === groupId ? { ...g, isMonitored: !nextOn } : g,
          ),
        );
        setError(
          err instanceof Error ? err.message : 'Erro ao atualizar grupo',
        );
      } finally {
        setToggling((prev) => {
          const next = new Set(prev);
          next.delete(groupId);
          return next;
        });
      }
    },
    [],
  );

  const handleSearchKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Escape' && searchInput.length > 0) {
        setSearchInput('');
        router.push(buildHref({ q: '' }));
      }
    },
    [searchInput, buildHref, router],
  );

  const monitoredBadge = useMemo(
    () => (
      <span className="sticker sticker-purple">
        🎯 {initialMonitoredOnly ? 'só monitorados' : `${total} nesta página`}
      </span>
    ),
    [total, initialMonitoredOnly],
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Toolbar */}
      <div
        style={{
          display: 'flex',
          gap: 12,
          alignItems: 'center',
          flexWrap: 'wrap',
        }}
      >
        <label
          style={{
            flex: 1,
            minWidth: 240,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '12px 16px',
            background: 'var(--surface)',
            border: '2.5px solid var(--stroke)',
            borderRadius: 'var(--radius-pill)',
            boxShadow: 'var(--shadow-chunk)',
          }}
        >
          <span aria-hidden style={{ fontSize: 18 }}>
            🔎
          </span>
          <input
            type="search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            placeholder="busca um grupo aí..."
            aria-label="Buscar grupos pelo nome"
            style={{
              flex: 1,
              border: 'none',
              background: 'transparent',
              outline: 'none',
              fontFamily: 'var(--font-body)',
              fontSize: 14,
              fontWeight: 500,
              color: 'var(--text)',
            }}
          />
          {searchInput && (
            <button
              type="button"
              onClick={() => {
                setSearchInput('');
                router.push(buildHref({ q: '' }));
              }}
              aria-label="Limpar busca"
              style={{
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                fontSize: 14,
                fontWeight: 700,
                color: 'var(--text-dim)',
                padding: 2,
              }}
            >
              ✕
            </button>
          )}
        </label>

        <button
          type="button"
          onClick={() => router.push(buildHref({ only: !initialMonitoredOnly }))}
          aria-pressed={initialMonitoredOnly}
          aria-label="Mostrar apenas grupos monitorados"
          style={{
            padding: '10px 16px',
            borderRadius: 'var(--radius-pill)',
            border: '2.5px solid var(--stroke)',
            background: initialMonitoredOnly
              ? 'var(--lime-500)'
              : 'var(--surface)',
            color: 'var(--ink-900)',
            fontFamily: 'var(--font-body)',
            fontSize: 13,
            fontWeight: 700,
            cursor: 'pointer',
            boxShadow: initialMonitoredOnly
              ? 'var(--shadow-chunk)'
              : '2px 2px 0 var(--stroke)',
            whiteSpace: 'nowrap',
          }}
        >
          {initialMonitoredOnly ? '✓ só monitorados' : 'só monitorados'}
        </button>

        <div role="status" aria-live="polite" aria-atomic="true">
          {monitoredBadge}
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div
          role="alert"
          style={{
            padding: 14,
            border: '2.5px solid var(--red-500)',
            borderRadius: 'var(--radius-md)',
            background: 'rgba(255, 77, 60, 0.08)',
            color: 'var(--red-500)',
            fontSize: 13,
            fontWeight: 600,
            display: 'flex',
            gap: 10,
            alignItems: 'center',
          }}
        >
          <span aria-hidden>⚠</span>
          <span style={{ flex: 1 }}>{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            aria-label="Dispensar erro"
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--red-500)',
              fontWeight: 800,
              fontSize: 14,
            }}
          >
            ✕
          </button>
        </div>
      )}

      {/* Grid + pagination */}
      {groups.length > 0 ? (
        <>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
              gap: 16,
            }}
          >
            {groups.map((group) => (
              <GroupCard
                key={group.id}
                group={group}
                isToggling={toggling.has(group.id)}
                onToggle={(on) => {
                  void handleToggle(group.id, on);
                }}
                onGenerate={(id) => setGenerateGroupId(id)}
              />
            ))}
          </div>

          {generateGroupId && (
            <GenerateNowModal
              open={true}
              onClose={() => setGenerateGroupId(null)}
              initialGroupId={generateGroupId}
            />
          )}

          {totalPages > 1 && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                padding: '14px 20px',
                background: 'var(--surface)',
                border: '2.5px solid var(--stroke)',
                borderRadius: 'var(--radius-lg)',
                boxShadow: 'var(--shadow-chunk)',
                flexWrap: 'wrap',
              }}
            >
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: 'var(--text-dim)',
                }}
              >
                <span style={{ color: 'var(--text)', fontWeight: 800 }}>
                  {from}–{to}
                </span>{' '}
                de{' '}
                <span style={{ color: 'var(--text)', fontWeight: 800 }}>
                  {total}
                </span>
                {' · '}
                página{' '}
                <span style={{ color: 'var(--text)', fontWeight: 800 }}>
                  {page + 1}
                </span>
                {' / '}
                {totalPages}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={page <= 0}
                  onClick={() =>
                    router.push(buildHref({ page: Math.max(0, page - 1) }))
                  }
                  aria-label="Página anterior"
                  style={{
                    opacity: page > 0 ? 1 : 0.4,
                    cursor: page > 0 ? 'pointer' : 'not-allowed',
                    padding: '8px 14px',
                  }}
                >
                  ← anterior
                </button>
                <button
                  type="button"
                  className="btn btn-purple"
                  disabled={page >= totalPages - 1}
                  onClick={() =>
                    router.push(
                      buildHref({ page: Math.min(totalPages - 1, page + 1) }),
                    )
                  }
                  aria-label="Próxima página"
                  style={{
                    opacity: page < totalPages - 1 ? 1 : 0.4,
                    cursor:
                      page < totalPages - 1 ? 'pointer' : 'not-allowed',
                    padding: '8px 14px',
                  }}
                >
                  próxima →
                </button>
              </div>
            </div>
          )}
        </>
      ) : (
        <FilterEmptyState
          hasQuery={initialSearch.length > 0}
          monitoredOnly={initialMonitoredOnly}
          onClear={() => {
            setSearchInput('');
            router.push(pathname);
          }}
        />
      )}
    </div>
  );
}

export default GroupsList;

/* -------------------------------------------------------------------------- */
/* Local components                                                           */
/* -------------------------------------------------------------------------- */

interface FilterEmptyStateProps {
  hasQuery: boolean;
  monitoredOnly: boolean;
  onClear: () => void;
}

function FilterEmptyState({
  hasQuery,
  monitoredOnly,
  onClear,
}: FilterEmptyStateProps) {
  const message =
    hasQuery && monitoredOnly
      ? 'nenhum grupo monitorado bate com essa busca'
      : hasQuery
        ? 'nenhum grupo bate com essa busca'
        : 'nenhum grupo monitorado ainda — liga o toggle em algum pra começar';
  return (
    <div
      className="card"
      style={{
        padding: 28,
        display: 'flex',
        gap: 16,
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
      }}
    >
      <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
        <span aria-hidden style={{ fontSize: 36 }}>
          🫥
        </span>
        <div>
          <div
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 18,
              fontWeight: 800,
              letterSpacing: '-0.02em',
            }}
          >
            nada por aqui
          </div>
          <div
            style={{
              fontSize: 13,
              color: 'var(--text-dim)',
              marginTop: 2,
            }}
          >
            {message}
          </div>
        </div>
      </div>
      {(hasQuery || monitoredOnly) && (
        <button type="button" onClick={onClear} className="btn btn-ghost">
          limpar filtros
        </button>
      )}
    </div>
  );
}
