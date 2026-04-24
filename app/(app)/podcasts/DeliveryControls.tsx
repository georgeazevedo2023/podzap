'use client';

/**
 * `DeliveryControls` — Fase 10 wrapper that co-locates the delivery
 * `DeliveryBadge` + `RedeliverButton` for one audio row.
 *
 * Owns the tiny bit of shared client state both pieces need:
 *   - A successful POST optimistically flips the badge back to "enviando…"
 *     (the Inngest worker will flip the row to delivered shortly after).
 *   - A failed POST raises the red error badge until the next attempt.
 *
 * `/podcasts/page.tsx` is a server component, so it mounts this small
 * client island per card instead of threading a client boundary through
 * the entire `EpisodeCard`.
 */

import { useState } from 'react';

import { DeliveryBadge } from './DeliveryBadge';
import { RedeliverButton } from './RedeliverButton';

export interface DeliveryControlsProps {
  audioId: string;
  delivered: boolean;
  deliveredAt: string | null;
}

export function DeliveryControls({
  audioId,
  delivered: initialDelivered,
  deliveredAt: initialDeliveredAt,
}: DeliveryControlsProps) {
  const [delivered, setDelivered] = useState<boolean>(initialDelivered);
  const [deliveredAt, setDeliveredAt] = useState<string | null>(
    initialDeliveredAt,
  );
  const [error, setError] = useState<boolean>(false);

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        flexWrap: 'wrap',
      }}
    >
      <DeliveryBadge
        delivered={delivered}
        deliveredAt={deliveredAt}
        error={error}
      />
      <RedeliverButton
        audioId={audioId}
        delivered={delivered}
        onResult={(result) => {
          if (result.ok) {
            // Endpoint /redeliver é síncrono (chama UAZAPI + atualiza DB
            // antes de responder). Quando ok=true, o áudio JÁ foi enviado
            // ao grupo — flipa o badge imediatamente.
            setDelivered(true);
            setDeliveredAt(
              result.deliveredAt ?? new Date().toISOString(),
            );
            setError(false);
          } else {
            setError(true);
          }
        }}
      />
    </div>
  );
}

export default DeliveryControls;
