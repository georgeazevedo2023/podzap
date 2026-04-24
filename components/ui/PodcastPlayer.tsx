'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

export interface PodcastPlayerProps {
  /** Signed URL da Fase 9 (bucket `audios` privado). */
  src: string;
  /** Duração em segundos vinda da row `audios.duration_seconds`. */
  durationSeconds: number | null;
  /** Identificador pro callback de "tocando agora" (coordena cards na mesma página). */
  playerId?: string;
}

function fmt(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// Cross-card coordination: quando um player dá play, avisa os outros via
// CustomEvent pra pararem. Evita ter N áudios sobrepondo ao clicar em vários.
const PLAY_EVENT = 'podzap:player:play';

export function PodcastPlayer({
  src,
  durationSeconds,
  playerId,
}: PodcastPlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState<number>(durationSeconds ?? 0);

  const localId = useMemo(
    () => playerId ?? Math.random().toString(36).slice(2, 10),
    [playerId],
  );

  // Sync tempo + fim + quando outro player começa a tocar → pausa este.
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;

    const onTime = () => setCurrentTime(el.currentTime);
    const onLoaded = () => {
      if (el.duration && Number.isFinite(el.duration)) {
        setDuration(el.duration);
      }
    };
    const onEnded = () => {
      setPlaying(false);
      setCurrentTime(0);
      el.currentTime = 0;
    };
    const onOtherPlay = (ev: Event) => {
      const id = (ev as CustomEvent<string>).detail;
      if (id !== localId && !el.paused) {
        el.pause();
        setPlaying(false);
      }
    };

    el.addEventListener('timeupdate', onTime);
    el.addEventListener('loadedmetadata', onLoaded);
    el.addEventListener('ended', onEnded);
    window.addEventListener(PLAY_EVENT, onOtherPlay);

    return () => {
      el.removeEventListener('timeupdate', onTime);
      el.removeEventListener('loadedmetadata', onLoaded);
      el.removeEventListener('ended', onEnded);
      window.removeEventListener(PLAY_EVENT, onOtherPlay);
    };
  }, [localId]);

  const toggle = () => {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) {
      window.dispatchEvent(new CustomEvent(PLAY_EVENT, { detail: localId }));
      void el.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
    } else {
      el.pause();
      setPlaying(false);
    }
  };

  const seek = (clientX: number) => {
    const el = audioRef.current;
    const bar = barRef.current;
    if (!el || !bar || !duration) return;
    const rect = bar.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    el.currentTime = ratio * duration;
    setCurrentTime(ratio * duration);
  };

  const progress = duration > 0 ? currentTime / duration : 0;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '12px 14px',
        border: '2.5px solid var(--stroke)',
        borderRadius: 16,
        background:
          'linear-gradient(135deg, color-mix(in srgb, var(--purple-500) 10%, var(--bg-2)) 0%, var(--bg-2) 55%)',
        boxShadow: '3px 3px 0 var(--stroke)',
      }}
    >
      <audio ref={audioRef} src={src} preload="metadata" />

      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? 'Pausar áudio' : 'Tocar áudio'}
        style={{
          cursor: 'pointer',
          width: 44,
          height: 44,
          flexShrink: 0,
          borderRadius: '50%',
          border: '2.5px solid var(--stroke)',
          background: playing ? 'var(--lime-500)' : 'var(--accent, var(--lime-500))',
          color: 'var(--ink-900)',
          boxShadow: '3px 3px 0 var(--stroke)',
          fontSize: 18,
          fontWeight: 900,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'transform 120ms, box-shadow 120ms',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.transform = 'translate(-1px, -1px)';
          e.currentTarget.style.boxShadow = '4px 4px 0 var(--stroke)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = 'translate(0, 0)';
          e.currentTarget.style.boxShadow = '3px 3px 0 var(--stroke)';
        }}
      >
        <span aria-hidden style={{ marginLeft: playing ? 0 : 2 }}>
          {playing ? '⏸' : '▶'}
        </span>
      </button>

      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div
          ref={barRef}
          role="slider"
          aria-label="Progresso do áudio"
          aria-valuemin={0}
          aria-valuemax={duration || 100}
          aria-valuenow={currentTime}
          tabIndex={0}
          onClick={(e) => seek(e.clientX)}
          onKeyDown={(e) => {
            const el = audioRef.current;
            if (!el || !duration) return;
            if (e.key === 'ArrowRight') {
              el.currentTime = Math.min(duration, el.currentTime + 5);
              setCurrentTime(el.currentTime);
            } else if (e.key === 'ArrowLeft') {
              el.currentTime = Math.max(0, el.currentTime - 5);
              setCurrentTime(el.currentTime);
            } else if (e.key === ' ' || e.key === 'Enter') {
              e.preventDefault();
              toggle();
            }
          }}
          style={{
            position: 'relative',
            height: 10,
            borderRadius: 999,
            background: 'color-mix(in srgb, var(--stroke) 25%, transparent)',
            border: '2px solid var(--stroke)',
            cursor: 'pointer',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              position: 'absolute',
              inset: 0,
              width: `${progress * 100}%`,
              background:
                'linear-gradient(90deg, var(--lime-500) 0%, var(--accent-2, #FF3DA5) 100%)',
              transition: 'width 160ms linear',
            }}
          />
        </div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            fontWeight: 700,
            color: 'var(--text-dim)',
            letterSpacing: '0.02em',
          }}
        >
          <span style={{ color: 'var(--text)' }}>{fmt(currentTime)}</span>
          <span>{fmt(duration)}</span>
        </div>
      </div>
    </div>
  );
}

export default PodcastPlayer;
