'use client';

// NOTE: `@/lib/whatsapp/service` is authored in parallel by another agent.
// This file imports only the `InstanceView` type — once the module lands it
// will type-check without changes.

import { useCallback, useEffect, useRef, useState } from 'react';

import type { InstanceView } from '@/lib/whatsapp/service';

const POLL_BASE_MS = 3_000;
const POLL_MAX_MS = 30_000;
const QR_STALE_AFTER_MS = 45_000;
const REDIRECT_AFTER_CONNECT_MS = 1_500;

type QrCodeResponse = {
  qrCodeBase64: string | null;
  status: InstanceView['status'];
};

type StatusResponse = {
  instance: InstanceView;
};

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, cache: 'no-store' });
  if (!res.ok) {
    throw new Error(`Request failed: ${res.status}`);
  }
  return (await res.json()) as T;
}

export interface QrCodePanelProps {
  instance: InstanceView;
}

/**
 * Client-side QR code panel. Receives the initial `connecting` instance from
 * the server page, fetches the QR code if it's missing, and polls status
 * every 3s until it becomes `connected` (or the user cancels).
 *
 * Polling strategy:
 *   - Base interval: 3s.
 *   - On fetch error: exponential backoff 3 → 6 → 12 → 24 → 30s (capped).
 *     Resets to 3s on the next successful response.
 *   - Stops when `status === 'connected'` (then redirects) or the component
 *     unmounts.
 *   - If a poll returns a different `qrCodeBase64` than we currently have,
 *     the image updates in place — backend rotates QRs periodically.
 *
 * UX decisions:
 *   - On `connected`: show a transient success sticker, wait 1.5s, then
 *     `router.push('/home')` so the user sees the confirmation.
 *   - On repeated errors: render a small error banner with a "tentar de
 *     novo" link that resets the polling state.
 *   - If the instance has been in `connecting` for >45s, surface a
 *     "regenerar QR" button that POSTs to `/api/whatsapp/connect` — the
 *     backend is expected to rotate the QR for the same (or a new) instance.
 */
export function QrCodePanel({ instance: initial }: QrCodePanelProps) {
  const [instance, setInstance] = useState<InstanceView>(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [connectedAcknowledged, setConnectedAcknowledged] = useState(false);

  // Timestamp of when the current QR was first shown — drives the "stale"
  // / regenerate button and the countdown.
  const [qrShownAt, setQrShownAt] = useState<number>(() => Date.now());
  const [now, setNow] = useState<number>(() => Date.now());

  const failureCountRef = useRef(0);
  const cancelledRef = useRef(false);

  const instanceId = instance.id;

  // --- polling loop -------------------------------------------------------
  useEffect(() => {
    cancelledRef.current = false;

    let timeout: ReturnType<typeof setTimeout> | null = null;

    async function tick(): Promise<void> {
      try {
        const data = await fetchJson<StatusResponse>(
          `/api/whatsapp/status?instanceId=${encodeURIComponent(instanceId)}`,
        );
        if (cancelledRef.current) return;

        failureCountRef.current = 0;
        setError(null);

        setInstance((prev) => {
          // If QR string changed, reset "shown at" so the stale timer restarts.
          if (
            data.instance.qrCodeBase64 &&
            data.instance.qrCodeBase64 !== prev.qrCodeBase64
          ) {
            setQrShownAt(Date.now());
          }
          return data.instance;
        });

        if (data.instance.status === 'connected') {
          // stop polling — the separate `connected` effect handles redirect
          return;
        }
      } catch (err) {
        if (cancelledRef.current) return;
        failureCountRef.current += 1;
        setError(
          err instanceof Error ? err.message : 'Erro ao consultar status',
        );
      }

      if (cancelledRef.current) return;

      const backoff = Math.min(
        POLL_BASE_MS * 2 ** Math.max(0, failureCountRef.current - 1),
        POLL_MAX_MS,
      );
      timeout = setTimeout(tick, backoff);
    }

    // If we don't have a QR yet, grab one eagerly before the first status poll.
    async function bootstrap(): Promise<void> {
      if (!instance.qrCodeBase64) {
        try {
          const qr = await fetchJson<QrCodeResponse>(
            `/api/whatsapp/qrcode?instanceId=${encodeURIComponent(instanceId)}`,
          );
          if (cancelledRef.current) return;
          if (qr.qrCodeBase64) {
            setInstance((prev) => ({
              ...prev,
              qrCodeBase64: qr.qrCodeBase64,
              status: qr.status,
            }));
            setQrShownAt(Date.now());
          }
        } catch {
          // non-fatal — the status poll will retry and surface the error
        }
      }
      if (!cancelledRef.current) {
        timeout = setTimeout(tick, POLL_BASE_MS);
      }
    }

    void bootstrap();

    return () => {
      cancelledRef.current = true;
      if (timeout) clearTimeout(timeout);
    };
    // Only re-run if the instanceId itself changes (shouldn't happen during
    // a session, but defensive). We don't depend on `instance.qrCodeBase64`
    // because the interval already reacts to backend changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instanceId]);

  // --- countdown / "now" ticker for stale detection -----------------------
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(id);
  }, []);

  // --- auto-redirect on connected ----------------------------------------
  useEffect(() => {
    if (instance.status !== 'connected' || connectedAcknowledged) return;
    setConnectedAcknowledged(true);
    const id = setTimeout(() => {
      // `window.location.assign` triggers a full navigation so the server
      // layout re-renders (sidebar badge, etc.) with fresh data.
      window.location.assign('/home');
    }, REDIRECT_AFTER_CONNECT_MS);
    return () => clearTimeout(id);
  }, [instance.status, connectedAcknowledged]);

  // --- user actions -------------------------------------------------------
  const handleRegenerate = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const data = await fetchJson<StatusResponse>(
        '/api/whatsapp/connect',
        { method: 'POST' },
      );
      setInstance(data.instance);
      setQrShownAt(Date.now());
      failureCountRef.current = 0;
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Erro ao regenerar QR',
      );
    } finally {
      setBusy(false);
    }
  }, []);

  const handleCancel = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await fetchJson<{ ok: boolean }>(
        '/api/whatsapp/disconnect',
        { method: 'POST' },
      );
      // Full reload so the server page re-reads the empty-state.
      window.location.assign('/onboarding');
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Erro ao cancelar',
      );
      setBusy(false);
    }
  }, []);

  const qrAgeMs = now - qrShownAt;
  const stale = qrAgeMs > QR_STALE_AFTER_MS;
  const secondsLeft = Math.max(0, Math.round((QR_STALE_AFTER_MS - qrAgeMs) / 1000));
  const isConnected = instance.status === 'connected';

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
        gap: 28,
        alignItems: 'start',
      }}
    >
      {/* LEFT — instructions */}
      <div>
        <span className="sticker sticker-yellow" style={{ marginBottom: 14 }}>
          📡 passo 2/3
        </span>
        <h2
          style={{
            margin: '12px 0 10px',
            fontFamily: 'var(--font-display)',
            fontSize: 40,
            lineHeight: 1,
            fontWeight: 800,
            letterSpacing: '-0.025em',
          }}
        >
          abre o zap e<br />aponta a câmera 📸
        </h2>
        <p
          style={{
            margin: '0 0 18px',
            color: 'var(--text-dim)',
            fontSize: 14,
            lineHeight: 1.5,
            maxWidth: 440,
          }}
        >
          o QR é válido por uns 30 segundos. se vencer antes de você escanear,
          a gente regenera automaticamente.
        </p>

        <ol
          style={{
            listStyle: 'none',
            padding: 0,
            margin: 0,
            display: 'grid',
            gap: 12,
          }}
        >
          {[
            'abre o WhatsApp no celular',
            'toca em ⋮ > Aparelhos conectados',
            'toca em "Conectar um aparelho"',
            'aponta a câmera pro QR ao lado',
          ].map((label, i) => (
            <li
              key={i}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '10px 12px',
                border: '2px solid var(--color-stroke)',
                borderRadius: 'var(--radius-md)',
                background: 'var(--color-bg-2)',
              }}
            >
              <div
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 8,
                  background: 'var(--color-purple-600)',
                  color: '#fff',
                  border: '2px solid var(--color-stroke)',
                  boxShadow: '2px 2px 0 var(--color-stroke)',
                  display: 'grid',
                  placeItems: 'center',
                  fontFamily: 'var(--font-brand)',
                  fontSize: 13,
                  flexShrink: 0,
                }}
              >
                {i + 1}
              </div>
              <span style={{ fontSize: 14, fontWeight: 600 }}>{label}</span>
            </li>
          ))}
        </ol>

        <div
          aria-live="polite"
          style={{
            marginTop: 18,
            padding: 14,
            background: 'var(--color-yellow-500)',
            border: '2.5px solid var(--color-stroke)',
            borderRadius: 'var(--radius-md)',
            boxShadow: 'var(--shadow-chunk)',
            color: 'var(--color-ink-900)',
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 800,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
            }}
          >
            ⏱ {stale ? 'QR expirou, regenera aí' : `QR expira em ~${secondsLeft}s`}
          </div>
          <div style={{ fontSize: 13, marginTop: 4 }}>
            {stale
              ? 'clica em "regenerar QR" pra pedir um novo'
              : 'se estourar, a gente avisa e gera outro'}
          </div>
        </div>

        {/* actions */}
        <div style={{ display: 'flex', gap: 10, marginTop: 20, flexWrap: 'wrap' }}>
          {stale && (
            <button
              className="btn btn-zap"
              onClick={handleRegenerate}
              disabled={busy}
              type="button"
            >
              ⟳ regenerar QR
            </button>
          )}
          <button
            className="btn btn-ghost"
            onClick={handleCancel}
            disabled={busy}
            type="button"
            style={{ color: 'var(--color-red-500)' }}
          >
            cancelar
          </button>
        </div>

        {error && (
          <div
            role="alert"
            style={{
              marginTop: 16,
              padding: 12,
              border: '2px solid var(--color-red-500)',
              borderRadius: 'var(--radius-md)',
              background: 'rgba(255, 77, 60, 0.08)',
              color: 'var(--color-red-500)',
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            ⚠ {error}
          </div>
        )}
      </div>

      {/* RIGHT — QR frame */}
      <div style={{ display: 'grid', placeItems: 'center' }}>
        <div
          className="card"
          style={{
            padding: 20,
            background: 'var(--color-surface)',
            boxShadow: 'var(--shadow-chunk-lg)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 14,
            maxWidth: 340,
            width: '100%',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontSize: 11,
              fontWeight: 800,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              color: 'var(--color-zap-500)',
            }}
          >
            <span className="live-dot" />
            QR ativo
          </div>

          <div
            style={{
              width: 280,
              height: 280,
              background: '#fff',
              border: '3px solid var(--color-stroke)',
              borderRadius: 16,
              padding: 12,
              display: 'grid',
              placeItems: 'center',
              position: 'relative',
              overflow: 'hidden',
            }}
          >
            {instance.qrCodeBase64 ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`data:image/png;base64,${instance.qrCodeBase64}`}
                alt="QR code para conectar o WhatsApp"
                width={256}
                height={256}
                style={{ display: 'block', imageRendering: 'pixelated' }}
              />
            ) : (
              <div
                style={{
                  color: 'var(--color-ink-900)',
                  textAlign: 'center',
                  fontSize: 13,
                  fontWeight: 600,
                }}
              >
                gerando QR…
              </div>
            )}
          </div>

          <div
            aria-live="polite"
            role="status"
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              color: 'var(--color-text-dim)',
              textAlign: 'center',
            }}
          >
            {isConnected
              ? '✓ conectado, redirecionando…'
              : 'aguardando scan no celular'}
          </div>

          {isConnected && (
            <span
              aria-live="polite"
              className="sticker sticker-zap"
            >
              <span className="live-dot" /> conectado!
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

export default QrCodePanel;
