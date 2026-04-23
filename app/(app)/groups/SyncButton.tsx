'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

/** ms to leave the "synced X of Y" toast on screen before auto-dismissing. */
const TOAST_AUTO_DISMISS_MS = 4_000;

type Toast =
  | { kind: 'success'; synced: number; total: number }
  | { kind: 'error'; message: string };

/**
 * "Sincronizar" button: POST /api/groups/sync, then `router.refresh()` so the
 * server `/groups` page re-fetches the updated list.
 *
 * Rendered both in the `TopBar` actions slot and inside empty states, so it
 * is self-contained: no props, no shared state.
 *
 * On 409 `NO_INSTANCE` the button surfaces a distinct error ("Conecte o
 * WhatsApp primeiro") instead of the generic "falha ao sincronizar".
 *
 * We use a plain `fetch` + client state rather than a React 19 server
 * action so this component can live anywhere (including inside the
 * synchronous TopBar slot) and so we have a clean place to decode the
 * `NO_INSTANCE` envelope.
 */
export function SyncButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);

  // Auto-dismiss success toasts; errors stick until the user hits "sync" again.
  useEffect(() => {
    if (!toast || toast.kind !== 'success') return;
    const id = setTimeout(() => setToast(null), TOAST_AUTO_DISMISS_MS);
    return () => clearTimeout(id);
  }, [toast]);

  const handleSync = useCallback(async () => {
    if (loading) return;
    setLoading(true);
    setToast(null);
    try {
      const res = await fetch('/api/groups/sync', {
        method: 'POST',
        cache: 'no-store',
      });
      const payload = (await res.json().catch(() => null)) as
        | { synced?: number; total?: number; error?: { code?: string; message?: string } }
        | null;

      if (!res.ok) {
        const code = payload?.error?.code;
        if (res.status === 409 && code === 'NO_INSTANCE') {
          setToast({
            kind: 'error',
            message: 'Conecte o WhatsApp primeiro para sincronizar.',
          });
          return;
        }
        const message =
          payload?.error?.message ??
          `Falha ao sincronizar grupos (${res.status}).`;
        setToast({ kind: 'error', message });
        return;
      }

      setToast({
        kind: 'success',
        synced: payload?.synced ?? 0,
        total: payload?.total ?? 0,
      });
      // Re-fetch the server page so the list reflects freshly synced data.
      router.refresh();
    } catch (err) {
      setToast({
        kind: 'error',
        message:
          err instanceof Error
            ? err.message
            : 'Erro inesperado ao sincronizar.',
      });
    } finally {
      setLoading(false);
    }
  }, [loading, router]);

  return (
    <>
      <button
        type="button"
        onClick={handleSync}
        disabled={loading}
        aria-label="Sincronizar grupos do WhatsApp"
        className="btn btn-purple"
        style={{ opacity: loading ? 0.75 : 1 }}
      >
        {loading ? '⟳ sincronizando...' : '⟳ sincronizar'}
      </button>

      {toast && (
        <div
          role={toast.kind === 'error' ? 'alert' : 'status'}
          aria-live="polite"
          style={{
            position: 'fixed',
            right: 24,
            bottom: 24,
            maxWidth: 360,
            padding: '14px 18px',
            borderRadius: 'var(--radius-md)',
            border: '2.5px solid var(--stroke)',
            background:
              toast.kind === 'success'
                ? 'var(--lime-500)'
                : 'rgba(255, 77, 60, 0.12)',
            color:
              toast.kind === 'success'
                ? 'var(--ink-900)'
                : 'var(--red-500)',
            boxShadow: 'var(--shadow-chunk-lg)',
            fontSize: 13,
            fontWeight: 700,
            zIndex: 50,
            display: 'flex',
            gap: 10,
            alignItems: 'flex-start',
          }}
        >
          <span aria-hidden style={{ fontSize: 16 }}>
            {toast.kind === 'success' ? '✓' : '⚠'}
          </span>
          <span style={{ flex: 1 }}>
            {toast.kind === 'success'
              ? `${toast.synced} de ${toast.total} grupos sincronizados.`
              : toast.message}
          </span>
          <button
            type="button"
            onClick={() => setToast(null)}
            aria-label="Dispensar"
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              fontSize: 14,
              fontWeight: 800,
              color: 'inherit',
            }}
          >
            ✕
          </button>
        </div>
      )}
    </>
  );
}

export default SyncButton;
