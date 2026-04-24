'use client';

/**
 * `RedeliverButton` — botão de envio ao grupo.
 *
 * Duplo papel, controlado por `delivered`:
 *   - `delivered=false` → PRIMARY "📤 enviar ao grupo". Esse é o ÚNICO
 *     caminho de delivery: clique humano explícito. Nada é enviado ao
 *     grupo até o admin clicar aqui.
 *   - `delivered=true`  → secondary "↻ reenviar" pra retry / reshare.
 *
 * POSTa em `/api/audios/<audioId>/redeliver` — handler é síncrono (chama
 * lib/delivery/service.ts#redeliver → UAZAPI /send/media), então quando a
 * resposta volta o row já está flipado pra delivered=true.
 *
 * `onResult` informa o pai (DeliveryControls) pro badge refletir o novo
 * estado (entregue / falha) sem esperar o server-refresh.
 */

import { useCallback, useState } from 'react';

type ErrorEnvelope = {
  error?: { code?: string; message?: string };
};

type DeliveryEnvelope = {
  delivery?: { deliveredAt?: string | null };
};

export interface RedeliverButtonProps {
  audioId: string;
  /** Estado atual do row — governa primary vs secondary. */
  delivered: boolean;
  onResult?: (result: {
    ok: boolean;
    message: string;
    deliveredAt?: string | null;
  }) => void;
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

export function RedeliverButton({
  audioId,
  delivered,
  onResult,
}: RedeliverButtonProps) {
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [confirming, setConfirming] = useState<boolean>(false);

  const submit = useCallback(async () => {
    setStatus({ kind: 'pending' });
    try {
      const res = await fetch(
        `/api/audios/${encodeURIComponent(audioId)}/redeliver`,
        { method: 'POST', cache: 'no-store' },
      );
      if (res.ok) {
        const payload = (await res.json().catch(() => null)) as
          | DeliveryEnvelope
          | null;
        const msg = delivered ? 'Reenvio concluído.' : 'Enviado ao grupo.';
        setStatus({ kind: 'done', ok: true, message: msg });
        onResult?.({
          ok: true,
          message: msg,
          deliveredAt: payload?.delivery?.deliveredAt ?? null,
        });
      } else {
        const msg = await parseError(res);
        setStatus({ kind: 'done', ok: false, message: msg });
        onResult?.({ ok: false, message: msg });
      }
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Erro de rede ao enviar.';
      setStatus({ kind: 'done', ok: false, message: msg });
      onResult?.({ ok: false, message: msg });
    }

    // Auto-clear the inline toast after 4s so the button returns to idle.
    window.setTimeout(() => {
      setStatus((curr) => (curr.kind === 'done' ? { kind: 'idle' } : curr));
      setConfirming(false);
    }, 4000);
  }, [audioId, delivered, onResult]);

  const busy = status.kind === 'pending';

  // Two variants: primary ("enviar ao grupo") when nothing was sent yet,
  // secondary ("reenviar") once a delivery already landed. The primary is
  // gated by a 1-click confirmation step so a misclick can't publish to
  // the group — critical: the whole point of this page is that the admin
  // previews before publishing.
  const isPrimary = !delivered;
  const primaryClass = isPrimary ? 'btn btn-zap' : 'btn btn-ghost';
  const primaryLabel = isPrimary
    ? busy
      ? '📤 enviando…'
      : confirming
        ? '📤 confirmar envio ao grupo'
        : '📤 enviar ao grupo'
    : busy
      ? '↻ reenviando…'
      : '↻ reenviar';

  const ariaLabel = isPrimary
    ? 'Autorizar envio do áudio ao grupo do WhatsApp'
    : 'Reenviar áudio ao grupo';

  const onClick = () => {
    if (busy) return;
    if (isPrimary && !confirming) {
      setConfirming(true);
      window.setTimeout(() => setConfirming(false), 5000);
      return;
    }
    submit();
  };

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
        className={primaryClass}
        onClick={onClick}
        disabled={busy}
        aria-label={ariaLabel}
        style={{
          fontSize: isPrimary ? 13 : 12,
          fontWeight: 800,
          padding: isPrimary ? '8px 16px' : undefined,
        }}
      >
        {primaryLabel}
      </button>
      {isPrimary && confirming && status.kind !== 'pending' ? (
        <span
          role="status"
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: 'var(--text-dim)',
          }}
        >
          clique de novo pra confirmar (5s)
        </span>
      ) : null}
      {status.kind === 'done' ? (
        <span
          role="status"
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: status.ok
              ? 'var(--zap-600, var(--zap-500))'
              : 'var(--red-500)',
          }}
        >
          {status.message}
        </span>
      ) : null}
    </div>
  );
}

export default RedeliverButton;
