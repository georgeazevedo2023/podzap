'use client';

import { useMemo } from 'react';

/**
 * Animated waveform (bars pulse via the `wave` keyframes declared in
 * globals.css). Heights are deterministic per `seed`.
 *
 * Ported 1:1 from `podZAP/components.jsx` Waveform.
 */
export type WaveformProps = {
  bars?: number;
  playing?: boolean;
  /** CSS color — defaults to `currentColor`. */
  color?: string;
  height?: number;
  seed?: number;
};

export function Waveform({
  bars = 48,
  playing = true,
  color = 'currentColor',
  height = 40,
  seed = 1,
}: WaveformProps): React.ReactElement {
  const heights = useMemo(() => {
    const out: number[] = [];
    let s = seed * 9301 + 49297;
    for (let i = 0; i < bars; i++) {
      s = (s * 9301 + 49297) % 233280;
      out.push(0.2 + (s / 233280) * 0.8);
    }
    return out;
  }, [bars, seed]);

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 3,
        height,
        width: '100%',
      }}
    >
      {heights.map((h, i) => (
        <div
          key={i}
          style={{
            flex: 1,
            height: `${h * 100}%`,
            background: color,
            borderRadius: 2,
            animation: playing
              ? `wave ${0.6 + (i % 5) * 0.12}s ease-in-out ${i * 0.03}s infinite`
              : 'none',
            transformOrigin: 'center',
          }}
        />
      ))}
    </div>
  );
}

export default Waveform;
