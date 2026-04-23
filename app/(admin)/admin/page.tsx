import { createAdminClient } from '@/lib/supabase/admin';
import { listAllTenants } from '@/lib/admin/tenants';
import { listAllUsers } from '@/lib/admin/users';
import { listAllInstances } from '@/lib/admin/uazapi';
import { TopBar } from '@/components/shell/TopBar';
import { StatCard } from '@/components/ui/StatCard';
import { Sticker } from '@/components/ui/Sticker';

/**
 * Admin dashboard landing — high-signal overview for the superadmin.
 *
 * Four stat cards + three quick links. Zero interactive state lives on
 * this page; every CTA is a plain `<a>` that navigates to the relevant
 * management screen.
 *
 * Counts are pulled in parallel. The superadmins count comes straight
 * from `superadmins` via the admin client (bypasses RLS) because the
 * admin services don't wrap that particular table.
 */
export default async function AdminDashboardPage() {
  const [tenants, users, instances, superadminCount] = await Promise.all([
    listAllTenants().catch(() => [] as Awaited<ReturnType<typeof listAllTenants>>),
    listAllUsers().catch(() => [] as Awaited<ReturnType<typeof listAllUsers>>),
    listAllInstances().catch(
      () => [] as Awaited<ReturnType<typeof listAllInstances>>,
    ),
    countSuperadmins(),
  ]);

  const attachedCount = instances.filter((i) => i.attachedTenantId).length;
  const unattachedCount = instances.length - attachedCount;
  const suspendedCount = tenants.filter((t) => !t.isActive).length;

  return (
    <div style={{ minHeight: '100vh' }}>
      <TopBar
        title="Superadmin"
        subtitle="painel administrativo — gestão de tenants, usuários e instâncias"
        accent="pink"
        breadcrumb="podZAP · Fase 13"
        actions={<Sticker variant="lime">⚡ modo god</Sticker>}
      />

      <div
        style={{
          padding: '28px 36px 40px',
          display: 'flex',
          flexDirection: 'column',
          gap: 24,
          maxWidth: 1240,
        }}
      >
        {/* Stat grid — 4-up on desktop, collapses via wrap on narrow */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: 16,
          }}
        >
          <StatCard
            label="tenants"
            value={String(tenants.length)}
            accent="purple"
            icon="🏢"
          />
          <StatCard
            label="usuários"
            value={String(users.length)}
            accent="pink"
            icon="👥"
          />
          <StatCard
            label="instâncias atribuídas"
            value={String(attachedCount)}
            accent="lime"
            icon="🔌"
          />
          <StatCard
            label="instâncias livres"
            value={String(unattachedCount)}
            accent="yellow"
            icon="🆓"
          />
        </div>

        {/* Secondary stats row */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: 16,
          }}
        >
          <MiniStat label="tenants suspensos" value={suspendedCount} />
          <MiniStat label="superadmins" value={superadminCount} />
          <MiniStat
            label="instâncias (total)"
            value={instances.length}
          />
        </div>

        {/* Quick actions */}
        <section
          className="card"
          style={{
            padding: 24,
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
          }}
        >
          <h2
            style={{
              margin: 0,
              fontFamily: 'var(--font-display)',
              fontSize: 22,
              fontWeight: 800,
              letterSpacing: '-0.02em',
            }}
          >
            atalhos
          </h2>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: 12,
            }}
          >
            <QuickLink
              href="/admin/tenants"
              emoji="🏢"
              title="novo tenant"
              desc="cria um espaço novo"
            />
            <QuickLink
              href="/admin/users"
              emoji="👤"
              title="novo usuário"
              desc="convida com email e senha"
            />
            <QuickLink
              href="/admin/uazapi"
              emoji="⚡"
              title="atribuir instância"
              desc="vincula UAZAPI a tenant"
            />
          </div>
        </section>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Bits                                                                       */
/* -------------------------------------------------------------------------- */

async function countSuperadmins(): Promise<number> {
  try {
    const supabase = createAdminClient();
    const { count, error } = await supabase
      .from('superadmins')
      .select('user_id', { count: 'exact', head: true });
    if (error) return 0;
    return count ?? 0;
  } catch {
    return 0;
  }
}

function MiniStat({ label, value }: { label: string; value: number }) {
  return (
    <div
      style={{
        padding: 16,
        border: '2.5px solid var(--stroke)',
        borderRadius: 'var(--radius-md)',
        background: 'var(--surface)',
        boxShadow: 'var(--shadow-chunk)',
      }}
    >
      <div
        style={{
          fontSize: 10,
          fontWeight: 800,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: 'var(--text-dim)',
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: 28,
          fontWeight: 800,
          marginTop: 4,
          letterSpacing: '-0.02em',
        }}
      >
        {value}
      </div>
    </div>
  );
}

function QuickLink({
  href,
  emoji,
  title,
  desc,
}: {
  href: string;
  emoji: string;
  title: string;
  desc: string;
}) {
  return (
    <a
      href={href}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: 14,
        border: '2.5px solid var(--stroke)',
        borderRadius: 'var(--radius-md)',
        background: 'var(--bg-2)',
        boxShadow: '2px 2px 0 var(--stroke)',
        textDecoration: 'none',
        color: 'var(--text)',
        transition: 'transform 0.1s ease',
      }}
    >
      <div style={{ fontSize: 28 }}>{emoji}</div>
      <div>
        <div style={{ fontSize: 14, fontWeight: 800 }}>{title}</div>
        <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>{desc}</div>
      </div>
    </a>
  );
}
