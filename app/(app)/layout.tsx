import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { AppSidebar } from '@/components/shell/AppSidebar';
import type { WhatsappStatus } from '@/components/shell/Sidebar';
import { createAdminClient } from '@/lib/supabase/admin';
import { getCurrentUserAndTenant } from '@/lib/tenant';

/**
 * Fetches the tenant's current WhatsApp instance (if any) and derives the
 * status tuple for the sidebar indicator.
 *
 * Uses the admin client on purpose:
 *   - The sidebar indicator needs to be visible even when the user's RLS
 *     role would hide the row (unlikely in Fase 2, but cheap to be safe).
 *   - We already trust the current session (authorised in the same request
 *     via `getCurrentUserAndTenant`), so scoping the query by `tenant_id`
 *     on the server is sufficient.
 *
 * The query is O(1) — single row by tenant_id, smallest possible projection.
 *
 * Errors (network, serialization, etc.) degrade to `'none'` — the sidebar
 * must never block the rest of the layout.
 */
async function fetchWhatsappState(
  tenantId: string,
): Promise<{ status: WhatsappStatus; phone: string | null }> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from('whatsapp_instances')
      .select('status, phone')
      .eq('tenant_id', tenantId)
      .limit(1)
      .maybeSingle();

    if (error || !data) {
      return { status: 'none', phone: null };
    }

    // DB enum is `disconnected | connecting | qrcode | connected`. The UI
    // collapses `qrcode` into `connecting` (both mean "mid-handshake").
    const raw = data.status;
    const status: WhatsappStatus =
      raw === 'connected'
        ? 'connected'
        : raw === 'connecting' || raw === 'qrcode'
          ? 'connecting'
          : 'disconnected';

    return { status, phone: data.phone ?? null };
  } catch {
    return { status: 'none', phone: null };
  }
}

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
  const whatsapp = await fetchWhatsappState(tenant.id);

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
        whatsappStatus={whatsapp.status}
        whatsappPhone={whatsapp.phone}
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
