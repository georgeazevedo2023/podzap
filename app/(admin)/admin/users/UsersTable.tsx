'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { AdminEntityList, type AdminColumn } from '@/components/admin/AdminEntityList';
import type { TenantAdminView } from '@/lib/admin/tenants';
import type { UserAdminView } from '@/lib/admin/users';

import {
  fieldLabel,
  formatDate,
  FormError,
  inputStyle,
  ModalFooter,
  ModalShell,
} from '../tenants/TenantsTable';

type ModalState =
  | { kind: 'new' }
  | { kind: 'reset'; user: UserAdminView }
  | { kind: 'delete'; user: UserAdminView }
  | { kind: 'sa'; user: UserAdminView }
  | null;

export function UsersTable({
  users,
  tenants,
}: {
  users: UserAdminView[];
  tenants: TenantAdminView[];
}) {
  const router = useRouter();
  const [modal, setModal] = useState<ModalState>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
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

  async function applySuperadmin(user: UserAdminView) {
    setBusyId(user.id);
    setFlash(null);
    try {
      await callApi(`/api/admin/users/${user.id}`, 'PATCH', {
        isSuperadmin: !user.isSuperadmin,
      });
      setModal(null);
      router.refresh();
    } catch (err) {
      setFlash(err instanceof Error ? err.message : 'erro');
    } finally {
      setBusyId(null);
    }
  }

  async function confirmDelete(user: UserAdminView) {
    setBusyId(user.id);
    setFlash(null);
    try {
      await callApi(`/api/admin/users/${user.id}`, 'DELETE');
      setModal(null);
      router.refresh();
    } catch (err) {
      setFlash(err instanceof Error ? err.message : 'erro');
    } finally {
      setBusyId(null);
    }
  }

  const columns: AdminColumn<UserAdminView>[] = [
    {
      key: 'email',
      label: 'email',
      mobileHide: true,
      render: (u) => (
        <code style={{ fontSize: 12, fontWeight: 700 }}>{u.email}</code>
      ),
    },
    {
      key: 'sa',
      label: 'superadmin',
      render: (u) =>
        u.isSuperadmin ? (
          <span
            style={{
              padding: '3px 10px',
              borderRadius: 'var(--radius-pill)',
              background: 'var(--pink-500)',
              color: '#fff',
              fontSize: 11,
              fontWeight: 800,
              border: '2px solid var(--stroke)',
            }}
          >
            ⚡ SA
          </span>
        ) : (
          <span style={{ color: 'var(--text-dim)' }}>—</span>
        ),
    },
    {
      key: 'tenants',
      label: 'tenants',
      render: (u) =>
        u.tenants.length === 0 ? (
          <span style={{ color: 'var(--text-dim)' }}>sem tenant</span>
        ) : (
          <div
            style={{
              display: 'flex',
              gap: 6,
              flexWrap: 'wrap',
              justifyContent: 'flex-end',
            }}
          >
            {u.tenants.map((t) => (
              <RoleBadge
                key={t.tenantId}
                tenantName={t.tenantName}
                role={t.role}
              />
            ))}
          </div>
        ),
    },
    {
      key: 'createdAt',
      label: 'criado',
      render: (u) => formatDate(u.createdAt),
    },
  ];

  const renderActions = (u: UserAdminView) => (
    <>
      <button
        type="button"
        className="btn btn-ghost btn-xs"
        data-admin-action
        onClick={() => setModal({ kind: 'reset', user: u })}
        disabled={busyId === u.id}
      >
        senha
      </button>
      <button
        type="button"
        className="btn btn-ghost btn-xs"
        data-admin-action
        onClick={() => setModal({ kind: 'sa', user: u })}
        disabled={busyId === u.id}
      >
        {u.isSuperadmin ? 'tirar SA' : 'tornar SA'}
      </button>
      <button
        type="button"
        className="btn btn-ghost btn-xs"
        data-admin-action
        data-danger="true"
        onClick={() => setModal({ kind: 'delete', user: u })}
        disabled={busyId === u.id}
      >
        deletar
      </button>
    </>
  );

  return (
    <>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 16,
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ color: 'var(--text-dim)', fontSize: 14 }}>
          {users.length} {users.length === 1 ? 'usuário' : 'usuários'}
        </div>
        <button
          type="button"
          className="btn btn-zap"
          onClick={() => setModal({ kind: 'new' })}
          disabled={tenants.length === 0}
          title={
            tenants.length === 0
              ? 'cria um tenant antes — todo usuário precisa de pelo menos um'
              : undefined
          }
        >
          + novo usuário
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

      <AdminEntityList<UserAdminView>
        rows={users}
        columns={columns}
        getRowKey={(u) => u.id}
        mobileTitle={(u) => (
          <code style={{ fontSize: 14 }}>{u.email}</code>
        )}
        actions={renderActions}
        emptyState={
          <EmptyUsers
            hasTenant={tenants.length > 0}
            onCreate={() => setModal({ kind: 'new' })}
          />
        }
      />

      {modal?.kind === 'new' && (
        <NewUserModal
          tenants={tenants}
          onClose={(saved) => {
            setModal(null);
            if (saved) router.refresh();
          }}
        />
      )}

      {modal?.kind === 'reset' && (
        <ResetPasswordModal
          user={modal.user}
          onClose={() => setModal(null)}
        />
      )}

      {modal?.kind === 'sa' && (
        <SuperadminConfirmModal
          user={modal.user}
          onCancel={() => setModal(null)}
          onConfirm={() => applySuperadmin(modal.user)}
          busy={busyId === modal.user.id}
        />
      )}

      {modal?.kind === 'delete' && (
        <DeleteUserModal
          userEmail={modal.user.email}
          onCancel={() => setModal(null)}
          onConfirm={() => confirmDelete(modal.user)}
          busy={busyId === modal.user.id}
        />
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Modals                                                                     */
/* -------------------------------------------------------------------------- */

function NewUserModal({
  tenants,
  onClose,
}: {
  tenants: TenantAdminView[];
  onClose: (saved: boolean) => void;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [tenantId, setTenantId] = useState(tenants[0]?.id ?? '');
  const [role, setRole] = useState<'owner' | 'admin' | 'member'>('owner');
  const [isSuperadmin, setIsSuperadmin] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting) return;
    if (password.length < 8) {
      setError('senha precisa de no mínimo 8 caracteres');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          password,
          tenantId,
          role,
          isSuperadmin,
        }),
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
    <ModalShell title="novo usuário" onClose={() => onClose(false)}>
      <form
        onSubmit={handleSubmit}
        style={{ display: 'flex', flexDirection: 'column', gap: 16 }}
      >
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={fieldLabel}>email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            disabled={submitting}
            style={inputStyle}
            placeholder="nome@dominio.com"
            autoComplete="off"
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={fieldLabel}>senha (mín. 8 caracteres)</span>
          <input
            type="text"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            disabled={submitting}
            style={{ ...inputStyle, fontFamily: 'var(--font-mono)' }}
            placeholder="senha inicial"
            autoComplete="new-password"
          />
        </label>
        <div className="admin-form-grid-2">
          <label
            style={{ display: 'flex', flexDirection: 'column', gap: 6 }}
          >
            <span style={fieldLabel}>tenant inicial</span>
            <select
              value={tenantId}
              onChange={(e) => setTenantId(e.target.value)}
              disabled={submitting}
              required
              style={{ ...inputStyle, cursor: 'pointer' }}
            >
              {tenants.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.plan})
                </option>
              ))}
            </select>
          </label>
          <label
            style={{ display: 'flex', flexDirection: 'column', gap: 6 }}
          >
            <span style={fieldLabel}>role</span>
            <select
              value={role}
              onChange={(e) =>
                setRole(e.target.value as 'owner' | 'admin' | 'member')
              }
              disabled={submitting}
              style={{ ...inputStyle, cursor: 'pointer' }}
            >
              <option value="owner">owner</option>
              <option value="admin">admin</option>
              <option value="member">member</option>
            </select>
          </label>
        </div>
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '10px 14px',
            border: '2.5px solid var(--stroke)',
            borderRadius: 'var(--radius-md)',
            background: 'var(--bg-2)',
            cursor: submitting ? 'wait' : 'pointer',
          }}
        >
          <input
            type="checkbox"
            checked={isSuperadmin}
            onChange={(e) => setIsSuperadmin(e.target.checked)}
            disabled={submitting}
            style={{
              width: 18,
              height: 18,
              accentColor: 'var(--pink-500)',
            }}
          />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 800 }}>
              ⚡ superadmin
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>
              acesso total ao <code>/admin/*</code>. use com parcimônia.
            </div>
          </div>
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
            {submitting ? '⟳ criando...' : '✓ criar usuário'}
          </button>
        </ModalFooter>
      </form>
    </ModalShell>
  );
}

function ResetPasswordModal({
  user,
  onClose,
}: {
  user: UserAdminView;
  onClose: () => void;
}) {
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting) return;
    if (password.length < 8) {
      setError('senha precisa de no mínimo 8 caracteres');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/users/${user.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password }),
        cache: 'no-store',
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(body?.error?.message ?? `falha (${res.status})`);
      }
      setDone(true);
      setSubmitting(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'erro');
      setSubmitting(false);
    }
  }

  return (
    <ModalShell title="resetar senha" onClose={onClose}>
      {done ? (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: 48 }}>✅</div>
          <div style={{ fontSize: 15, fontWeight: 700 }}>
            senha atualizada pra <code>{user.email}</code>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>
            compartilha a nova senha com o usuário por canal seguro.
          </div>
          <button
            type="button"
            className="btn btn-zap"
            onClick={onClose}
          >
            fechar
          </button>
        </div>
      ) : (
        <form
          onSubmit={handleSubmit}
          style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
        >
          <div style={{ fontSize: 13, color: 'var(--text-dim)' }}>
            resetando senha de <code>{user.email}</code>
          </div>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={fieldLabel}>nova senha (mín. 8)</span>
            <input
              type="text"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              disabled={submitting}
              style={{ ...inputStyle, fontFamily: 'var(--font-mono)' }}
              autoComplete="new-password"
            />
          </label>
          {error && <FormError>{error}</FormError>}
          <ModalFooter>
            <button
              type="button"
              className="btn btn-ghost btn-tap"
              onClick={onClose}
              disabled={submitting}
            >
              cancelar
            </button>
            <button
              type="submit"
              className="btn btn-zap"
              disabled={submitting}
            >
              {submitting ? '⟳ salvando...' : '✓ resetar'}
            </button>
          </ModalFooter>
        </form>
      )}
    </ModalShell>
  );
}

function SuperadminConfirmModal({
  user,
  onCancel,
  onConfirm,
  busy,
}: {
  user: UserAdminView;
  onCancel: () => void;
  onConfirm: () => void;
  busy: boolean;
}) {
  const promoting = !user.isSuperadmin;
  return (
    <ModalShell
      title={promoting ? 'tornar superadmin?' : 'remover superadmin?'}
      onClose={onCancel}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div
          style={{
            padding: 14,
            border: `2.5px solid var(${promoting ? '--pink-500' : '--yellow-500'})`,
            borderRadius: 'var(--radius-md)',
            background: promoting
              ? 'rgba(255, 61, 165, 0.08)'
              : 'rgba(255, 200, 40, 0.12)',
            fontSize: 13,
            lineHeight: 1.5,
          }}
        >
          {promoting ? (
            <>
              <strong style={{ color: 'var(--pink-500)' }}>
                ⚡ acesso total ao admin.
              </strong>
              <div style={{ marginTop: 6 }}>
                <code>{user.email}</code> vai poder criar/deletar tenants,
                resetar senhas, atribuir instâncias UAZAPI e promover outros
                superadmins.
              </div>
            </>
          ) : (
            <>
              <strong style={{ color: 'var(--text)' }}>
                remove o acesso ao painel admin.
              </strong>
              <div style={{ marginTop: 6 }}>
                <code>{user.email}</code> volta a ser usuário comum — só vê
                os tenants em que é membro.
              </div>
            </>
          )}
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
            className={`btn ${promoting ? 'btn-pink' : 'btn-yellow'}`}
          >
            {busy
              ? '⟳ aplicando...'
              : promoting
                ? '⚡ tornar SA'
                : '↩ remover SA'}
          </button>
        </ModalFooter>
      </div>
    </ModalShell>
  );
}

function DeleteUserModal({
  userEmail,
  onCancel,
  onConfirm,
  busy,
}: {
  userEmail: string;
  onCancel: () => void;
  onConfirm: () => void;
  busy: boolean;
}) {
  const [typed, setTyped] = useState('');
  const canDelete = typed === userEmail;
  return (
    <ModalShell title="deletar usuário?" onClose={onCancel}>
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
            fontSize: 13,
            lineHeight: 1.5,
          }}
        >
          <strong style={{ color: 'var(--red-500)' }}>
            ⚠ irreversível.
          </strong>
          <div style={{ marginTop: 6 }}>
            vai remover <code>{userEmail}</code> do auth e de todos os
            tenants que ele pertence.
          </div>
        </div>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={fieldLabel}>
            digite <code>{userEmail}</code> pra confirmar
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
            {busy ? '⟳ deletando...' : '🗑 deletar'}
          </button>
        </ModalFooter>
      </div>
    </ModalShell>
  );
}

/* -------------------------------------------------------------------------- */
/* Empty + shared bits                                                         */
/* -------------------------------------------------------------------------- */

function EmptyUsers({
  hasTenant,
  onCreate,
}: {
  hasTenant: boolean;
  onCreate: () => void;
}) {
  return (
    <div
      className="card"
      style={{
        padding: 32,
        textAlign: 'center',
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
        alignItems: 'center',
      }}
    >
      <div style={{ fontSize: 48 }}>👤</div>
      <h3
        style={{
          margin: 0,
          fontFamily: 'var(--font-display)',
          fontSize: 22,
          fontWeight: 800,
        }}
      >
        nenhum usuário ainda
      </h3>
      <p style={{ margin: 0, color: 'var(--text-dim)', fontSize: 14 }}>
        {hasTenant
          ? 'cria o primeiro usuário com email + senha.'
          : 'você precisa de pelo menos um tenant pra criar um usuário.'}
      </p>
      {hasTenant && (
        <button
          type="button"
          className="btn btn-zap"
          onClick={onCreate}
        >
          + criar primeiro usuário
        </button>
      )}
    </div>
  );
}

function RoleBadge({
  tenantName,
  role,
}: {
  tenantName: string;
  role: 'owner' | 'admin' | 'member';
}) {
  const bg =
    role === 'owner'
      ? 'var(--purple-600)'
      : role === 'admin'
        ? 'var(--pink-500)'
        : 'var(--yellow-500)';
  const fg = role === 'member' ? 'var(--ink-900)' : '#fff';
  return (
    <span
      style={{
        padding: '3px 10px',
        borderRadius: 'var(--radius-pill)',
        border: '2px solid var(--stroke)',
        background: bg,
        color: fg,
        fontSize: 11,
        fontWeight: 700,
      }}
      title={`${role} em ${tenantName}`}
    >
      {tenantName} · {role}
    </span>
  );
}
