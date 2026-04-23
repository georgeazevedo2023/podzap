'use client';

// NOTE: imports only the `GroupView` type from the service module, which is
// authored in parallel by another Fase 3 agent.

import type { GroupView } from '@/lib/groups/service';

export interface GroupCardProps {
  group: GroupView;
  onToggle: (on: boolean) => void;
  isToggling: boolean;
}

/**
 * Chunky neo-brutalist card for a single WhatsApp group, with a custom
 * toggle for the "monitor" flag.
 *
 * The toggle is a real `<button>` with `aria-pressed`, **not** a native
 * checkbox — the visual is a hand-built animated dot, and using a button
 * lets us control focus/keyboard behaviour cleanly. Enter/Space on the
 * button (or anywhere else on the card) flips it. The whole card is
 * clickable as a hit target, but we guard against double-fire when the
 * user clicks directly on the toggle button.
 */
export function GroupCard({ group, onToggle, isToggling }: GroupCardProps) {
  const on = group.isMonitored;

  const handleCardClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (isToggling) return;
    // Ignore bubbled clicks from the inner <button> — it handles its own.
    if ((event.target as HTMLElement).closest('[data-toggle-btn]')) return;
    onToggle(!on);
  };

  const handleCardKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (isToggling) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onToggle(!on);
    }
  };

  return (
    <div
      role="group"
      aria-label={`Grupo ${group.name}`}
      onClick={handleCardClick}
      onKeyDown={handleCardKeyDown}
      tabIndex={0}
      style={{
        background: on ? 'var(--surface)' : 'var(--bg-2)',
        border: '2.5px solid var(--stroke)',
        borderRadius: 'var(--radius-lg)',
        padding: 16,
        boxShadow: on
          ? 'var(--shadow-chunk)'
          : '2px 2px 0 var(--stroke)',
        cursor: isToggling ? 'wait' : 'pointer',
        transition: 'box-shadow 0.12s ease, transform 0.12s ease, opacity 0.12s ease',
        position: 'relative',
        opacity: isToggling ? 0.6 : on ? 1 : 0.85,
        outline: 'none',
      }}
    >
      {/* Toggle (top-right) */}
      <ToggleSwitch
        on={on}
        disabled={isToggling}
        groupName={group.name}
        onToggle={() => onToggle(!on)}
      />

      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <Avatar picture={group.pictureUrl} />
        <div style={{ flex: 1, minWidth: 0, paddingRight: 60 }}>
          <div
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 16,
              fontWeight: 800,
              letterSpacing: '-0.01em',
              lineHeight: 1.15,
              marginBottom: 2,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            title={group.name}
          >
            {group.name}
          </div>
          <div
            style={{
              fontSize: 11,
              color: 'var(--text-dim)',
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
            }}
          >
            {formatMembers(group.memberCount)} · últ. sync{' '}
            {formatRelative(group.lastSyncedAt)}
          </div>
        </div>
      </div>
    </div>
  );
}

export default GroupCard;

/* -------------------------------------------------------------------------- */
/* Toggle switch (button + animated dot)                                      */
/* -------------------------------------------------------------------------- */

interface ToggleSwitchProps {
  on: boolean;
  disabled: boolean;
  groupName: string;
  onToggle: () => void;
}

function ToggleSwitch({ on, disabled, groupName, onToggle }: ToggleSwitchProps) {
  return (
    <button
      type="button"
      data-toggle-btn
      onClick={(e) => {
        e.stopPropagation();
        if (!disabled) onToggle();
      }}
      aria-pressed={on}
      aria-label={
        on
          ? `Desativar monitoramento de ${groupName}`
          : `Ativar monitoramento de ${groupName}`
      }
      disabled={disabled}
      style={{
        position: 'absolute',
        top: 12,
        right: 12,
        width: 48,
        height: 28,
        borderRadius: 999,
        background: on ? 'var(--lime-500)' : 'var(--ink-500)',
        border: '2.5px solid var(--stroke)',
        padding: 2,
        cursor: disabled ? 'wait' : 'pointer',
        transition: 'background 0.15s ease',
        boxShadow: '2px 2px 0 var(--stroke)',
      }}
    >
      <span
        aria-hidden
        style={{
          display: 'block',
          width: 18,
          height: 18,
          borderRadius: '50%',
          background: '#fff',
          border: '2px solid var(--stroke)',
          transform: on ? 'translateX(20px)' : 'translateX(0)',
          transition: 'transform 0.15s ease',
        }}
      />
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* Avatar                                                                     */
/* -------------------------------------------------------------------------- */

function Avatar({ picture }: { picture: string | null }) {
  if (picture) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={picture}
        alt=""
        width={56}
        height={56}
        style={{
          width: 56,
          height: 56,
          borderRadius: 'var(--radius-md)',
          objectFit: 'cover',
          border: '2.5px solid var(--stroke)',
          boxShadow: '2px 2px 0 var(--stroke)',
          flexShrink: 0,
          background: 'var(--bg-2)',
        }}
      />
    );
  }
  return (
    <div
      aria-hidden
      style={{
        width: 56,
        height: 56,
        borderRadius: 'var(--radius-md)',
        border: '2.5px solid var(--stroke)',
        boxShadow: '2px 2px 0 var(--stroke)',
        background: 'var(--yellow-500)',
        display: 'grid',
        placeItems: 'center',
        fontSize: 28,
        flexShrink: 0,
      }}
    >
      👥
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Formatters                                                                 */
/* -------------------------------------------------------------------------- */

function formatMembers(count: number | null | undefined): string {
  if (count == null) return 'sem contagem';
  if (count === 1) return '1 pessoa';
  return `${count} pessoas`;
}

function formatRelative(iso: string | null | undefined): string {
  if (!iso) return 'nunca';
  const date = new Date(iso);
  const diffMs = Date.now() - date.getTime();
  if (!Number.isFinite(diffMs) || diffMs < 0) return 'agora';
  const s = Math.floor(diffMs / 1000);
  if (s < 60) return 'agora';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d`;
  const months = Math.floor(d / 30);
  if (months < 12) return `${months}mes`;
  const years = Math.floor(d / 365);
  return `${years}ano${years === 1 ? '' : 's'}`;
}
