import type { ReactNode } from 'react';

export type TopBarAccent = 'purple' | 'pink' | 'lime' | 'yellow' | 'zap';

export interface TopBarProps {
  title: ReactNode;
  subtitle?: ReactNode;
  accent?: TopBarAccent;
  /** Rendered on the right side (buttons, stickers, etc.). */
  actions?: ReactNode;
  /** Eyebrow text above the title. */
  breadcrumb?: ReactNode;
}

const BG_MAP: Record<TopBarAccent, string> = {
  purple: 'var(--purple-600)',
  pink: 'var(--pink-500)',
  lime: 'var(--lime-500)',
  yellow: 'var(--yellow-500)',
  zap: 'var(--zap-500)',
};

export function TopBar({
  title,
  subtitle,
  accent = 'purple',
  actions,
  breadcrumb,
}: TopBarProps) {
  return (
    <div
      style={{
        padding: '26px 36px 22px',
        borderBottom: '2.5px solid var(--stroke)',
        background: 'var(--surface)',
        display: 'flex',
        alignItems: 'center',
        gap: 20,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* accent blob */}
      <div
        style={{
          position: 'absolute',
          right: -40,
          top: -40,
          width: 200,
          height: 200,
          background: BG_MAP[accent],
          borderRadius: '50%',
          opacity: 0.12,
        }}
      />

      <div style={{ flex: 1, zIndex: 2 }}>
        {breadcrumb && (
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              color: 'var(--text-dim)',
              marginBottom: 6,
            }}
          >
            {breadcrumb}
          </div>
        )}
        <h1
          style={{
            margin: 0,
            fontFamily: 'var(--font-display)',
            fontWeight: 800,
            fontSize: 38,
            lineHeight: 1,
            letterSpacing: '-0.025em',
            color: 'var(--text)',
          }}
        >
          {title}
        </h1>
        {subtitle && (
          <div
            style={{
              fontSize: 14,
              color: 'var(--text-dim)',
              marginTop: 8,
              fontWeight: 500,
            }}
          >
            {subtitle}
          </div>
        )}
      </div>
      {actions && (
        <div
          style={{
            display: 'flex',
            gap: 10,
            alignItems: 'center',
            zIndex: 2,
          }}
        >
          {actions}
        </div>
      )}
    </div>
  );
}

export default TopBar;
