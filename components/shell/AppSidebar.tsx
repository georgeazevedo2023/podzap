'use client';

import { usePathname, useRouter } from 'next/navigation';
import { Sidebar, type NavId, type WhatsappStatus } from './Sidebar';

/**
 * Route table for the sidebar nav. Each `NavId` maps to a URL under the
 * `(app)` route group. Keep this in sync with the `PROTECTED` list in
 * `proxy.ts` — routes here must all be gated behind auth.
 */
const ROUTES: Record<NavId, string> = {
  home: '/home',
  groups: '/groups',
  approval: '/approval',
  history: '/history',
  schedule: '/schedule',
  onboarding: '/onboarding',
  settings: '/settings',
};

/**
 * Derives the active `NavId` from the current pathname. Defaults to `home`
 * when the pathname doesn't match any known route (e.g. deep sub-pages).
 */
function pathToNavId(pathname: string): NavId {
  // Match the longest prefix — more specific routes win.
  let best: NavId = 'home';
  let bestLen = -1;
  (Object.keys(ROUTES) as NavId[]).forEach((id) => {
    const base = ROUTES[id];
    if (pathname === base || pathname.startsWith(`${base}/`)) {
      if (base.length > bestLen) {
        best = id;
        bestLen = base.length;
      }
    }
  });
  return best;
}

export interface AppSidebarProps {
  userEmail: string;
  tenantName: string;
  tenantPlan: string;
  /**
   * Current WhatsApp connection status for the tenant. The server layout
   * resolves this via `whatsapp_instances` (admin client) so RLS doesn't
   * accidentally hide the row; falls back to `'none'` if no instance exists
   * or the fetch threw.
   */
  whatsappStatus?: WhatsappStatus;
  /** Phone attached to the connected instance, when available. */
  whatsappPhone?: string | null;
  /**
   * Count of summaries in `pending_review` state for the current tenant.
   * Drives the numeric badge on the "Aprovação" nav entry. `0` (or omitted)
   * renders without a badge.
   *
   * Resolved server-side in `app/(app)/layout.tsx` so the number refreshes on
   * every navigation without any client polling.
   */
  pendingApprovals?: number;
}

/**
 * Client wrapper that plugs the server-rendered layout into the existing
 * (client-only) `Sidebar` component. Owns route <-> nav-id translation and
 * uses `next/navigation` for in-app nav.
 */
export function AppSidebar({
  userEmail,
  tenantName,
  tenantPlan,
  whatsappStatus,
  whatsappPhone,
  pendingApprovals,
}: AppSidebarProps) {
  const pathname = usePathname() ?? '/home';
  const router = useRouter();
  const current = pathToNavId(pathname);

  return (
    <Sidebar
      current={current}
      onNav={(id) => router.push(ROUTES[id])}
      userEmail={userEmail}
      tenantName={tenantName}
      tenantPlan={tenantPlan}
      whatsappStatus={whatsappStatus}
      whatsappPhone={whatsappPhone}
      pendingApprovals={pendingApprovals}
    />
  );
}

export default AppSidebar;
