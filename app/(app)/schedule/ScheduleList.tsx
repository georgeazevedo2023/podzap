'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

import type { GroupView } from '@/lib/groups/service';
import type { ScheduleView } from '@/lib/schedules/service';

import { ScheduleCard } from './ScheduleCard';
import { ScheduleForm } from './ScheduleForm';

export interface ScheduleListProps {
  initial: ScheduleView[];
  groups: GroupView[];
}

/**
 * Client-side orchestrator for the schedule screen.
 *
 * State strategy mirrors `GroupsList`:
 *
 *   - `schedules` starts from the server-rendered `initial` prop and is
 *     kept in sync when the parent server component re-renders (after
 *     `router.refresh()` triggered by create/edit/delete). We compare
 *     `initial` identity in a ref so we don't clobber in-flight
 *     optimistic mutations.
 *   - "Active" toggles are optimistic: flip immediately, PATCH in the
 *     background, revert + surface an error banner on failure.
 *   - Delete is optimistic too — we snapshot the row so we can restore it
 *     if the DELETE fails.
 *   - Edit opens the `ScheduleForm` modal, prefilled. Submit → PATCH →
 *     `router.refresh()`.
 *
 * A per-id `Set<string>` tracks pending mutations so the card can render a
 * disabled / "wait" state without multiple mutations on the same row
 * clobbering each other's UI.
 */
export function ScheduleList({ initial, groups }: ScheduleListProps) {
  const router = useRouter();
  const [schedules, setSchedules] = useState<ScheduleView[]>(initial);
  const [mutating, setMutating] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<ScheduleView | null>(null);

  // Keep state in sync when `initial` identity changes (server refreshed).
  const lastSeenInitialRef = useRef(initial);
  useEffect(() => {
    if (lastSeenInitialRef.current !== initial) {
      lastSeenInitialRef.current = initial;
      setSchedules(initial);
    }
  }, [initial]);

  const markMutating = useCallback((id: string, on: boolean) => {
    setMutating((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const handleToggleActive = useCallback(
    async (schedule: ScheduleView, nextActive: boolean) => {
      // Optimistic flip.
      setSchedules((prev) =>
        prev.map((s) =>
          s.id === schedule.id ? { ...s, isActive: nextActive } : s,
        ),
      );
      markMutating(schedule.id, true);
      setError(null);

      try {
        const res = await fetch(
          `/api/schedules/${encodeURIComponent(schedule.id)}`,
          {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ isActive: nextActive }),
            cache: 'no-store',
          },
        );
        if (!res.ok) {
          throw new Error(
            `Falha ao ${nextActive ? 'ativar' : 'pausar'} agenda (${res.status})`,
          );
        }
        const data = (await res.json()) as { schedule: ScheduleView };
        setSchedules((prev) =>
          prev.map((s) => (s.id === schedule.id ? data.schedule : s)),
        );
      } catch (err) {
        // Revert.
        setSchedules((prev) =>
          prev.map((s) =>
            s.id === schedule.id ? { ...s, isActive: !nextActive } : s,
          ),
        );
        setError(
          err instanceof Error ? err.message : 'Erro ao atualizar agenda',
        );
      } finally {
        markMutating(schedule.id, false);
      }
    },
    [markMutating],
  );

  const handleDelete = useCallback(
    async (schedule: ScheduleView) => {
      if (
        !window.confirm(
          'Deletar essa agenda? O grupo deixa de receber resumos automáticos.',
        )
      ) {
        return;
      }
      const snapshot = schedule;
      // Optimistic remove.
      setSchedules((prev) => prev.filter((s) => s.id !== schedule.id));
      markMutating(schedule.id, true);
      setError(null);

      try {
        const res = await fetch(
          `/api/schedules/${encodeURIComponent(schedule.id)}`,
          {
            method: 'DELETE',
            cache: 'no-store',
          },
        );
        if (!res.ok && res.status !== 204) {
          throw new Error(`Falha ao deletar agenda (${res.status})`);
        }
        // Refresh server page so `initial` rehydrates from the DB.
        router.refresh();
      } catch (err) {
        // Revert.
        setSchedules((prev) => [snapshot, ...prev]);
        setError(
          err instanceof Error ? err.message : 'Erro ao deletar agenda',
        );
      } finally {
        markMutating(schedule.id, false);
      }
    },
    [markMutating, router],
  );

  const handleEdit = useCallback((schedule: ScheduleView) => {
    setEditing(schedule);
  }, []);

  const handleEditClose = useCallback(
    (saved: boolean) => {
      setEditing(null);
      if (saved) router.refresh();
    },
    [router],
  );

  // For the edit form, we hand it the group currently attached (even if
  // it's outside the monitoredOnly list, since you can't re-pick a group
  // while editing — the group picker is disabled in edit mode).
  const editingGroups = editing
    ? mergeGroupForEdit(groups, schedules, editing)
    : groups;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
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

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
          gap: 16,
        }}
      >
        {schedules.map((schedule) => {
          const group = groups.find((g) => g.id === schedule.groupId);
          return (
            <ScheduleCard
              key={schedule.id}
              schedule={schedule}
              group={group ?? null}
              isMutating={mutating.has(schedule.id)}
              onToggleActive={(on) => {
                void handleToggleActive(schedule, on);
              }}
              onEdit={() => handleEdit(schedule)}
              onDelete={() => {
                void handleDelete(schedule);
              }}
            />
          );
        })}
      </div>

      {editing && (
        <ScheduleForm
          mode="edit"
          schedule={editing}
          groups={editingGroups}
          existing={schedules}
          onClose={handleEditClose}
        />
      )}
    </div>
  );
}

export default ScheduleList;

/**
 * When editing, the attached group might no longer be monitored (user could
 * have toggled it off). We still want the form to display the name, so we
 * ensure the group is present in the list handed to the form.
 */
function mergeGroupForEdit(
  monitored: GroupView[],
  all: ScheduleView[],
  editing: ScheduleView,
): GroupView[] {
  const found = monitored.find((g) => g.id === editing.groupId);
  if (found) return monitored;
  // Synthesize a placeholder group so the form can render the name row;
  // in edit mode the group picker is disabled anyway.
  void all;
  const placeholder: GroupView = {
    id: editing.groupId,
    tenantId: editing.tenantId,
    instanceId: '',
    uazapiGroupJid: '',
    name: '(grupo desmonitorado)',
    pictureUrl: null,
    isMonitored: false,
    memberCount: null,
    lastSyncedAt: null,
    createdAt: editing.createdAt,
  };
  return [...monitored, placeholder];
}
