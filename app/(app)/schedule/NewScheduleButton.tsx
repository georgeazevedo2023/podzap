'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';

import type { GroupView } from '@/lib/groups/service';
import type { ScheduleView } from '@/lib/schedules/service';

import { ScheduleForm } from './ScheduleForm';

export interface NewScheduleButtonProps {
  groups: GroupView[];
  existing: ScheduleView[];
}

/**
 * TopBar-mounted "+ nova agenda" CTA. Pops the `ScheduleForm` modal in
 * create mode. Owned by the server page so it can live outside the
 * `ScheduleList` tree (which only renders when there's already at least
 * one schedule). The form itself dedupes groups already scheduled so the
 * `schedules.group_id` UNIQUE constraint is never hit from the UI.
 *
 * We disable the button when every monitored group already has a
 * schedule — avoids the degenerate "open form, no groups to pick" state.
 */
export function NewScheduleButton({
  groups,
  existing,
}: NewScheduleButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const availableCount = groups.filter(
    (g) => !existing.some((s) => s.groupId === g.id),
  ).length;
  const allScheduled = availableCount === 0;

  const handleClose = useCallback(
    (saved: boolean) => {
      setOpen(false);
      if (saved) router.refresh();
    },
    [router],
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={allScheduled}
        className="btn btn-purple"
        aria-label="Criar nova agenda"
        title={
          allScheduled
            ? 'Todos os grupos monitorados já têm agenda'
            : 'Criar nova agenda'
        }
        style={{ opacity: allScheduled ? 0.5 : 1 }}
      >
        + nova agenda
      </button>

      {open && (
        <ScheduleForm
          mode="create"
          groups={groups}
          existing={existing}
          onClose={handleClose}
        />
      )}
    </>
  );
}

export default NewScheduleButton;
