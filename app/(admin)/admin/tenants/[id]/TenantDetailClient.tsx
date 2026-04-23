'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import type { TenantAdminView } from '@/lib/admin/tenants';
import type { UserAdminView } from '@/lib/admin/users';

import {
  ModalShell,
  PlanBadge,
  StatusPill,
} from '../TenantsTable';

type MemberRow = UserAdminView & {
  tenantRole: 'owner' | 'admin' | 'member';
};

/**
 * Interactive shell for the tenant detail screen. Wraps the server-
 * rendered summary + members list with mutation handlers (edit, suspend,
 * delete, role change, remove member).
 */
export function TenantDetailClient({
  tenant,
  members,
}: {
  tenant: TenantAdminView;
  members: MemberRow[];
}) {
  const router = useRouter();
  const [modal, setModal] = useState<'edit' | 'delete' | null>(null);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  async function callApi(
    url: string,
    method: 'POST' | 'PATCH' | 'DELETE',
    body?: unknown,
  ): Promise<void> {
    const res = await fetch(url, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store',
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      throw new Error(data?.error?.message ?? `falha (${res.status})`);
    }
  }

  async function toggleSuspend() {
    setBusy(true);
    setFlash(null);
    try {
      await callApi(`/api/admin/tenants/${tenant.id}`, 'PATCH', {
        isActive: !tenant.isActive,
      });
      router.refresh();
    } catch (err) {
      setFlash(err instanceof Error ? err.message : 'erro');
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete() {
    setBusy(true);
    setFlash(null);
    try {
      await callApi(`/api/admin/tenants/${tenant.id}`, 'DELETE');
      router.push('/admin/tenants');
    } catch (err) {
      setFlash(err instanceof Error ? err.message : 'erro');
      setBusy(false);
    }
  }

  async function changeRole(
    userId: string,
    role: 'owner' | 'admin' | 'member',
  ) {
    setBusy(true);
    setFlash(null);
    try {
      await callApi(`/api/admin/users/${userId}`, 'PATCH', {
        tenantId: tenant.id,
        role,
      });
      router.refresh();
    } catch (err) {
      setFlash(err instanceof Error ? err.message : 'erro');
    } finally {
      setBusy(false);
    }
  }

  async function removeMember(userId: string) {
    if (!window.confirm('remover esse membro do tenant?')) return;
    setBusy(true);
    setFlash(null);
    try {
      await callApi(
        `/api/admin/users/${userId}?tenantId=${tenant.id}`,
        'DELETE',
      );
      router.refresh();
    } catch (err) {
      setFlash(err instanceof Error ? err.message : 'erro');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {/* Header actions row */}
      <div
        style={{
          display: 'flex',
          gap: 20,
          alignItems: 'center',
          flexWrap: 'wrap',
          marginBottom: 24,
        }}
      >
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <PlanBadge plan={tenant.plan} />
          <StatusPill active={tenant.isActive} />
        </div>
        <div style={{ flex: 1 }} />
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => setModal('edit')}
          disabled={busy}
        >
          ✎ editar
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={toggleSuspend}
          disabled={busy}
        >
          {tenant.isActive ? '⏸ suspender' : '▶ reativar'}
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => setModal('delete')}
          disabled={busy}
          style={{ color: 'var(--red-500)' }}
        >
          🗑 deletar
        </button>
      </div>

      {flash && (
        <div
          role="alert"
          style={{
            padding: 12,
            border: '2.5px solid var(--red-500)',
            borderRadius: 'var(--radius-md)',
            background: 'rgba(255, 77, 60, 0.08)',
            color: 'var(--red-500)',
            fontSize: 13,
            fontWeight: 600,
            marginBottom: 16,
          }}
        >
          ⚠ {flash}
        </div>
      )}

      {/* Members section */}
      <section style={{ marginBottom: 28 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            marginBottom: 12,
            gap: 12,
          }}
        >
          <h2
            style={{
              margin: 0,
              fontFamily: 'var(--font-display)',
              fontSize: 22,
              fontWeight: 800,
            }}
          >
            membros
          </h2>
          <span style={{ color: 'var(--text-dim)', fontSize: 13 }}>
            ({members.length})
          </span>
        </div>
        {members.length === 0 ? (
          <div
            className="card"
            style={{
              padding: 20,
              color: 'var(--text-dim)',
              fontSize: 13,
              textAlign: 'center',
            }}
          >
            nenhum membro nesse tenant ainda. use <code>/admin/users</code>{' '}
            pra criar um usuário já vinculado aqui.
          </div>
        ) : (
          <div
            className="card"
            style={{ padding: 0, overflow: 'hidden' }}
          >
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr
                  style={{
                    background: 'var(--bg-2)',
                    borderBottom: '2.5px solid var(--stroke)',
                  }}
                >
                  <ThAdmin>email</ThAdmin>
                  <ThAdmin>role</ThAdmin>
                  <ThAdmin>superadmin?</ThAdmin>
                  <ThAdmin>ações</ThAdmin>
                </tr>
              </thead>
              <tbody>
                {members.map((m, idx) => (
                  <tr
                    key={m.id}
                    style={{
                      borderBottom:
                        idx === members.length - 1
                          ? undefined
                          : '1px solid var(--stroke)',
                    }}
                  >
                    <TdAdmin>
                      <code style={{ fontSize: 12 }}>{m.email}</code>
                    </TdAdmin>
                    <TdAdmin>
                      <select
                        value={m.tenantRole}
                        onChange={(e) =>
                          changeRole(
                            m.id,
                            e.target.value as
                              | 'owner'
                              | 'admin'
                              | 'member',
                          )
                        }
                        disabled={busy}
                        style={{
                          padding: '4px 8px',
                          border: '2px solid var(--stroke)',
                          borderRadius: 'var(--radius-sm)',
                          background: 'var(--surface)',
                          color: 'var(--text)',
                          fontSize: 12,
                          fontWeight: 700,
                        }}
                      >
                        <option value="owner">owner</option>
                        <option value="admin">admin</option>
                        <option value="member">member</option>
                      </select>
                    </TdAdmin>
                    <TdAdmin>
                      {m.isSuperadmin ? (
                        <span style={{ color: 'var(--pink-500)' }}>
                          ✓ sim
                        </span>
                      ) : (
                        <span style={{ color: 'var(--text-dim)' }}>—</span>
                      )}
                    </TdAdmin>
                    <TdAdmin>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={() => removeMember(m.id)}
                        disabled={busy}
                        style={{
                          fontSize: 11,
                          padding: '4px 8px',
                          color: 'var(--red-500)',
                        }}
                      >
                        remover
                      </button>
                    </TdAdmin>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {modal === 'edit' && (
        <EditTenantModal
          tenant={tenant}
          onClose={(saved) => {
            setModal(null);
            if (saved) router.refresh();
          }}
        />
      )}

      {modal === 'delete' && (
        <DeleteTenantModal
          tenantName={tenant.name}
          onCancel={() => setModal(null)}
          onConfirm={confirmDelete}
          busy={busy}
        />
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Edit modal                                                                 */
/* -------------------------------------------------------------------------- */

function EditTenantModal({
  tenant,
  onClose,
}: {
  tenant: TenantAdminView;
  onClose: (saved: boolean) => void;
}) {
  const [name, setName] = useState(tenant.name);
  const [plan, setPlan] = useState(tenant.plan);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/tenants/${tenant.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), plan }),
        cache: 'no-store',
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(body?.error?.message ?? `falha (${res.status})`);
      }
      onClose(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'erro');
      setSubmitting(false);
    }
  }

  return (
    <ModalShell title="editar tenant" onClose={() => onClose(false)}>
      <form
        onSubmit={handleSubmit}
        style={{ display: 'flex', flexDirection: 'column', gap: 16 }}
      >
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={fieldLabel}>nome</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={200}
            disabled={submitting}
            style={inputStyle}
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={fieldLabel}>plano</span>
          <select
            value={plan}
            onChange={(e) => setPlan(e.target.value)}
            disabled={submitting}
            style={{ ...inputStyle, cursor: 'pointer' }}
          >
            <option value="free">free</option>
            <option value="pro">pro</option>
            <option value="enterprise">enterprise</option>
          </select>
        </label>
        {error && (
          <div
            role="alert"
            style={{
              padding: 10,
              border: '2.5px solid var(--red-500)',
              borderRadius: 'var(--radius-md)',
              background: 'rgba(255, 77, 60, 0.08)',
              color: 'var(--red-500)',
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            ⚠ {error}
          </div>
        )}
        <div
          style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}
        >
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => onClose(false)}
            disabled={submitting}
          >
            cancelar
          </button>
          <button
            type="submit"
            className="btn btn-zap"
            disabled={submitting}
          >
            {submitting ? '⟳ salvando...' : '✓ salvar'}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

function DeleteTenantModal({
  tenantName,
  onCancel,
  onConfirm,
  busy,
}: {
  tenantName: string;
  onCancel: () => void;
  onConfirm: () => void;
  busy: boolean;
}) {
  const [typed, setTyped] = useState('');
  const canDelete = typed === tenantName;
  return (
    <ModalShell title="deletar tenant?" onClose={onCancel}>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}
      >
        <div
          style={{
            padding: 14,
            border: '2.5px solid var(--red-500)',
            borderRadius: 'var(--radius-md)',
            background: 'rgba(255, 77, 60, 0.08)',
            color: 'var(--text)',
            fontSize: 13,
            lineHeight: 1.5,
          }}
        >
          <strong style={{ color: 'var(--red-500)' }}>
            ⚠ ação destrutiva e irreversível.
          </strong>
          <div style={{ marginTop: 6 }}>
            vai apagar <code>{tenantName}</code> e todo o histórico: membros,
            WhatsApp, grupos, mensagens, resumos, áudios, agendas.
          </div>
        </div>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={fieldLabel}>
            digite <code>{tenantName}</code> pra confirmar
          </span>
          <input
            type="text"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            disabled={busy}
            style={inputStyle}
          />
        </label>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={onCancel}
            disabled={busy}
          >
            cancelar
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!canDelete || busy}
            style={{
              background: 'var(--red-500)',
              color: '#fff',
              border: '2.5px solid var(--stroke)',
              borderRadius: 'var(--radius-md)',
              padding: '10px 16px',
              fontWeight: 800,
              fontSize: 13,
              cursor: canDelete && !busy ? 'pointer' : 'not-allowed',
              opacity: !canDelete || busy ? 0.5 : 1,
              boxShadow: '2px 2px 0 var(--stroke)',
            }}
          >
            {busy ? '⟳ deletando...' : '🗑 deletar pra sempre'}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

function ThAdmin({ children }: { children: React.ReactNode }) {
  return (
    <th
      style={{
        padding: '12px 16px',
        textAlign: 'left',
        fontSize: 11,
        fontWeight: 800,
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
        color: 'var(--text-dim)',
      }}
    >
      {children}
    </th>
  );
}

function TdAdmin({ children }: { children: React.ReactNode }) {
  return (
    <td
      style={{
        padding: '12px 16px',
        fontSize: 13,
        color: 'var(--text)',
      }}
    >
      {children}
    </td>
  );
}

const fieldLabel: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 800,
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  color: 'var(--text-dim)',
};

const inputStyle: React.CSSProperties = {
  padding: '10px 14px',
  border: '2.5px solid var(--stroke)',
  borderRadius: 'var(--radius-md)',
  fontFamily: 'var(--font-body)',
  fontSize: 14,
  fontWeight: 600,
  background: 'var(--surface)',
  color: 'var(--text)',
  boxShadow: '2px 2px 0 var(--stroke)',
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box',
};
