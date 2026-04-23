'use client';

import { useState, type CSSProperties } from 'react';

/**
 * Editorial-style podcast cover — photo background + bold typography.
 * Ported 1:1 from `podZAP/components.jsx` PodCover.
 *
 * `variant` selects one of 6 accent/photo pairs. `photo` overrides the
 * default Unsplash URL; pass `null` explicitly to skip the <img> entirely
 * and render a gradient + microphone emoji fallback (used for zero-data
 * states so we don't hit external Unsplash URLs).
 */
export type PodCoverProps = {
  title: string;
  subtitle?: string;
  variant?: number;
  size?: number;
  date?: string;
  /** Override photo URL. Pass `null` to render a fallback (no <img>). */
  photo?: string | null;
};

type Variant = {
  accent: string;
  tint: string;
  photo: string;
};

const VARIANTS: readonly Variant[] = [
  {
    accent: '#22C55E',
    tint: 'rgba(34,197,94,0.08)',
    photo:
      'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=400&h=400&fit=crop&crop=faces',
  },
  {
    accent: '#FF3DA5',
    tint: 'rgba(255,61,165,0.08)',
    photo:
      'https://images.unsplash.com/photo-1600486913747-55e5470d6f40?w=400&h=400&fit=crop&crop=faces',
  },
  {
    accent: '#FFC828',
    tint: 'rgba(255,200,40,0.08)',
    photo:
      'https://images.unsplash.com/photo-1580489944761-15a19d654956?w=400&h=400&fit=crop&crop=faces',
  },
  {
    accent: '#7A3CFF',
    tint: 'rgba(122,60,255,0.08)',
    photo:
      'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400&h=400&fit=crop&crop=faces',
  },
  {
    accent: '#C6FF3C',
    tint: 'rgba(198,255,60,0.08)',
    photo:
      'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=400&h=400&fit=crop&crop=faces',
  },
  {
    accent: '#1DE9B6',
    tint: 'rgba(29,233,182,0.08)',
    photo:
      'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=400&h=400&fit=crop&crop=faces',
  },
] as const;

export function PodCover({
  title,
  subtitle = 'podcast',
  variant = 0,
  size = 200,
  date,
  photo,
}: PodCoverProps): React.ReactElement {
  const v = VARIANTS[variant % VARIANTS.length]!;
  const isSmall = size <= 80;
  // `photo` === null → explicit fallback (no external image). `photo` === undefined → variant default.
  const effectivePhoto = photo === undefined ? v.photo : photo;
  const [imgFailed, setImgFailed] = useState(false);
  const showImage = effectivePhoto !== null && !imgFailed;

  const containerStyle: CSSProperties = {
    width: size,
    height: size,
    background: '#0A0420',
    border: '2px solid var(--color-stroke)',
    borderRadius: 'var(--radius-md)',
    boxShadow: 'var(--shadow-chunk)',
    position: 'relative',
    overflow: 'hidden',
    flexShrink: 0,
  };

  return (
    <div style={containerStyle}>
      {showImage && effectivePhoto ? (
        <img
          src={effectivePhoto}
          alt=""
          loading="lazy"
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            filter: 'contrast(1.05) saturate(1.1)',
          }}
          onError={() => setImgFailed(true)}
        />
      ) : (
        // Fallback: gradient from accent into ink + mic emoji, no external image.
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: `linear-gradient(135deg, ${v.accent} 0%, #0A0420 85%)`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: Math.max(size * 0.28, 18),
            lineHeight: 1,
          }}
          aria-hidden
        >
          <span role="img" aria-hidden>
            🎙
          </span>
        </div>
      )}

      {/* Dark gradient overlay for text contrast */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'linear-gradient(180deg, rgba(10,4,32,0.15) 0%, rgba(10,4,32,0.35) 45%, rgba(10,4,32,0.92) 100%)',
        }}
      />

      {/* Accent bar bottom */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          bottom: 0,
          width: '100%',
          height: 3,
          background: v.accent,
        }}
      />

      {/* Title block (bottom) — not on smalls */}
      {!isSmall && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            padding: size > 160 ? 16 : 10,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'flex-end',
            zIndex: 2,
          }}
        >
          <div
            style={{
              width: 24,
              height: 3,
              background: v.accent,
              marginBottom: size > 160 ? 10 : 6,
            }}
          />
          <div
            style={{
              fontFamily: 'var(--font-display)',
              fontWeight: 800,
              fontSize: size > 160 ? 20 : size > 100 ? 15 : 12,
              color: '#fff',
              lineHeight: 1.0,
              letterSpacing: '-0.02em',
              wordBreak: 'break-word',
              textTransform: 'lowercase',
            }}
          >
            {title}
          </div>
          {size > 100 && (
            <div
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: size > 160 ? 10 : 9,
                fontWeight: 600,
                color: v.accent,
                marginTop: 6,
                textTransform: 'uppercase',
                letterSpacing: '0.12em',
              }}
            >
              {subtitle}
              {date ? ` · ${date}` : ''}
            </div>
          )}
        </div>
      )}

      {/* Small variant: tiny label */}
      {isSmall && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background:
              'linear-gradient(180deg, transparent 40%, rgba(10,4,32,0.8) 100%)',
            display: 'flex',
            alignItems: 'flex-end',
            padding: 6,
          }}
        >
          <div
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 10,
              fontWeight: 800,
              color: '#fff',
              lineHeight: 1,
              textTransform: 'lowercase',
              letterSpacing: '-0.01em',
            }}
          >
            {title.split(' ')[0]}
          </div>
        </div>
      )}

      {/* Top-left brand mark — only large */}
      {size > 140 && (
        <div
          style={{
            position: 'absolute',
            top: 12,
            left: 12,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '4px 9px 4px 7px',
            background: 'rgba(255,255,255,0.95)',
            borderRadius: 'var(--radius-pill)',
            fontFamily: 'var(--font-body)',
            fontSize: 9,
            fontWeight: 800,
            textTransform: 'uppercase',
            letterSpacing: '0.1em',
            color: '#0A0420',
            zIndex: 3,
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: v.accent,
            }}
          />
          podZAP
        </div>
      )}

      {/* Top-right date pill — large + has date */}
      {size > 140 && date && (
        <div
          style={{
            position: 'absolute',
            top: 12,
            right: 12,
            padding: '3px 8px',
            background: 'rgba(10,4,32,0.6)',
            backdropFilter: 'blur(8px)',
            borderRadius: 'var(--radius-pill)',
            fontFamily: 'var(--font-mono)',
            fontSize: 9,
            fontWeight: 700,
            color: '#fff',
            border: `1px solid ${v.accent}`,
            zIndex: 3,
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
          }}
        >
          {date}
        </div>
      )}
    </div>
  );
}

export default PodCover;
