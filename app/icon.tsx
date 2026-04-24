import { ImageResponse } from 'next/og';

/**
 * App icon (favicon) — SVG rendered at runtime via next/og.
 * Mesmo esquema do logo na sidebar: quadrado roxo 32x32 rotacionado -4deg,
 * borda preta, shadow offset, microfone emoji branco no centro.
 *
 * Next 15 picks this up automatically at `/icon` and wires it as the
 * site favicon + apple-touch-icon via <head> <link> injection.
 */

export const size = { width: 32, height: 32 };
export const contentType = 'image/png';

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          background: '#0A0420',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div
          style={{
            width: 28,
            height: 28,
            background: '#5B2BE8',
            borderRadius: 7,
            border: '2px solid #0A0420',
            boxShadow: '2px 2px 0 #0A0420',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transform: 'rotate(-4deg)',
            fontSize: 18,
            color: '#fff',
          }}
        >
          🎙
        </div>
      </div>
    ),
    size,
  );
}
