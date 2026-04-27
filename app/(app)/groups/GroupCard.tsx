'use client';

import { useEffect, useState } from 'react';

import { TEMPLATES } from '@/lib/summary/templates';
import type { GroupView } from '@/lib/groups/service';

export interface GroupCardProps {
  group: GroupView;
  onToggle: (on: boolean) => void;
  isToggling: boolean;
  /**
   * Callback do "✨ gerar agora" — 1-clique, usa os defaults do grupo
   * (tom, voiceMode, período). Se a chamada falhar, o pai mostra o erro
   * no banner global da `/groups` page.
   */
  onQuickGenerate?: (group: GroupView) => void;
  /** True enquanto o POST está em voo pra travar duplo clique. */
  isGenerating?: boolean;
  /** Callback quando user clica "✎ editar" — abre EditGroupModal no pai. */
  onEdit?: (group: GroupView) => void;
  /** Callback quando user clica "📋 duplicar" — abre DuplicateConfigModal. */
  onDuplicate?: (group: GroupView) => void;
}

/**
 * Chunky neo-brutalist card for a single WhatsApp group.
 *
 * Estados visuais:
 *   - `is_monitored=false` → card cinza, fundo bg-2, border 2.5px stroke,
 *     conteúdo mínimo (avatar + nome + sub).
 *   - `is_monitored=true` → card lime accent, border 3px lime, shadow lime,
 *     stats inline (msgs/podcasts/último), ações inline (gerar/editar/
 *     duplicar), footer com template+hosts. Pode ser RECOLHIDO pra um
 *     único line via state local persistido em sessionStorage.
 *
 * Recolher persiste em sessionStorage (key por groupId) — quando o user
 * troca de página + volta, o estado de cada card é restaurado. Não
 * usamos localStorage de propósito: queremos que abrir uma sessão nova
 * mostre tudo expandido (default).
 */
export function GroupCard({
  group,
  onToggle,
  isToggling,
  onQuickGenerate,
  isGenerating = false,
  onEdit,
  onDuplicate,
}: GroupCardProps) {
  const on = group.isMonitored;
  const recentCount = group.recentMessageCount ?? null;
  const summaryCount = group.summaryCount ?? null;
  const lastSummaryAt = group.lastSummaryAt ?? null;
  const canGenerate = on && recentCount !== null && recentCount >= 3;
  const template = TEMPLATES[group.promptTemplateId];

  const [collapsed, setCollapsed] = useState<boolean>(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const v = window.sessionStorage.getItem(`groupcard_collapsed:${group.id}`);
      if (v === '1') setCollapsed(true);
    } catch {
      // sessionStorage indisponível — ok, fica default expandido.
    }
  }, [group.id]);

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        if (typeof window !== 'undefined') {
          if (next) {
            window.sessionStorage.setItem(
              `groupcard_collapsed:${group.id}`,
              '1',
            );
          } else {
            window.sessionStorage.removeItem(
              `groupcard_collapsed:${group.id}`,
            );
          }
        }
      } catch {
        // segue mesmo sem persistência.
      }
      return next;
    });
  }

  const handleCardClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (isToggling) return;
    const target = event.target as HTMLElement;
    if (
      target.closest('[data-toggle-btn]') ||
      target.closest('[data-generate-btn]') ||
      target.closest('[data-edit-btn]') ||
      target.closest('[data-msgs-btn]') ||
      target.closest('[data-duplicate-btn]') ||
      target.closest('[data-collapse-btn]') ||
      target.closest('[data-card-config]')
    ) {
      return;
    }
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
        border: on
          ? '3px solid var(--lime-500)'
          : '2.5px solid var(--stroke)',
        borderRadius: 'var(--radius-lg)',
        padding: 16,
        boxShadow: on
          ? '4px 4px 0 var(--lime-500)'
          : '2px 2px 0 var(--stroke)',
        cursor: isToggling ? 'wait' : 'pointer',
        transition:
          'box-shadow 0.12s ease, transform 0.12s ease, opacity 0.12s ease, border-color 0.12s ease',
        position: 'relative',
        opacity: isToggling ? 0.6 : 1,
        outline: 'none',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
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
              color: 'var(--text)',
              fontStyle: group.name ? 'normal' : 'italic',
              opacity: group.name ? 1 : 0.55,
            }}
            title={group.name || '(sem nome)'}
          >
            {group.name || '(sem nome)'}
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

      {on && !collapsed && (
        <>
          <StatsGrid
            msgs24h={recentCount}
            podcasts={summaryCount}
            lastSummaryAt={lastSummaryAt}
          />

          <ActionsRow
            group={group}
            canGenerate={canGenerate}
            isGenerating={isGenerating}
            onQuickGenerate={onQuickGenerate}
            onEdit={onEdit}
            onDuplicate={onDuplicate}
            templateLabel={template.label}
          />

          <ConfigFooter
            templateEmoji={template.emoji}
            templateLabel={template.label}
            host1={group.host1Name}
            host2={group.host2Name}
            period={group.defaultPeriod}
            voiceMode={group.defaultVoiceMode}
            onCollapse={toggleCollapsed}
          />
        </>
      )}

      {on && collapsed && (
        <CollapsedFooter
          msgs24h={recentCount}
          podcasts={summaryCount}
          templateEmoji={template.emoji}
          templateLabel={template.label}
          onExpand={toggleCollapsed}
        />
      )}
    </div>
  );
}

export default GroupCard;

/* -------------------------------------------------------------------------- */
/* Stats grid (msgs hoje · podcasts · último)                                 */
/* -------------------------------------------------------------------------- */

function StatsGrid({
  msgs24h,
  podcasts,
  lastSummaryAt,
}: {
  msgs24h: number | null;
  podcasts: number | null;
  lastSummaryAt: string | null;
}) {
  return (
    <div
      style={{
        marginTop: 12,
        paddingTop: 12,
        borderTop: '2px dashed var(--stroke)',
        display: 'grid',
        gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
        gap: 8,
      }}
    >
      <Stat
        label="msgs hoje"
        value={msgs24h === null ? '—' : msgs24h.toString()}
        accent={
          msgs24h !== null && msgs24h >= 10
            ? 'lime'
            : msgs24h !== null && msgs24h >= 3
              ? 'pink'
              : 'muted'
        }
      />
      <Stat
        label="podcasts"
        value={podcasts === null ? '—' : podcasts.toString()}
        accent={podcasts !== null && podcasts > 0 ? 'purple' : 'muted'}
      />
      <Stat
        label="último"
        value={lastSummaryAt ? formatRelative(lastSummaryAt) : '—'}
        accent={lastSummaryAt ? 'yellow' : 'muted'}
      />
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent: 'lime' | 'pink' | 'purple' | 'yellow' | 'muted';
}) {
  const accentColor =
    accent === 'lime'
      ? 'var(--lime-500)'
      : accent === 'pink'
        ? 'var(--pink-500)'
        : accent === 'purple'
          ? 'var(--purple-600)'
          : accent === 'yellow'
            ? 'var(--yellow-500)'
            : 'var(--text-dim)';
  return (
    <div
      style={{
        background: 'var(--bg-2)',
        border: '2px solid var(--stroke)',
        borderRadius: 'var(--radius-md)',
        padding: '8px 10px',
        boxShadow: '2px 2px 0 var(--stroke)',
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        minWidth: 0,
      }}
    >
      <div
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: 18,
          fontWeight: 800,
          color: accentColor,
          lineHeight: 1.05,
          letterSpacing: '-0.02em',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {value}
      </div>
      <div
        style={{
          fontSize: 9,
          fontWeight: 700,
          color: 'var(--text-dim)',
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
        }}
      >
        {label}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Actions row (gerar · msgs · editar · duplicar)                             */
/* -------------------------------------------------------------------------- */

function ActionsRow({
  group,
  canGenerate,
  isGenerating,
  onQuickGenerate,
  onEdit,
  onDuplicate,
  templateLabel,
}: {
  group: GroupView;
  canGenerate: boolean;
  isGenerating: boolean;
  onQuickGenerate?: (g: GroupView) => void;
  onEdit?: (g: GroupView) => void;
  onDuplicate?: (g: GroupView) => void;
  templateLabel: string;
}) {
  return (
    <div
      style={{
        marginTop: 10,
        display: 'flex',
        gap: 6,
        flexWrap: 'wrap',
      }}
    >
      {onQuickGenerate && (
        <button
          type="button"
          data-generate-btn
          onClick={(e) => {
            e.stopPropagation();
            if (!isGenerating && canGenerate) onQuickGenerate(group);
          }}
          disabled={isGenerating || !canGenerate}
          className="btn"
          style={{
            background: canGenerate ? 'var(--lime-500)' : 'var(--bg-2)',
            color: canGenerate ? 'var(--ink-900)' : 'var(--text-dim)',
            border: '2.5px solid var(--stroke)',
            borderRadius: 'var(--radius-pill)',
            padding: '8px 14px',
            fontFamily: 'var(--font-body)',
            fontSize: 12,
            fontWeight: 800,
            cursor: isGenerating
              ? 'wait'
              : canGenerate
                ? 'pointer'
                : 'not-allowed',
            boxShadow: canGenerate
              ? '2px 2px 0 var(--stroke)'
              : '1px 1px 0 var(--stroke)',
            opacity: isGenerating ? 0.6 : canGenerate ? 1 : 0.55,
            minHeight: 44,
          }}
          title={
            canGenerate
              ? `${templateLabel} · ${group.host1Name}+${group.host2Name} · ${group.defaultPeriod}`
              : 'precisa de pelo menos 3 mensagens nas últimas 24h pra gerar'
          }
          aria-label={`Gerar resumo agora pro grupo ${group.name}`}
        >
          {isGenerating ? '⟳ gerando...' : '✨ gerar'}
        </button>
      )}

      <a
        href={`/history?groupId=${encodeURIComponent(group.id)}`}
        data-msgs-btn
        onClick={(e) => e.stopPropagation()}
        className="btn btn-ghost btn-tap"
        style={{
          fontSize: 12,
          padding: '8px 14px',
          textDecoration: 'none',
        }}
        title={`Ver histórico de podcasts de ${group.name}`}
      >
        📜 histórico
      </a>

      {onEdit && (
        <button
          type="button"
          data-edit-btn
          onClick={(e) => {
            e.stopPropagation();
            onEdit(group);
          }}
          className="btn btn-ghost btn-tap"
          style={{ fontSize: 12, padding: '8px 14px' }}
          aria-label={`Editar configuração de ${group.name}`}
        >
          ✎ editar
        </button>
      )}

      {onDuplicate && (
        <button
          type="button"
          data-duplicate-btn
          onClick={(e) => {
            e.stopPropagation();
            onDuplicate(group);
          }}
          className="btn btn-ghost btn-tap"
          style={{ fontSize: 12, padding: '8px 14px' }}
          aria-label={`Duplicar config de ${group.name} pra outro grupo`}
          title="Copia template + hosts + defaults pra outros grupos"
        >
          📋 duplicar
        </button>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Config footer (template + hosts + voice + period + recolher)                */
/* -------------------------------------------------------------------------- */

function ConfigFooter({
  templateEmoji,
  templateLabel,
  host1,
  host2,
  period,
  voiceMode,
  onCollapse,
}: {
  templateEmoji: string;
  templateLabel: string;
  host1: string;
  host2: string;
  period: '24h' | '7d';
  voiceMode: 'single' | 'duo';
  onCollapse: () => void;
}) {
  return (
    <div
      data-card-config
      style={{
        marginTop: 10,
        paddingTop: 10,
        borderTop: '1px solid var(--stroke)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
        fontSize: 11,
        color: 'var(--text-dim)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          flexWrap: 'wrap',
          minWidth: 0,
          flex: 1,
        }}
      >
        <span
          aria-hidden
          style={{ fontSize: 14, flexShrink: 0 }}
        >
          {templateEmoji}
        </span>
        <span
          style={{
            fontWeight: 700,
            color: 'var(--text)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            maxWidth: 140,
          }}
        >
          {templateLabel}
        </span>
        <span style={{ opacity: 0.6 }}>·</span>
        <span style={{ whiteSpace: 'nowrap' }}>
          {host1}+{host2}
        </span>
        <span style={{ opacity: 0.6 }}>·</span>
        <span style={{ whiteSpace: 'nowrap' }}>
          {period} · {voiceMode === 'duo' ? 'dupla' : 'solo'}
        </span>
      </div>
      <button
        type="button"
        data-collapse-btn
        onClick={(e) => {
          e.stopPropagation();
          onCollapse();
        }}
        aria-label="Recolher card"
        style={{
          background: 'transparent',
          border: '2px solid var(--stroke)',
          borderRadius: 'var(--radius-pill)',
          padding: '4px 10px',
          fontSize: 10,
          fontWeight: 800,
          color: 'var(--text-dim)',
          cursor: 'pointer',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          minHeight: 28,
          flexShrink: 0,
        }}
      >
        ↑ recolher
      </button>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Collapsed footer (single line summary)                                      */
/* -------------------------------------------------------------------------- */

function CollapsedFooter({
  msgs24h,
  podcasts,
  templateEmoji,
  templateLabel,
  onExpand,
}: {
  msgs24h: number | null;
  podcasts: number | null;
  templateEmoji: string;
  templateLabel: string;
  onExpand: () => void;
}) {
  return (
    <div
      data-card-config
      style={{
        marginTop: 10,
        paddingTop: 10,
        borderTop: '1px dashed var(--stroke)',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        fontSize: 11,
        color: 'var(--text-dim)',
      }}
    >
      <span style={{ flex: 1, display: 'flex', gap: 8, minWidth: 0 }}>
        <span aria-hidden>{templateEmoji}</span>
        <span
          style={{
            fontWeight: 700,
            color: 'var(--text)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {templateLabel}
        </span>
        <span style={{ opacity: 0.6, whiteSpace: 'nowrap' }}>
          · {msgs24h ?? 0} msgs · {podcasts ?? 0} pods
        </span>
      </span>
      <button
        type="button"
        data-collapse-btn
        onClick={(e) => {
          e.stopPropagation();
          onExpand();
        }}
        aria-label="Expandir card"
        style={{
          background: 'transparent',
          border: '2px solid var(--stroke)',
          borderRadius: 'var(--radius-pill)',
          padding: '4px 10px',
          fontSize: 10,
          fontWeight: 800,
          color: 'var(--text-dim)',
          cursor: 'pointer',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          minHeight: 28,
          flexShrink: 0,
        }}
      >
        ↓ expandir
      </button>
    </div>
  );
}

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
        // Tap target hit area >=44 via padding interno + posicionamento
        // do dot. Visual continua compacto (48×28) mas a área clicável é
        // 48×44 graças ao padding-y de 8.
        width: 48,
        height: 28,
        minWidth: 44,
        minHeight: 28,
        boxSizing: 'content-box',
        paddingTop: 8,
        paddingBottom: 8,
        marginTop: -8,
        marginBottom: -8,
        borderRadius: 999,
        background: on ? 'var(--lime-500)' : 'var(--ink-500)',
        border: '2.5px solid var(--stroke)',
        cursor: disabled ? 'wait' : 'pointer',
        transition: 'background 0.15s ease',
        boxShadow: '2px 2px 0 var(--stroke)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'flex-start',
      }}
    >
      <span
        aria-hidden
        style={{
          display: 'block',
          width: 18,
          height: 18,
          marginLeft: 2,
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
