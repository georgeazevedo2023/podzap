'use client';

/**
 * `DeliveryBadge` — Fase 10 delivery status sticker.
 *
 * Renders one of three chunky pill states:
 *   - green  `✓ entregue há <relative>`   when `delivered=true`
 *   - yellow `enviando…` (pulsing dot)    when `delivered=false` (Inngest
 *                                          retries in the background)
 *   - red    `falha na entrega`           when the caller flips `error=true`
 *                                          after a failed `reenviar` attempt
 *
 * The badge is read-only — the sibling `RedeliverButton` owns the POST that
 * triggers a re-delivery. Kept split so the card grid composes them as
 * independent chunks (the badge sits next to the audio player; the button
 * lives in the card footer).
 */

import { formatRelativeTime } from '@/lib/time/relative';

export interface DeliveryBadgeProps {
  delivered: boolean;
  deliveredAt: string | null;
  error?: boolean;
}

export function DeliveryBadge({
  delivered,
  deliveredAt,
  error,
}: DeliveryBadgeProps) {
  if (error) {
    return (
      <span
        className="sticker"
        style={{
          background: 'var(--red-500)',
          color: '#fff',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
        }}
        role="status"
      >
        <span aria-hidden>⚠</span>
        falha na entrega
      </span>
    );
  }

  if (delivered) {
    const relative = deliveredAt ? formatRelativeTime(deliveredAt) : null;
    return (
      <span
        className="sticker"
        style={{
          background: 'var(--zap-500)',
          color: '#fff',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
        }}
        role="status"
        title={deliveredAt ?? undefined}
      >
        <span aria-hidden>✓</span>
        {relative ? `entregue ${relative}` : 'entregue'}
      </span>
    );
  }

  return (
    <span
      className="sticker"
      style={{
        background: 'var(--yellow-500)',
        color: 'var(--ink-900)',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        animation: 'podzapPulse 1.4s ease-in-out infinite',
      }}
      role="status"
    >
      <span className="live-dot" aria-hidden />
      enviando…
      <style>{`
        @keyframes podzapPulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.6; }
        }
      `}</style>
    </span>
  );
}

export default DeliveryBadge;
