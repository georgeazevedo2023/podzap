'use client';

// NOTE: `@/lib/groups/service` is authored in parallel by another Fase 3
// agent. We only import the `GroupView` type from it — once the module
// lands this file type-checks without changes.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { GroupView } from '@/lib/groups/service';

import { GroupCard } from './GroupCard';

/** ms of "stop typing" before the filter re-evaluates. Cheap debounce — we
 *  filter client-side so the only cost is React render work, but even that
 *  gets chatty on long lists. */
const SEARCH_DEBOUNCE_MS = 150;

export interface GroupsListProps {
  initial: GroupView[];
}

/**
 * Client-side orchestrator for the groups screen.
 *
 * State strategy:
 *   - `groups` starts from the server-rendered `initial` and only mutates
 *     via optimistic toggle updates. Server-side refreshes (after a "sync")
 *     happen through `router.refresh()` invoked by `SyncButton`, which
 *     re-runs the parent server component and therefore re-seeds
 *     `initial` on the next render.
 *   - Search is fully client-side (debounced 150ms). We keep the raw input
 *     value as controlled state so we can wire Esc-to-clear; the debounced
 *     copy feeds the filter.
 *   - Toggle monitor is optimistic: we flip the flag immediately, POST in
 *     the background, and revert + surface an error banner on failure.
 *     Per-group toggling state lives in a `Set<string>` so multiple
 *     toggles in flight don't clobber each other.
 *
 * Accessibility:
 *   - Search input has an `aria-label` + Esc clears it.
 *   - The "N monitorados" sticker sits inside a `role="status"
 *     aria-live="polite"` region so screen readers hear the updated count
 *     when a toggle lands.
 *   - Monitored-only pill is a button with `aria-pressed`.
 */
export function GroupsList({ initial }: GroupsListProps) {
  const [groups, setGroups] = useState<GroupView[]>(initial);
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [monitoredOnly, setMonitoredOnly] = useState(false);
  const [toggling, setToggling] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState<string | null>(null);

  // Keep `groups` in sync when the server re-renders this component with a
  // new `initial` prop (e.g. after `router.refresh()` post-sync). We only
  // replace when the identity of the array changes to avoid clobbering
  // in-flight optimistic toggles.
  const lastSeenInitialRef = useRef(initial);
  useEffect(() => {
    if (lastSeenInitialRef.current !== initial) {
      lastSeenInitialRef.current = initial;
      setGroups(initial);
    }
  }, [initial]);

  // Debounce the search input.
  useEffect(() => {
    const id = setTimeout(
      () => setDebouncedSearch(searchInput),
      SEARCH_DEBOUNCE_MS,
    );
    return () => clearTimeout(id);
  }, [searchInput]);

  const monitoredCount = useMemo(
    () => groups.filter((g) => g.isMonitored).length,
    [groups],
  );

  const filtered = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    return groups.filter((g) => {
      if (monitoredOnly && !g.isMonitored) return false;
      if (q && !g.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [groups, debouncedSearch, monitoredOnly]);

  const handleToggle = useCallback(
    async (groupId: string, nextOn: boolean) => {
      // Optimistic flip.
      setGroups((prev) =>
        prev.map((g) =>
          g.id === groupId ? { ...g, isMonitored: nextOn } : g,
        ),
      );
      setToggling((prev) => {
        const next = new Set(prev);
        next.add(groupId);
        return next;
      });
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
          throw new Error(
            `Falha ao ${nextOn ? 'ativar' : 'desativar'} monitoramento (${res.status})`,
          );
        }
        const data = (await res.json()) as { group: GroupView };
        // Reconcile with server-returned truth.
        setGroups((prev) =>
          prev.map((g) => (g.id === groupId ? data.group : g)),
        );
      } catch (err) {
        // Revert optimistic update.
        setGroups((prev) =>
          prev.map((g) =>
            g.id === groupId ? { ...g, isMonitored: !nextOn } : g,
          ),
        );
        setError(
          err instanceof Error
            ? err.message
            : 'Erro ao atualizar grupo',
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
        setDebouncedSearch('');
      }
    },
    [searchInput],
  );

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 20,
      }}
    >
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
                setDebouncedSearch('');
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
          onClick={() => setMonitoredOnly((v) => !v)}
          aria-pressed={monitoredOnly}
          aria-label="Mostrar apenas grupos monitorados"
          style={{
            padding: '10px 16px',
            borderRadius: 'var(--radius-pill)',
            border: '2.5px solid var(--stroke)',
            background: monitoredOnly
              ? 'var(--lime-500)'
              : 'var(--surface)',
            color: 'var(--ink-900)',
            fontFamily: 'var(--font-body)',
            fontSize: 13,
            fontWeight: 700,
            cursor: 'pointer',
            boxShadow: monitoredOnly
              ? 'var(--shadow-chunk)'
              : '2px 2px 0 var(--stroke)',
            whiteSpace: 'nowrap',
          }}
        >
          {monitoredOnly ? '✓ só monitorados' : 'só monitorados'}
        </button>

        <div
          role="status"
          aria-live="polite"
          aria-atomic="true"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
          }}
        >
          <span className="sticker sticker-purple">
            🎯 {monitoredCount} monitorados
          </span>
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

      {/* Grid */}
      {filtered.length > 0 ? (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns:
              'repeat(auto-fit, minmax(320px, 1fr))',
            gap: 16,
          }}
        >
          {filtered.map((group) => (
            <GroupCard
              key={group.id}
              group={group}
              isToggling={toggling.has(group.id)}
              onToggle={(on) => {
                void handleToggle(group.id, on);
              }}
            />
          ))}
        </div>
      ) : (
        <FilterEmptyState
          hasQuery={debouncedSearch.length > 0}
          monitoredOnly={monitoredOnly}
          onClear={() => {
            setSearchInput('');
            setDebouncedSearch('');
            setMonitoredOnly(false);
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
        <button
          type="button"
          onClick={onClear}
          className="btn btn-ghost"
        >
          limpar filtros
        </button>
      )}
    </div>
  );
}
