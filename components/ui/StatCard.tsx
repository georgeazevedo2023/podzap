import type { CSSProperties, ReactNode } from 'react';

/**
 * Small stat card used on the home dashboard. 4 accent colors; foreground
 * is auto-selected for contrast (white on purple/pink, ink on lime/yellow).
 *
 * Pure server component — no interactivity.
 */
export type StatAccent = 'lime' | 'pink' | 'yellow' | 'purple';

export type StatCardProps = {
  label: string;
  value: string;
  accent: StatAccent;
  /** Optional emoji or short glyph rendered in the top-right. */
  icon?: ReactNode;
};

const ACCENT_BG: Record<StatAccent, string> = {
  lime: 'var(--color-lime-500)',
  pink: 'var(--color-pink-500)',
  yellow: 'var(--color-yellow-500)',
  purple: 'var(--color-purple-600)',
};

const ACCENT_FG: Record<StatAccent, string> = {
  lime: 'var(--color-ink-900)',
  pink: '#ffffff',
  yellow: 'var(--color-ink-900)',
  purple: '#ffffff',
};

export function StatCard({
  label,
  value,
  accent,
  icon,
}: StatCardProps): React.ReactElement {
  const style: CSSProperties = {
    background: ACCENT_BG[accent],
    color: ACCENT_FG[accent],
    border: '2.5px solid var(--color-stroke)',
    borderRadius: 'var(--radius-md)',
    boxShadow: 'var(--shadow-chunk)',
    padding: 16,
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    minHeight: 96,
    position: 'relative',
  };

  return (
    <div style={style}>
      {icon !== undefined && (
        <div
          style={{
            position: 'absolute',
            top: 12,
            right: 12,
            fontSize: 20,
            lineHeight: 1,
          }}
          aria-hidden
        >
          {icon}
        </div>
      )}
      <div
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 10,
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.14em',
          opacity: 0.85,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: 32,
          fontWeight: 800,
          lineHeight: 1,
          letterSpacing: '-0.02em',
        }}
      >
        {value}
      </div>
    </div>
  );
}

export default StatCard;
