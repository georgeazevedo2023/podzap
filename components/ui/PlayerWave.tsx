'use client';

import { useMemo } from 'react';

/**
 * Static progress waveform for the hero player. Bars are generated from a
 * deterministic seed and an envelope (more activity in the middle). Bars
 * before `progress` are highlighted with `--color-accent-2` (pink); the rest
 * render in `--color-ink-500` at 40% opacity.
 *
 * Ported 1:1 from `podZAP/components.jsx` PlayerWave.
 */
export type PlayerWaveProps = {
  /** 0..1 playback progress. */
  progress: number;
  bars?: number;
  seed?: number;
  height?: number;
};

export function PlayerWave({
  progress,
  bars = 80,
  seed = 2,
  height = 56,
}: PlayerWaveProps): React.ReactElement {
  const heights = useMemo(() => {
    const out: number[] = [];
    let s = seed * 9301 + 49297;
    for (let i = 0; i < bars; i++) {
      s = (s * 9301 + 49297) % 233280;
      const pos = i / bars;
      const envelope = Math.sin(pos * Math.PI) * 0.6 + 0.4;
      out.push((0.2 + (s / 233280) * 0.8) * envelope);
    }
    return out;
  }, [bars, seed]);

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        height,
        width: '100%',
      }}
    >
      {heights.map((h, i) => {
        const filled = i / bars < progress;
        return (
          <div
            key={i}
            style={{
              flex: 1,
              height: `${Math.max(h * 100, 8)}%`,
              background: filled
                ? 'var(--color-accent-2)'
                : 'var(--color-ink-500)',
              opacity: filled ? 1 : 0.4,
              borderRadius: 2,
            }}
          />
        );
      })}
    </div>
  );
}

export default PlayerWave;
