'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { AdminEntityList, type AdminColumn } from '@/components/admin/AdminEntityList';
import type { TenantAdminView } from '@/lib/admin/tenants';
import type { UserAdminView } from '@/lib/admin/users';

import {
  fieldLabel,
  FormError,
  inputStyle,
  ModalFooter,
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
  const [modal, setModal] = useState<
    'edit' | 'delete' | { kind: 'remove-member'; member: MemberRow } | null
  >(null);
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

  async function confirmRemoveMember(userId: string) {
    setBusy(true);
    setFlash(null);
    try {
      await callApi(
        `/api/admin/users/${userId}?tenantId=${tenant.id}`,
        'DELETE',
      );
      setModal(null);
      router.refresh();
    } catch (err) {
      setFlash(err instanceof Error ? err.message : 'erro');
    } finally {
      setBusy(false);
    }
  }

  const memberColumns: AdminColumn<MemberRow>[] = [
    {
      key: 'email',
      label: 'email',
      mobileHide: true,
      render: (m) => <code style={{ fontSize: 12 }}>{m.email}</code>,
    },
    {
      key: 'role',
      label: 'role',
      render: (m) => (
        <select
          value={m.tenantRole}
          onChange={(e) =>
            changeRole(
              m.id,
              e.target.value as 'owner' | 'admin' | 'member',
            )
          }
          disabled={busy}
          style={{
            padding: '8px 12px',
            border: '2px solid var(--stroke)',
            borderRadius: 'var(--radius-sm)',
            background: 'var(--surface)',
            color: 'var(--text)',
            fontSize: 12,
            fontWeight: 700,
            minHeight: 44,
          }}
        >
          <option value="owner">owner</option>
          <option value="admin">admin</option>
          <option value="member">member</option>
        </select>
      ),
    },
    {
      key: 'sa',
      label: 'superadmin?',
      render: (m) =>
        m.isSuperadmin ? (
          <span style={{ color: 'var(--pink-500)' }}>✓ sim</span>
        ) : (
          <span style={{ color: 'var(--text-dim)' }}>—</span>
        ),
    },
  ];

  const memberActions = (m: MemberRow) => (
    <button
      type="button"
      className="btn btn-ghost btn-xs"
      data-admin-action
      data-danger="true"
      onClick={() => setModal({ kind: 'remove-member', member: m })}
      disabled={busy}
    >
      remover
    </button>
  );

  return (
    <>
      {/* Header actions row */}
      <div
        style={{
          display: 'flex',
          gap: 16,
          alignItems: 'center',
          flexWrap: 'wrap',
          marginBottom: 24,
        }}
      >
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <PlanBadge plan={tenant.plan} />
          <StatusPill active={tenant.isActive} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }} />
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn btn-ghost btn-tap"
            onClick={() => setModal('edit')}
            disabled={busy}
          >
            ✎ editar
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-tap"
            onClick={toggleSuspend}
            disabled={busy}
          >
            {tenant.isActive ? '⏸ suspender' : '▶ reativar'}
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-tap"
            onClick={() => setModal('delete')}
            disabled={busy}
            style={{ color: 'var(--red-500)' }}
          >
            🗑 deletar
          </button>
        </div>
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
        <AdminEntityList<MemberRow>
          rows={members}
          columns={memberColumns}
          getRowKey={(m) => m.id}
          mobileTitle={(m) => <code style={{ fontSize: 14 }}>{m.email}</code>}
          actions={memberActions}
          emptyState={
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
          }
        />
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

      {modal && typeof modal !== 'string' && modal.kind === 'remove-member' && (
        <RemoveMemberModal
          email={modal.member.email}
          onCancel={() => setModal(null)}
          onConfirm={() => confirmRemoveMember(modal.member.id)}
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
        {error && <FormError>{error}</FormError>}
        <ModalFooter>
          <button
            type="button"
            className="btn btn-ghost btn-tap"
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
        </ModalFooter>
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
        <ModalFooter>
          <button
            type="button"
            className="btn btn-ghost btn-tap"
            onClick={onCancel}
            disabled={busy}
          >
            cancelar
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!canDelete || busy}
            className="btn"
            style={{
              background: 'var(--red-500)',
              color: '#fff',
              opacity: !canDelete || busy ? 0.5 : 1,
              cursor: canDelete && !busy ? 'pointer' : 'not-allowed',
            }}
          >
            {busy ? '⟳ deletando...' : '🗑 deletar pra sempre'}
          </button>
        </ModalFooter>
      </div>
    </ModalShell>
  );
}

function RemoveMemberModal({
  email,
  onCancel,
  onConfirm,
  busy,
}: {
  email: string;
  onCancel: () => void;
  onConfirm: () => void;
  busy: boolean;
}) {
  return (
    <ModalShell title="remover membro?" onClose={onCancel}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div
          style={{
            padding: 14,
            border: '2.5px solid var(--yellow-500)',
            borderRadius: 'var(--radius-md)',
            background: 'rgba(255, 200, 40, 0.12)',
            fontSize: 13,
            lineHeight: 1.5,
          }}
        >
          <strong>tira o vínculo</strong> de <code>{email}</code> com esse
          tenant. o usuário em si <strong>não</strong> é deletado — só perde
          acesso aqui.
        </div>
        <ModalFooter>
          <button
            type="button"
            className="btn btn-ghost btn-tap"
            onClick={onCancel}
            disabled={busy}
          >
            cancelar
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="btn"
            style={{
              background: 'var(--red-500)',
              color: '#fff',
              opacity: busy ? 0.5 : 1,
            }}
          >
            {busy ? '⟳ removendo...' : '🗑 remover do tenant'}
          </button>
        </ModalFooter>
      </div>
    </ModalShell>
  );
}
