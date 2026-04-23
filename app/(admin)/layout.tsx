import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { AdminSidebar } from '@/components/shell/AdminSidebar';
import { requireSuperadmin } from '@/lib/tenant';

/**
 * Protected layout for the superadmin route group — everything under
 * `/admin/*` renders inside this shell.
 *
 * Auth:
 *   - `requireSuperadmin()` checks the session cookie + the `superadmins`
 *     table via the service-role admin client.
 *   - Non-authenticated users get redirected to `/login`.
 *   - Authenticated-but-not-superadmin users get redirected to `/home` with
 *     an error flash.
 *
 * The `proxy.ts` matcher also guards `/admin` as a belt-and-suspenders layer;
 * this server check is the authoritative gate. If the helper returns a
 * redirect response (constructed for API routes), we forward the same
 * decision via `next/navigation`'s `redirect()` helper so the browser
 * navigates cleanly instead of seeing a raw Response body.
 *
 * Dark theme: applied via `data-theme="dark"` on the wrapper — same pattern
 * as `app/(app)/layout.tsx`. Keeps `/login` and the landing page on the
 * default light palette while every admin route renders dark.
 */
export default async function AdminLayout({
  children,
}: {
  children: ReactNode;
}) {
  const guard = await requireSuperadmin();

  if ('response' in guard) {
    // Translate the Response-level redirect into a Next-level redirect so
    // React Server Components unwind cleanly. The URL was baked by
    // `requireSuperadmin()` using `NEXT_PUBLIC_APP_URL`.
    const location = guard.response.headers.get('location');
    redirect(location ?? '/login');
  }

  const { user } = guard;

  return (
    <div
      data-theme="dark"
      style={{
        display: 'flex',
        minHeight: '100vh',
        background: 'var(--bg)',
        color: 'var(--text)',
      }}
    >
      <AdminSidebar userEmail={user.email} />
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
