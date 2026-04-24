'use client';

/**
 * `PodcastsHero` — client island com hero moderno no topo de /podcasts.
 *
 * Visual: card roxo chunky com blobs decorativos (mesma paleta do
 * HeroPlayer de /home), stats agregados (total episódios, minutos,
 * grupos distintos) e CTA primário "criar novo podcast" que abre o
 * `GenerateNowModal` — mesma modal do /home.
 *
 * Por que client: o modal de gerar tem estado (open/close) e só roda
 * no browser. A página /podcasts é server-side, então isolamos aqui.
 */

import { useState } from 'react';

import { GenerateNowModal } from '@/app/(app)/home/GenerateNowModal';

export interface PodcastsHeroStats {
  totalEpisodes: number;
  totalMinutes: number;
  uniqueGroups: number;
}

export function PodcastsHero({ stats }: { stats: PodcastsHeroStats }) {
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <>
      <div
        className="card"
        style={{
          position: 'relative',
          overflow: 'hidden',
          background:
            'linear-gradient(135deg, var(--purple-700, #4318D1) 0%, var(--purple-600, #5B2BE8) 60%, var(--pink-500, #FF3DA5) 180%)',
          border: '2.5px solid var(--stroke)',
          borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--shadow-chunk-lg)',
          padding: '28px 28px 24px',
          color: '#fff',
          display: 'flex',
          alignItems: 'center',
          gap: 24,
          flexWrap: 'wrap',
        }}
      >
        {/* Decorative blobs — absolute, clipped by overflow:hidden */}
        <div
          aria-hidden
          style={{
            position: 'absolute',
            top: -80,
            right: -80,
            width: 240,
            height: 240,
            borderRadius: '50%',
            background:
              'radial-gradient(circle at 30% 30%, rgba(255,255,255,0.18), transparent 60%)',
          }}
        />
        <div
          aria-hidden
          style={{
            position: 'absolute',
            bottom: -60,
            left: -40,
            width: 180,
            height: 180,
            borderRadius: '50%',
            background:
              'radial-gradient(circle at 60% 60%, rgba(198,255,60,0.22), transparent 55%)',
          }}
        />

        <div style={{ flex: '1 1 320px', minWidth: 0, position: 'relative' }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 800,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color: 'rgba(255,255,255,0.75)',
              marginBottom: 6,
            }}
          >
            🎧 biblioteca · podZAP
          </div>
          <h1
            style={{
              margin: 0,
              fontFamily: 'var(--font-display)',
              fontSize: 'clamp(28px, 4vw, 42px)',
              fontWeight: 900,
              lineHeight: 1.02,
              letterSpacing: '-0.02em',
            }}
          >
            seus podcasts{' '}
            <span style={{ color: 'var(--lime-500)' }}>no capricho</span>
          </h1>
          <p
            style={{
              margin: '8px 0 16px',
              fontSize: 13,
              lineHeight: 1.45,
              maxWidth: 520,
              color: 'rgba(255,255,255,0.85)',
            }}
          >
            escuta o preview, manda pro grupo quando estiver redondo.
            gera um novo a qualquer hora.
          </p>

          <div
            style={{
              display: 'flex',
              gap: 10,
              flexWrap: 'wrap',
              marginBottom: 18,
            }}
          >
            <StatChip
              emoji="📻"
              label={`${stats.totalEpisodes} ${
                stats.totalEpisodes === 1 ? 'episódio' : 'episódios'
              }`}
            />
            <StatChip
              emoji="⏱"
              label={`${stats.totalMinutes}m ouvidos`}
            />
            <StatChip
              emoji="👥"
              label={`${stats.uniqueGroups} ${
                stats.uniqueGroups === 1 ? 'grupo' : 'grupos'
              }`}
            />
          </div>

          <button
            type="button"
            onClick={() => setModalOpen(true)}
            className="btn"
            style={{
              background: 'var(--lime-500)',
              color: 'var(--ink-900)',
              border: '2.5px solid var(--stroke)',
              borderRadius: 'var(--radius-pill)',
              padding: '12px 20px',
              fontFamily: 'var(--font-body)',
              fontSize: 14,
              fontWeight: 800,
              cursor: 'pointer',
              boxShadow: 'var(--shadow-chunk)',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              letterSpacing: '0.01em',
              transition: 'transform 0.15s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'translateY(-2px)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'translateY(0)';
            }}
          >
            ✨ criar novo podcast
          </button>
        </div>

        {/* Right side: mascot-ish decorative column */}
        <div
          aria-hidden
          style={{
            flex: '0 0 auto',
            display: 'grid',
            placeItems: 'center',
            minWidth: 120,
            position: 'relative',
          }}
        >
          <div
            style={{
              width: 120,
              height: 120,
              borderRadius: 28,
              background: 'var(--ink-900)',
              border: '2.5px solid var(--stroke)',
              boxShadow: 'var(--shadow-chunk-lg)',
              display: 'grid',
              placeItems: 'center',
              transform: 'rotate(-6deg)',
              fontSize: 56,
            }}
          >
            🎙
          </div>
          <div
            style={{
              position: 'absolute',
              bottom: -8,
              right: -8,
              padding: '4px 10px',
              background: 'var(--pink-500)',
              color: '#fff',
              border: '2.5px solid var(--stroke)',
              borderRadius: 999,
              fontSize: 10,
              fontWeight: 800,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              boxShadow: '2px 2px 0 var(--stroke)',
              transform: 'rotate(8deg)',
            }}
          >
            🔥 HOJE
          </div>
        </div>
      </div>

      <GenerateNowModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
      />
    </>
  );
}

export default PodcastsHero;

function StatChip({ emoji, label }: { emoji: string; label: string }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '5px 12px',
        background: 'rgba(255,255,255,0.14)',
        color: '#fff',
        border: '2px solid rgba(255,255,255,0.35)',
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 700,
        backdropFilter: 'blur(6px)',
      }}
    >
      <span aria-hidden>{emoji}</span>
      {label}
    </span>
  );
}
