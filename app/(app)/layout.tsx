import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { AppSidebar } from '@/components/shell/AppSidebar';
import { getCurrentUserAndTenant } from '@/lib/tenant';

/**
 * Protected layout for every route under the `(app)` route group.
 *
 * Auth enforcement lives here (rather than in `proxy.ts`) for two reasons:
 *   1. The layout already needs the full `user + tenant` server fetch to render
 *      the sidebar — re-running auth in the proxy would duplicate the round
 *      trip for every request.
 *   2. Server components can `redirect()` safely. The proxy still calls
 *      `updateSession()` on every request to keep cookies fresh, but redirect
 *      decisions tied to tenant membership belong next to the data fetch.
 *
 * If the user is not authenticated OR has no tenant membership, we redirect
 * to `/login` with a friendly error. The signup trigger (`handle_new_user`)
 * creates the tenant automatically, so "authenticated but no tenant" should
 * only happen during a race right after signup.
 */
export default async function AppLayout({
  children,
}: {
  children: ReactNode;
}) {
  const context = await getCurrentUserAndTenant();

  if (!context) {
    redirect('/login?error=Faça login para continuar');
  }

  const { user, tenant } = context;

  return (
    <div
      style={{
        display: 'flex',
        minHeight: '100vh',
        background: 'var(--bg)',
        color: 'var(--text)',
      }}
    >
      <AppSidebar
        userEmail={user.email}
        tenantName={tenant.name}
        tenantPlan={tenant.plan}
      />
      <main
        style={{
          flex: 1,
          overflowY: 'auto',
          minWidth: 0,
        }}
      >
        {children}
      </main>
    </div>
  );
}
