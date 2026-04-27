'use client';

import { useState, type FormEvent } from 'react';

import { Modal } from '@/components/ui/Modal';
import { TEMPLATES, TEMPLATE_IDS, type TemplateId } from '@/lib/summary/templates';
import type { GroupView } from '@/lib/groups/service';
import type { SummaryTone } from '@/lib/summary/prompt';

/**
 * Modal "Editar grupo" — fechamento da Fase B+C do mobile-first follow-up.
 *
 * 3 tabs:
 *   1. Geral          — tom + formato (single|duo) + janela default (24h|7d)
 *   2. Hosts & Vozes  — nome do apresentador 1 e 2 (substitui {{host1_name}}
 *                       e {{host2_name}} nos templates)
 *   3. Avançado       — picker de template do catálogo (lib/summary/templates)
 *
 * Patch parcial via PATCH /api/groups/[id]. Só envia o que mudou pra
 * minimizar o footprint da request (e do trail de updated_at).
 */

type TabKey = 'geral' | 'hosts' | 'advanced';

export interface EditGroupModalProps {
  group: GroupView;
  open: boolean;
  onClose: () => void;
  /** Chamado com a view atualizada após PATCH ok. */
  onSaved: (group: GroupView) => void;
}

export function EditGroupModal({
  group,
  open,
  onClose,
  onSaved,
}: EditGroupModalProps) {
  const [tab, setTab] = useState<TabKey>('geral');
  const [tone, setTone] = useState<SummaryTone>(group.defaultTone);
  const [voiceMode, setVoiceMode] = useState<'single' | 'duo'>(
    group.defaultVoiceMode,
  );
  const [period, setPeriod] = useState<'24h' | '7d'>(group.defaultPeriod);
  const [host1, setHost1] = useState(group.host1Name);
  const [host2, setHost2] = useState(group.host2Name);
  const [templateId, setTemplateId] = useState<TemplateId>(
    group.promptTemplateId,
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Diff manual: só inclui campos que de fato mudaram em relação ao grupo
   * que veio em props. Evita gravar `updated_at` à toa (importante em
   * /history e nos audits).
   */
  function buildPatch(): Record<string, unknown> {
    const patch: Record<string, unknown> = {};
    if (tone !== group.defaultTone) patch.defaultTone = tone;
    if (voiceMode !== group.defaultVoiceMode) patch.defaultVoiceMode = voiceMode;
    if (period !== group.defaultPeriod) patch.defaultPeriod = period;
    if (host1.trim() !== group.host1Name) patch.host1Name = host1.trim();
    if (host2.trim() !== group.host2Name) patch.host2Name = host2.trim();
    if (templateId !== group.promptTemplateId)
      patch.promptTemplateId = templateId;
    return patch;
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting) return;

    if (!host1.trim()) {
      setError('nome do apresentador 1 não pode ficar vazio');
      return;
    }
    if (!host2.trim()) {
      setError('nome do apresentador 2 não pode ficar vazio');
      return;
    }

    const patch = buildPatch();
    if (Object.keys(patch).length === 0) {
      onClose();
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/groups/${encodeURIComponent(group.id)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch),
        cache: 'no-store',
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null;
        throw new Error(
          body?.error?.message ?? `Falha ao salvar (${res.status})`,
        );
      }
      const data = (await res.json()) as { group: GroupView };
      onSaved(data.group);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'erro');
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={submitting ? () => undefined : onClose}
      title={`editar — ${group.name || '(sem nome)'}`}
      size="md"
      footer={
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
            type="submit"
            form="edit-group-form"
            className="btn btn-zap"
            disabled={submitting}
          >
            {submitting ? '⟳ salvando...' : '✓ salvar'}
          </button>
        </>
      }
    >
      <form
        id="edit-group-form"
        onSubmit={handleSubmit}
        style={{ display: 'flex', flexDirection: 'column', gap: 16 }}
      >
        <Tabs current={tab} onChange={setTab} />

        {tab === 'geral' && (
          <GeralTab
            tone={tone}
            voiceMode={voiceMode}
            period={period}
            onTone={setTone}
            onVoiceMode={setVoiceMode}
            onPeriod={setPeriod}
            disabled={submitting}
          />
        )}

        {tab === 'hosts' && (
          <HostsTab
            host1={host1}
            host2={host2}
            onHost1={setHost1}
            onHost2={setHost2}
            disabled={submitting}
          />
        )}

        {tab === 'advanced' && (
          <AdvancedTab
            templateId={templateId}
            onTemplateId={setTemplateId}
            disabled={submitting}
          />
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
      </form>
    </Modal>
  );
}

/* -------------------------------------------------------------------------- */
/* Tabs                                                                       */
/* -------------------------------------------------------------------------- */

function Tabs({
  current,
  onChange,
}: {
  current: TabKey;
  onChange: (t: TabKey) => void;
}) {
  const tabs: { key: TabKey; label: string }[] = [
    { key: 'geral', label: 'Geral' },
    { key: 'hosts', label: 'Hosts & Vozes' },
    { key: 'advanced', label: 'Avançado' },
  ];

  return (
    <div
      role="tablist"
      style={{
        display: 'flex',
        gap: 4,
        borderBottom: '2px solid var(--stroke)',
        marginBottom: 4,
      }}
    >
      {tabs.map((t) => {
        const active = current === t.key;
        return (
          <button
            key={t.key}
            role="tab"
            type="button"
            aria-selected={active}
            onClick={() => onChange(t.key)}
            style={{
              padding: '12px 16px',
              background: 'transparent',
              border: 'none',
              borderBottom: active
                ? '3px solid var(--lime-500)'
                : '3px solid transparent',
              color: active ? 'var(--text)' : 'var(--text-dim)',
              fontFamily: 'var(--font-body)',
              fontSize: 13,
              fontWeight: 800,
              cursor: 'pointer',
              marginBottom: -2,
              minHeight: 44,
            }}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Tab: Geral                                                                 */
/* -------------------------------------------------------------------------- */

function GeralTab({
  tone,
  voiceMode,
  period,
  onTone,
  onVoiceMode,
  onPeriod,
  disabled,
}: {
  tone: SummaryTone;
  voiceMode: 'single' | 'duo';
  period: '24h' | '7d';
  onTone: (t: SummaryTone) => void;
  onVoiceMode: (v: 'single' | 'duo') => void;
  onPeriod: (p: '24h' | '7d') => void;
  disabled: boolean;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <SegmentField
        label="tom default"
        helpText="aplicado quando o '✨ gerar' do card é clicado sem override."
        value={tone}
        onChange={onTone}
        options={[
          { value: 'fun', label: '🎉 divertido' },
          { value: 'formal', label: '🎩 formal' },
          { value: 'corporate', label: '💼 corporativo' },
        ]}
        disabled={disabled}
      />

      <SegmentField
        label="formato do áudio"
        helpText="duo = Ana+Beto (multi-speaker). solo = narrador único."
        value={voiceMode}
        onChange={onVoiceMode}
        options={[
          { value: 'duo', label: '🎙️🎙️ dupla' },
          { value: 'single', label: '🎙️ solo' },
        ]}
        disabled={disabled}
      />

      <SegmentField
        label="janela default"
        helpText="quanto tempo de mensagens entra no resumo."
        value={period}
        onChange={onPeriod}
        options={[
          { value: '24h', label: 'últimas 24h' },
          { value: '7d', label: 'últimos 7 dias' },
        ]}
        disabled={disabled}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Tab: Hosts                                                                 */
/* -------------------------------------------------------------------------- */

function HostsTab({
  host1,
  host2,
  onHost1,
  onHost2,
  disabled,
}: {
  host1: string;
  host2: string;
  onHost1: (s: string) => void;
  onHost2: (s: string) => void;
  disabled: boolean;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <p style={{ margin: 0, fontSize: 13, color: 'var(--text-dim)' }}>
        nome dos apresentadores. substitui <code>{'{{host1_name}}'}</code> e{' '}
        <code>{'{{host2_name}}'}</code> nos templates de prompt e nos
        prefixos de fala que o TTS multi-speaker usa.
      </p>

      <TextField
        label="nome do apresentador 1"
        value={host1}
        onChange={onHost1}
        placeholder="Ana"
        disabled={disabled}
        maxLength={60}
        helpText="voz feminina por convenção (mapa de TTS)."
      />

      <TextField
        label="nome do apresentador 2"
        value={host2}
        onChange={onHost2}
        placeholder="Beto"
        disabled={disabled}
        maxLength={60}
        helpText="voz masculina por convenção."
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Tab: Advanced                                                              */
/* -------------------------------------------------------------------------- */

function AdvancedTab({
  templateId,
  onTemplateId,
  disabled,
}: {
  templateId: TemplateId;
  onTemplateId: (id: TemplateId) => void;
  disabled: boolean;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <p style={{ margin: 0, fontSize: 13, color: 'var(--text-dim)' }}>
        template de prompt — define o estilo do podcast. cada um produz
        áudios com vibe diferente. o "padrão" mantém o comportamento que
        o grupo já tinha.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {TEMPLATE_IDS.map((id) => {
          const t = TEMPLATES[id];
          const selected = templateId === id;
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => !disabled && onTemplateId(id)}
              disabled={disabled}
              style={{
                textAlign: 'left',
                padding: 14,
                border: selected
                  ? '2.5px solid var(--lime-500)'
                  : '2.5px solid var(--stroke)',
                borderRadius: 'var(--radius-md)',
                background: selected
                  ? 'rgba(198, 255, 60, 0.08)'
                  : 'var(--surface)',
                color: 'var(--text)',
                cursor: disabled ? 'wait' : 'pointer',
                boxShadow: selected
                  ? '4px 4px 0 var(--lime-500)'
                  : '2px 2px 0 var(--stroke)',
                display: 'flex',
                alignItems: 'flex-start',
                gap: 10,
                fontFamily: 'var(--font-body)',
              }}
            >
              <span style={{ fontSize: 22, flexShrink: 0 }}>{t.emoji}</span>
              <span
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                  minWidth: 0,
                }}
              >
                <strong style={{ fontSize: 14 }}>{t.label}</strong>
                <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>
                  {t.description}
                </span>
                <span
                  style={{
                    fontSize: 10,
                    fontFamily: 'var(--font-mono)',
                    color: 'var(--text-dim)',
                    opacity: 0.6,
                  }}
                >
                  {id} · voz: {t.voiceMode}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <details style={{ marginTop: 4 }}>
        <summary
          style={{
            cursor: 'pointer',
            fontSize: 12,
            fontWeight: 700,
            color: 'var(--text-dim)',
          }}
        >
          variáveis disponíveis nos templates
        </summary>
        <ul
          style={{
            marginTop: 8,
            paddingLeft: 20,
            fontSize: 12,
            color: 'var(--text-dim)',
            lineHeight: 1.7,
          }}
        >
          <li>
            <code>{'{{group_name}}'}</code> — nome deste grupo
          </li>
          <li>
            <code>{'{{host1_name}}'}</code> — nome do apresentador 1
          </li>
          <li>
            <code>{'{{host2_name}}'}</code> — nome do apresentador 2
          </li>
        </ul>
      </details>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Generic field components                                                    */
/* -------------------------------------------------------------------------- */

function SegmentField<T extends string>({
  label,
  helpText,
  value,
  onChange,
  options,
  disabled,
}: {
  label: string;
  helpText?: string;
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
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

function TextField({
  label,
  value,
  onChange,
  placeholder,
  disabled,
  maxLength,
  helpText,
}: {
  label: string;
  value: string;
  onChange: (s: string) => void;
  placeholder?: string;
  disabled: boolean;
  maxLength?: number;
  helpText?: string;
}) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
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
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        maxLength={maxLength}
        style={{
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
        }}
      />
      {helpText && (
        <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>
          {helpText}
        </span>
      )}
    </label>
  );
}
