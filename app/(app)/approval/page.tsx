import { redirect } from 'next/navigation';

import { TopBar } from '@/components/shell/TopBar';
import { Sticker } from '@/components/ui/Sticker';
import { getCurrentUserAndTenant } from '@/lib/tenant';
import { listSummaries, type SummaryView } from '@/lib/summaries/service';

import { GeneratingBanner } from './GeneratingBanner';
import { StatusFilter, type ApprovalStatusFilter } from './StatusFilter';
import { SummaryCard } from './SummaryCard';

/**
 * Approval screen (list) — Fase 8, Agente 3.
 *
 * Server component: resolves the tenant, reads the `?status=` query param,
 * and fetches the matching `summaries` slice via `listSummaries`. All
 * interactivity lives in `StatusFilter` (client) and per-card navigation
 * (plain `<Link>` inside `SummaryCard`).
 *
 * URL contract:
 *   `/approval`                 → defaults to `pending_review`
 *   `/approval?status=approved` → approved only
 *   `/approval?status=rejected` → rejected only
 *   `/approval?status=all`      → no status filter
 *
 * Unknown values collapse to the `pending_review` default so bad inputs
 * never produce an empty page with no explanation.
 *
 * The detail route (`/approval/[id]`) is owned by Agente 4 — this page
 * only provides navigation links into it.
 */

const VALID_FILTERS: readonly ApprovalStatusFilter[] = [
  'pending_review',
  'approved',
  'rejected',
  'all',
] as const;

function parseStatus(raw: string | string[] | undefined): ApprovalStatusFilter {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value && (VALID_FILTERS as readonly string[]).includes(value)) {
    return value as ApprovalStatusFilter;
  }
  return 'pending_review';
}

/** Next 16's `searchParams` arrives as a Promise in async page components. */
interface ApprovalPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function ApprovalPage({
  searchParams,
}: ApprovalPageProps) {
  const context = await getCurrentUserAndTenant();
  if (!context) {
    redirect('/login?error=Faça login para continuar');
  }

  const { tenant } = context;

  const resolvedSearchParams = await searchParams;
  const status = parseStatus(resolvedSearchParams.status);

  // `all` → don't pass a status filter so the service returns everything.
  const summaries: SummaryView[] = await listSummaries(tenant.id, {
    status: status === 'all' ? undefined : status,
    limit: 50,
  });

  const subtitle = buildSubtitle(status, summaries.length);

  return (
    <div style={{ minHeight: '100vh' }}>
      <TopBar
        title="Aprovação"
        subtitle={subtitle}
        accent="pink"
        breadcrumb="podZAP · Fase 8"
        actions={<StatusFilter current={status} />}
      />

      <div
        style={{
          padding: '28px 36px 48px',
          display: 'flex',
          flexDirection: 'column',
          gap: 20,
        }}
      >
        {/* Banner "IA cozinhando" aparece quando há um ticket ativo em
            localStorage (disparado pelo GenerateNowModal). Some sozinho
            quando a row pending_review chega. */}
        <GeneratingBanner />

        {summaries.length === 0 ? (
          <EmptyState status={status} />
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))',
              gap: 20,
            }}
          >
            {summaries.map((summary) => (
              <SummaryCard key={summary.id} summary={summary} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function buildSubtitle(status: ApprovalStatusFilter, count: number): string {
  switch (status) {
    case 'pending_review':
      return count === 1 ? '1 pendente' : `${count} pendentes`;
    case 'approved':
      return count === 1 ? '1 aprovado' : `${count} aprovados`;
    case 'rejected':
      return count === 1 ? '1 rejeitado' : `${count} rejeitados`;
    case 'all':
    default:
      return count === 1 ? '1 resumo' : `${count} resumos`;
  }
}

interface EmptyStateProps {
  status: ApprovalStatusFilter;
}

/**
 * Friendly empty state — the copy shifts with the filter so "no pendentes"
 * reads as a celebration while "no rejeitados" reads as neutral.
 */
function EmptyState({ status }: EmptyStateProps) {
  const copy = EMPTY_COPY[status];
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
        <Sticker variant={copy.stickerVariant} style={{ marginBottom: 12 }}>
          {copy.stickerLabel}
        </Sticker>
        <h2
          style={{
            margin: '8px 0 10px',
            fontFamily: 'var(--font-display)',
            fontSize: 32,
            fontWeight: 800,
            lineHeight: 1.05,
            letterSpacing: '-0.02em',
          }}
        >
          {copy.title}
        </h2>
        <p
          style={{
            margin: 0,
            fontSize: 14,
            lineHeight: 1.5,
            color: 'var(--text-dim)',
            maxWidth: 480,
          }}
        >
          {copy.body}
        </p>
      </div>
      <div
        aria-hidden
        style={{
          width: 140,
          height: 140,
          borderRadius: 'var(--radius-lg)',
          background: 'var(--bg-2)',
          border: '3px solid var(--stroke)',
          boxShadow: 'var(--shadow-chunk-lg)',
          display: 'grid',
          placeItems: 'center',
          fontSize: 64,
        }}
      >
        {copy.emoji}
      </div>
    </div>
  );
}

type EmptyCopy = {
  stickerVariant: 'lime' | 'yellow' | 'pink' | 'purple';
  stickerLabel: string;
  title: string;
  body: string;
  emoji: string;
};

const EMPTY_COPY: Record<ApprovalStatusFilter, EmptyCopy> = {
  pending_review: {
    stickerVariant: 'lime',
    stickerLabel: '🎉 inbox zero',
    title: 'Nenhum resumo pendente. Todos em dia! 🎉',
    body: 'assim que um novo resumo cair na fila, ele aparece aqui pra você aprovar, editar ou rejeitar.',
    emoji: '🎉',
  },
  approved: {
    stickerVariant: 'yellow',
    stickerLabel: '✨ ainda sem aprovados',
    title: 'nenhum resumo aprovado ainda',
    body: 'aprova um resumo pendente e ele aparece aqui — pronto pra virar áudio.',
    emoji: '✅',
  },
  rejected: {
    stickerVariant: 'pink',
    stickerLabel: '🧹 sem rejeições',
    title: 'nenhum resumo rejeitado',
    body: 'quando você rejeitar um resumo com motivo, ele fica aqui pro histórico.',
    emoji: '🗑️',
  },
  all: {
    stickerVariant: 'purple',
    stickerLabel: '📭 nada por aqui',
    title: 'nenhum resumo pra esse tenant',
    body: 'configura seus grupos e agendas na Fase 6/7 — quando um resumo for gerado, ele cai aqui.',
    emoji: '📭',
  },
};
