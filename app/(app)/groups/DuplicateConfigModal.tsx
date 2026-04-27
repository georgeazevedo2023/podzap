'use client';

import { useEffect, useState } from 'react';

import { Modal } from '@/components/ui/Modal';
import { TEMPLATES } from '@/lib/summary/templates';
import type { GroupView } from '@/lib/groups/service';

/**
 * Modal "📋 Duplicar config" — copia template/hosts/defaults/promptOverride
 * de um grupo source pra N grupos target selecionados via checkboxes.
 *
 * Lista os outros grupos MONITORADOS do tenant (excluindo o source).
 * Pra grupos não-monitorados, faz menos sentido — o cliente provavelmente
 * vai monitorar primeiro. Decisão pode ser revista; o endpoint aceita
 * qualquer grupo do tenant.
 */
export interface DuplicateConfigModalProps {
  source: GroupView;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}

export function DuplicateConfigModal({
  source,
  open,
  onClose,
  onSaved,
}: DuplicateConfigModalProps) {
  const [targets, setTargets] = useState<GroupView[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [fetching, setFetching] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ updated: number } | null>(null);

  const sourceTemplate = TEMPLATES[source.promptTemplateId];

  useEffect(() => {
    if (!open) return;
    setError(null);
    setDone(null);
    setSelected(new Set());
    setFetching(true);
    let cancelled = false;
    fetch('/api/groups?monitoredOnly=true&pageSize=100', { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) throw new Error('falha ao carregar grupos');
        const data = (await res.json()) as { groups: GroupView[] };
        if (cancelled) return;
        // Tira o source da lista — duplicar pra si mesmo é no-op.
        const list = (data.groups ?? []).filter((g) => g.id !== source.id);
        setTargets(list);
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
  }, [open, source.id]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (selected.size === targets.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(targets.map((g) => g.id)));
    }
  }

  async function handleSubmit() {
    if (submitting || selected.size === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/groups/${encodeURIComponent(source.id)}/duplicate-config`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ targetGroupIds: Array.from(selected) }),
          cache: 'no-store',
        },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null;
        throw new Error(body?.error?.message ?? `Falha (${res.status})`);
      }
      const data = (await res.json()) as { updated: number };
      setDone(data);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'erro');
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={submitting ? () => undefined : onClose}
      title={`duplicar config — ${source.name || '(sem nome)'}`}
      size="md"
      footer={
        done ? (
          <button
            type="button"
            className="btn btn-zap"
            onClick={onClose}
          >
            ✓ fechar
          </button>
        ) : (
          <>
            <button
              type="button"
              className="btn btn-ghost btn-tap"
              onClick={onClose}
              disabled={submitting}
            >
              cancelar
            </button>
            <button
              type="button"
              className="btn btn-purple"
              onClick={handleSubmit}
              disabled={submitting || selected.size === 0 || fetching}
            >
              {submitting
                ? '⟳ duplicando...'
                : `📋 aplicar pra ${selected.size}`}
            </button>
          </>
        )
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {done ? (
          <div
            style={{
              padding: 18,
              border: '2.5px solid var(--lime-500)',
              borderRadius: 'var(--radius-md)',
              background: 'rgba(198, 255, 60, 0.08)',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              alignItems: 'center',
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: 36 }}>✅</div>
            <div style={{ fontSize: 15, fontWeight: 800 }}>
              config duplicada pra {done.updated}{' '}
              {done.updated === 1 ? 'grupo' : 'grupos'}
            </div>
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
              vai copiar do <strong>{source.name}</strong>:{' '}
              <span aria-hidden>{sourceTemplate.emoji}</span>{' '}
              <strong>{sourceTemplate.label}</strong> · {source.host1Name}+
              {source.host2Name} · {source.defaultPeriod} ·{' '}
              {source.defaultVoiceMode === 'duo' ? 'dupla' : 'solo'} · tom{' '}
              {source.defaultTone}
              {source.promptOverride && ' · prompt customizado'}
            </div>

            {fetching ? (
              <div style={{ color: 'var(--text-dim)', fontSize: 13 }}>
                carregando grupos...
              </div>
            ) : targets.length === 0 ? (
              <div style={{ color: 'var(--text-dim)', fontSize: 13 }}>
                não tem outros grupos monitorados pra duplicar.
              </div>
            ) : (
              <>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 800,
                      textTransform: 'uppercase',
                      letterSpacing: '0.1em',
                      color: 'var(--text-dim)',
                    }}
                  >
                    aplicar em ({selected.size}/{targets.length})
                  </span>
                  <button
                    type="button"
                    onClick={toggleAll}
                    className="btn btn-ghost btn-tap"
                    style={{ fontSize: 11, padding: '6px 10px' }}
                  >
                    {selected.size === targets.length
                      ? 'desmarcar todos'
                      : 'marcar todos'}
                  </button>
                </div>
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                    maxHeight: 320,
                    overflowY: 'auto',
                    paddingRight: 4,
                  }}
                >
                  {targets.map((g) => {
                    const checked = selected.has(g.id);
                    const t = TEMPLATES[g.promptTemplateId];
                    return (
                      <label
                        key={g.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 10,
                          padding: '10px 12px',
                          border: checked
                            ? '2.5px solid var(--purple-600)'
                            : '2px solid var(--stroke)',
                          borderRadius: 'var(--radius-md)',
                          background: checked
                            ? 'rgba(91, 43, 232, 0.08)'
                            : 'var(--surface)',
                          cursor: submitting ? 'wait' : 'pointer',
                          boxShadow: checked
                            ? '2px 2px 0 var(--purple-600)'
                            : '1px 1px 0 var(--stroke)',
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggle(g.id)}
                          disabled={submitting}
                          style={{
                            width: 18,
                            height: 18,
                            accentColor: 'var(--purple-600)',
                            flexShrink: 0,
                          }}
                        />
                        <div
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 2,
                            minWidth: 0,
                            flex: 1,
                          }}
                        >
                          <span
                            style={{
                              fontWeight: 800,
                              fontSize: 13,
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                            }}
                          >
                            {g.name || '(sem nome)'}
                          </span>
                          <span
                            style={{
                              fontSize: 10,
                              color: 'var(--text-dim)',
                              fontFamily: 'var(--font-mono)',
                            }}
                          >
                            atual: {t.emoji} {t.label} · {g.host1Name}+
                            {g.host2Name}
                          </span>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </>
            )}

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
