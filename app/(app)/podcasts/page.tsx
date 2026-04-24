/**
 * `/podcasts` — Fase 9 UI.
 *
 * Separate from `/history` (which is the incoming-WhatsApp-messages feed):
 * this page is the generated-podcast library. Every approved summary is
 * expected to produce one audio file (`audios.summary_id` is UNIQUE), so the
 * page renders one card per approved summary with an inline `<audio>` player
 * when the worker has already uploaded the WAV, and a pulsing
 * "gerando áudio…" badge when the summary was just approved and the Inngest
 * `generate-tts` job is still in flight.
 *
 * All data is fetched server-side so the browser never needs service-role
 * credentials; signed URLs are short-lived (1h) per
 * `lib/media/signedUrl.ts`. No client interactivity beyond `<details>` for
 * the transcript expand/collapse and the browser's native audio controls.
 */

import { redirect } from 'next/navigation';

import { TopBar } from '@/components/shell/TopBar';
import { Sticker } from '@/components/ui/Sticker';
import { getCurrentUserAndTenant } from '@/lib/tenant';
import { listSummaries, type SummaryView } from '@/lib/summaries/service';
import { listAudios, type AudioView } from '@/lib/audios/service';
import { getSignedUrl } from '@/lib/media/signedUrl';

import { DeliveryControls } from './DeliveryControls';

/** Upper bound on episodes shown. Matches `listSummaries` cap (100). */
const EPISODE_LIMIT = 50;

type Episode = {
  summary: SummaryView;
  audio: AudioView | null;
  audioUrl: string | null;
};

/**
 * Tone badge styling — mirrors `/approval/SummaryCard.tsx` so the same
 * summary shows the same tone pill across screens. Zero new colors.
 */
const TONE_STYLE: Record<
  SummaryView['tone'],
  { label: string; bg: string; fg: string; emoji: string }
> = {
  formal: {
    label: 'formal',
    bg: 'var(--purple-600)',
    fg: '#fff',
    emoji: '🎩',
  },
  fun: {
    label: 'divertido',
    bg: 'var(--lime-500)',
    fg: 'var(--ink-900)',
    emoji: '🎉',
  },
  corporate: {
    label: 'corporativo',
    bg: 'var(--yellow-500)',
    fg: 'var(--ink-900)',
    emoji: '💼',
  },
};

/**
 * Fetch all approved summaries + their audio rows, then sign storage paths.
 * We pull audios via `listAudios` once and index by `summary_id` in-memory
 * rather than firing per-summary `getAudioBySummary` calls — `EPISODE_LIMIT`
 * is well below `listAudios`'s clamp and the two queries run in parallel.
 */
async function loadEpisodes(tenantId: string): Promise<Episode[]> {
  const [summaries, audios] = await Promise.all([
    listSummaries(tenantId, { status: 'approved', limit: EPISODE_LIMIT }),
    listAudios(tenantId, { limit: 100 }),
  ]);

  const audioBySummary = new Map<string, AudioView>();
  for (const a of audios) audioBySummary.set(a.summaryId, a);

  return Promise.all(
    summaries.map(async (summary) => {
      const audio = audioBySummary.get(summary.id) ?? null;
      let audioUrl: string | null = null;
      if (audio) {
        try {
          audioUrl = await getSignedUrl(audio.storagePath, {
            bucket: 'audios',
          });
        } catch {
          // Swallow — the UI falls back to "áudio indisponível" when the
          // url is null (same pattern as `/history`'s media handling).
          audioUrl = null;
        }
      }
      return { summary, audio, audioUrl };
    }),
  );
}

export default async function PodcastsPage() {
  const context = await getCurrentUserAndTenant();
  if (!context) {
    redirect('/login?error=Faça login para continuar');
  }

  const { tenant } = context;
  const episodes = await loadEpisodes(tenant.id);

  return (
    <div style={{ minHeight: '100vh' }}>
      <TopBar
        title="Podcasts"
        subtitle="episódios gerados"
        accent="yellow"
        breadcrumb="podZAP · Fase 9"
      />

      <div
        style={{
          padding: '28px clamp(16px, 4vw, 36px) 48px',
          display: 'flex',
          flexDirection: 'column',
          gap: 18,
        }}
      >
        {episodes.length === 0 ? (
          <EmptyState />
        ) : (
          <>
            <div
              role="status"
              aria-live="polite"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                flexWrap: 'wrap',
              }}
            >
              <span className="sticker sticker-yellow">
                🎧 {episodes.length}{' '}
                {episodes.length === 1 ? 'episódio' : 'episódios'}
              </span>
              <span
                style={{
                  fontSize: 12,
                  color: 'var(--text-dim)',
                  fontWeight: 600,
                }}
              >
                mais recentes primeiro
              </span>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns:
                  'repeat(auto-fit, minmax(min(100%, 380px), 1fr))',
                gap: 20,
              }}
            >
              {episodes.map((ep) => (
                <EpisodeCard key={ep.summary.id} episode={ep} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Card                                                                       */
/* -------------------------------------------------------------------------- */

function EpisodeCard({ episode }: { episode: Episode }) {
  const { summary, audio, audioUrl } = episode;
  const tone = TONE_STYLE[summary.tone];
  const period = formatPeriod(summary.periodStart, summary.periodEnd);
  const groupName = summary.groupName ?? 'grupo sem nome';

  return (
    <article
      className="card"
      style={{
        padding: 20,
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
        minWidth: 0,
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 12,
          justifyContent: 'space-between',
          flexWrap: 'wrap',
        }}
      >
        <div style={{ minWidth: 0, flex: '1 1 200px' }}>
          <h2
            style={{
              margin: 0,
              fontFamily: 'var(--font-display)',
              fontSize: 20,
              fontWeight: 800,
              lineHeight: 1.15,
              letterSpacing: '-0.01em',
              color: 'var(--text)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            title={groupName}
          >
            {groupName}
          </h2>
          <div
            style={{
              fontSize: 12,
              fontFamily: 'var(--font-mono)',
              color: 'var(--text-dim)',
              fontWeight: 600,
              marginTop: 4,
            }}
          >
            {period}
          </div>
        </div>
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: '3px 10px',
            borderRadius: 999,
            background: tone.bg,
            color: tone.fg,
            border: '2px solid var(--stroke)',
            fontSize: 10,
            fontWeight: 800,
            letterSpacing: '0.05em',
            textTransform: 'uppercase',
            flexShrink: 0,
          }}
        >
          <span aria-hidden>{tone.emoji}</span>
          {tone.label}
        </span>
      </header>

      {audio && audioUrl ? (
        <AudioPlayer url={audioUrl} audio={audio} />
      ) : audio && !audioUrl ? (
        <UnavailableBadge />
      ) : (
        <GeneratingBadge />
      )}

      {audio ? (
        <DeliveryControls
          audioId={audio.id}
          delivered={audio.deliveredToWhatsapp}
          deliveredAt={audio.deliveredAt}
        />
      ) : null}

      <details
        style={{
          border: '2px solid var(--stroke)',
          borderRadius: 'var(--r-md)',
          background: 'var(--bg-1)',
          padding: '10px 14px',
        }}
      >
        <summary
          style={{
            cursor: 'pointer',
            fontSize: 11,
            fontWeight: 800,
            letterSpacing: '0.05em',
            textTransform: 'uppercase',
            color: 'var(--text-dim)',
            userSelect: 'none',
          }}
        >
          📝 transcrição
        </summary>
        <p
          style={{
            margin: '10px 0 0',
            fontSize: 13,
            lineHeight: 1.5,
            color: 'var(--text)',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {summary.text}
        </p>
      </details>
    </article>
  );
}

function AudioPlayer({ url, audio }: { url: string; audio: AudioView }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <audio
        controls
        preload="none"
        src={url}
        style={{ width: '100%' }}
      >
        <track kind="captions" />
      </audio>
      {audio.durationSeconds ? (
        <span
          style={{
            fontSize: 11,
            color: 'var(--text-dim)',
            fontFamily: 'var(--font-mono)',
          }}
        >
          {formatDuration(audio.durationSeconds)}
        </span>
      ) : null}
    </div>
  );
}

/**
 * Pulsing "gerando áudio…" pill for summaries that are approved but whose
 * `generate-tts` Inngest job hasn't dropped a row yet. Styled as a dashed
 * block (not a solid card) so it reads as "in-flight" instead of "failed".
 */
function GeneratingBadge() {
  return (
    <div
      style={{
        padding: '14px 16px',
        border: '2px dashed var(--stroke)',
        borderRadius: 'var(--r-md)',
        background: 'var(--bg-2)',
        color: 'var(--text-dim)',
        fontSize: 13,
        fontWeight: 700,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        animation: 'podzapPulse 1.4s ease-in-out infinite',
      }}
    >
      <span aria-hidden>⏳</span>
      gerando áudio…
      <style>{`
        @keyframes podzapPulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.55; }
        }
      `}</style>
    </div>
  );
}

/**
 * Row exists but the signed URL failed (storage object missing / expired
 * credentials / etc). Distinct from `GeneratingBadge` so operators can
 * distinguish "still working" from "something broke".
 */
function UnavailableBadge() {
  return (
    <div
      style={{
        padding: '14px 16px',
        border: '2px solid var(--stroke)',
        borderRadius: 'var(--r-md)',
        background: 'var(--bg-2)',
        color: 'var(--text-dim)',
        fontSize: 13,
        fontWeight: 700,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
      }}
    >
      <span aria-hidden>⚠️</span>
      áudio indisponível no momento
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Empty state                                                                */
/* -------------------------------------------------------------------------- */

function EmptyState() {
  return (
    <div
      className="card"
      style={{
        padding: 36,
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) auto',
        gap: 28,
        alignItems: 'center',
      }}
    >
      <div>
        <Sticker variant="yellow" style={{ marginBottom: 12 }}>
          🎙 nenhum episódio ainda
        </Sticker>
        <h2
          style={{
            margin: '8px 0 10px',
            fontFamily: 'var(--font-display)',
            fontSize: 30,
            fontWeight: 800,
            lineHeight: 1.05,
            letterSpacing: '-0.02em',
          }}
        >
          sem podcasts por enquanto
        </h2>
        <p
          style={{
            margin: 0,
            fontSize: 14,
            lineHeight: 1.5,
            color: 'var(--text-dim)',
            maxWidth: 520,
          }}
        >
          aprova um resumo na tela de Aprovação — o áudio é gerado
          automaticamente e aparece aqui em alguns segundos pra você
          escutar. Só vai pro grupo quando você clicar "enviar ao grupo"
          no card.
        </p>
      </div>
      <div
        aria-hidden
        style={{
          width: 128,
          height: 128,
          borderRadius: 'var(--radius-lg)',
          background: 'var(--bg-2)',
          border: '3px solid var(--stroke)',
          boxShadow: 'var(--shadow-chunk-lg)',
          display: 'grid',
          placeItems: 'center',
          fontSize: 60,
        }}
      >
        🎧
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Format `period_start`..`period_end` as a compact pt-BR range. Both
 * endpoints come in as ISO strings (they're `date`/`timestamptz` columns).
 * Falls back to raw ISO on parse failure so operators can still tell rows
 * apart.
 */
function formatPeriod(startIso: string, endIso: string): string {
  const start = new Date(startIso);
  const end = new Date(endIso);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return `${startIso} → ${endIso}`;
  }
  const fmt = (d: Date): string =>
    d.toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: 'short',
    });
  const sameDay =
    start.getUTCFullYear() === end.getUTCFullYear() &&
    start.getUTCMonth() === end.getUTCMonth() &&
    start.getUTCDate() === end.getUTCDate();
  return sameDay ? fmt(start) : `${fmt(start)} → ${fmt(end)}`;
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
