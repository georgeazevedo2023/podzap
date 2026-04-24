'use client';

/**
 * Client-only boundary para `MessagesList`.
 *
 * Next 15 proíbe `dynamic({ ssr: false })` em server components — o server
 * não pode decidir SSR bit pra um child. Solução: um componente `use client`
 * fininho que declara o dynamic import. O server component `page.tsx`
 * importa este wrapper normalmente.
 *
 * Por que client-only: a lista tinha (ou tem) hydration mismatches que
 * derrubavam scroll + cliques do subtree via React error #418. Renderizando
 * client-only, eliminamos a classe inteira de bug — SSR só entrega o
 * skeleton esqueleto cinza, cliente monta a lista após mount.
 */
import dynamic from 'next/dynamic';

import type { HistoryItem } from './MessagesList';

const MessagesListInner = dynamic(
  () => import('./MessagesList').then((m) => m.MessagesList),
  {
    ssr: false,
    loading: () => <MessagesListSkeleton />,
  },
);

function MessagesListSkeleton() {
  return (
    <div
      role="status"
      aria-label="carregando mensagens"
      style={{
        display: 'grid',
        gap: 12,
        gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
      }}
    >
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          aria-hidden
          style={{
            height: 92,
            borderRadius: 'var(--r-md)',
            border: '2.5px solid var(--stroke)',
            background: 'var(--bg-2)',
            opacity: 0.35 + (i % 2) * 0.1,
          }}
        />
      ))}
    </div>
  );
}

export function MessagesListClient({ initial }: { initial: HistoryItem[] }) {
  return <MessagesListInner initial={initial} />;
}

export default MessagesListClient;
