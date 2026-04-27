'use client';

import { useEffect, useState, type ReactNode } from 'react';

import { Drawer } from '../ui/Drawer';
import { AppSidebar, type AppSidebarProps } from './AppSidebar';
import { BottomNav } from './BottomNav';
import { MobileHeader } from './MobileHeader';

/**
 * Responsive shell for every route under `(app)`. Owns the mobile drawer
 * state and renders two presentations:
 *
 *  - `<md` (≤767px): MobileHeader + main + BottomNav. The Sidebar lives
 *    inside a `Drawer` triggered by the header hamburger or by the "Mais"
 *    item in the bottom nav.
 *  - `≥md` (≥768px): the legacy desktop layout — Sidebar fixed left,
 *    main scrolls. body gets `data-shell="fixed"` so its overflow is
 *    locked (only main scrolls). On mobile we leave body scroll natural so
 *    iOS Safari address-bar collapse works.
 *
 * The desktop and mobile copies of `AppSidebar` render the same component
 * with the same props — duplication is cheap and keeps the implementation
 * declarative. CSS `[data-desktop-only]` / `[data-mobile-only]` toggle which
 * one is visible.
 */
export interface AppShellProps extends AppSidebarProps {
  /**
   * Forwarded server-resolved value used by BottomNav to render the
   * "Aprovar" badge. Same source as the sidebar's badge — kept on the
   * shell so the bottom nav doesn't need its own server fetch.
   */
  pendingApprovals?: number;
  children: ReactNode;
}

export function AppShell({ children, ...sidebarProps }: AppShellProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Tag <body data-shell="fixed"> so the desktop @media rule in globals.css
  // can lock body overflow for the app-shell feel. We toggle on mount so
  // server-rendered pages (e.g. /login) that don't use AppShell stay scrollable.
  useEffect(() => {
    document.body.setAttribute('data-shell', 'fixed');
    return () => {
      document.body.removeAttribute('data-shell');
    };
  }, []);

  return (
    <div
      data-theme="dark"
      style={{
        display: 'flex',
        flexDirection: 'column',
        // 100dvh > 100vh on mobile: dvh excludes the iOS dynamic toolbar so
        // the bottom nav doesn't get hidden behind the address bar collapse.
        // Falls back to 100vh on browsers without dvh support.
        minHeight: '100dvh',
        background: 'var(--bg)',
        color: 'var(--text)',
      }}
    >
      <MobileHeader onOpenDrawer={() => setDrawerOpen(true)} />

      <div
        style={{
          display: 'flex',
          flex: 1,
          minHeight: 0,
        }}
      >
        {/* Desktop persistent sidebar */}
        <div data-desktop-only data-as="flex" style={{ flexShrink: 0 }}>
          <AppSidebar {...sidebarProps} />
        </div>

        {/* Main content. On desktop the parent locks height (via body
           data-shell), so main is the scroll viewport. On mobile body
           scrolls naturally, but we still pad-bottom for the fixed nav. */}
        <main
          style={{
            flex: 1,
            minWidth: 0,
            overflowY: 'auto',
            // Reserve space for the fixed BottomNav. `--bottom-nav-h` is
            // defined in globals.css and collapses to 0 at md+ (where the
            // nav is hidden), so desktop main reclaims the full height.
            paddingBottom: 'var(--bottom-nav-h)',
          }}
        >
          {children}
        </main>
      </div>

      {/* Mobile drawer holds the same sidebar component */}
      <div data-mobile-only>
        <Drawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          label="Menu de navegação"
        >
          <AppSidebar {...sidebarProps} />
        </Drawer>
      </div>

      <BottomNav
        pendingApprovals={sidebarProps.pendingApprovals}
        drawerOpen={drawerOpen}
        onMore={() => setDrawerOpen((v) => !v)}
      />
    </div>
  );
}

export default AppShell;
