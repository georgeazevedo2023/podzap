'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import type { TenantAdminView } from '@/lib/admin/tenants';

/**
 * Client-side table + modal shell for the tenants management screen.
 *
 * Owns the interactive state:
 *   - which modal (new / edit / delete-confirm) is open
 *   - submission state + error flash
 *
 * Mutations go through `/api/admin/tenants`. Every successful mutation
 * calls `router.refresh()` so the server-rendered list re-hydrates from
 * the DB (instead of shoehorning an optimistic update and drifting).
 */
export function TenantsTable({ tenants }: { tenants: TenantAdminView[] }) {
  const router = useRouter();
  const [modal, setModal] = useState<
    | { kind: 'new' }
    | { kind: 'edit'; tenant: TenantAdminView }
    | { kind: 'delete'; tenant: TenantAdminView }
    | null
  >(null);
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
      throw new Error(
        data?.error?.message ?? `Falhou (${res.status})`,
      );
    }
  }

  async function toggleSuspend(tenant: TenantAdminView) {
    setBusyId(tenant.id);
    setFlash(null);
    try {
      await callApi(`/api/admin/tenants/${tenant.id}`, 'PATCH', {
        isActive: !tenant.isActive,
      });
      router.refresh();
    } catch (err) {
      setFlash(err instanceof Error ? err.message : 'erro');
    } finally {
      setBusyId(null);
    }
  }

  async function confirmDelete(tenant: TenantAdminView) {
    setBusyId(tenant.id);
    setFlash(null);
    try {
      await callApi(`/api/admin/tenants/${tenant.id}`, 'DELETE');
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
          {tenants.length === 0
            ? 'nenhum tenant ainda'
            : `${tenants.length} tenant${tenants.length === 1 ? '' : 's'}`}
        </div>
        <button
          type="button"
          className="btn btn-zap"
          onClick={() => setModal({ kind: 'new' })}
        >
          + novo tenant
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

      {tenants.length === 0 ? (
        <EmptyState onCreate={() => setModal({ kind: 'new' })} />
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
                <Th>nome</Th>
                <Th>plano</Th>
                <Th>status</Th>
                <Th>membros</Th>
                <Th>instância</Th>
                <Th>criado</Th>
                <Th>ações</Th>
              </tr>
            </thead>
            <tbody>
              {tenants.map((t, idx) => (
                <tr
                  key={t.id}
                  style={{
                    borderBottom:
                      idx === tenants.length - 1
                        ? undefined
                        : '1px solid var(--stroke)',
                  }}
                >
                  <Td>
                    <a
                      href={`/admin/tenants/${t.id}`}
                      style={{
                        color: 'var(--text)',
                        fontWeight: 700,
                        textDecoration: 'none',
                      }}
                    >
                      {t.name}
                    </a>
                  </Td>
                  <Td>
                    <PlanBadge plan={t.plan} />
                  </Td>
                  <Td>
                    <StatusPill active={t.isActive} />
                  </Td>
                  <Td>{t.memberCount}</Td>
                  <Td>
                    {t.hasInstance ? (
                      <span style={{ color: 'var(--lime-500)' }}>
                        ● sim
                      </span>
                    ) : (
                      <span style={{ color: 'var(--text-dim)' }}>
                        — não
                      </span>
                    )}
                  </Td>
                  <Td>{formatDate(t.createdAt)}</Td>
                  <Td>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <a
                        href={`/admin/tenants/${t.id}`}
                        className="btn btn-ghost"
                        style={{ fontSize: 11, padding: '4px 8px' }}
                      >
                        ver
                      </a>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        disabled={busyId === t.id}
                        style={{ fontSize: 11, padding: '4px 8px' }}
                        onClick={() => toggleSuspend(t)}
                      >
                        {t.isActive ? 'suspender' : 'reativar'}
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        disabled={busyId === t.id}
                        style={{
                          fontSize: 11,
                          padding: '4px 8px',
                          color: 'var(--red-500)',
                        }}
                        onClick={() => setModal({ kind: 'delete', tenant: t })}
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
        <TenantFormModal
          onClose={(saved) => {
            setModal(null);
            if (saved) router.refresh();
          }}
        />
      )}

      {modal?.kind === 'delete' && (
        <DeleteConfirmModal
          tenantName={modal.tenant.name}
          onCancel={() => setModal(null)}
          onConfirm={() => confirmDelete(modal.tenant)}
          busy={busyId === modal.tenant.id}
        />
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* New tenant modal                                                           */
/* -------------------------------------------------------------------------- */

function TenantFormModal({ onClose }: { onClose: (saved: boolean) => void }) {
  const [name, setName] = useState('');
  const [plan, setPlan] = useState('free');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting) return;
    if (!name.trim()) {
      setError('nome é obrigatório');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/tenants', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), plan }),
        cache: 'no-store',
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(body?.error?.message ?? `Falha (${res.status})`);
      }
      onClose(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'erro');
      setSubmitting(false);
    }
  }

  return (
    <ModalShell title="novo tenant" onClose={() => onClose(false)}>
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
            placeholder="ex.: acme corp"
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
          style={{
            display: 'flex',
            gap: 10,
            justifyContent: 'flex-end',
          }}
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
            {submitting ? '⟳ criando...' : '✓ criar tenant'}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

/* -------------------------------------------------------------------------- */
/* Delete confirm modal                                                       */
/* -------------------------------------------------------------------------- */

function DeleteConfirmModal({
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
            vai apagar o tenant <code>{tenantName}</code> e TUDO que depende
            dele em cascata: membros, instância WhatsApp, grupos, mensagens,
            resumos, áudios e agendas.
          </div>
          <div style={{ marginTop: 6, opacity: 0.8 }}>
            se só quer pausar, use <strong>suspender</strong> em vez de
            deletar.
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
            placeholder={tenantName}
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

/* -------------------------------------------------------------------------- */
/* Shared bits                                                                */
/* -------------------------------------------------------------------------- */

export function ModalShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.5)',
        display: 'grid',
        placeItems: 'center',
        padding: 24,
        zIndex: 100,
        overflowY: 'auto',
      }}
    >
      <div
        className="card"
        style={{
          width: '100%',
          maxWidth: 520,
          maxHeight: '90vh',
          overflowY: 'auto',
          padding: 24,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 18,
          }}
        >
          <h2
            style={{
              margin: 0,
              fontFamily: 'var(--font-display)',
              fontSize: 24,
              fontWeight: 800,
              letterSpacing: '-0.02em',
            }}
          >
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            style={{
              width: 32,
              height: 32,
              borderRadius: '50%',
              border: '2.5px solid var(--stroke)',
              background: 'var(--surface)',
              fontSize: 14,
              fontWeight: 800,
              cursor: 'pointer',
              boxShadow: '2px 2px 0 var(--stroke)',
              color: 'var(--text)',
            }}
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
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
      <div style={{ fontSize: 48 }}>🏢</div>
      <h3
        style={{
          margin: 0,
          fontFamily: 'var(--font-display)',
          fontSize: 22,
          fontWeight: 800,
        }}
      >
        nenhum tenant ainda
      </h3>
      <p
        style={{
          margin: 0,
          color: 'var(--text-dim)',
          fontSize: 14,
          maxWidth: 400,
        }}
      >
        cria o primeiro tenant pra começar — depois você adiciona membros e
        atribui uma instância UAZAPI.
      </p>
      <button
        type="button"
        className="btn btn-zap"
        onClick={onCreate}
      >
        + criar primeiro tenant
      </button>
    </div>
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

export function StatusPill({ active }: { active: boolean }) {
  return (
    <span
      style={{
        padding: '3px 10px',
        borderRadius: 'var(--radius-pill)',
        border: '2px solid var(--stroke)',
        background: active ? 'var(--lime-500)' : 'var(--yellow-500)',
        color: 'var(--ink-900)',
        fontSize: 11,
        fontWeight: 800,
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
      }}
    >
      {active ? '● ativo' : '⏸ suspenso'}
    </span>
  );
}

export function PlanBadge({ plan }: { plan: string }) {
  const bg =
    plan === 'enterprise'
      ? 'var(--purple-600)'
      : plan === 'pro'
        ? 'var(--pink-500)'
        : 'var(--bg-2)';
  const fg =
    plan === 'enterprise' || plan === 'pro' ? '#fff' : 'var(--text)';
  return (
    <span
      style={{
        padding: '3px 10px',
        borderRadius: 'var(--radius-pill)',
        border: '2px solid var(--stroke)',
        background: bg,
        color: fg,
        fontSize: 11,
        fontWeight: 800,
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
      }}
    >
      {plan}
    </span>
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
