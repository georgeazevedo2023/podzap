'use client';

/**
 * Sticky mobile header with hamburger trigger + brand mark. Visible only
 * below the `md` breakpoint via the `data-mobile-only` attribute (the
 * parent layout hides it via CSS at md+).
 *
 * Owns no state — receives `onOpenDrawer` from the layout, which also owns
 * the drawer instance. Keeping the trigger in the header (rather than the
 * BottomNav) means it's always reachable with one thumb regardless of
 * scroll position.
 *
 * Brand mark is a compact mirror of the sidebar logo (purple square with
 * the studio mic), sized for ~48px header height.
 */
export interface MobileHeaderProps {
  onOpenDrawer: () => void;
  /** Optional title rendered next to the logo (e.g. current route). */
  title?: string;
  /** When true, swap the purple brand mark for the pink "admin" variant. */
  admin?: boolean;
}

export function MobileHeader({
  onOpenDrawer,
  title,
  admin = false,
}: MobileHeaderProps) {
  const brandColor = admin ? 'var(--pink-500)' : 'var(--purple-600)';
  const brandGlyph = admin ? '⚡' : '🎙';

  return (
    <header
      data-mobile-only
      data-as="flex"
      style={{
        // `display` intentionally omitted — globals.css controls it via
        // `[data-mobile-only][data-as="flex"]` so the desktop hide rule wins.
        position: 'sticky',
        top: 0,
        zIndex: 30,
        alignItems: 'center',
        gap: 12,
        height: 56,
        padding: '0 12px',
        paddingTop: 'var(--safe-top)',
        paddingLeft: 'calc(12px + var(--safe-left))',
        paddingRight: 'calc(12px + var(--safe-right))',
        background: 'var(--surface)',
        borderBottom: '2.5px solid var(--stroke)',
      }}
    >
      <button
        type="button"
        onClick={onOpenDrawer}
        aria-label="Abrir menu"
        aria-haspopup="dialog"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 44,
          height: 44,
          borderRadius: 12,
          border: '2.5px solid var(--stroke)',
          background: 'var(--bg-2)',
          color: 'var(--text)',
          boxShadow: '2px 2px 0 var(--stroke)',
          cursor: 'pointer',
          flexShrink: 0,
        }}
      >
        <svg
          viewBox="0 0 24 24"
          width={22}
          height={22}
          aria-hidden
          focusable={false}
        >
          <path
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            d="M4 7h16M4 12h16M4 17h16"
          />
        </svg>
      </button>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        <div
          aria-hidden
          style={{
            width: 32,
            height: 32,
            borderRadius: 10,
            background: brandColor,
            border: '2.5px solid var(--stroke)',
            display: 'grid',
            placeItems: 'center',
            boxShadow: '2px 2px 0 var(--stroke)',
            transform: 'rotate(-4deg)',
            flexShrink: 0,
          }}
        >
          <span
            style={{
              color: '#fff',
              fontFamily: 'var(--font-brand)',
              fontSize: 16,
            }}
          >
            {brandGlyph}
          </span>
        </div>
        <div style={{ minWidth: 0, lineHeight: 1.05 }}>
          <div
            style={{
              fontFamily: 'var(--font-brand)',
              fontSize: 18,
              color: 'var(--text)',
              letterSpacing: '-0.02em',
            }}
          >
            {admin ? 'super' : 'pod'}
            <span
              style={{
                color: 'var(--pink-500)',
                textShadow: '1.5px 1.5px 0 var(--stroke)',
              }}
            >
              {admin ? 'admin' : 'ZAP'}
            </span>
          </div>
          {title && (
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: 'var(--text-dim)',
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {title}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

export default MobileHeader;
