'use client';

import { useEffect, useState, type ReactNode } from 'react';

import { Drawer } from '../ui/Drawer';
import { AdminSidebar, type AdminSidebarProps } from './AdminSidebar';
import { MobileHeader } from './MobileHeader';

/**
 * Responsive shell for `/admin/*`. Mirrors `AppShell` but without a
 * BottomNav — superadmin tooling has fewer "primary" routes (4 sections),
 * and stacking another fixed nav adds more chrome than value. The drawer
 * still surfaces the full nav on mobile via the hamburger.
 *
 * Body `data-shell="fixed"` is also set here so the desktop overflow lock
 * behaves the same as the tenant app.
 */
export interface AdminShellProps extends AdminSidebarProps {
  children: ReactNode;
}

export function AdminShell({ children, ...sidebarProps }: AdminShellProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);

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
        minHeight: '100dvh',
        background: 'var(--bg)',
        color: 'var(--text)',
      }}
    >
      <MobileHeader
        admin
        title="Painel admin"
        onOpenDrawer={() => setDrawerOpen(true)}
      />

      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <div data-desktop-only data-as="flex" style={{ flexShrink: 0 }}>
          <AdminSidebar {...sidebarProps} />
        </div>

        <main
          style={{
            flex: 1,
            minWidth: 0,
            overflowY: 'auto',
          }}
        >
          {children}
        </main>
      </div>

      <div data-mobile-only>
        <Drawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          label="Menu de navegação admin"
        >
          <AdminSidebar {...sidebarProps} />
        </Drawer>
      </div>
    </div>
  );
}

export default AdminShell;
