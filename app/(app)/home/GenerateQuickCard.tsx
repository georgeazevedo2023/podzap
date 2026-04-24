'use client';

import { useState } from 'react';

import { Icons } from '@/components/icons/Icons';
import { MicMascot } from '@/components/ui/MicMascot';

import { GenerateNowModal } from './GenerateNowModal';

/**
 * "bora" quick-action card — sprinkle background + party-mascot mic.
 *
 * Opens an inline modal (`GenerateNowModal`) so the user can kick off a
 * one-shot summary (pick group + tone + window) without going through
 * `/schedule`. On success, routes to `/approval` where the resumo shows
 * up pending review ~30s later.
 */
export function GenerateQuickCard(): React.ReactElement {
  const [open, setOpen] = useState(false);

  return (
    <>
      <div
        className="card sprinkle"
        style={{ padding: 18, position: 'relative', overflow: 'hidden' }}
      >
        <div style={{ position: 'absolute', top: -8, right: -8 }}>
          <MicMascot size={72} mood="party" />
        </div>
        <span className="sticker sticker-pink" style={{ marginBottom: 10 }}>
          ✨ bora
        </span>
        <h3
          style={{
            margin: '0 0 6px',
            fontFamily: 'var(--font-display)',
            fontSize: 20,
            fontWeight: 800,
            lineHeight: 1.05,
            letterSpacing: '-0.02em',
            maxWidth: 160,
          }}
        >
          gerar resumo agora
        </h3>
        <p
          style={{
            margin: 0,
            fontSize: 12,
            color: 'var(--color-text-dim)',
          }}
        >
          pega as últimas 24h do grupo e vira um pod de 5 min
        </p>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="btn btn-purple"
          style={{
            marginTop: 14,
            width: '100%',
            justifyContent: 'center',
            border: '2.5px solid var(--stroke)',
            cursor: 'pointer',
          }}
        >
          <Icons.Sparkle /> fazer podcast
        </button>
      </div>

      <GenerateNowModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}

export default GenerateQuickCard;
