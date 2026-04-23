'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import type { TenantAdminView } from '@/lib/admin/tenants';
import type { UazapiInstanceAdminView } from '@/lib/admin/uazapi';

import { ModalShell } from '../tenants/TenantsTable';

type ModalState =
  | { kind: 'attach'; instance: UazapiInstanceAdminView }
  | { kind: 'detach'; instance: UazapiInstanceAdminView }
  | { kind: 'create' }
  | null;

/**
 * UAZAPI instances table — lists every instance the UAZAPI account knows
 * about, joined with the local `whatsapp_instances` row when attached.
 *
 * Actions:
 *   - "atribuir" → pick a tenant (only those without an instance) and
 *     call POST /api/admin/uazapi/attach.
 *   - "desatribuir" → destructive (cascades to groups/messages/etc).
 *   - "+ criar e atribuir" → create a new UAZAPI instance on the fly
 *     and bind it to the chosen tenant in one call.
 */
export function UazapiTable({
  instances,
  tenants,
}: {
  instances: UazapiInstanceAdminView[];
  tenants: TenantAdminView[];
}) {
  const router = useRouter();
  const [modal, setModal] = useState<ModalState>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const tenantsWithoutInstance = tenants.filter((t) => !t.hasInstance);

  async function callApi(
    url: string,
    method: 'POST' | 'DELETE',
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

  async function attachNow(
    instance: UazapiInstanceAdminView,
    tenantId: string,
  ): Promise<void> {
    setBusyId(instance.uazapiInstanceId);
    setFlash(null);
    try {
      await callApi('/api/admin/uazapi/attach', 'POST', {
        uazapiInstanceId: instance.uazapiInstanceId,
        tenantId,
      });
      setModal(null);
      router.refresh();
    } catch (err) {
      setFlash(err instanceof Error ? err.message : 'erro');
    } finally {
      setBusyId(null);
    }
  }

  async function detachNow(
    instance: UazapiInstanceAdminView,
  ): Promise<void> {
    if (!instance.attachedTenantId) return;
    setBusyId(instance.uazapiInstanceId);
    setFlash(null);
    try {
      await callApi(
        `/api/admin/uazapi/attach/${instance.attachedTenantId}`,
        'DELETE',
      );
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
          flexWrap: 'wrap',
          gap: 10,
        }}
      >
        <div style={{ color: 'var(--text-dim)', fontSize: 14 }}>
          {instances.length} {instances.length === 1 ? 'instância' : 'instâncias'}
          {' · '}
          {instances.filter((i) => i.attachedTenantId).length} atribuída(s)
        </div>
        <button
          type="button"
          className="btn btn-zap"
          onClick={() => setModal({ kind: 'create' })}
          disabled={tenantsWithoutInstance.length === 0}
          title={
            tenantsWithoutInstance.length === 0
              ? 'nenhum tenant livre pra receber uma nova instância'
              : undefined
          }
        >
          + criar e atribuir
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

      {instances.length === 0 ? (
        <EmptyInstances
          canCreate={tenantsWithoutInstance.length > 0}
          onCreate={() => setModal({ kind: 'create' })}
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
                <Th>nome UAZAPI</Th>
                <Th>status</Th>
                <Th>telefone</Th>
                <Th>tenant</Th>
                <Th>criado</Th>
                <Th>ações</Th>
              </tr>
            </thead>
            <tbody>
              {instances.map((inst, idx) => {
                const attached = Boolean(inst.attachedTenantId);
                return (
                  <tr
                    key={inst.uazapiInstanceId}
                    style={{
                      borderBottom:
                        idx === instances.length - 1
                          ? undefined
                          : '1px solid var(--stroke)',
                    }}
                  >
                    <Td>
                      <div style={{ fontWeight: 700 }}>{inst.name}</div>
                      <div
                        style={{
                          fontSize: 10,
                          fontFamily: 'var(--font-mono)',
                          color: 'var(--text-dim)',
                        }}
                      >
                        {inst.uazapiInstanceId}
                      </div>
                    </Td>
                    <Td>
                      <InstanceStatus status={inst.status} />
                    </Td>
                    <Td>
                      <code style={{ fontSize: 12 }}>
                        {inst.phone ?? '—'}
                      </code>
                    </Td>
                    <Td>
                      {attached ? (
                        <a
                          href={`/admin/tenants/${inst.attachedTenantId}`}
                          style={{
                            padding: '3px 10px',
                            borderRadius: 'var(--radius-pill)',
                            background: 'var(--lime-500)',
                            color: 'var(--ink-900)',
                            fontSize: 11,
                            fontWeight: 800,
                            border: '2px solid var(--stroke)',
                            textDecoration: 'none',
                          }}
                        >
                          🔗 {inst.attachedTenantName}
                        </a>
                      ) : (
                        <span
                          style={{
                            padding: '3px 10px',
                            borderRadius: 'var(--radius-pill)',
                            background: 'var(--bg-2)',
                            color: 'var(--text-dim)',
                            fontSize: 11,
                            fontWeight: 800,
                            border: '2px solid var(--stroke)',
                          }}
                        >
                          ○ livre
                        </span>
                      )}
                    </Td>
                    <Td>{formatDate(inst.createdAt)}</Td>
                    <Td>
                      {attached ? (
                        <button
                          type="button"
                          className="btn btn-ghost"
                          style={{
                            fontSize: 11,
                            padding: '4px 8px',
                            color: 'var(--red-500)',
                          }}
                          disabled={busyId === inst.uazapiInstanceId}
                          onClick={() =>
                            setModal({ kind: 'detach', instance: inst })
                          }
                        >
                          desatribuir
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="btn btn-ghost"
                          style={{ fontSize: 11, padding: '4px 8px' }}
                          disabled={
                            busyId === inst.uazapiInstanceId ||
                            tenantsWithoutInstance.length === 0
                          }
                          title={
                            tenantsWithoutInstance.length === 0
                              ? 'nenhum tenant livre'
                              : undefined
                          }
                          onClick={() =>
                            setModal({ kind: 'attach', instance: inst })
                          }
                        >
                          atribuir
                        </button>
                      )}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {modal?.kind === 'attach' && (
        <AttachModal
          instance={modal.instance}
          tenants={tenantsWithoutInstance}
          onCancel={() => setModal(null)}
          onAttach={(tenantId) => attachNow(modal.instance, tenantId)}
          busy={busyId === modal.instance.uazapiInstanceId}
        />
      )}

      {modal?.kind === 'detach' && (
        <DetachConfirmModal
          instance={modal.instance}
          onCancel={() => setModal(null)}
          onConfirm={() => detachNow(modal.instance)}
          busy={busyId === modal.instance.uazapiInstanceId}
        />
      )}

      {modal?.kind === 'create' && (
        <CreateAttachModal
          tenants={tenantsWithoutInstance}
          onClose={(saved) => {
            setModal(null);
            if (saved) router.refresh();
          }}
        />
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Modals                                                                     */
/* -------------------------------------------------------------------------- */

function AttachModal({
  instance,
  tenants,
  onCancel,
  onAttach,
  busy,
}: {
  instance: UazapiInstanceAdminView;
  tenants: TenantAdminView[];
  onCancel: () => void;
  onAttach: (tenantId: string) => void;
  busy: boolean;
}) {
  const [tenantId, setTenantId] = useState(tenants[0]?.id ?? '');

  return (
    <ModalShell title="atribuir instância" onClose={onCancel}>
      <div
        style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
      >
        <div style={{ fontSize: 13, color: 'var(--text-dim)' }}>
          vincular <strong>{instance.name}</strong> a qual tenant?
        </div>
        {tenants.length === 0 ? (
          <div
            style={{
              padding: 12,
              border: '2.5px solid var(--yellow-500)',
              borderRadius: 'var(--radius-md)',
              background: 'rgba(255, 200, 40, 0.12)',
              fontSize: 13,
            }}
          >
            todos os tenants já têm instância. cria um tenant novo primeiro.
          </div>
        ) : (
          <label
            style={{ display: 'flex', flexDirection: 'column', gap: 6 }}
          >
            <span style={fieldLabel}>tenant</span>
            <select
              value={tenantId}
              onChange={(e) => setTenantId(e.target.value)}
              disabled={busy}
              style={{ ...inputStyle, cursor: 'pointer' }}
            >
              {tenants.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.plan})
                </option>
              ))}
            </select>
          </label>
        )}
        <div
          style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}
        >
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
            className="btn btn-zap"
            onClick={() => onAttach(tenantId)}
            disabled={busy || tenants.length === 0 || !tenantId}
          >
            {busy ? '⟳ atribuindo...' : '✓ atribuir'}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

function DetachConfirmModal({
  instance,
  onCancel,
  onConfirm,
  busy,
}: {
  instance: UazapiInstanceAdminView;
  onCancel: () => void;
  onConfirm: () => void;
  busy: boolean;
}) {
  const [acknowledged, setAcknowledged] = useState(false);
  return (
    <ModalShell title="desatribuir instância?" onClose={onCancel}>
      <div
        style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
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
            ⚠ ação destrutiva pra esse tenant.
          </strong>
          <div style={{ marginTop: 6 }}>
            vai deletar a linha em <code>whatsapp_instances</code> do tenant{' '}
            <strong>{instance.attachedTenantName}</strong> — em cascata:
            grupos monitorados, mensagens salvas, resumos e áudios atrelados.
          </div>
          <div style={{ marginTop: 6 }}>
            a instância UAZAPI em si <strong>não</strong> é apagada — ela
            volta pra "livre" e pode ser reatribuída pra qualquer tenant.
          </div>
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
            cursor: busy ? 'wait' : 'pointer',
          }}
        >
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(e) => setAcknowledged(e.target.checked)}
            disabled={busy}
            style={{
              width: 18,
              height: 18,
              accentColor: 'var(--red-500)',
            }}
          />
          <div style={{ fontSize: 13, fontWeight: 700 }}>
            entendo que o histórico do tenant vai ser apagado
          </div>
        </label>
        <div
          style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}
        >
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
            disabled={!acknowledged || busy}
            style={{
              background: 'var(--red-500)',
              color: '#fff',
              border: '2.5px solid var(--stroke)',
              borderRadius: 'var(--radius-md)',
              padding: '10px 16px',
              fontWeight: 800,
              fontSize: 13,
              cursor: acknowledged && !busy ? 'pointer' : 'not-allowed',
              opacity: !acknowledged || busy ? 0.5 : 1,
              boxShadow: '2px 2px 0 var(--stroke)',
            }}
          >
            {busy ? '⟳ desatribuindo...' : '🔌 desatribuir'}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

function CreateAttachModal({
  tenants,
  onClose,
}: {
  tenants: TenantAdminView[];
  onClose: (saved: boolean) => void;
}) {
  const [tenantId, setTenantId] = useState(tenants[0]?.id ?? '');
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting) return;
    if (!name.trim() || !tenantId) {
      setError('escolhe tenant e informa nome');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/uazapi/create-and-attach', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tenantId, name: name.trim() }),
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
    <ModalShell title="criar e atribuir" onClose={() => onClose(false)}>
      <form
        onSubmit={handleSubmit}
        style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
      >
        <div style={{ fontSize: 13, color: 'var(--text-dim)' }}>
          cria uma instância nova direto na UAZAPI e já vincula ao tenant
          escolhido.
        </div>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={fieldLabel}>tenant</span>
          <select
            value={tenantId}
            onChange={(e) => setTenantId(e.target.value)}
            required
            disabled={submitting}
            style={{ ...inputStyle, cursor: 'pointer' }}
          >
            {tenants.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.plan})
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={fieldLabel}>nome da instância UAZAPI</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            disabled={submitting}
            style={inputStyle}
            placeholder="ex.: acme-prod"
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
            {submitting ? '⟳ criando...' : '✓ criar e atribuir'}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

/* -------------------------------------------------------------------------- */
/* Bits                                                                       */
/* -------------------------------------------------------------------------- */

function InstanceStatus({
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
  const className = status === 'connecting' ? 'live-dot' : undefined;
  return (
    <span
      className={className}
      style={{
        padding: '3px 10px',
        borderRadius: 'var(--radius-pill)',
        border: '2px solid var(--stroke)',
        background: bg,
        color: status === 'disconnected' ? 'var(--text-dim)' : 'var(--ink-900)',
        fontSize: 11,
        fontWeight: 800,
      }}
    >
      {label}
    </span>
  );
}

function EmptyInstances({
  canCreate,
  onCreate,
}: {
  canCreate: boolean;
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
      <div style={{ fontSize: 48 }}>⚡</div>
      <h3
        style={{
          margin: 0,
          fontFamily: 'var(--font-display)',
          fontSize: 22,
          fontWeight: 800,
        }}
      >
        nenhuma instância na UAZAPI
      </h3>
      <p style={{ margin: 0, color: 'var(--text-dim)', fontSize: 14 }}>
        cria uma instância nova e já atribui pra um tenant.
      </p>
      {canCreate && (
        <button
          type="button"
          className="btn btn-zap"
          onClick={onCreate}
        >
          + criar e atribuir
        </button>
      )}
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

function formatDate(iso: string | null): string {
  if (!iso) return '—';
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
