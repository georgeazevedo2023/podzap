'use client';

import { useState } from 'react';

export interface CopyableCaptionProps {
  caption: string;
  label?: string;
}

export function CopyableCaption({
  caption,
  label = '💬 Legenda do WhatsApp',
}: CopyableCaptionProps) {
  const [copied, setCopied] = useState(false);
  const [hover, setHover] = useState(false);

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

  const buttonBg = copied ? 'var(--lime-500)' : 'var(--purple-500)';
  const buttonFg = copied ? 'var(--ink-900)' : '#FFFBF2';
  const shadowColor = 'var(--stroke)';
  const shadowOffset = hover && !copied ? 5 : 3;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <div
          style={{
            fontSize: 12,
            fontWeight: 800,
            letterSpacing: '0.06em',
            color: 'var(--text)',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
          }}
        >
          {label}
        </div>
        <button
          type="button"
          onClick={handleCopy}
          onMouseEnter={() => setHover(true)}
          onMouseLeave={() => setHover(false)}
          aria-live="polite"
          style={{
            cursor: 'pointer',
            padding: '8px 16px',
            border: '2.5px solid var(--stroke)',
            borderRadius: 999,
            background: buttonBg,
            color: buttonFg,
            fontFamily: 'var(--font-body)',
            fontSize: 12,
            fontWeight: 800,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            boxShadow: `${shadowOffset}px ${shadowOffset}px 0 ${shadowColor}`,
            transform:
              hover && !copied
                ? 'translate(-1px, -1px)'
                : 'translate(0, 0)',
            transition:
              'transform 120ms cubic-bezier(0.2, 0.8, 0.2, 1), box-shadow 120ms cubic-bezier(0.2, 0.8, 0.2, 1), background 200ms ease, color 200ms ease',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            userSelect: 'none',
            whiteSpace: 'nowrap',
          }}
        >
          <span
            aria-hidden
            style={{
              display: 'inline-flex',
              width: 18,
              height: 18,
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 14,
              lineHeight: 1,
            }}
          >
            {copied ? '✓' : '📋'}
          </span>
          {copied ? 'copiado!' : 'copiar'}
        </button>
      </div>

      <div
        style={{
          position: 'relative',
          padding: '16px 18px 16px 22px',
          border: '2.5px solid var(--stroke)',
          borderRadius: 14,
          background:
            'linear-gradient(135deg, color-mix(in srgb, var(--purple-500) 8%, var(--bg-2)) 0%, var(--bg-2) 60%)',
          boxShadow: '3px 3px 0 var(--stroke)',
          fontFamily: 'var(--font-body)',
          fontSize: 13,
          lineHeight: 1.6,
          whiteSpace: 'pre-wrap',
          color: 'var(--text)',
          overflow: 'hidden',
        }}
      >
        <span
          aria-hidden
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: 0,
            width: 5,
            background: 'var(--lime-500)',
          }}
        />
        {caption}
      </div>
    </div>
  );
}
