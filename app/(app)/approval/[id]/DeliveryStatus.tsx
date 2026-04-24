'use client';

/**
 * `DeliveryStatus` — Fase 10 client widget for the approval-page side panel.
 *
 * Mirrors `AudioStatus` but focuses on the WhatsApp delivery lane rather
 * than the TTS generation lane. Reuses the existing
 * `GET /api/audios/[summaryId]/signed-url` endpoint (which already returns
 * the full `AudioView` in `audio`) instead of adding another route — that
 * endpoint already runs through `requireAuth` + tenant scoping, so the
 * delivery flags come back correctly scoped.
 *
 * States:
 *   - loading      → subtle "checando…" hint while the initial GET is inflight
 *   - not-yet      → the summary has no audio row yet; render nothing (the
 *                    sibling "Áudio" card covers the generating phase)
 *   - ready        → show the green/yellow badge + reenviar button
 *   - error        → surface the error message (no retry needed — page reload
 *                    recovers)
 *
 * The component re-fetches the signed-url endpoint after a redeliver attempt
 * so the badge transitions green once the worker flips the row.
 */

import { useCallback, useEffect, useState } from 'react';

import { SendToMenu, type SendResult } from '@/components/ui/SendToMenu';

import { DeliveryBadge } from '../../podcasts/DeliveryBadge';

export interface DeliveryStatusProps {
  summaryId: string;
}

interface SignedUrlResponse {
  url: string;
  expiresIn: number;
  audio: {
    id: string;
    deliveredToWhatsapp: boolean;
    deliveredAt: string | null;
  };
}

type State =
  | { kind: 'loading' }
  | { kind: 'not-yet' }
  | {
      kind: 'ready';
      audioId: string;
      delivered: boolean;
      deliveredAt: string | null;
      error: boolean;
    }
  | { kind: 'error'; message: string };

async function fetchStatus(
  summaryId: string,
  signal: AbortSignal,
): Promise<
  | { kind: 'ready'; payload: SignedUrlResponse }
  | { kind: 'not-yet' }
  | { kind: 'error'; message: string }
> {
  const res = await fetch(
    `/api/summaries/${encodeURIComponent(summaryId)}/audio/signed-url`,
    { cache: 'no-store', signal },
  );
  if (res.ok) {
    const payload = (await res.json()) as SignedUrlResponse;
    return { kind: 'ready', payload };
  }
  if (res.status === 404) {
    return { kind: 'not-yet' };
  }
  let message = `Falha ao carregar entrega (${res.status}).`;
  try {
    const body = (await res.json()) as { error?: { message?: string } } | null;
    if (body?.error?.message) message = body.error.message;
  } catch {
    // ignore
  }
  return { kind: 'error', message };
}

export function DeliveryStatus({ summaryId }: DeliveryStatusProps) {
  const [state, setState] = useState<State>({ kind: 'loading' });

  const load = useCallback(
    async (signal: AbortSignal) => {
      const outcome = await fetchStatus(summaryId, signal);
      if (signal.aborted) return;
      if (outcome.kind === 'ready') {
        setState({
          kind: 'ready',
          audioId: outcome.payload.audio.id,
          delivered: outcome.payload.audio.deliveredToWhatsapp,
          deliveredAt: outcome.payload.audio.deliveredAt,
          error: false,
        });
      } else if (outcome.kind === 'not-yet') {
        setState({ kind: 'not-yet' });
      } else {
        setState({ kind: 'error', message: outcome.message });
      }
    },
    [summaryId],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  if (state.kind === 'loading') {
    return (
      <span
        style={{
          fontSize: 12,
          color: 'var(--text-dim)',
          fontFamily: 'var(--font-mono)',
        }}
      >
        checando…
      </span>
    );
  }

  if (state.kind === 'not-yet') {
    // The sibling "Áudio" card already communicates "gerando áudio…"; no need
    // to duplicate the state here.
    return (
      <span
        style={{
          fontSize: 12,
          color: 'var(--text-dim)',
          lineHeight: 1.4,
        }}
      >
        aguardando geração do áudio.
      </span>
    );
  }

  if (state.kind === 'error') {
    return (
      <div
        role="alert"
        style={{
          fontSize: 12,
          color: 'var(--red-500)',
          lineHeight: 1.4,
        }}
      >
        {state.message}
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        alignItems: 'flex-start',
      }}
    >
      <DeliveryBadge
        delivered={state.delivered}
        deliveredAt={state.deliveredAt}
        error={state.error}
      />
      <SendToMenu
        audioId={state.audioId}
        label={state.delivered ? 'enviar novamente' : 'enviar'}
        variant={state.delivered ? 'secondary' : 'primary'}
        onResult={(result: SendResult) => {
          if (!result.ok) {
            setState((curr) =>
              curr.kind === 'ready' ? { ...curr, error: true } : curr,
            );
            return;
          }
          // Badge reflete APENAS entrega ao GRUPO.
          if (result.target === 'group') {
            setState((curr) =>
              curr.kind === 'ready'
                ? {
                    ...curr,
                    delivered: true,
                    deliveredAt: new Date().toISOString(),
                    error: false,
                  }
                : curr,
            );
          } else {
            setState((curr) =>
              curr.kind === 'ready' ? { ...curr, error: false } : curr,
            );
          }
        }}
      />
    </div>
  );
}

export default DeliveryStatus;
