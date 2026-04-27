'use client';

import { useState, type FormEvent } from 'react';

import { Modal } from '@/components/ui/Modal';
import { TEMPLATES, TEMPLATE_IDS, type TemplateId } from '@/lib/summary/templates';
import {
  FEMININE_VOICES,
  MASCULINE_VOICES,
  VOICES,
  type VoiceId,
} from '@/lib/audios/voices';
import { MUSIC_IDS, MUSIC_TRACKS, type MusicId } from '@/lib/audios/music';
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
  const [overrideEnabled, setOverrideEnabled] = useState<boolean>(
    () => !!group.promptOverride,
  );
  const [overrideText, setOverrideText] = useState<string>(
    group.promptOverride ?? '',
  );
  const [voice1, setVoice1] = useState<VoiceId>(group.voice1Id);
  const [voice2, setVoice2] = useState<VoiceId>(group.voice2Id);
  const [music, setMusic] = useState<MusicId>(group.backgroundMusic);
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
    if (voice1 !== group.voice1Id) patch.voice1Id = voice1;
    if (voice2 !== group.voice2Id) patch.voice2Id = voice2;
    if (music !== group.backgroundMusic) patch.backgroundMusic = music;
    if (templateId !== group.promptTemplateId)
      patch.promptTemplateId = templateId;

    // promptOverride: 3 casos
    //   1) overrideEnabled=false: limpa via null (se tinha valor antes)
    //   2) overrideEnabled=true, texto inalterado: pula
    //   3) overrideEnabled=true, texto novo: envia trim()
    const currentOverride = group.promptOverride ?? '';
    const nextOverride = overrideEnabled ? overrideText.trim() : '';
    if (overrideEnabled && nextOverride !== currentOverride) {
      patch.promptOverride = nextOverride;
    } else if (!overrideEnabled && group.promptOverride) {
      patch.promptOverride = null;
    }
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
    if (overrideEnabled) {
      const len = overrideText.trim().length;
      if (len < 100 || len > 6000) {
        setError(
          `prompt customizado precisa ter entre 100 e 6000 caracteres (atual: ${len})`,
        );
        return;
      }
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
            music={music}
            onTone={setTone}
            onVoiceMode={setVoiceMode}
            onPeriod={setPeriod}
            onMusic={setMusic}
            disabled={submitting}
          />
        )}

        {tab === 'hosts' && (
          <HostsTab
            host1={host1}
            host2={host2}
            voice1={voice1}
            voice2={voice2}
            onHost1={setHost1}
            onHost2={setHost2}
            onVoice1={setVoice1}
            onVoice2={setVoice2}
            disabled={submitting}
          />
        )}

        {tab === 'advanced' && (
          <AdvancedTab
            templateId={templateId}
            onTemplateId={setTemplateId}
            overrideEnabled={overrideEnabled}
            overrideText={overrideText}
            host1={host1}
            host2={host2}
            groupName={group.name || '(sem nome)'}
            onOverrideEnabled={setOverrideEnabled}
            onOverrideText={setOverrideText}
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
  music,
  onTone,
  onVoiceMode,
  onPeriod,
  onMusic,
  disabled,
}: {
  tone: SummaryTone;
  voiceMode: 'single' | 'duo';
  period: '24h' | '7d';
  music: MusicId;
  onTone: (t: SummaryTone) => void;
  onVoiceMode: (v: 'single' | 'duo') => void;
  onPeriod: (p: '24h' | '7d') => void;
  onMusic: (m: MusicId) => void;
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

      <MusicPicker
        value={music}
        onChange={onMusic}
        disabled={disabled}
      />
    </div>
  );
}

function MusicPicker({
  value,
  onChange,
  disabled,
}: {
  value: MusicId;
  onChange: (id: MusicId) => void;
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
        música de fundo
      </span>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
          gap: 8,
        }}
      >
        {MUSIC_IDS.map((id) => {
          const m = MUSIC_TRACKS[id];
          const selected = value === id;
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => !disabled && onChange(id)}
              disabled={disabled}
              title={m.description}
              style={{
                textAlign: 'left',
                padding: 10,
                border: selected
                  ? '2.5px solid var(--yellow-500)'
                  : '2px solid var(--stroke)',
                borderRadius: 'var(--radius-md)',
                background: selected
                  ? 'rgba(255, 200, 40, 0.12)'
                  : 'var(--surface)',
                color: 'var(--text)',
                cursor: disabled ? 'wait' : 'pointer',
                boxShadow: selected
                  ? '2px 2px 0 var(--yellow-500)'
                  : '1px 1px 0 var(--stroke)',
                fontFamily: 'var(--font-body)',
                display: 'flex',
                gap: 8,
                alignItems: 'flex-start',
                minWidth: 0,
              }}
            >
              <span style={{ fontSize: 18, flexShrink: 0 }}>{m.emoji}</span>
              <span
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 2,
                  minWidth: 0,
                }}
              >
                <strong style={{ fontSize: 12 }}>{m.label}</strong>
                <span
                  style={{
                    fontSize: 10,
                    color: 'var(--text-dim)',
                    lineHeight: 1.3,
                  }}
                >
                  {m.description}
                </span>
              </span>
            </button>
          );
        })}
      </div>
      <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>
        💡 tracks novas (chillout/upbeat/epic/lofi) precisam dos arquivos
        em <code>assets/</code> — antes disso o sistema cai no padrão.
      </span>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Tab: Hosts                                                                 */
/* -------------------------------------------------------------------------- */

function HostsTab({
  host1,
  host2,
  voice1,
  voice2,
  onHost1,
  onHost2,
  onVoice1,
  onVoice2,
  disabled,
}: {
  host1: string;
  host2: string;
  voice1: VoiceId;
  voice2: VoiceId;
  onHost1: (s: string) => void;
  onHost2: (s: string) => void;
  onVoice1: (v: VoiceId) => void;
  onVoice2: (v: VoiceId) => void;
  disabled: boolean;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <p style={{ margin: 0, fontSize: 13, color: 'var(--text-dim)' }}>
        nome + voz de cada apresentador. nome substitui{' '}
        <code>{'{{host1_name}}'}</code> e <code>{'{{host2_name}}'}</code>{' '}
        nos templates; voz é mapeada no TTS multi-speaker do Gemini.
      </p>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          padding: 14,
          border: '2.5px solid var(--pink-500)',
          background: 'rgba(255, 61, 165, 0.05)',
          borderRadius: 'var(--radius-md)',
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontWeight: 800,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color: 'var(--pink-500)',
          }}
        >
          🎙️ apresentador 1 (host1)
        </span>
        <TextField
          label="nome"
          value={host1}
          onChange={onHost1}
          placeholder="Ana"
          disabled={disabled}
          maxLength={60}
        />
        <VoicePicker
          label="voz"
          value={voice1}
          onChange={onVoice1}
          options={[...FEMININE_VOICES, ...MASCULINE_VOICES]}
          recommended={FEMININE_VOICES}
          disabled={disabled}
          accent="pink"
        />
      </div>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          padding: 14,
          border: '2.5px solid var(--purple-600)',
          background: 'rgba(91, 43, 232, 0.05)',
          borderRadius: 'var(--radius-md)',
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontWeight: 800,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color: 'var(--purple-600)',
          }}
        >
          🎙️ apresentador 2 (host2)
        </span>
        <TextField
          label="nome"
          value={host2}
          onChange={onHost2}
          placeholder="Beto"
          disabled={disabled}
          maxLength={60}
        />
        <VoicePicker
          label="voz"
          value={voice2}
          onChange={onVoice2}
          options={[...MASCULINE_VOICES, ...FEMININE_VOICES]}
          recommended={MASCULINE_VOICES}
          disabled={disabled}
          accent="purple"
        />
      </div>
    </div>
  );
}

function VoicePicker({
  label,
  value,
  onChange,
  options,
  recommended,
  disabled,
  accent,
}: {
  label: string;
  value: VoiceId;
  onChange: (v: VoiceId) => void;
  options: VoiceId[];
  recommended: VoiceId[];
  disabled: boolean;
  accent: 'pink' | 'purple';
}) {
  const accentColor =
    accent === 'pink' ? 'var(--pink-500)' : 'var(--purple-600)';
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
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
          gap: 8,
        }}
      >
        {options.map((id) => {
          const v = VOICES[id];
          const selected = value === id;
          const isRecommended = recommended.includes(id);
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => !disabled && onChange(id)}
              disabled={disabled}
              style={{
                textAlign: 'left',
                padding: 10,
                border: selected
                  ? `2.5px solid ${accentColor}`
                  : '2px solid var(--stroke)',
                borderRadius: 'var(--radius-md)',
                background: selected
                  ? accent === 'pink'
                    ? 'rgba(255, 61, 165, 0.12)'
                    : 'rgba(91, 43, 232, 0.12)'
                  : 'var(--surface)',
                color: 'var(--text)',
                cursor: disabled ? 'wait' : 'pointer',
                boxShadow: selected
                  ? `2px 2px 0 ${accentColor}`
                  : '1px 1px 0 var(--stroke)',
                fontFamily: 'var(--font-body)',
                display: 'flex',
                gap: 8,
                alignItems: 'flex-start',
                opacity: !isRecommended && !selected ? 0.65 : 1,
                minWidth: 0,
              }}
              title={v.description}
            >
              <span style={{ fontSize: 18, flexShrink: 0 }}>{v.emoji}</span>
              <span
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 2,
                  minWidth: 0,
                }}
              >
                <strong
                  style={{
                    fontSize: 13,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {v.label}
                </strong>
                <span
                  style={{
                    fontSize: 10,
                    color: 'var(--text-dim)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {v.gender}
                </span>
              </span>
            </button>
          );
        })}
      </div>
      <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>
        💡 {recommended.length === 4 ? 'recomendados primeiro' : ''} —
        qualquer voz funciona em qualquer host.
      </span>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Tab: Advanced                                                              */
/* -------------------------------------------------------------------------- */

function AdvancedTab({
  templateId,
  onTemplateId,
  overrideEnabled,
  overrideText,
  host1,
  host2,
  groupName,
  onOverrideEnabled,
  onOverrideText,
  disabled,
}: {
  templateId: TemplateId;
  onTemplateId: (id: TemplateId) => void;
  overrideEnabled: boolean;
  overrideText: string;
  host1: string;
  host2: string;
  groupName: string;
  onOverrideEnabled: (v: boolean) => void;
  onOverrideText: (v: string) => void;
  disabled: boolean;
}) {
  // Preview: substitui as vars no texto pra o user ver o resultado final.
  const previewText = overrideEnabled
    ? overrideText
        .split('{{group_name}}')
        .join(groupName)
        .split('{{host1_name}}')
        .join(host1)
        .split('{{host2_name}}')
        .join(host2)
    : '';

  const charCount = overrideText.trim().length;
  const charCountColor =
    !overrideEnabled
      ? 'var(--text-dim)'
      : charCount < 100 || charCount > 6000
        ? 'var(--red-500)'
        : 'var(--lime-500)';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <p style={{ margin: 0, fontSize: 13, color: 'var(--text-dim)' }}>
        template de prompt — define o estilo do podcast. cada um produz
        áudios com vibe diferente. o "padrão" mantém o comportamento que
        o grupo já tinha.
      </p>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          opacity: overrideEnabled ? 0.5 : 1,
          pointerEvents: overrideEnabled ? 'none' : 'auto',
        }}
        aria-disabled={overrideEnabled}
      >
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
              disabled={disabled || overrideEnabled}
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
                cursor:
                  disabled || overrideEnabled ? 'not-allowed' : 'pointer',
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

      <div
        style={{
          marginTop: 4,
          paddingTop: 16,
          borderTop: '2px dashed var(--stroke)',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        <label
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 10,
            padding: 12,
            background: overrideEnabled
              ? 'rgba(255, 61, 165, 0.08)'
              : 'var(--bg-2)',
            border: overrideEnabled
              ? '2.5px solid var(--pink-500)'
              : '2.5px solid var(--stroke)',
            borderRadius: 'var(--radius-md)',
            cursor: disabled ? 'wait' : 'pointer',
          }}
        >
          <input
            type="checkbox"
            checked={overrideEnabled}
            onChange={(e) => onOverrideEnabled(e.target.checked)}
            disabled={disabled}
            style={{
              width: 18,
              height: 18,
              accentColor: 'var(--pink-500)',
              flexShrink: 0,
              marginTop: 2,
            }}
          />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 800 }}>
              ⚡ usar prompt customizado (power user)
            </div>
            <div
              style={{
                fontSize: 11,
                color: 'var(--text-dim)',
                marginTop: 4,
                lineHeight: 1.5,
              }}
            >
              substitui o template acima por um texto livre. usa{' '}
              <code>{'{{group_name}}'}</code>, <code>{'{{host1_name}}'}</code>{' '}
              e <code>{'{{host2_name}}'}</code> como placeholders. ative
              só se você sabe o que tá fazendo — prompt mal escrito pode
              quebrar o JSON de saída e custar Gemini à toa.
            </div>
          </div>
        </label>

        {overrideEnabled && (
          <>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 800,
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                  color: 'var(--text-dim)',
                  display: 'flex',
                  justifyContent: 'space-between',
                }}
              >
                <span>system prompt</span>
                <span style={{ color: charCountColor, fontFamily: 'var(--font-mono)' }}>
                  {charCount}/6000
                </span>
              </span>
              <textarea
                value={overrideText}
                onChange={(e) => onOverrideText(e.target.value)}
                disabled={disabled}
                rows={10}
                maxLength={6000}
                placeholder={`Você é o apresentador do podcast "{{group_name}}".\n\nFormato:\n{{host1_name}}: ...\n{{host2_name}}: ...\n\nRegras:\n- ...\n\nIMPORTANTE: cada linha de fala começa com "{{host1_name}}:" ou "{{host2_name}}:" seguido de um espaço.`}
                style={{
                  padding: '12px 14px',
                  border: '2.5px solid var(--stroke)',
                  borderRadius: 'var(--radius-md)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 12,
                  background: 'var(--surface)',
                  color: 'var(--text)',
                  boxShadow: '2px 2px 0 var(--stroke)',
                  outline: 'none',
                  width: '100%',
                  boxSizing: 'border-box',
                  resize: 'vertical',
                  minHeight: 200,
                }}
              />
            </label>

            <details style={{ marginTop: 0 }}>
              <summary
                style={{
                  cursor: 'pointer',
                  fontSize: 11,
                  fontWeight: 800,
                  color: 'var(--text-dim)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                }}
              >
                preview com vars substituídas
              </summary>
              <pre
                style={{
                  marginTop: 8,
                  padding: 12,
                  background: 'var(--bg-2)',
                  border: '2px solid var(--stroke)',
                  borderRadius: 'var(--radius-md)',
                  fontSize: 11,
                  fontFamily: 'var(--font-mono)',
                  color: 'var(--text)',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  maxHeight: 300,
                  overflowY: 'auto',
                }}
              >
                {previewText || '(vazio)'}
              </pre>
            </details>
          </>
        )}
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
          variáveis disponíveis
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
