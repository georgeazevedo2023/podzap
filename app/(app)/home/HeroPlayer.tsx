'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type CSSProperties } from 'react';

import { Icons } from '@/components/icons/Icons';
import { PlayerWave } from '@/components/ui/PlayerWave';
import { PodCover } from '@/components/ui/PodCover';

/**
 * Hero player card — direct 1:1 port of the purple hero block from
 * `podZAP/screen_home.jsx`.
 *
 * When `episode` is provided we render a fully-interactive player with
 * waveform + play/pause controls + "mandar no zap" CTA. When `episode`
 * is `null` (no approved episodes yet) we keep the same purple card
 * aesthetic but swap content for a "primeiro passo" empty state that
 * links to `/onboarding`.
 *
 * Real audio playback (when `audioSignedUrl` is non-null) is driven by
 * a hidden `<audio>` element. The visual waveform + timecodes reflect
 * the audio's current time. If there is no signed URL we fall back to
 * a decorative animated progress — the play button still toggles so
 * the UI demonstrates intent even without real audio.
 */

export type HeroEpisode = {
  summaryId: string;
  groupName: string;
  title: string;
  messagesCount: number;
  audiosCount: number;
  imagesCount: number;
  durationSeconds: number | null;
  audioSignedUrl: string | null;
  tone: string;
};

export type HeroPlayerProps = {
  episode: HeroEpisode | null;
  tenantName: string;
};

function fmtTimecode(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// Fallback duration used when the DB row has no `duration_seconds` yet.
const DEFAULT_DURATION = 18 * 60 + 42;

export function HeroPlayer({
  episode,
  tenantName,
}: HeroPlayerProps): React.ReactElement {
  const [playing, setPlaying] = useState<boolean>(false);
  const [progress, setProgress] = useState<number>(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const durationSeconds =
    episode?.durationSeconds && episode.durationSeconds > 0
      ? episode.durationSeconds
      : DEFAULT_DURATION;

  // Decorative progress loop — only when we don't have a real audio element.
  useEffect(() => {
    if (!playing || audioRef.current) return;
    const t = setInterval(() => {
      setProgress((p) => (p >= 1 ? 0 : p + 0.003));
    }, 200);
    return () => clearInterval(t);
  }, [playing]);

  // Wire <audio> time updates into the visual waveform.
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const onTime = () => {
      const dur = el.duration || durationSeconds;
      setProgress(dur > 0 ? el.currentTime / dur : 0);
    };
    const onEnded = () => {
      setPlaying(false);
      setProgress(0);
    };
    el.addEventListener('timeupdate', onTime);
    el.addEventListener('ended', onEnded);
    return () => {
      el.removeEventListener('timeupdate', onTime);
      el.removeEventListener('ended', onEnded);
    };
  }, [durationSeconds, episode?.audioSignedUrl]);

  const togglePlay = () => {
    const next = !playing;
    setPlaying(next);
    const el = audioRef.current;
    if (!el) return;
    if (next) {
      void el.play().catch(() => setPlaying(false));
    } else {
      el.pause();
    }
  };

  const cardStyle: CSSProperties = {
    background: 'var(--color-purple-600)',
    color: '#fff',
    border: '2.5px solid var(--color-stroke)',
    borderRadius: 'var(--radius-xl)',
    padding: 24,
    boxShadow: 'var(--shadow-chunk-lg)',
    position: 'relative',
    overflow: 'hidden',
  };

  const blobs = (
    <>
      <div
        style={{
          position: 'absolute',
          right: -50,
          top: -50,
          width: 220,
          height: 220,
          background: 'var(--color-pink-500)',
          borderRadius: '50%',
          opacity: 0.35,
        }}
        aria-hidden
      />
      <div
        style={{
          position: 'absolute',
          right: 80,
          bottom: -40,
          width: 140,
          height: 140,
          background: 'var(--color-lime-500)',
          borderRadius: '50%',
          opacity: 0.25,
        }}
        aria-hidden
      />
    </>
  );

  // ─── Empty state ────────────────────────────────────────────────────────
  if (episode === null) {
    return (
      <div style={cardStyle}>
        {blobs}
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 20,
            position: 'relative',
            zIndex: 2,
          }}
        >
          <PodCover
            title={tenantName}
            subtitle="aguardando"
            variant={0}
            size={140}
            photo={null}
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
              <span className="sticker">🌱 primeiro passo</span>
            </div>
            <div
              style={{
                fontFamily: 'var(--font-display)',
                fontWeight: 800,
                fontSize: 32,
                lineHeight: 1,
                letterSpacing: '-0.02em',
              }}
            >
              ainda sem episódios
            </div>
            <div
              style={{
                fontSize: 13,
                opacity: 0.85,
                marginTop: 8,
                fontWeight: 500,
                maxWidth: 520,
              }}
            >
              conecta o whatsapp, escolhe os grupos e a gente transforma a
              conversa em podcast
            </div>
            <div style={{ marginTop: 18 }}>
              <Link
                href="/onboarding"
                className="btn"
                style={{ background: 'var(--color-lime-500)' }}
              >
                conectar whatsapp →
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ─── Active episode ────────────────────────────────────────────────────
  return (
    <div style={cardStyle}>
      {blobs}

      {episode.audioSignedUrl && (
        // Hidden real-audio element — visual waveform reflects its time.
        <audio
          ref={audioRef}
          src={episode.audioSignedUrl}
          preload="metadata"
          style={{ display: 'none' }}
        />
      )}

      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 20,
          position: 'relative',
          zIndex: 2,
        }}
      >
        <PodCover
          title={episode.groupName}
          subtitle="ep. hoje"
          variant={0}
          size={140}
          date="hoje"
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            <span className="sticker sticker-yellow">🎧 tá no ar</span>
            <span
              className="sticker"
              style={{
                background: 'rgba(255,255,255,0.15)',
                color: '#fff',
                border: '2px solid #fff',
              }}
            >
              <span className="live-dot" /> ao vivo há 3min
            </span>
          </div>
          <div
            style={{
              fontFamily: 'var(--font-display)',
              fontWeight: 800,
              fontSize: 32,
              lineHeight: 1,
              letterSpacing: '-0.02em',
            }}
          >
            {episode.title}
          </div>
          <div
            style={{
              fontSize: 13,
              opacity: 0.85,
              marginTop: 8,
              fontWeight: 500,
            }}
          >
            {episode.messagesCount} mensagens · {episode.audiosCount} áudios ·{' '}
            {episode.imagesCount} imagens · narrado com {episode.tone}
          </div>

          {/* waveform + time */}
          <div
            style={{
              marginTop: 18,
              display: 'flex',
              alignItems: 'center',
              gap: 14,
            }}
          >
            <div
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 12,
                fontWeight: 700,
                minWidth: 42,
              }}
            >
              {fmtTimecode(progress * durationSeconds)}
            </div>
            <div style={{ flex: 1 }}>
              <PlayerWave progress={progress} bars={80} />
            </div>
            <div
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 12,
                fontWeight: 700,
                minWidth: 42,
                opacity: 0.7,
              }}
            >
              {fmtTimecode(durationSeconds)}
            </div>
          </div>

          {/* controls */}
          <div
            style={{
              marginTop: 16,
              display: 'flex',
              alignItems: 'center',
              gap: 10,
            }}
          >
            <button
              type="button"
              className="btn btn-ghost"
              style={{ color: '#fff', padding: 10 }}
              title="voltar 15s"
              onClick={() => {
                const el = audioRef.current;
                if (el) el.currentTime = Math.max(0, el.currentTime - 15);
              }}
            >
              <Icons.Rewind />
            </button>
            <button
              type="button"
              onClick={togglePlay}
              className="btn"
              style={{
                background: 'var(--color-lime-500)',
                width: 56,
                height: 56,
                padding: 0,
                borderRadius: '50%',
                justifyContent: 'center',
              }}
              aria-label={playing ? 'pausar' : 'tocar'}
            >
              {playing ? <Icons.Pause /> : <Icons.Play />}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              style={{ color: '#fff', padding: 10 }}
              title="pular 15s"
              onClick={() => {
                const el = audioRef.current;
                if (el)
                  el.currentTime = Math.min(
                    durationSeconds,
                    el.currentTime + 15,
                  );
              }}
            >
              <Icons.Skip />
            </button>
            <div style={{ flex: 1 }} />
            <button
              type="button"
              title="compartilhar no zap"
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'translateY(-2px)';
                e.currentTarget.style.boxShadow =
                  '0 8px 24px rgba(34,197,94,0.5), inset 0 1px 0 rgba(255,255,255,0.3)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow =
                  '0 4px 14px rgba(34,197,94,0.35), inset 0 1px 0 rgba(255,255,255,0.25)';
              }}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 10,
                padding: '11px 18px 11px 14px',
                background:
                  'linear-gradient(135deg, #22C55E 0%, #16A34A 100%)',
                color: '#fff',
                border: 'none',
                borderRadius: 999,
                fontFamily: 'var(--font-body)',
                fontWeight: 700,
                fontSize: 13,
                letterSpacing: '0.01em',
                cursor: 'pointer',
                boxShadow:
                  '0 4px 14px rgba(34,197,94,0.35), inset 0 1px 0 rgba(255,255,255,0.25)',
                transition:
                  'transform 0.18s cubic-bezier(0.2,0.9,0.3,1.4), box-shadow 0.18s ease',
              }}
            >
              <span
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: '50%',
                  background: 'rgba(255,255,255,0.2)',
                  display: 'grid',
                  placeItems: 'center',
                  backdropFilter: 'blur(4px)',
                }}
              >
                <Icons.Send />
              </span>
              mandar no zap
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default HeroPlayer;
