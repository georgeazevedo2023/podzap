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
/**
 * Counts summaries in `pending_review` state for the sidebar badge.
 *
 * Uses a `head: true, count: 'exact'` query — we don't need the rows, just
 * the number. Admin client is fine here for the same reason `fetchWhatsappState`
 * uses it: the caller's tenant was already resolved + authorised upstream,
 * and we scope the WHERE by `tenant_id` on the server.
 *
 * Graceful degradation: any error (schema drift, network hiccup, RLS surprise)
 * returns `0` so the sidebar never blocks the layout — a missing badge is
 * always preferable to a broken shell.
 */
async function fetchPendingApprovalsCount(tenantId: string): Promise<number> {
  try {
    const admin = createAdminClient();
    const { count, error } = await admin
      .from('summaries')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('status', 'pending_review');

    if (error) return 0;
    return count ?? 0;
  } catch {
    return 0;
  }
}

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
  // Parallelise the two sidebar-scoped fetches — they're independent and
  // both block the layout render.
  const [whatsapp, pendingApprovals] = await Promise.all([
    fetchWhatsappState(tenant.id),
    fetchPendingApprovalsCount(tenant.id),
  ]);

  return (
    // `data-theme="dark"` flips the semantic tokens (--bg, --surface, --text,
    // --stroke, shadow) declared in `app/globals.css`. Applying it on the
    // wrapper (not <html>) keeps `/login`, `/auth/*`, and the landing page
    // on the default light palette while every `(app)` route renders dark.
    <div
      data-theme="dark"
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
        pendingApprovals={pendingApprovals}
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
