/**
 * `/approval/[id]` — Fase 8 detail page.
 *
 * Server component: resolves the authenticated tenant, fetches the summary,
 * and hands a frozen copy to the client `SummaryEditor`. Everything
 * interactive (textarea, save, approve, reject, regenerate) lives in the
 * client component — this file does no client state.
 *
 * Layout mirrors `podZAP/screen_approval.jsx`: `TopBar` (pink accent) on top,
 * two-column grid below — textarea + action toolbar on the left, metadata
 * panel on the right.
 */

import { notFound, redirect } from 'next/navigation';

import { TopBar } from '@/components/shell/TopBar';
import { Sticker } from '@/components/ui/Sticker';
import { getSummary, type SummaryView } from '@/lib/summaries/service';
import { getCurrentUserAndTenant } from '@/lib/tenant';

import { AudioStatus } from './AudioStatus';
import { DeliveryStatus } from './DeliveryStatus';
import { SummaryEditor } from './SummaryEditor';

interface ApprovalDetailPageProps {
  params: Promise<{ id: string }>;
}

/** Human-readable labels for the `summary_tone` enum. Also used by the side
 *  panel badge color mapping in `ToneBadge`. */
const TONE_LABELS: Record<SummaryView['tone'], string> = {
  formal: 'Formal',
  fun: 'Divertido',
  corporate: 'Corporativo',
};

/** Human-readable labels for the `summary_status` enum. */
const STATUS_LABELS: Record<SummaryView['status'], string> = {
  pending_review: 'Aguardando revisão',
  approved: 'Aprovado',
  rejected: 'Rejeitado',
};

/** CSS color token per status — used on the status sticker. */
const STATUS_ACCENTS: Record<SummaryView['status'], string> = {
  pending_review: 'var(--yellow-500)',
  approved: 'var(--zap-500)',
  rejected: 'var(--red-500)',
};

export default async function ApprovalDetailPage({
  params,
}: ApprovalDetailPageProps) {
  const context = await getCurrentUserAndTenant();
  if (!context) {
    redirect('/login?error=Faça login para continuar');
  }

  const { tenant } = context;
  const { id } = await params;

  if (!id || typeof id !== 'string') {
    notFound();
  }

  const summary = await getSummary(tenant.id, id);
  if (!summary) {
    notFound();
  }

  const groupLabel = summary.groupName ?? 'grupo sem nome';
  const periodLabel = formatPeriod(summary.periodStart, summary.periodEnd);

  return (
    <div style={{ minHeight: '100vh' }}>
      <TopBar
        title="Revisar resumo"
        subtitle={groupLabel}
        accent="pink"
        breadcrumb="podZAP · Fase 8"
      />

      <div
        style={{
          padding: '24px clamp(16px, 4vw, 36px) 40px',
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) 320px',
          gap: 20,
          alignItems: 'start',
        }}
      >
        <SummaryEditor initial={summary} />

        <aside
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
            position: 'sticky',
            top: 24,
          }}
        >
          <MetadataCard title="Status">
            <span
              className="sticker"
              style={{
                background: STATUS_ACCENTS[summary.status],
                color:
                  summary.status === 'approved' ||
                  summary.status === 'rejected'
                    ? '#fff'
                    : 'var(--ink-900)',
              }}
            >
              {STATUS_LABELS[summary.status]}
            </span>
          </MetadataCard>

          {summary.status === 'approved' && (
            <MetadataCard title="Áudio">
              <AudioStatus summaryId={summary.id} />
            </MetadataCard>
          )}

          {summary.status === 'approved' && (
            <MetadataCard title="Entrega">
              <DeliveryStatus summaryId={summary.id} />
            </MetadataCard>
          )}

          <MetadataCard title="Tom">
            <ToneBadge tone={summary.tone} />
          </MetadataCard>

          <MetadataCard title="Período">
            <div
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: 'var(--text)',
                fontFamily: 'var(--font-mono)',
              }}
            >
              {periodLabel}
            </div>
          </MetadataCard>

          <MetadataCard title="Criado">
            <div
              style={{
                fontSize: 13,
                fontWeight: 500,
                color: 'var(--text)',
              }}
            >
              {formatDateTime(summary.createdAt)}
            </div>
          </MetadataCard>

          {summary.model && (
            <MetadataCard title="Modelo">
              <div
                style={{
                  fontSize: 12,
                  fontFamily: 'var(--font-mono)',
                  color: 'var(--text)',
                  wordBreak: 'break-all',
                }}
              >
                {summary.model}
              </div>
            </MetadataCard>
          )}

          {summary.promptVersion && (
            <MetadataCard title="Prompt">
              <div
                style={{
                  fontSize: 12,
                  fontFamily: 'var(--font-mono)',
                  color: 'var(--text)',
                }}
              >
                {summary.promptVersion}
              </div>
            </MetadataCard>
          )}

          {summary.rejectedReason && (
            <MetadataCard title="Motivo da rejeição" tone="danger">
              <div
                style={{
                  fontSize: 13,
                  lineHeight: 1.5,
                  color: 'var(--text)',
                  whiteSpace: 'pre-wrap',
                }}
              >
                {summary.rejectedReason}
              </div>
            </MetadataCard>
          )}
        </aside>
      </div>
    </div>
  );
}

/** Small metadata block with a bold uppercase eyebrow label. */
function MetadataCard({
  title,
  children,
  tone,
}: {
  title: string;
  children: React.ReactNode;
  tone?: 'danger';
}) {
  return (
    <div
      className="card"
      style={{
        padding: 14,
        borderColor:
          tone === 'danger' ? 'var(--red-500)' : 'var(--stroke)',
      }}
    >
      <div
        style={{
          fontSize: 10,
          fontWeight: 800,
          textTransform: 'uppercase',
          letterSpacing: '0.12em',
          color: 'var(--text-dim)',
          marginBottom: 8,
        }}
      >
        {title}
      </div>
      {children}
    </div>
  );
}

/** Tone sticker, color-coded (formal=purple, fun=lime, corporate=yellow). */
function ToneBadge({ tone }: { tone: SummaryView['tone'] }) {
  const background =
    tone === 'formal'
      ? 'var(--purple-600)'
      : tone === 'fun'
        ? 'var(--lime-500)'
        : 'var(--yellow-500)';
  const color = tone === 'formal' ? '#fff' : 'var(--ink-900)';
  return (
    <span
      className="sticker"
      style={{
        background,
        color,
      }}
    >
      {TONE_LABELS[tone]}
    </span>
  );
}

/** Period label: `dd/mm → dd/mm` (UTC formatting keeps it stable server-side). */
function formatPeriod(startIso: string, endIso: string): string {
  return `${formatShortDate(startIso)} → ${formatShortDate(endIso)}`;
}

function formatShortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}`;
}

/** `dd/mm/yyyy HH:mm` UTC. */
function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = d.getUTCFullYear();
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mi = String(d.getUTCMinutes()).padStart(2, '0');
  return `${dd}/${mm}/${yyyy} ${hh}:${mi} UTC`;
}
