'use client';

/**
 * `AudioStatus` — Fase 9 client widget for the approval detail side panel.
 *
 * Mounts when a summary is `approved` and polls
 * `GET /api/audios/[summaryId]/signed-url` until the TTS worker produces the
 * audio file. While the worker is still generating the audio the route
 * responds 404; once the row is persisted it responds 200 with
 * `{ url, durationSeconds?, mimeType? }` and we swap to a `<audio>` player.
 *
 * Polling strategy (kept tight on purpose — Gemini TTS for a typical summary
 * finishes well under 60s):
 *   - Poll on mount, then every `POLL_INTERVAL_MS` (5s)
 *   - Bail after `MAX_POLLS` attempts (12 = ~1 min total)
 *   - On timeout we render a "tentar de novo" button that restarts the loop
 *   - Non-404 errors are surfaced immediately and halt polling
 */

import { useCallback, useEffect, useRef, useState } from 'react';

export interface AudioStatusProps {
  summaryId: string;
}

interface SignedUrlResponse {
  url: string;
  durationSeconds?: number | null;
  mimeType?: string | null;
}

type State =
  | { kind: 'pending'; attempts: number }
  | { kind: 'ready'; data: SignedUrlResponse }
  | { kind: 'timeout' }
  | { kind: 'error'; message: string };

const POLL_INTERVAL_MS = 5_000;
const MAX_POLLS = 12;

/** Parse the JSON body of a failed response for a user-facing message.
 *  Mirrors the `{ error: { code, message } }` envelope other Fase 8/9 routes
 *  already use. Falls back to the status code. */
async function parseErrorMessage(res: Response): Promise<string> {
  try {
    const payload = (await res.json()) as {
      error?: { message?: string };
    } | null;
    if (payload?.error?.message) return payload.error.message;
  } catch {
    // ignore — fall through to status-code fallback
  }
  return `Falha ao carregar áudio (${res.status}).`;
}

/** Format seconds as `m:ss`. Returns null when we don't have a duration. */
function formatDuration(seconds: number | null | undefined): string | null {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) {
    return null;
  }
  const total = Math.round(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function AudioStatus({ summaryId }: AudioStatusProps) {
  const [state, setState] = useState<State>({ kind: 'pending', attempts: 0 });

  // `runId` lets the user-triggered "tentar de novo" button restart polling
  // without racing with a stale in-flight loop (stale closures bail on
  // mismatch).
  const [runId, setRunId] = useState(0);

  // Track the current attempt count in a ref so the polling effect can see
  // the latest value without re-subscribing on every state update.
  const attemptsRef = useRef(0);

  const fetchOnce = useCallback(
    async (signal: AbortSignal): Promise<'ready' | 'pending' | 'stop'> => {
      const res = await fetch(
        `/api/audios/${encodeURIComponent(summaryId)}/signed-url`,
        { cache: 'no-store', signal },
      );
      if (signal.aborted) return 'stop';

      if (res.ok) {
        const data = (await res.json()) as SignedUrlResponse;
        setState({ kind: 'ready', data });
        return 'ready';
      }
      if (res.status === 404) {
        return 'pending';
      }
      const message = await parseErrorMessage(res);
      setState({ kind: 'error', message });
      return 'stop';
    },
    [summaryId],
  );

  useEffect(() => {
    const controller = new AbortController();
    let timer: number | null = null;
    let cancelled = false;

    attemptsRef.current = 0;
    setState({ kind: 'pending', attempts: 0 });

    const tick = async () => {
      if (cancelled) return;
      attemptsRef.current += 1;

      let outcome: 'ready' | 'pending' | 'stop';
      try {
        outcome = await fetchOnce(controller.signal);
      } catch (err) {
        if (cancelled || controller.signal.aborted) return;
        setState({
          kind: 'error',
          message:
            err instanceof Error
              ? err.message
              : 'Erro inesperado ao carregar áudio.',
        });
        return;
      }

      if (cancelled) return;
      if (outcome === 'ready' || outcome === 'stop') return;

      // still pending — decide whether to schedule another poll
      if (attemptsRef.current >= MAX_POLLS) {
        setState({ kind: 'timeout' });
        return;
      }
      setState({ kind: 'pending', attempts: attemptsRef.current });
      timer = window.setTimeout(tick, POLL_INTERVAL_MS);
    };

    void tick();

    return () => {
      cancelled = true;
      controller.abort();
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [fetchOnce, runId]);

  if (state.kind === 'ready') {
    const duration = formatDuration(state.data.durationSeconds);
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <audio
          controls
          src={state.data.url}
          preload="none"
          style={{ width: '100%' }}
        />
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
            flexWrap: 'wrap',
          }}
        >
          {duration ? (
            <span
              style={{
                fontSize: 12,
                fontFamily: 'var(--font-mono)',
                color: 'var(--text-dim)',
              }}
            >
              duração {duration}
            </span>
          ) : (
            <span />
          )}
          <a
            href={state.data.url}
            download
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: 'var(--zap-600, var(--zap-500))',
              textDecoration: 'underline',
            }}
          >
            ↓ baixar
          </a>
        </div>
      </div>
    );
  }

  if (state.kind === 'timeout') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div
          style={{
            fontSize: 12,
            color: 'var(--text-dim)',
            lineHeight: 1.4,
          }}
        >
          A geração demorou mais que o esperado.
        </div>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => setRunId((n) => n + 1)}
          aria-label="Tentar recarregar o áudio"
          style={{ alignSelf: 'flex-start' }}
        >
          ⟳ tentar recarregar
        </button>
      </div>
    );
  }

  if (state.kind === 'error') {
    return (
      <div
        role="alert"
        style={{
          fontSize: 12,
          color: 'var(--color-red-500)',
          lineHeight: 1.4,
        }}
      >
        {state.message}
      </div>
    );
  }

  // pending — live sticker with pulsing dot
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        alignItems: 'flex-start',
      }}
    >
      <span
        className="sticker"
        style={{
          background: 'var(--yellow-500)',
          color: 'var(--ink-900)',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        <span className="live-dot" aria-hidden />
        <span>gerando áudio…</span>
      </span>
      <span
        style={{
          fontSize: 11,
          fontFamily: 'var(--font-mono)',
          color: 'var(--text-dim)',
        }}
      >
        tentativa {state.attempts}/{MAX_POLLS}
      </span>
    </div>
  );
}

export default AudioStatus;
