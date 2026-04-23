'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import type { TenantAdminView } from '@/lib/admin/tenants';
import type { UserAdminView } from '@/lib/admin/users';

import { ModalShell } from '../tenants/TenantsTable';

type ModalState =
  | { kind: 'new' }
  | { kind: 'reset'; user: UserAdminView }
  | { kind: 'delete'; user: UserAdminView }
  | null;

/**
 * Users management table — covers create, reset password, toggle
 * superadmin flag, and hard-delete.
 *
 * Edit-membership lives in the tenant detail screen (role dropdown) so
 * the user modal here focuses on identity (email, password, initial
 * tenant attachment).
 */
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

  async function toggleSuperadmin(user: UserAdminView) {
    const verb = user.isSuperadmin ? 'remover' : 'promover';
    if (!window.confirm(`${verb} superadmin em ${user.email}?`)) return;
    setBusyId(user.id);
    setFlash(null);
    try {
      await callApi(`/api/admin/users/${user.id}`, 'PATCH', {
        isSuperadmin: !user.isSuperadmin,
      });
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

  return (
    <>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 16,
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

      {users.length === 0 ? (
        <EmptyUsers
          hasTenant={tenants.length > 0}
          onCreate={() => setModal({ kind: 'new' })}
        />
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr
                style={{
                  background: 'var(--bg-2)',
                  borderBottom: '2.5px solid var(--stroke)',
                }}
              >
                <Th>email</Th>
                <Th>superadmin</Th>
                <Th>tenants</Th>
                <Th>criado</Th>
                <Th>ações</Th>
              </tr>
            </thead>
            <tbody>
              {users.map((u, idx) => (
                <tr
                  key={u.id}
                  style={{
                    borderBottom:
                      idx === users.length - 1
                        ? undefined
                        : '1px solid var(--stroke)',
                  }}
                >
                  <Td>
                    <code style={{ fontSize: 12, fontWeight: 700 }}>
                      {u.email}
                    </code>
                  </Td>
                  <Td>
                    {u.isSuperadmin ? (
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
                    )}
                  </Td>
                  <Td>
                    {u.tenants.length === 0 ? (
                      <span style={{ color: 'var(--text-dim)' }}>
                        sem tenant
                      </span>
                    ) : (
                      <div
                        style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}
                      >
                        {u.tenants.map((t) => (
                          <RoleBadge
                            key={t.tenantId}
                            tenantName={t.tenantName}
                            role={t.role}
                          />
                        ))}
                      </div>
                    )}
                  </Td>
                  <Td>{formatDate(u.createdAt)}</Td>
                  <Td>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        style={{ fontSize: 11, padding: '4px 8px' }}
                        onClick={() => setModal({ kind: 'reset', user: u })}
                        disabled={busyId === u.id}
                      >
                        senha
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        style={{ fontSize: 11, padding: '4px 8px' }}
                        onClick={() => toggleSuperadmin(u)}
                        disabled={busyId === u.id}
                      >
                        {u.isSuperadmin ? 'tirar SA' : 'tornar SA'}
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        style={{
                          fontSize: 11,
                          padding: '4px 8px',
                          color: 'var(--red-500)',
                        }}
                        onClick={() => setModal({ kind: 'delete', user: u })}
                        disabled={busyId === u.id}
                      >
                        deletar
                      </button>
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

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
        <div
          style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}
        >
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
            {submitting ? '⟳ criando...' : '✓ criar usuário'}
          </button>
        </div>
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
          </div>
        </form>
      )}
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
            {busy ? '⟳ deletando...' : '🗑 deletar'}
          </button>
        </div>
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

function Th({ children }: { children: React.ReactNode }) {
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

function Td({ children }: { children: React.ReactNode }) {
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
