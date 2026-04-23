'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

/**
 * Top-bar action on `/history` — triggers a server-side refetch of the page
 * so new messages (possibly arrived via webhook) show up without a manual
 * browser reload. Uses `router.refresh()` rather than a client-side fetch
 * so the server can also re-resolve signed URLs for newly-downloaded media.
 */
export function RefreshButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [spinning, setSpinning] = useState(false);

  const onClick = () => {
    setSpinning(true);
    startTransition(() => {
      router.refresh();
      // Release the spinner shortly after the transition starts so the icon
      // animates even on fast refreshes — the transition itself ends before
      // the user can perceive it otherwise.
      setTimeout(() => setSpinning(false), 600);
    });
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isPending}
      className="btn"
      aria-label="Atualizar histórico"
      style={{ fontSize: 13, padding: '8px 14px' }}
    >
      <span
        aria-hidden
        style={{
          display: 'inline-block',
          marginRight: 6,
          transition: 'transform 0.5s ease',
          transform: spinning ? 'rotate(360deg)' : 'rotate(0deg)',
        }}
      >
        🔄
      </span>
      {isPending ? 'atualizando…' : 'atualizar'}
    </button>
  );
}

export default RefreshButton;
