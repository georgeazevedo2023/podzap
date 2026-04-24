'use client';

/**
 * `DeliveryControls` — co-loca o `DeliveryBadge` (status de entrega ao
 * GRUPO) + o `SendToMenu` (dropdown de destinos) num card de podcast.
 *
 * O badge reflete especificamente `delivered_to_whatsapp` (que só vira
 * true quando o envio foi pro grupo de origem — ver semântica em
 * `lib/delivery/service.ts#runDelivery`). Envios pra "mim" ou pra
 * contato avulso não alteram o badge, mas o toast do SendToMenu
 * confirma o resultado.
 *
 * `/podcasts/page.tsx` é server component — este é o client island
 * por card.
 */

import { useState } from 'react';

import { SendToMenu, type SendResult } from '@/components/ui/SendToMenu';

import { DeliveryBadge } from './DeliveryBadge';

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
      <SendToMenu
        audioId={audioId}
        label={delivered ? 'enviar novamente' : 'enviar'}
        variant={delivered ? 'secondary' : 'primary'}
        onResult={(result: SendResult) => {
          if (!result.ok) {
            setError(true);
            return;
          }
          setError(false);
          // Badge só reflete entrega ao GRUPO. Outros destinos não mudam
          // o estado do row — só o toast dentro do SendToMenu confirma.
          if (result.target === 'group') {
            setDelivered(true);
            setDeliveredAt(new Date().toISOString());
          }
        }}
      />
    </div>
  );
}

export default DeliveryControls;
