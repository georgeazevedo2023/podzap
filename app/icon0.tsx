import { ImageResponse } from 'next/og';

// 192x192 PWA icon — required by Android "Add to home screen" / install prompt.
// Same visual as `app/icon.tsx` (32px favicon), scaled up. Kept as a separate
// file because each icon convention file in Next exports one size.

export const size = { width: 192, height: 192 };
export const contentType = 'image/png';

export default function Icon192() {
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
            width: 168,
            height: 168,
            background: '#5B2BE8',
            borderRadius: 42,
            border: '12px solid #0A0420',
            boxShadow: '12px 12px 0 #0A0420',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transform: 'rotate(-4deg)',
            fontSize: 100,
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
