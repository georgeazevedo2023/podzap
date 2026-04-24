'use client';

import { useState } from 'react';

export interface CopyableCaptionProps {
  caption: string;
  label?: string;
}

export function CopyableCaption({
  caption,
  label = 'Legenda — preview da mensagem que acompanha o áudio no zap',
}: CopyableCaptionProps) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(caption);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = caption;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      } finally {
        document.body.removeChild(ta);
      }
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10,
        }}
      >
        <div
          style={{
            fontSize: 11,
            fontWeight: 800,
            textTransform: 'uppercase',
            letterSpacing: '0.12em',
            color: 'var(--text-dim)',
          }}
        >
          {label}
        </div>
        <button
          type="button"
          onClick={handleCopy}
          aria-live="polite"
          style={{
            cursor: 'pointer',
            padding: '4px 10px',
            border: '2px solid var(--stroke)',
            borderRadius: 999,
            background: copied ? 'var(--lime-500)' : 'var(--bg-2)',
            color: copied ? 'var(--ink-900)' : 'var(--text)',
            fontSize: 10,
            fontWeight: 800,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            boxShadow: '2px 2px 0 var(--stroke)',
            transition: 'background 120ms ease',
          }}
        >
          {copied ? '✓ copiado' : '📋 copiar'}
        </button>
      </div>
      <div
        style={{
          padding: '14px 18px',
          border: '2.5px solid var(--stroke)',
          borderRadius: 'var(--radius-md, var(--r-md))',
          background: 'var(--bg-2)',
          boxShadow: '2px 2px 0 var(--stroke)',
          fontFamily: 'var(--font-body)',
          fontSize: 13,
          lineHeight: 1.55,
          whiteSpace: 'pre-wrap',
          color: 'var(--text)',
        }}
      >
        {caption}
      </div>
    </div>
  );
}
