'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

import { Icons } from '@/components/icons/Icons';
import { PodCover } from '@/components/ui/PodCover';

/**
 * "últimos eps" 4-up grid. Each card can play its own audio — but only
 * ONE at a time across the grid (a second click transfers focus). We
 * don't push to a global store: a top-level `useState` tracking the
 * currently-playing summary id is enough.
 *
 * Empty state: render 4 `PodCover` stubs with `photo={null}` variants
 * 0..3 and "aguardando" as title. Matches protótipo visual rhythm.
 */

export type LatestEpisode = {
  summaryId: string;
  groupName: string;
  createdAt: string;
  durationSeconds: number | null;
  coverVariant: number;
  audioSignedUrl: string | null;
};

export type LastEpisodesGridProps = {
  episodes: LatestEpisode[];
};

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = Date.now();
  const diffMs = now - d.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays <= 0) return 'hoje';
  if (diffDays === 1) return 'ontem';
  if (diffDays < 7) return `${diffDays}d`;
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
}

function fmtDuration(s: number | null): string {
  if (!s || s <= 0) return '—:—';
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}

export function LastEpisodesGrid({
  episodes,
}: LastEpisodesGridProps): React.ReactElement {
  const [nowPlaying, setNowPlaying] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Whenever the chosen episode changes, (re)create the audio element.
  useEffect(() => {
    if (!nowPlaying) {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      return;
    }
    const ep = episodes.find((e) => e.summaryId === nowPlaying);
    if (!ep || !ep.audioSignedUrl) {
      setNowPlaying(null);
      return;
    }
    if (audioRef.current) {
      audioRef.current.pause();
    }
    const el = new Audio(ep.audioSignedUrl);
    audioRef.current = el;
    el.addEventListener('ended', () => setNowPlaying(null));
    void el.play().catch(() => setNowPlaying(null));
    return () => {
      el.pause();
    };
  }, [nowPlaying, episodes]);

  const toggle = (id: string) => {
    setNowPlaying((cur) => (cur === id ? null : id));
  };

  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          marginBottom: 14,
        }}
      >
        <div>
          <h2
            style={{
              margin: 0,
              fontFamily: 'var(--font-display)',
              fontWeight: 800,
              fontSize: 22,
              letterSpacing: '-0.02em',
            }}
          >
            últimos eps 🔥
          </h2>
          <div
            style={{ fontSize: 12, color: 'var(--color-text-dim)', marginTop: 2 }}
          >
            o que rolou nos seus grupos
          </div>
        </div>
        <Link
          href="/podcasts"
          className="btn btn-ghost"
          style={{ fontSize: 12 }}
        >
          ver tudo →
        </Link>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 14,
        }}
      >
        {episodes.length > 0
          ? episodes.map((ep, i) => (
              <div key={ep.summaryId}>
                <PodCover
                  title={ep.groupName}
                  subtitle={`ep. ${episodes.length - i}`}
                  variant={ep.coverVariant}
                  size={220}
                  date={fmtDate(ep.createdAt)}
                />
                <div
                  style={{
                    marginTop: 10,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <div
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 11,
                      color: 'var(--color-text-dim)',
                    }}
                  >
                    {fmtDuration(ep.durationSeconds)}
                  </div>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button
                      type="button"
                      className="btn"
                      style={{ padding: '6px 10px', fontSize: 11 }}
                      disabled={!ep.audioSignedUrl}
                      onClick={() => toggle(ep.summaryId)}
                      aria-label={
                        nowPlaying === ep.summaryId ? 'pausar' : 'tocar'
                      }
                    >
                      {nowPlaying === ep.summaryId ? (
                        <Icons.Pause />
                      ) : (
                        <Icons.Play />
                      )}
                    </button>
                  </div>
                </div>
              </div>
            ))
          : Array.from({ length: 4 }).map((_, i) => (
              <div key={i}>
                <PodCover
                  title="aguardando"
                  subtitle="em breve"
                  variant={i}
                  size={220}
                  photo={null}
                />
              </div>
            ))}
      </div>
    </div>
  );
}

export default LastEpisodesGrid;
