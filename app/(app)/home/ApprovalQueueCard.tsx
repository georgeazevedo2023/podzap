import Link from 'next/link';

import { listSummaries } from '@/lib/summaries/service';

/**
 * Right-column card listing the next few summaries waiting on human
 * approval. Pulled fresh on every render — the list is short (max 3)
 * and the queries are tenant-scoped so the cost is negligible.
 *
 * `pendingCount` comes from the layout's existing sidebar badge count
 * (source of truth) so the "N na fila" pill stays consistent with the
 * sidebar even if the list itself is truncated.
 */
export type ApprovalQueueCardProps = {
  tenantId: string;
  pendingCount: number;
};

export async function ApprovalQueueCard({
  tenantId,
  pendingCount,
}: ApprovalQueueCardProps): Promise<React.ReactElement> {
  const rows =
    pendingCount > 0
      ? await listSummaries(tenantId, {
          status: 'pending_review',
          limit: 3,
        }).catch(() => [])
      : [];

  return (
    <div className="card" style={{ padding: 18 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 12,
        }}
      >
        <div
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 800,
            fontSize: 16,
            letterSpacing: '-0.01em',
          }}
        >
          aprovar
        </div>
        {pendingCount > 0 && (
          <span
            style={{
              background: 'var(--color-pink-500)',
              color: '#fff',
              borderRadius: 999,
              padding: '2px 10px',
              fontSize: 11,
              fontWeight: 800,
              border: '2px solid var(--color-stroke)',
            }}
          >
            {pendingCount} na fila
          </span>
        )}
      </div>

      {rows.length === 0 ? (
        <div
          style={{
            fontSize: 12,
            color: 'var(--color-text-dim)',
            padding: '10px 4px',
          }}
        >
          nenhum resumo pendente 👍
        </div>
      ) : (
        rows.map((row, i) => (
          <Link
            key={row.id}
            href={`/approval/${row.id}`}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: 10,
              marginTop: i === 0 ? 0 : 6,
              border: '2px solid var(--color-stroke)',
              borderRadius: 'var(--radius-md)',
              background: 'var(--color-bg-2)',
              color: 'var(--color-text)',
              textDecoration: 'none',
            }}
          >
            <div
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background:
                  i === 0
                    ? 'var(--color-yellow-500)'
                    : 'var(--color-pink-500)',
              }}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {row.groupName ?? 'grupo'}
              </div>
              <div
                style={{
                  fontSize: 10,
                  color: 'var(--color-text-dim)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                }}
              >
                {i === 0 ? 'pendente' : 'revisar'}
              </div>
            </div>
            <div style={{ fontSize: 12, opacity: 0.4 }}>→</div>
          </Link>
        ))
      )}
    </div>
  );
}

export default ApprovalQueueCard;
