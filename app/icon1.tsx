import { ImageResponse } from 'next/og';

// 512x512 PWA icon — used by Chrome / Android for splash screens and high-DPI
// home-screen tiles. Twin of icon0.tsx (192px) at higher resolution.

export const size = { width: 512, height: 512 };
export const contentType = 'image/png';

export default function Icon512() {
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
            width: 448,
            height: 448,
            background: '#5B2BE8',
            borderRadius: 112,
            border: '32px solid #0A0420',
            boxShadow: '32px 32px 0 #0A0420',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transform: 'rotate(-4deg)',
            fontSize: 268,
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
