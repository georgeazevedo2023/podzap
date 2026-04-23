'use client';

/**
 * `RedeliverButton` — Fase 10 "↻ reenviar" trigger.
 *
 * POSTs to `/api/audios/<audioId>/redeliver` and surfaces the result via a
 * lightweight inline toast (no global toast context — the button's own
 * `<span>` below it shows success/error for a few seconds, which keeps the
 * component self-contained and matches the ad-hoc toast pattern used by
 * other Fase 8/9 client widgets).
 *
 * `onResult` lets the parent card flip the adjacent `DeliveryBadge` into
 * the error state on failure, or optimistically show "enviando…" after a
 * successful enqueue (the Inngest worker then flips the row to delivered).
 */

import { useCallback, useState } from 'react';

type ErrorEnvelope = {
  error?: { code?: string; message?: string };
};

export interface RedeliverButtonProps {
  audioId: string;
  onResult?: (result: { ok: boolean; message: string }) => void;
}

type Status = { kind: 'idle' } | { kind: 'pending' } | { kind: 'done'; ok: boolean; message: string };

async function parseError(res: Response): Promise<string> {
  try {
    const payload = (await res.json()) as ErrorEnvelope | null;
    if (payload?.error?.message) return payload.error.message;
  } catch {
    // ignore
  }
  return `Falha ao reenviar (${res.status}).`;
}

export function RedeliverButton({ audioId, onResult }: RedeliverButtonProps) {
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  const submit = useCallback(async () => {
    setStatus({ kind: 'pending' });
    try {
      const res = await fetch(
        `/api/audios/${encodeURIComponent(audioId)}/redeliver`,
        { method: 'POST', cache: 'no-store' },
      );
      if (res.ok) {
        const msg = 'Reenvio solicitado.';
        setStatus({ kind: 'done', ok: true, message: msg });
        onResult?.({ ok: true, message: msg });
      } else {
        const msg = await parseError(res);
        setStatus({ kind: 'done', ok: false, message: msg });
        onResult?.({ ok: false, message: msg });
      }
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Erro de rede ao reenviar.';
      setStatus({ kind: 'done', ok: false, message: msg });
      onResult?.({ ok: false, message: msg });
    }

    // Auto-clear the inline toast after 4s so the button returns to idle.
    window.setTimeout(() => {
      setStatus((curr) => (curr.kind === 'done' ? { kind: 'idle' } : curr));
    }, 4000);
  }, [audioId, onResult]);

  const busy = status.kind === 'pending';

  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        flexWrap: 'wrap',
      }}
    >
      <button
        type="button"
        className="btn btn-ghost"
        onClick={submit}
        disabled={busy}
        aria-label="Reenviar áudio pelo WhatsApp"
        style={{ fontSize: 12, fontWeight: 700 }}
      >
        {busy ? '↻ reenviando…' : '↻ reenviar'}
      </button>
      {status.kind === 'done' ? (
        <span
          role="status"
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: status.ok ? 'var(--zap-600, var(--zap-500))' : 'var(--red-500)',
          }}
        >
          {status.message}
        </span>
      ) : null}
    </div>
  );
}

export default RedeliverButton;
