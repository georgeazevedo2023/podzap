import { TopBar } from '@/components/shell/TopBar';
import { listAllTenants } from '@/lib/admin/tenants';
import { listAllInstances } from '@/lib/admin/uazapi';

import { UazapiTable } from './UazapiTable';

/**
 * UAZAPI instances screen — full join of:
 *   - every UAZAPI instance (remote API call, admintoken)
 *   - every local `whatsapp_instances` row (DB, admin client)
 * surfaced as a single table so the superadmin sees exactly which instances
 * are free vs already bound to a tenant.
 *
 * Mutations: attach, detach, create-and-attach — all via `/api/admin/uazapi/*`.
 */
export default async function AdminUazapiPage() {
  const [instances, tenants] = await Promise.all([
    listAllInstances(),
    listAllTenants(),
  ]);

  return (
    <div style={{ minHeight: '100vh' }}>
      <TopBar
        title="Instâncias UAZAPI"
        subtitle="cross-tenant · gestão de instâncias WhatsApp"
        accent="lime"
        breadcrumb="admin"
      />

      <div
        style={{
          padding: '28px 36px 40px',
          maxWidth: 1240,
        }}
      >
        <UazapiTable instances={instances} tenants={tenants} />
      </div>
    </div>
  );
}
