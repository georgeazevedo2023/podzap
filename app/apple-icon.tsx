import { ImageResponse } from 'next/og';

/**
 * Apple touch icon — 180x180 PNG gerado em runtime via next/og.
 * Mesma arte do `app/icon.tsx` com tamanho maior pra iOS home-screen.
 */

export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default function AppleIcon() {
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
            width: 150,
            height: 150,
            background: '#5B2BE8',
            borderRadius: 36,
            border: '10px solid #0A0420',
            boxShadow: '10px 10px 0 #0A0420',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transform: 'rotate(-4deg)',
            fontSize: 96,
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
