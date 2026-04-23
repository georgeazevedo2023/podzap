import { TopBar } from '@/components/shell/TopBar';
import { listAllTenants } from '@/lib/admin/tenants';
import { listAllUsers } from '@/lib/admin/users';

import { UsersTable } from './UsersTable';

/**
 * Users management — lists every auth user + their memberships. Lets a
 * superadmin create new users (email+password+initial tenant), reset
 * passwords, toggle the superadmin flag, and hard-delete.
 *
 * The tenants list is loaded here so the "new user" modal can offer a
 * dropdown without a second round trip.
 */
export default async function AdminUsersPage() {
  const [users, tenants] = await Promise.all([
    listAllUsers(),
    listAllTenants(),
  ]);

  return (
    <div style={{ minHeight: '100vh' }}>
      <TopBar
        title="Usuários"
        subtitle={`${users.length} no total · cria, reseta senha e promove`}
        accent="pink"
        breadcrumb="admin"
      />

      <div
        style={{
          padding: '28px 36px 40px',
          maxWidth: 1240,
        }}
      >
        <UsersTable users={users} tenants={tenants} />
      </div>
    </div>
  );
}
