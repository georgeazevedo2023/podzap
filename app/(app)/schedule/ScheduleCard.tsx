'use client';

import type { GroupView } from '@/lib/groups/service';
import type {
  ScheduleApprovalMode,
  ScheduleFrequency,
  ScheduleView,
  SummaryTone,
} from '@/lib/schedules/service';

export interface ScheduleCardProps {
  schedule: ScheduleView;
  /** May be null if the group is gone / desmonitorado. */
  group: GroupView | null;
  isMutating: boolean;
  onToggleActive: (on: boolean) => void;
  onEdit: () => void;
  onDelete: () => void;
}

/**
 * Chunky neo-brutalist card for a single schedule. Mirrors the shape of
 * `GroupCard` — avatar + name header, colored sticker strip for metadata,
 * a toggle in the top-right for `isActive`, and a row of edit/delete
 * actions at the bottom.
 *
 * The toggle is a real `<button>` with `aria-pressed` (same pattern used
 * by `GroupCard`). Clicking anywhere else on the card does nothing — we
 * intentionally don't make the card itself a hit target because we have
 * explicit Edit/Delete buttons and the toggle already owns the primary
 * action. Keeps intent crystal clear.
 */
export function ScheduleCard({
  schedule,
  group,
  isMutating,
  onToggleActive,
  onEdit,
  onDelete,
}: ScheduleCardProps) {
  const active = schedule.isActive;
  const displayName = group?.name ?? '(grupo removido)';
  const timeLabel = formatTime(schedule.timeOfDay);
  const dayLabel =
    schedule.frequency === 'weekly'
      ? formatDayOfWeek(schedule.dayOfWeek)
      : null;

  return (
    <div
      role="group"
      aria-label={`Agenda de ${displayName}`}
      style={{
        background: active ? 'var(--surface)' : 'var(--bg-2)',
        border: '2.5px solid var(--stroke)',
        borderRadius: 'var(--radius-lg)',
        padding: 18,
        boxShadow: active ? 'var(--shadow-chunk)' : '2px 2px 0 var(--stroke)',
        opacity: isMutating ? 0.6 : active ? 1 : 0.85,
        transition: 'box-shadow 0.12s ease, opacity 0.12s ease',
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
      }}
    >
      {/* Active toggle */}
      <ActiveToggle
        on={active}
        disabled={isMutating}
        groupName={displayName}
        onToggle={() => onToggleActive(!active)}
      />

      {/* Header */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', paddingRight: 60 }}>
        <Avatar picture={group?.pictureUrl ?? null} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 17,
              fontWeight: 800,
              letterSpacing: '-0.01em',
              lineHeight: 1.15,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            title={displayName}
          >
            {displayName}
          </div>
          <div
            style={{
              fontSize: 11,
              color: 'var(--text-dim)',
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              marginTop: 2,
            }}
          >
            {active ? 'ativa' : 'pausada'}
            {' · '}
            {schedule.triggerType.replace('_', ' ')}
          </div>
        </div>
      </div>

      {/* Time block */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '10px 14px',
          background: 'var(--bg-2)',
          border: '2px solid var(--stroke)',
          borderRadius: 'var(--radius-md)',
        }}
      >
        <span aria-hidden style={{ fontSize: 20 }}>
          🕐
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontFamily: 'var(--font-brand, var(--font-display))',
              fontSize: 22,
              fontWeight: 800,
              letterSpacing: '-0.02em',
              color: 'var(--ink-900)',
            }}
          >
            {timeLabel}
          </div>
          <div
            style={{
              fontSize: 11,
              color: 'var(--text-dim)',
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              marginTop: 2,
            }}
          >
            {dayLabel ? `${dayLabel} · America/SP` : 'America/São_Paulo'}
          </div>
        </div>
        <FrequencySticker frequency={schedule.frequency} />
      </div>

      {/* Pills row */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <TonePill tone={schedule.tone} />
        <ApprovalPill mode={schedule.approvalMode} />
        {schedule.voice && <VoicePill voice={schedule.voice} />}
      </div>

      {/* Actions */}
      <div
        style={{
          display: 'flex',
          gap: 8,
          marginTop: 4,
          justifyContent: 'flex-end',
        }}
      >
        <button
          type="button"
          onClick={onEdit}
          disabled={isMutating}
          aria-label={`Editar agenda de ${displayName}`}
          className="btn btn-ghost"
          style={{ fontSize: 12, padding: '8px 14px' }}
        >
          ✏️ editar
        </button>
        <button
          type="button"
          onClick={onDelete}
          disabled={isMutating}
          aria-label={`Deletar agenda de ${displayName}`}
          style={{
            fontSize: 12,
            padding: '8px 14px',
            border: '2.5px solid var(--stroke)',
            borderRadius: 'var(--radius-pill)',
            background: 'var(--surface)',
            color: 'var(--red-500)',
            fontFamily: 'var(--font-body)',
            fontWeight: 700,
            cursor: isMutating ? 'wait' : 'pointer',
            boxShadow: '2px 2px 0 var(--stroke)',
          }}
        >
          🗑 deletar
        </button>
      </div>
    </div>
  );
}

export default ScheduleCard;

/* -------------------------------------------------------------------------- */
/* Toggle                                                                     */
/* -------------------------------------------------------------------------- */

interface ActiveToggleProps {
  on: boolean;
  disabled: boolean;
  groupName: string;
  onToggle: () => void;
}

function ActiveToggle({
  on,
  disabled,
  groupName,
  onToggle,
}: ActiveToggleProps) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        if (!disabled) onToggle();
      }}
      aria-pressed={on}
      aria-label={
        on
          ? `Pausar agenda de ${groupName}`
          : `Ativar agenda de ${groupName}`
      }
      disabled={disabled}
      style={{
        position: 'absolute',
        top: 14,
        right: 14,
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
/* Stickers / pills                                                           */
/* -------------------------------------------------------------------------- */

function FrequencySticker({ frequency }: { frequency: ScheduleFrequency }) {
  const cfg: Record<
    ScheduleFrequency,
    { label: string; bg: string; fg: string; emoji: string }
  > = {
    daily: {
      label: 'diário',
      bg: 'var(--lime-500)',
      fg: 'var(--ink-900)',
      emoji: '📅',
    },
    weekly: {
      label: 'semanal',
      bg: 'var(--yellow-500)',
      fg: 'var(--ink-900)',
      emoji: '🗓️',
    },
    custom: {
      label: 'custom',
      bg: 'var(--purple-600)',
      fg: '#fff',
      emoji: '⚙️',
    },
  };
  const c = cfg[frequency];
  return (
    <span
      style={{
        padding: '4px 10px',
        borderRadius: 999,
        background: c.bg,
        color: c.fg,
        fontSize: 10,
        fontWeight: 800,
        border: '2px solid var(--stroke)',
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
        boxShadow: '2px 2px 0 var(--stroke)',
        whiteSpace: 'nowrap',
      }}
    >
      {c.emoji} {c.label}
    </span>
  );
}

function TonePill({ tone }: { tone: SummaryTone }) {
  const cfg: Record<SummaryTone, { label: string; emoji: string }> = {
    formal: { label: 'formal', emoji: '🎩' },
    fun: { label: 'descontraído', emoji: '🎉' },
    corporate: { label: 'corporativo', emoji: '💼' },
  };
  const c = cfg[tone];
  return (
    <span
      style={{
        padding: '4px 10px',
        borderRadius: 999,
        background: 'var(--surface)',
        color: 'var(--text)',
        fontSize: 11,
        fontWeight: 700,
        border: '2px solid var(--stroke)',
        boxShadow: '2px 2px 0 var(--stroke)',
      }}
    >
      {c.emoji} {c.label}
    </span>
  );
}

function ApprovalPill({ mode }: { mode: ScheduleApprovalMode }) {
  const cfg: Record<
    ScheduleApprovalMode,
    { label: string; emoji: string; bg: string; fg: string }
  > = {
    optional: {
      label: 'revisão opcional',
      emoji: '👀',
      bg: 'var(--bg-2)',
      fg: 'var(--text)',
    },
    required: {
      label: 'revisão obrigatória',
      emoji: '🔒',
      bg: 'var(--ink-900)',
      fg: '#fff',
    },
  };
  const c = cfg[mode];
  return (
    <span
      style={{
        padding: '4px 10px',
        borderRadius: 999,
        background: c.bg,
        color: c.fg,
        fontSize: 11,
        fontWeight: 700,
        border: '2px solid var(--stroke)',
        boxShadow: '2px 2px 0 var(--stroke)',
      }}
    >
      {c.emoji} {c.label}
    </span>
  );
}

function VoicePill({ voice }: { voice: string }) {
  return (
    <span
      style={{
        padding: '4px 10px',
        borderRadius: 999,
        background: 'var(--pink-500)',
        color: '#fff',
        fontSize: 11,
        fontWeight: 700,
        border: '2px solid var(--stroke)',
        boxShadow: '2px 2px 0 var(--stroke)',
      }}
    >
      🎙 {voice}
    </span>
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
        width={48}
        height={48}
        style={{
          width: 48,
          height: 48,
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
        width: 48,
        height: 48,
        borderRadius: 'var(--radius-md)',
        border: '2.5px solid var(--stroke)',
        boxShadow: '2px 2px 0 var(--stroke)',
        background: 'var(--yellow-500)',
        display: 'grid',
        placeItems: 'center',
        fontSize: 22,
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

function formatTime(value: string | null): string {
  if (!value) return '--:--';
  // `time_of_day` comes as "HH:MM:SS" from Postgres; trim seconds.
  const m = /^(\d{1,2}):(\d{1,2})/.exec(value);
  if (!m) return value;
  const hh = m[1].padStart(2, '0');
  const mm = m[2].padStart(2, '0');
  return `${hh}:${mm}`;
}

const DAY_LABELS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'] as const;

function formatDayOfWeek(day: number | null): string {
  if (day === null || day < 0 || day > 6) return '—';
  return DAY_LABELS[day];
}
