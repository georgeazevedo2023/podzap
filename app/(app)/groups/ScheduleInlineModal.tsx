'use client';

import { useEffect, useState } from 'react';

import { Modal } from '@/components/ui/Modal';
import type { GroupView } from '@/lib/groups/service';
import type { ScheduleView } from '@/lib/schedules/service';

/**
 * Modal "⏰ Agendar" inline — cria/atualiza schedule pra um grupo direto
 * do GroupCard, sem ir pra /schedule.
 *
 * Restrições propositais (escopo enxuto vs. /schedule completa):
 *   - Frequency: só `daily` (semanal e custom usam /schedule).
 *   - TriggerType: só `fixed_time`.
 *   - Approval mode: required (default) | optional.
 *   - Tone/voice/voiceMode: herdados do grupo (defaults Fase A) — não
 *     expostos aqui pra reduzir cliques.
 *
 * Quem precisar mais (semanal, dia específico da semana, custom),
 * navega pra /schedule via link no rodapé.
 *
 * Comportamento:
 *   - Se o grupo já tem schedule, modal pré-preenche e dispara PATCH ao
 *     salvar.
 *   - Se não tem, dispara POST /api/schedules.
 *   - Excluir schedule mostra DELETE → schedule volta a ser "on-demand".
 */

export interface ScheduleInlineModalProps {
  group: GroupView;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, h) => {
  const hh = String(h).padStart(2, '0');
  return { value: `${hh}:00`, label: `${hh}:00` };
});

export function ScheduleInlineModal({
  group,
  open,
  onClose,
  onSaved,
}: ScheduleInlineModalProps) {
  const [existing, setExisting] = useState<ScheduleView | null>(null);
  const [fetching, setFetching] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [time, setTime] = useState<string>('09:00');
  const [approvalMode, setApprovalMode] = useState<'required' | 'optional'>(
    'required',
  );

  useEffect(() => {
    if (!open) return;
    setError(null);
    setFetching(true);
    let cancelled = false;
    fetch('/api/schedules', { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) throw new Error('falha ao carregar agendas');
        const data = (await res.json()) as { schedules: ScheduleView[] };
        if (cancelled) return;
        const found = (data.schedules ?? []).find(
          (s) => s.groupId === group.id,
        );
        setExisting(found ?? null);
        if (found) {
          // Normaliza HH:MM:SS pra HH:00 no select.
          const t = found.timeOfDay ?? '09:00:00';
          const hh = t.slice(0, 2);
          setTime(`${hh}:00`);
          setApprovalMode(
            found.approvalMode === 'optional' ? 'optional' : 'required',
          );
        }
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'falha');
      })
      .finally(() => {
        if (!cancelled) setFetching(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, group.id]);

  async function handleSave() {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const body = {
        groupId: group.id,
        frequency: 'daily' as const,
        timeOfDay: `${time}:00`,
        dayOfWeek: null,
        triggerType: 'fixed_time' as const,
        approvalMode,
        voice: null,
        tone: group.defaultTone,
        isActive: true,
      };
      const url = existing
        ? `/api/schedules/${encodeURIComponent(existing.id)}`
        : '/api/schedules';
      const method = existing ? 'PATCH' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        cache: 'no-store',
      });
      if (!res.ok) {
        const errBody = (await res.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null;
        throw new Error(
          errBody?.error?.message ?? `Falha (${res.status})`,
        );
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'erro');
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    if (!existing || deleting) return;
    if (
      typeof window !== 'undefined' &&
      !window.confirm(`remover agendamento de ${group.name}?`)
    ) {
      return;
    }
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/schedules/${encodeURIComponent(existing.id)}`,
        { method: 'DELETE', cache: 'no-store' },
      );
      if (!res.ok) throw new Error(`Falha ao remover (${res.status})`);
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'erro');
      setDeleting(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={submitting || deleting ? () => undefined : onClose}
      title={`agendar — ${group.name || '(sem nome)'}`}
      size="md"
      footer={
        <>
          <button
            type="button"
            className="btn btn-ghost btn-tap"
            onClick={onClose}
            disabled={submitting || deleting}
          >
            cancelar
          </button>
          {existing && (
            <button
              type="button"
              className="btn btn-ghost btn-tap"
              onClick={handleDelete}
              disabled={submitting || deleting}
              style={{ color: 'var(--red-500)' }}
            >
              {deleting ? '⟳ removendo...' : '🗑 remover'}
            </button>
          )}
          <button
            type="button"
            className="btn btn-zap"
            onClick={handleSave}
            disabled={submitting || deleting || fetching}
          >
            {submitting
              ? '⟳ salvando...'
              : existing
                ? '✓ atualizar'
                : '⏰ agendar'}
          </button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {fetching ? (
          <div style={{ color: 'var(--text-dim)', fontSize: 13 }}>
            carregando...
          </div>
        ) : (
          <>
            <div
              style={{
                padding: 12,
                border: '2.5px solid var(--purple-600)',
                borderRadius: 'var(--radius-md)',
                background: 'rgba(91, 43, 232, 0.08)',
                fontSize: 12,
                lineHeight: 1.5,
              }}
            >
              {existing ? (
                <>
                  já tá agendado <strong>diariamente</strong> às{' '}
                  <strong>{existing.timeOfDay?.slice(0, 5) ?? '?'}</strong>.
                  edita aqui ou{' '}
                  <a
                    href="/schedule"
                    style={{ color: 'var(--text)', textDecoration: 'underline' }}
                  >
                    /schedule
                  </a>{' '}
                  pra opções avançadas (semanal, custom).
                </>
              ) : (
                <>
                  agendamento rápido — <strong>diariamente</strong> no
                  horário escolhido. tom, formato e template vêm do grupo
                  ({group.defaultTone} · {group.defaultVoiceMode === 'duo'
                    ? 'dupla'
                    : 'solo'}
                  ). pra cron semanal/custom, usa{' '}
                  <a
                    href="/schedule"
                    style={{ color: 'var(--text)', textDecoration: 'underline' }}
                  >
                    /schedule
                  </a>
                  .
                </>
              )}
            </div>

            <SegmentField
              label="horário"
              value={time}
              onChange={setTime}
              options={HOUR_OPTIONS.filter((_, idx) =>
                idx % 2 === 0 || idx === 9 || idx === 12 || idx === 18,
              )}
              disabled={submitting || deleting}
            />

            <SegmentField
              label="modo de aprovação"
              helpText='"obrigatória" = você revisa antes de virar áudio. "opcional" = gera e fica em /aprovações pendente; se você não revisar em algumas horas, a IA aprova sozinha.'
              value={approvalMode}
              onChange={(v) =>
                setApprovalMode(v === 'optional' ? 'optional' : 'required')
              }
              options={[
                { value: 'required', label: '✋ obrigatória' },
                { value: 'optional', label: '⏱ opcional' },
              ]}
              disabled={submitting || deleting}
            />

            {error && (
              <div
                role="alert"
                style={{
                  padding: 10,
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
          </>
        )}
      </div>
    </Modal>
  );
}

function SegmentField({
  label,
  helpText,
  value,
  onChange,
  options,
  disabled,
}: {
  label: string;
  helpText?: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  disabled: boolean;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span
        style={{
          fontSize: 11,
          fontWeight: 800,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          color: 'var(--text-dim)',
        }}
      >
        {label}
      </span>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {options.map((o) => {
          const selected = o.value === value;
          return (
            <button
              key={o.value}
              type="button"
              onClick={() => !disabled && onChange(o.value)}
              disabled={disabled}
              aria-pressed={selected}
              style={{
                padding: '8px 14px',
                borderRadius: 'var(--radius-pill)',
                border: '2.5px solid var(--stroke)',
                background: selected ? 'var(--lime-500)' : 'var(--surface)',
                color: selected ? 'var(--ink-900)' : 'var(--text)',
                fontFamily: 'var(--font-body)',
                fontSize: 13,
                fontWeight: 700,
                cursor: disabled ? 'wait' : 'pointer',
                boxShadow: selected
                  ? '2px 2px 0 var(--stroke)'
                  : '1px 1px 0 var(--stroke)',
                minHeight: 44,
              }}
            >
              {o.label}
            </button>
          );
        })}
      </div>
      {helpText && (
        <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>
          {helpText}
        </span>
      )}
    </div>
  );
}
