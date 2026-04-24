'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react';

import type { GroupView } from '@/lib/groups/service';
import type {
  ScheduleApprovalMode,
  ScheduleFrequency,
  ScheduleTriggerType,
  ScheduleView,
  SummaryTone,
} from '@/lib/schedules/service';

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

export type ScheduleFormMode = 'create' | 'edit';

export interface ScheduleFormProps {
  mode: ScheduleFormMode;
  /** Only required in edit mode. Ignored otherwise. */
  schedule?: ScheduleView;
  /** Groups available to pick from (typically monitored-only). */
  groups: GroupView[];
  /** All current schedules, used to dedupe the group picker on create. */
  existing: ScheduleView[];
  /** Called on close — `saved=true` means a mutation landed and parent
   *  should `router.refresh()`. */
  onClose: (saved: boolean) => void;
}

/**
 * Shape of the POST/PATCH payload — matches the service `CreateScheduleInput`
 * shape (camelCase) minus tenant_id which the API derives from the
 * authenticated session.
 */
interface SchedulePayload {
  groupId: string;
  frequency: ScheduleFrequency;
  timeOfDay: string | null;
  dayOfWeek: number | null;
  triggerType: ScheduleTriggerType;
  approvalMode: ScheduleApprovalMode;
  voice: string | null;
  tone: SummaryTone;
  isActive: boolean;
}

/* -------------------------------------------------------------------------- */
/* Constants                                                                  */
/* -------------------------------------------------------------------------- */

const TONES: readonly { value: SummaryTone; label: string; emoji: string }[] = [
  { value: 'formal', label: 'formal', emoji: '🎩' },
  { value: 'fun', label: 'descontraído', emoji: '🎉' },
  { value: 'corporate', label: 'corporativo', emoji: '💼' },
] as const;

const APPROVAL_MODES: readonly {
  value: ScheduleApprovalMode;
  label: string;
  desc: string;
  emoji: string;
}[] = [
  {
    value: 'optional',
    label: 'aprovação opcional',
    desc: 'alerta; ainda exige clique em /approval antes de ir pro grupo',
    emoji: '👀',
  },
  {
    value: 'required',
    label: 'aprovação obrigatória',
    desc: 'nada sai sem seu ok',
    emoji: '🔒',
  },
] as const;

const TRIGGER_TYPES: readonly {
  value: ScheduleTriggerType;
  label: string;
  emoji: string;
  disabled: boolean;
}[] = [
  {
    value: 'fixed_time',
    label: 'horário fixo',
    emoji: '⏰',
    disabled: false,
  },
  {
    value: 'inactivity',
    label: 'após inatividade',
    emoji: '😴',
    disabled: true,
  },
  {
    value: 'dynamic_window',
    label: 'janela esperta',
    emoji: '🧠',
    disabled: true,
  },
] as const;

const VOICES: readonly { value: string; label: string }[] = [
  { value: '', label: 'padrão do sistema' },
  { value: 'alloy', label: 'alloy' },
  { value: 'echo', label: 'echo' },
  { value: 'fable', label: 'fable' },
  { value: 'onyx', label: 'onyx' },
  { value: 'nova', label: 'nova' },
  { value: 'shimmer', label: 'shimmer' },
] as const;

const WEEKDAYS = [
  { value: 0, label: 'domingo', short: 'dom' },
  { value: 1, label: 'segunda', short: 'seg' },
  { value: 2, label: 'terça', short: 'ter' },
  { value: 3, label: 'quarta', short: 'qua' },
  { value: 4, label: 'quinta', short: 'qui' },
  { value: 5, label: 'sexta', short: 'sex' },
  { value: 6, label: 'sábado', short: 'sáb' },
] as const;

/* -------------------------------------------------------------------------- */
/* Component                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * ScheduleForm — modal dialog for creating or editing a schedule.
 *
 * Design call-out: we render as a modal (full-screen overlay + centered
 * card) rather than inline. Rationale:
 *   - The screen can render 0..N cards already; squeezing a giant form
 *     in between breaks the "list of schedules at a glance" read.
 *   - The TopBar CTA works from any empty state, including when no list
 *     is mounted at all.
 *   - Escape / click-outside close out of the way cleanly.
 *
 * We don't pull in a modal primitive from `@/components/ui/*` because the
 * design system doesn't ship one yet — this is self-contained.
 *
 * Validation is intentionally conservative client-side:
 *   - `groupId` must be non-empty.
 *   - `timeOfDay` required for `fixed_time` trigger.
 *   - `dayOfWeek` required when `frequency=weekly`.
 * The server is the source of truth for everything else (conflict, etc.)
 * so we surface any server error verbatim.
 */
export function ScheduleForm({
  mode,
  schedule,
  groups,
  existing,
  onClose,
}: ScheduleFormProps) {
  const isEdit = mode === 'edit';

  // Seed from schedule (edit) or sensible defaults (create).
  const [groupId, setGroupId] = useState<string>(
    schedule?.groupId ?? '',
  );
  const [frequency, setFrequency] = useState<ScheduleFrequency>(
    schedule?.frequency ?? 'daily',
  );
  const [timeOfDay, setTimeOfDay] = useState<string>(
    trimSeconds(schedule?.timeOfDay) ?? '09:00',
  );
  const [dayOfWeek, setDayOfWeek] = useState<number>(
    schedule?.dayOfWeek ?? 1, // segunda
  );
  const [triggerType, setTriggerType] = useState<ScheduleTriggerType>(
    schedule?.triggerType ?? 'fixed_time',
  );
  const [approvalMode, setApprovalMode] = useState<ScheduleApprovalMode>(
    schedule?.approvalMode ?? 'optional',
  );
  const [tone, setTone] = useState<SummaryTone>(schedule?.tone ?? 'fun');
  const [voice, setVoice] = useState<string>(schedule?.voice ?? '');
  const [isActive, setIsActive] = useState<boolean>(
    schedule?.isActive ?? true,
  );

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  // Available groups: on create, hide ones that already have a schedule.
  // On edit, the current group must remain selectable (otherwise its own
  // name disappears from the dropdown).
  const availableGroups = useMemo<GroupView[]>(() => {
    if (isEdit) return groups;
    const taken = new Set(existing.map((s) => s.groupId));
    return groups.filter((g) => !taken.has(g.id));
  }, [groups, existing, isEdit]);

  // Escape key closes.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submitting) onClose(false);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose, submitting]);

  // Focus the card on open so tab order works.
  useEffect(() => {
    cardRef.current?.focus();
  }, []);

  const handleSubmit = useCallback(
    async (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      if (submitting) return;

      // Client-side validation.
      if (!groupId) {
        setError('Escolhe um grupo.');
        return;
      }
      if (triggerType === 'fixed_time' && !timeOfDay) {
        setError('Horário é obrigatório para horário fixo.');
        return;
      }
      if (frequency === 'weekly' && (dayOfWeek < 0 || dayOfWeek > 6)) {
        setError('Escolhe um dia da semana.');
        return;
      }

      setError(null);
      setSubmitting(true);

      const payload: SchedulePayload = {
        groupId,
        frequency,
        timeOfDay: triggerType === 'fixed_time' ? timeOfDay : null,
        dayOfWeek: frequency === 'weekly' ? dayOfWeek : null,
        triggerType,
        approvalMode,
        voice: voice.trim() === '' ? null : voice,
        tone,
        isActive,
      };

      try {
        const url = isEdit
          ? `/api/schedules/${encodeURIComponent(schedule!.id)}`
          : '/api/schedules';
        const res = await fetch(url, {
          method: isEdit ? 'PATCH' : 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
          cache: 'no-store',
        });

        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as {
            error?: { code?: string; message?: string };
          } | null;
          const code = body?.error?.code;
          if (res.status === 409 && code === 'CONFLICT') {
            throw new Error(
              'Esse grupo já tem uma agenda. Edita a que existe.',
            );
          }
          throw new Error(
            body?.error?.message ??
              `Falha ao salvar agenda (${res.status})`,
          );
        }

        onClose(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Erro ao salvar');
        setSubmitting(false);
      }
    },
    [
      submitting,
      groupId,
      frequency,
      timeOfDay,
      dayOfWeek,
      triggerType,
      approvalMode,
      voice,
      tone,
      isActive,
      isEdit,
      schedule,
      onClose,
    ],
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={isEdit ? 'Editar agenda' : 'Nova agenda'}
      onClick={(e) => {
        // Click on backdrop closes.
        if (e.target === e.currentTarget && !submitting) onClose(false);
      }}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.45)',
        display: 'grid',
        placeItems: 'center',
        padding: 24,
        zIndex: 100,
        overflowY: 'auto',
      }}
    >
      <div
        ref={cardRef}
        tabIndex={-1}
        className="card"
        style={{
          width: '100%',
          maxWidth: 640,
          maxHeight: '90vh',
          overflowY: 'auto',
          padding: 28,
          outline: 'none',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            marginBottom: 22,
          }}
        >
          <div style={{ flex: 1 }}>
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                color: 'var(--text-dim)',
                marginBottom: 4,
              }}
            >
              podZAP · Fase 11
            </div>
            <h2
              style={{
                margin: 0,
                fontFamily: 'var(--font-display)',
                fontSize: 28,
                fontWeight: 800,
                letterSpacing: '-0.02em',
              }}
            >
              {isEdit ? 'editar agenda' : 'nova agenda'}
            </h2>
          </div>
          <button
            type="button"
            onClick={() => onClose(false)}
            disabled={submitting}
            aria-label="Fechar"
            style={{
              width: 36,
              height: 36,
              borderRadius: '50%',
              border: '2.5px solid var(--stroke)',
              background: 'var(--surface)',
              fontSize: 16,
              fontWeight: 800,
              cursor: submitting ? 'wait' : 'pointer',
              boxShadow: '2px 2px 0 var(--stroke)',
            }}
          >
            ✕
          </button>
        </div>

        <form
          onSubmit={handleSubmit}
          style={{ display: 'flex', flexDirection: 'column', gap: 18 }}
        >
          {/* Group picker */}
          <Field label="grupo">
            <select
              value={groupId}
              onChange={(e) => setGroupId(e.target.value)}
              disabled={isEdit || submitting}
              required
              aria-label="Grupo monitorado"
              style={selectStyle}
            >
              <option value="">— escolhe um grupo —</option>
              {availableGroups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
            {!isEdit && availableGroups.length === 0 && (
              <Hint>
                todos os grupos monitorados já têm agenda. edita uma
                existente ou monitora outro grupo.
              </Hint>
            )}
          </Field>

          {/* Trigger type */}
          <Field label="quando disparar">
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: 10,
              }}
            >
              {TRIGGER_TYPES.map((t) => {
                const on = triggerType === t.value;
                return (
                  <button
                    key={t.value}
                    type="button"
                    disabled={t.disabled || submitting}
                    onClick={() => setTriggerType(t.value)}
                    aria-pressed={on}
                    title={t.disabled ? 'em breve' : undefined}
                    style={{
                      padding: 12,
                      textAlign: 'left',
                      background: on
                        ? 'var(--lime-500)'
                        : 'var(--surface)',
                      color: on ? 'var(--ink-900)' : 'var(--text)',
                      border: '2.5px solid var(--stroke)',
                      borderRadius: 'var(--radius-md)',
                      cursor:
                        t.disabled || submitting ? 'not-allowed' : 'pointer',
                      fontFamily: 'var(--font-body)',
                      boxShadow: on
                        ? 'var(--shadow-chunk)'
                        : '2px 2px 0 var(--stroke)',
                      opacity: t.disabled ? 0.5 : 1,
                    }}
                  >
                    <div style={{ fontSize: 20, marginBottom: 4 }}>
                      {t.emoji}
                    </div>
                    <div style={{ fontSize: 12, fontWeight: 800 }}>
                      {t.label}
                    </div>
                  </button>
                );
              })}
            </div>
          </Field>

          {/* Frequency */}
          <Field label="frequência">
            <div style={{ display: 'flex', gap: 8 }}>
              {(['daily', 'weekly'] as const).map((f) => {
                const on = frequency === f;
                return (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setFrequency(f)}
                    aria-pressed={on}
                    disabled={submitting}
                    style={{
                      padding: '10px 18px',
                      borderRadius: 'var(--radius-pill)',
                      border: '2.5px solid var(--stroke)',
                      background: on
                        ? 'var(--yellow-500)'
                        : 'var(--surface)',
                      color: 'var(--ink-900)',
                      fontFamily: 'var(--font-body)',
                      fontSize: 13,
                      fontWeight: 700,
                      cursor: submitting ? 'wait' : 'pointer',
                      boxShadow: on
                        ? 'var(--shadow-chunk)'
                        : '2px 2px 0 var(--stroke)',
                    }}
                  >
                    {f === 'daily' ? '📅 diário' : '🗓️ semanal'}
                  </button>
                );
              })}
            </div>
          </Field>

          {/* Time + day-of-week */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns:
                frequency === 'weekly' ? '1fr 1fr' : '1fr',
              gap: 12,
            }}
          >
            <Field label="horário (America/SP)">
              <input
                type="time"
                value={timeOfDay}
                onChange={(e) => setTimeOfDay(e.target.value)}
                disabled={triggerType !== 'fixed_time' || submitting}
                required={triggerType === 'fixed_time'}
                style={inputStyle}
              />
            </Field>
            {frequency === 'weekly' && (
              <Field label="dia da semana">
                <select
                  value={dayOfWeek}
                  onChange={(e) => setDayOfWeek(Number(e.target.value))}
                  disabled={submitting}
                  style={selectStyle}
                >
                  {WEEKDAYS.map((d) => (
                    <option key={d.value} value={d.value}>
                      {d.label}
                    </option>
                  ))}
                </select>
              </Field>
            )}
          </div>

          {/* Approval mode */}
          <Field label="modo de aprovação">
            <div style={{ display: 'grid', gap: 8 }}>
              {APPROVAL_MODES.map((m) => {
                const on = approvalMode === m.value;
                return (
                  <button
                    key={m.value}
                    type="button"
                    onClick={() => setApprovalMode(m.value)}
                    aria-pressed={on}
                    disabled={submitting}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      padding: 12,
                      textAlign: 'left',
                      background: on
                        ? 'var(--yellow-500)'
                        : 'var(--bg-2)',
                      color: on ? 'var(--ink-900)' : 'var(--text)',
                      border: '2.5px solid var(--stroke)',
                      borderRadius: 'var(--radius-md)',
                      cursor: submitting ? 'wait' : 'pointer',
                      fontFamily: 'var(--font-body)',
                      boxShadow: on
                        ? 'var(--shadow-chunk)'
                        : '2px 2px 0 var(--stroke)',
                    }}
                  >
                    <div style={{ fontSize: 22 }}>{m.emoji}</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 800 }}>
                        {m.label}
                      </div>
                      <div style={{ fontSize: 11, opacity: 0.8 }}>
                        {m.desc}
                      </div>
                    </div>
                    <div
                      aria-hidden
                      style={{
                        width: 18,
                        height: 18,
                        borderRadius: '50%',
                        background: on ? 'var(--ink-900)' : '#fff',
                        border: '2.5px solid var(--stroke)',
                        display: 'grid',
                        placeItems: 'center',
                      }}
                    >
                      {on && (
                        <div
                          style={{
                            width: 8,
                            height: 8,
                            borderRadius: '50%',
                            background: 'var(--lime-500)',
                          }}
                        />
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </Field>

          {/* Tone */}
          <Field label="tom do resumo">
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {TONES.map((t) => {
                const on = tone === t.value;
                return (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => setTone(t.value)}
                    aria-pressed={on}
                    disabled={submitting}
                    style={{
                      padding: '8px 14px',
                      borderRadius: 'var(--radius-pill)',
                      border: '2.5px solid var(--stroke)',
                      background: on
                        ? 'var(--pink-500)'
                        : 'var(--surface)',
                      color: on ? '#fff' : 'var(--text)',
                      fontFamily: 'var(--font-body)',
                      fontSize: 13,
                      fontWeight: 700,
                      cursor: submitting ? 'wait' : 'pointer',
                      boxShadow: on
                        ? 'var(--shadow-chunk)'
                        : '2px 2px 0 var(--stroke)',
                    }}
                  >
                    {t.emoji} {t.label}
                  </button>
                );
              })}
            </div>
          </Field>

          {/* Voice */}
          <Field label="voz (TTS)">
            <select
              value={voice}
              onChange={(e) => setVoice(e.target.value)}
              disabled={submitting}
              style={selectStyle}
            >
              {VOICES.map((v) => (
                <option key={v.value} value={v.value}>
                  {v.label}
                </option>
              ))}
            </select>
          </Field>

          {/* Active */}
          <label
            style={{
              display: 'flex',
              gap: 10,
              alignItems: 'center',
              padding: '10px 14px',
              border: '2.5px solid var(--stroke)',
              borderRadius: 'var(--radius-md)',
              background: 'var(--bg-2)',
              cursor: submitting ? 'wait' : 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              disabled={submitting}
              style={{ width: 18, height: 18, accentColor: 'var(--lime-500)' }}
            />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 800 }}>
                ativa agora
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>
                quando ligada, o cron dispara. desliga pra pausar sem
                deletar.
              </div>
            </div>
          </label>

          {/* Error */}
          {error && (
            <div
              role="alert"
              style={{
                padding: 12,
                border: '2.5px solid var(--red-500)',
                borderRadius: 'var(--radius-md)',
                background: 'rgba(255, 77, 60, 0.08)',
                color: 'var(--red-500)',
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              ⚠ {error}
            </div>
          )}

          {/* Actions */}
          <div
            style={{
              display: 'flex',
              gap: 10,
              justifyContent: 'flex-end',
              marginTop: 6,
            }}
          >
            <button
              type="button"
              onClick={() => onClose(false)}
              disabled={submitting}
              className="btn btn-ghost"
            >
              cancelar
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="btn btn-zap"
              style={{ opacity: submitting ? 0.75 : 1 }}
            >
              {submitting
                ? '⟳ salvando...'
                : isEdit
                  ? '✓ salvar alterações'
                  : '✓ criar agenda'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default ScheduleForm;

/* -------------------------------------------------------------------------- */
/* Bits                                                                       */
/* -------------------------------------------------------------------------- */

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div
        style={{
          fontSize: 11,
          fontWeight: 800,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          color: 'var(--text-dim)',
        }}
      >
        {label}
      </div>
      {children}
    </div>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 11,
        color: 'var(--text-dim)',
        fontStyle: 'italic',
        marginTop: 2,
      }}
    >
      {children}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  padding: '10px 14px',
  border: '2.5px solid var(--stroke)',
  borderRadius: 'var(--radius-md)',
  fontFamily: 'var(--font-body)',
  fontSize: 14,
  fontWeight: 600,
  background: 'var(--surface)',
  color: 'var(--text)',
  boxShadow: '2px 2px 0 var(--stroke)',
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box',
};

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  cursor: 'pointer',
};

function trimSeconds(value: string | null | undefined): string | null {
  if (!value) return null;
  const m = /^(\d{1,2}):(\d{1,2})/.exec(value);
  if (!m) return value;
  return `${m[1].padStart(2, '0')}:${m[2].padStart(2, '0')}`;
}
