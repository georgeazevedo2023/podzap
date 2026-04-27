'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

import { Icons } from '../icons/Icons';

/**
 * Mobile bottom navigation. Visible only below the `md` breakpoint
 * (`<48rem` / 768px). Provides one-tap access to the four routes the
 * tenant uses most:
 *   - Home (dashboard / context)
 *   - Aprovar (clique humano #1 — gate that turns a summary into audio)
 *   - Podcasts (clique humano #2 — manual send to WhatsApp via SendToMenu)
 *   - Mais (drawer trigger — opens the full sidebar with the long tail)
 *
 * Active state mirrors the sidebar's longest-prefix match so deep routes
 * like `/approval/[id]` still highlight "Aprovar".
 *
 * The "Mais" item is a button (not a link); the parent owns the drawer
 * state and is notified via `onMore`.
 */
export interface BottomNavProps {
  pendingApprovals?: number;
  /** Whether the drawer is currently open — used to highlight "Mais". */
  drawerOpen?: boolean;
  onMore: () => void;
}

interface BottomNavItem {
  label: string;
  href?: string;
  /** Pathname prefix for active match. */
  match?: string;
  icon: ReactNode;
  badge?: number;
  onClick?: () => void;
  /** Forces "active" regardless of pathname (used by the drawer trigger). */
  forceActive?: boolean;
}

export function BottomNav({
  pendingApprovals,
  drawerOpen = false,
  onMore,
}: BottomNavProps) {
  const pathname = usePathname() ?? '/home';
  const approvalBadge =
    pendingApprovals && pendingApprovals > 0 ? pendingApprovals : undefined;

  const items: BottomNavItem[] = [
    {
      label: 'Home',
      href: '/home',
      match: '/home',
      icon: <Icons.Home />,
    },
    {
      label: 'Aprovar',
      href: '/approval',
      match: '/approval',
      icon: <Icons.Check />,
      badge: approvalBadge,
    },
    {
      label: 'Podcasts',
      href: '/podcasts',
      match: '/podcasts',
      icon: <Icons.Play />,
    },
    {
      label: 'Mais',
      icon: <MenuIcon />,
      onClick: onMore,
      forceActive: drawerOpen,
    },
  ];

  return (
    <nav
      aria-label="Navegação principal"
      data-mobile-only
      data-as="flex"
      style={{
        // `display` controlled by globals.css `[data-mobile-only][data-as="flex"]`
        // so the rule properly hides the bar at md+. Setting `display: flex`
        // inline would beat the desktop `display: none` rule.
        position: 'fixed',
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 40,
        background: 'var(--surface)',
        borderTop: '2.5px solid var(--stroke)',
        // Honor iOS home indicator inset so the row doesn't sit on top of it.
        paddingBottom: 'var(--safe-bottom)',
        paddingLeft: 'var(--safe-left)',
        paddingRight: 'var(--safe-right)',
      }}
    >
      {items.map((item) => {
        const active =
          item.forceActive ??
          (item.match
            ? pathname === item.match || pathname.startsWith(`${item.match}/`)
            : false);
        const content = (
          <>
            <span
              style={{
                position: 'relative',
                display: 'grid',
                placeItems: 'center',
                width: 28,
                height: 28,
                color: active ? 'var(--accent)' : 'var(--text)',
              }}
            >
              {item.icon}
              {item.badge && (
                <span
                  aria-label={`${item.badge} pendentes`}
                  style={{
                    position: 'absolute',
                    top: -4,
                    right: -8,
                    minWidth: 18,
                    height: 18,
                    padding: '0 5px',
                    borderRadius: 999,
                    background: 'var(--pink-500)',
                    color: '#fff',
                    fontSize: 10,
                    fontWeight: 800,
                    lineHeight: '18px',
                    textAlign: 'center',
                    border: '1.5px solid var(--stroke)',
                  }}
                >
                  {item.badge > 9 ? '9+' : item.badge}
                </span>
              )}
            </span>
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                marginTop: 2,
                color: active ? 'var(--accent)' : 'var(--text-dim)',
                letterSpacing: '0.01em',
              }}
            >
              {item.label}
            </span>
          </>
        );

        const sharedStyle: React.CSSProperties = {
          flex: 1,
          // 56px is the floor — content (icon 28 + label ~14) + 14 vertical
          // padding lands the tap area at 56–60px, comfortably above the
          // 44px WCAG minimum.
          minHeight: 56,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '8px 4px',
          background: active ? 'var(--bg-2)' : 'transparent',
          border: 'none',
          borderTop: active
            ? '2.5px solid var(--accent)'
            : '2.5px solid transparent',
          cursor: 'pointer',
          textDecoration: 'none',
          transition: 'background 0.12s ease',
          fontFamily: 'var(--font-body)',
        };

        if (item.href) {
          return (
            <a
              key={item.label}
              href={item.href}
              style={sharedStyle}
              aria-current={active ? 'page' : undefined}
            >
              {content}
            </a>
          );
        }
        return (
          <button
            key={item.label}
            type="button"
            onClick={item.onClick}
            style={sharedStyle}
            aria-pressed={active}
            aria-haspopup="dialog"
            aria-expanded={drawerOpen}
          >
            {content}
          </button>
        );
      })}
    </nav>
  );
}

/* Hamburger / "more" icon — kept inline since Icons.tsx doesn't ship one and
   it's only used in the mobile shell. */
function MenuIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={20}
      height={20}
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
  );
}

export default BottomNav;
