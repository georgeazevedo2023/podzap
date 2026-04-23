import { notFound } from 'next/navigation';

import { TopBar } from '@/components/shell/TopBar';
import { getTenantAdmin } from '@/lib/admin/tenants';
import { listAllUsers } from '@/lib/admin/users';
import { listAllInstances } from '@/lib/admin/uazapi';

import { TenantDetailClient } from './TenantDetailClient';

/**
 * Tenant detail — server component. Fetches the tenant, its members (from
 * `listAllUsers()` filtered to this tenant), and its instance row (via the
 * cross-tenant UAZAPI listing filtered to this tenant).
 *
 * 404 when the id doesn't exist. Renders a read-only instance panel when
 * one is attached, with a deep-link to `/admin/uazapi` for detach. For
 * tenants without an instance, shows a CTA to the uazapi screen.
 */
export default async function TenantDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const tenant = await getTenantAdmin(id);
  if (!tenant) {
    notFound();
  }

  // Fetch members + instance in parallel; both reads are independent.
  const [allUsers, allInstances] = await Promise.all([
    listAllUsers().catch(
      () => [] as Awaited<ReturnType<typeof listAllUsers>>,
    ),
    listAllInstances().catch(
      () => [] as Awaited<ReturnType<typeof listAllInstances>>,
    ),
  ]);

  // Flatten the user -> membership list to a single row per member of THIS
  // tenant, carrying the tenant-specific role so the detail shell doesn't
  // have to cross-reference again.
  const members = allUsers
    .map((u) => {
      const m = u.tenants.find((t) => t.tenantId === id);
      if (!m) return null;
      return { ...u, tenantRole: m.role };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  const instance =
    allInstances.find((i) => i.attachedTenantId === id) ?? null;

  return (
    <div style={{ minHeight: '100vh' }}>
      <TopBar
        title={tenant.name}
        subtitle={`criado em ${formatDate(tenant.createdAt)} · ${tenant.memberCount} ${tenant.memberCount === 1 ? 'membro' : 'membros'}`}
        accent="purple"
        breadcrumb={<a href="/admin/tenants" style={{ color: 'inherit' }}>← tenants</a>}
      />

      <div
        style={{
          padding: '28px 36px 40px',
          maxWidth: 1240,
        }}
      >
        <TenantDetailClient tenant={tenant} members={members} />

        {/* Instance panel — read-only here; mutations live in /admin/uazapi */}
        <section style={{ marginTop: 28 }}>
          <h2
            style={{
              margin: '0 0 12px',
              fontFamily: 'var(--font-display)',
              fontSize: 22,
              fontWeight: 800,
            }}
          >
            instância WhatsApp
          </h2>
          {instance ? (
            <div
              className="card"
              style={{ padding: 20, display: 'flex', gap: 20, flexWrap: 'wrap' }}
            >
              <div style={{ flex: 1, minWidth: 220 }}>
                <div
                  style={{
                    fontSize: 10,
                    fontWeight: 800,
                    letterSpacing: '0.1em',
                    textTransform: 'uppercase',
                    color: 'var(--text-dim)',
                    marginBottom: 4,
                  }}
                >
                  nome UAZAPI
                </div>
                <div style={{ fontSize: 15, fontWeight: 700 }}>
                  {instance.name}
                </div>
              </div>
              <div style={{ flex: 1, minWidth: 160 }}>
                <div
                  style={{
                    fontSize: 10,
                    fontWeight: 800,
                    letterSpacing: '0.1em',
                    textTransform: 'uppercase',
                    color: 'var(--text-dim)',
                    marginBottom: 4,
                  }}
                >
                  status
                </div>
                <InstanceStatusPill status={instance.status} />
              </div>
              <div style={{ flex: 1, minWidth: 160 }}>
                <div
                  style={{
                    fontSize: 10,
                    fontWeight: 800,
                    letterSpacing: '0.1em',
                    textTransform: 'uppercase',
                    color: 'var(--text-dim)',
                    marginBottom: 4,
                  }}
                >
                  telefone
                </div>
                <div
                  style={{
                    fontSize: 14,
                    fontFamily: 'var(--font-mono)',
                  }}
                >
                  {instance.phone ?? '—'}
                </div>
              </div>
              <a
                href="/admin/uazapi"
                className="btn btn-ghost"
                style={{ alignSelf: 'center' }}
              >
                gerenciar →
              </a>
            </div>
          ) : (
            <div
              className="card"
              style={{
                padding: 20,
                display: 'flex',
                gap: 16,
                alignItems: 'center',
                flexWrap: 'wrap',
              }}
            >
              <div style={{ fontSize: 34 }}>📵</div>
              <div style={{ flex: 1, minWidth: 220 }}>
                <div style={{ fontSize: 15, fontWeight: 700 }}>
                  nenhuma instância atribuída
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>
                  vincula uma instância UAZAPI pra esse tenant poder usar
                  grupos, resumos e podcasts.
                </div>
              </div>
              <a href="/admin/uazapi" className="btn btn-zap">
                atribuir instância →
              </a>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function InstanceStatusPill({
  status,
}: {
  status: 'connected' | 'connecting' | 'disconnected';
}) {
  const bg =
    status === 'connected'
      ? 'var(--lime-500)'
      : status === 'connecting'
        ? 'var(--yellow-500)'
        : 'var(--bg-2)';
  const label =
    status === 'connected'
      ? '● conectado'
      : status === 'connecting'
        ? '◐ conectando'
        : '○ offline';
  return (
    <span
      style={{
        padding: '3px 10px',
        borderRadius: 'var(--radius-pill)',
        border: '2px solid var(--stroke)',
        background: bg,
        color: 'var(--ink-900)',
        fontSize: 12,
        fontWeight: 800,
      }}
    >
      {label}
    </span>
  );
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}
