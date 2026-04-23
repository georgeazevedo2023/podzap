import { TopBar } from '@/components/shell/TopBar';
import { listAllTenants } from '@/lib/admin/tenants';

import { TenantsTable } from './TenantsTable';

/**
 * Tenants management — lists every tenant in the system with inline actions
 * (suspend / reactivate / delete) and a "+ novo tenant" modal.
 *
 * Server component: fetches the list via `listAllTenants()` and hands it
 * off to a client shell (`TenantsTable`) that owns modals + mutations.
 */
export default async function AdminTenantsPage() {
  const tenants = await listAllTenants();

  return (
    <div style={{ minHeight: '100vh' }}>
      <TopBar
        title="Tenants"
        subtitle={`${tenants.length} no total · gestão cross-tenant`}
        accent="purple"
        breadcrumb="admin"
      />

      <div
        style={{
          padding: '28px 36px 40px',
          maxWidth: 1240,
        }}
      >
        <TenantsTable tenants={tenants} />
      </div>
    </div>
  );
}
