'use client';

import { useState, type CSSProperties } from 'react';

/**
 * Campo de senha do /login com botão de mostrar/ocultar. Client component
 * isolado pra página continuar server component (redirect + server action).
 */
export function PasswordInput({ style }: { style: CSSProperties }) {
  const [visible, setVisible] = useState(false);
  const label = visible ? 'Ocultar senha' : 'Mostrar senha';

  return (
    <div style={{ position: 'relative' }}>
      <input
        id="password"
        name="password"
        type={visible ? 'text' : 'password'}
        required
        minLength={6}
        autoComplete="current-password"
        placeholder="••••••••"
        style={{ ...style, width: '100%', paddingRight: 52 }}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={label}
        aria-pressed={visible}
        title={label}
        style={{
          position: 'absolute',
          right: 8,
          top: '50%',
          transform: 'translateY(-50%)',
          width: 36,
          height: 36,
          display: 'grid',
          placeItems: 'center',
          border: 'none',
          borderRadius: 999,
          background: 'transparent',
          color: '#B4A8D1',
          cursor: 'pointer',
        }}
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
          <circle cx="12" cy="12" r="3" />
          {visible && <line x1="3" y1="3" x2="21" y2="21" />}
        </svg>
      </button>
    </div>
  );
}
