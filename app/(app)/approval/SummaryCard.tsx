import Link from 'next/link';

import type { SummaryView } from '@/lib/summaries/service';

/**
 * Chunky card used in the `/approval` list — Fase 8.
 *
 * Server component on purpose: zero interaction beyond the `<Link>` click
 * target, so we render fully on the server and let Next handle navigation.
 *
 * Layout (top → bottom):
 *   1. Group sticker + tone sticker
 *   2. Text preview (first 200 chars, ellipsis if truncated)
 *   3. Metadata row (relative created_at · period · status pill)
 *
 * The whole card is wrapped in a single `<Link>` so the click target is
 * the entire surface, not just a tiny button — matches the approval mockup
 * vibe (big chunky tappable blocks).
 */
export interface SummaryCardProps {
  summary: SummaryView;
}

const PREVIEW_MAX = 200;

/**
 * Tone badge styling — each tone maps to an existing design token so we
 * don't introduce new colors. `formal = purple`, `fun = lime`,
 * `corporate = yellow` per the task brief.
 */
const TONE_STYLE: Record<
  SummaryView['tone'],
  { label: string; bg: string; fg: string; emoji: string }
> = {
  formal: {
    label: 'formal',
    bg: 'var(--purple-600)',
    fg: '#fff',
    emoji: '🎩',
  },
  fun: {
    label: 'divertido',
    bg: 'var(--lime-500)',
    fg: 'var(--ink-900)',
    emoji: '🎉',
  },
  corporate: {
    label: 'corporativo',
    bg: 'var(--yellow-500)',
    fg: 'var(--ink-900)',
    emoji: '💼',
  },
};

const STATUS_STYLE: Record<
  SummaryView['status'],
  { label: string; bg: string; fg: string; emoji: string }
> = {
  pending_review: {
    label: 'pendente',
    bg: 'var(--yellow-500)',
    fg: 'var(--ink-900)',
    emoji: '⏳',
  },
  approved: {
    label: 'aprovado',
    bg: 'var(--zap-500)',
    fg: '#fff',
    emoji: '✅',
  },
  rejected: {
    label: 'rejeitado',
    bg: 'var(--pink-500)',
    fg: '#fff',
    emoji: '❌',
  },
};

/**
 * Format `created_at` as a short relative timestamp in pt-BR. Pure function
 * so we can render it on the server without a locale library. Handles:
 *   - just now (< 1min)
 *   - N min atrás (< 1h)
 *   - N h atrás (< 24h)
 *   - N d atrás (< 30d)
 *   - dd/mm (>= 30d)
 */
function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '—';
  const diffMs = Date.now() - then;
  const min = Math.floor(diffMs / 60_000);
  if (min < 1) return 'agora';
  if (min < 60) return `${min}min atrás`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `${hrs}h atrás`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d atrás`;
  const d = new Date(iso);
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}`;
}

/**
 * Format the period range as `dd/mm – dd/mm` (or single date if identical).
 * Summaries always carry both ends from the upstream service.
 */
function formatPeriod(startIso: string, endIso: string): string {
  const fmt = (iso: string): string => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    const dd = String(d.getUTCDate()).padStart(2, '0');
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    return `${dd}/${mm}`;
  };
  const s = fmt(startIso);
  const e = fmt(endIso);
  return s === e ? s : `${s} – ${e}`;
}

/**
 * Collapse whitespace and truncate at `PREVIEW_MAX` chars. We break on a
 * word boundary when possible so the ellipsis doesn't cut mid-word.
 */
function buildPreview(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= PREVIEW_MAX) return flat;
  const slice = flat.slice(0, PREVIEW_MAX);
  const lastSpace = slice.lastIndexOf(' ');
  const cut = lastSpace > PREVIEW_MAX - 40 ? slice.slice(0, lastSpace) : slice;
  return `${cut}…`;
}

export function SummaryCard({ summary }: SummaryCardProps) {
  const tone = TONE_STYLE[summary.tone];
  const status = STATUS_STYLE[summary.status];
  const preview = buildPreview(summary.text);
  const relCreated = formatRelative(summary.createdAt);
  const period = formatPeriod(summary.periodStart, summary.periodEnd);
  const groupLabel = summary.groupName ?? 'grupo sem nome';

  return (
    <Link
      href={`/approval/${summary.id}`}
      className="card"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
        padding: 20,
        textDecoration: 'none',
        color: 'var(--text)',
        transition: 'transform 0.08s ease, box-shadow 0.08s ease',
        minHeight: 220,
      }}
    >
      {/* Top row — group + tone stickers */}
      <div
        style={{
          display: 'flex',
          gap: 8,
          flexWrap: 'wrap',
          alignItems: 'center',
        }}
      >
        <span
          className="sticker"
          style={{
            background: 'var(--bg-2)',
            color: 'var(--text)',
            maxWidth: '100%',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
          title={groupLabel}
        >
          💬 {groupLabel}
        </span>
        <span
          className="sticker"
          style={{ background: tone.bg, color: tone.fg }}
        >
          {tone.emoji} {tone.label}
        </span>
      </div>

      {/* Middle — text preview */}
      <div
        style={{
          flex: 1,
          fontFamily: 'var(--font-mono)',
          fontSize: 13,
          lineHeight: 1.55,
          color: 'var(--text-dim)',
          background: 'var(--bg-2)',
          border: '2px dashed var(--stroke)',
          borderRadius: 'var(--radius-md)',
          padding: 14,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        {preview}
      </div>

      {/* Bottom — metadata row */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          flexWrap: 'wrap',
          fontSize: 11,
          fontWeight: 600,
          color: 'var(--text-dim)',
          letterSpacing: '0.03em',
          textTransform: 'uppercase',
        }}
      >
        <span>{relCreated}</span>
        <span aria-hidden>·</span>
        <span>📅 {period}</span>
        <div style={{ flex: 1 }} />
        <span
          className="sticker"
          style={{ background: status.bg, color: status.fg }}
        >
          {status.emoji} {status.label}
        </span>
      </div>
    </Link>
  );
}

export default SummaryCard;
