'use client';

/**
 * `DeliveryBadge` — Fase 10 delivery status sticker.
 *
 * Renders one of three chunky pill states:
 *   - green  `✓ entregue há <relative>`       quando `delivered=true`
 *   - lime   `🔒 aguardando autorização`      quando `delivered=false`. NÃO é
 *                                              "enviando…": entrega é 100%
 *                                              manual — o áudio só sai do
 *                                              bucket pro grupo quando o
 *                                              admin clica o botão "enviar
 *                                              ao grupo" no card. Esse é o
 *                                              estado de "áudio pronto pra
 *                                              preview, nada foi pro grupo".
 *   - red    `falha na entrega`               quando o caller levanta
 *                                              `error=true` após POST falho.
 *
 * O badge é read-only — o sibling `RedeliverButton` (renomeado pra
 * "enviar ao grupo") é que dispara a entrega de fato.
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
        background: 'var(--lime-500)',
        color: 'var(--ink-900)',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
      }}
      role="status"
      title="Nada foi enviado ao grupo ainda — use o botão ao lado pra autorizar"
    >
      <span aria-hidden>🔒</span>
      aguardando autorização
    </span>
  );
}

export default DeliveryBadge;
