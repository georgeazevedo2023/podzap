// NOTE: `@/lib/pipeline/normalize` is authored in parallel by another Fase 6
// agent (Agente 3 in docs/plans/fase-6-plan.md). This page imports
// `buildNormalizedConversation` + the `NormalizedConversation`/`Topic`/
// `NormalizedMessage` types from that module — builds will fail until that
// module lands, same pattern used by Fase 3's groups page while
// `@/lib/groups/service` was still in flight.

import { notFound, redirect } from 'next/navigation';

import { TopBar } from '@/components/shell/TopBar';
import { getCurrentUserAndTenant } from '@/lib/tenant';
import { listGroups } from '@/lib/groups/service';
import {
  buildNormalizedConversation,
  type NormalizedConversation,
} from '@/lib/pipeline/normalize';
import type { NormalizedMessage } from '@/lib/pipeline/filter';
import type { Topic } from '@/lib/pipeline/cluster';

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

type PreviewSearchParams = {
  groupId?: string | string[];
  start?: string | string[];
  end?: string | string[];
};

function pickFirst(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

/* -------------------------------------------------------------------------- */
/* Page                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Pipeline Preview — dev-only UI for inspecting Fase 6 output.
 *
 * Guarded so a production build that somehow keeps the route around (e.g.
 * caller forgot a `next.config` rewrite) still returns a 404. `notFound()`
 * throws NEXT_NOT_FOUND which Next serves as a normal 404 page — no redirect
 * hop and no leak of the route's existence.
 *
 * Form is plain HTML (method=GET): submitting appends query params to the URL
 * and re-renders this server component with results. No client JS needed.
 */
export default async function PipelinePreviewPage({
  searchParams,
}: {
  searchParams: Promise<PreviewSearchParams>;
}) {
  if (process.env.NODE_ENV === 'production') {
    notFound();
  }

  const context = await getCurrentUserAndTenant();
  if (!context) {
    redirect('/login?error=Faça login para continuar');
  }

  const { tenant } = context;
  const params = await searchParams;

  const groupId = pickFirst(params.groupId)?.trim() ?? '';
  const startRaw = pickFirst(params.start)?.trim() ?? '';
  const endRaw = pickFirst(params.end)?.trim() ?? '';

  const groups = (await listGroups(tenant.id, { pageSize: 100 })).rows;

  const hasAllParams =
    groupId.length > 0 && startRaw.length > 0 && endRaw.length > 0;

  let conversation: NormalizedConversation | null = null;
  let runError: string | null = null;

  if (hasAllParams) {
    const startDate = new Date(startRaw);
    const endDate = new Date(endRaw);
    if (
      Number.isNaN(startDate.getTime()) ||
      Number.isNaN(endDate.getTime())
    ) {
      runError = 'Datas inválidas — verifica os campos start/end.';
    } else {
      try {
        conversation = await buildNormalizedConversation(
          tenant.id,
          groupId,
          startDate,
          endDate,
        );
      } catch (err) {
        runError = `${(err as Error).name}: ${(err as Error).message}`;
      }
    }
  }

  return (
    <div style={{ minHeight: '100vh' }}>
      <TopBar
        title="Pipeline Preview"
        subtitle="dev only"
        accent="yellow"
        breadcrumb="podZAP · Fase 6"
      />

      <div
        style={{
          padding: '28px 36px 40px',
          display: 'flex',
          flexDirection: 'column',
          gap: 24,
          maxWidth: 1240,
        }}
      >
        <PreviewForm
          groups={groups}
          groupId={groupId}
          start={startRaw}
          end={endRaw}
        />

        {runError && (
          <div
            role="alert"
            className="card"
            style={{
              padding: 20,
              borderColor: 'var(--pink-500, #ff4c8d)',
              background: 'rgba(255, 76, 141, 0.08)',
              color: 'var(--text)',
              fontSize: 14,
              lineHeight: 1.5,
            }}
          >
            <strong style={{ display: 'block', marginBottom: 6 }}>
              erro ao rodar o pipeline
            </strong>
            <code style={{ fontSize: 13 }}>{runError}</code>
          </div>
        )}

        {conversation && <ConversationView conversation={conversation} />}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Form                                                                       */
/* -------------------------------------------------------------------------- */

type PreviewFormProps = {
  groups: Array<{ id: string; name: string; isMonitored: boolean }>;
  groupId: string;
  start: string;
  end: string;
};

function PreviewForm({ groups, groupId, start, end }: PreviewFormProps) {
  return (
    <form
      method="get"
      className="card"
      style={{
        padding: 24,
        display: 'grid',
        gap: 16,
        gridTemplateColumns: 'minmax(220px, 1fr) minmax(200px, 1fr) minmax(200px, 1fr) auto',
        alignItems: 'end',
      }}
    >
      <label style={{ display: 'grid', gap: 6 }}>
        <span style={labelStyle}>Grupo</span>
        <select
          name="groupId"
          defaultValue={groupId}
          required
          style={inputStyle}
        >
          <option value="">— selecione —</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.isMonitored ? '★ ' : ''}
              {g.name}
            </option>
          ))}
        </select>
      </label>

      <label style={{ display: 'grid', gap: 6 }}>
        <span style={labelStyle}>Start</span>
        <input
          type="datetime-local"
          name="start"
          defaultValue={start}
          required
          style={inputStyle}
        />
      </label>

      <label style={{ display: 'grid', gap: 6 }}>
        <span style={labelStyle}>End</span>
        <input
          type="datetime-local"
          name="end"
          defaultValue={end}
          required
          style={inputStyle}
        />
      </label>

      <button type="submit" className="btn btn-zap">
        ⚡ run pipeline
      </button>
    </form>
  );
}

const labelStyle = {
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '0.1em',
  textTransform: 'uppercase' as const,
  color: 'var(--text-dim)',
};

const inputStyle = {
  padding: '10px 12px',
  fontSize: 14,
  borderRadius: 'var(--radius-md, 10px)',
  border: '2px solid var(--stroke, #111)',
  background: 'var(--bg-1, #fff)',
  color: 'var(--text, #111)',
  fontFamily: 'inherit',
};

/* -------------------------------------------------------------------------- */
/* Conversation                                                               */
/* -------------------------------------------------------------------------- */

function ConversationView({
  conversation,
}: {
  conversation: NormalizedConversation;
}) {
  const totalKept = conversation.topics.reduce(
    (acc, t) => acc + t.messages.length,
    0,
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <StatsRow
        total={conversation.total}
        discarded={conversation.discarded}
        topics={conversation.topics.length}
        kept={totalKept}
        groupName={conversation.groupName}
      />

      {conversation.topics.length === 0 ? (
        <div
          className="card"
          style={{ padding: 20, fontSize: 14, color: 'var(--text-dim)' }}
        >
          nenhum tópico encontrado no período — o filtro descartou todas as
          mensagens ou não havia nada no intervalo.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {conversation.topics.map((topic, idx) => (
            <TopicCard key={topic.id} topic={topic} index={idx} />
          ))}
        </div>
      )}

      <JsonDump conversation={conversation} />
    </div>
  );
}

function StatsRow({
  total,
  discarded,
  topics,
  kept,
  groupName,
}: {
  total: number;
  discarded: number;
  topics: number;
  kept: number;
  groupName: string;
}) {
  return (
    <div
      className="card"
      style={{
        padding: 20,
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
        gap: 18,
        alignItems: 'center',
      }}
    >
      <Stat label="grupo" value={groupName} wide />
      <Stat label="total msgs" value={String(total)} />
      <Stat label="descartadas" value={String(discarded)} />
      <Stat label="mantidas" value={String(kept)} />
      <Stat label="tópicos" value={String(topics)} />
    </div>
  );
}

function Stat({
  label,
  value,
  wide,
}: {
  label: string;
  value: string;
  wide?: boolean;
}) {
  return (
    <div
      style={{
        display: 'grid',
        gap: 4,
        gridColumn: wide ? 'span 2' : undefined,
        minWidth: 0,
      }}
    >
      <span style={labelStyle}>{label}</span>
      <span
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: 22,
          fontWeight: 800,
          letterSpacing: '-0.02em',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
        title={value}
      >
        {value}
      </span>
    </div>
  );
}

function TopicCard({ topic, index }: { topic: Topic; index: number }) {
  const start = formatDateTime(topic.startAt);
  const end = formatDateTime(topic.endAt);

  return (
    <div className="card" style={{ padding: 20 }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          gap: 16,
          marginBottom: 10,
          flexWrap: 'wrap',
        }}
      >
        <h3
          style={{
            margin: 0,
            fontFamily: 'var(--font-display)',
            fontSize: 20,
            fontWeight: 800,
            letterSpacing: '-0.02em',
          }}
        >
          tópico #{index + 1}
        </h3>
        <span style={{ fontSize: 13, color: 'var(--text-dim)' }}>
          {start} → {end}
        </span>
      </div>

      <div style={{ display: 'grid', gap: 8, marginBottom: 12 }}>
        <MetaRow label="participantes" items={topic.participants} />
        <MetaRow label="keywords" items={topic.dominantKeywords} />
        <div style={{ fontSize: 13, color: 'var(--text-dim)' }}>
          <strong style={{ color: 'var(--text)' }}>
            {topic.messages.length}
          </strong>{' '}
          mensagens
        </div>
      </div>

      <details>
        <summary
          style={{
            cursor: 'pointer',
            fontSize: 13,
            fontWeight: 700,
            color: 'var(--text)',
            padding: '6px 0',
          }}
        >
          ver mensagens
        </summary>
        <div
          style={{
            marginTop: 10,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            maxHeight: 480,
            overflowY: 'auto',
            paddingRight: 6,
          }}
        >
          {topic.messages.map((msg) => (
            <MessageRow key={msg.id} msg={msg} />
          ))}
        </div>
      </details>
    </div>
  );
}

function MetaRow({ label, items }: { label: string; items: string[] }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'baseline',
        gap: 10,
        flexWrap: 'wrap',
      }}
    >
      <span style={labelStyle}>{label}</span>
      {items.length === 0 ? (
        <span style={{ fontSize: 13, color: 'var(--text-dim)' }}>—</span>
      ) : (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {items.map((it) => (
            <span
              key={it}
              style={{
                fontSize: 12,
                padding: '3px 8px',
                borderRadius: 999,
                border: '1.5px solid var(--stroke, #111)',
                background: 'var(--bg-2, #f4f4f4)',
                fontWeight: 600,
              }}
            >
              {it}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function MessageRow({ msg }: { msg: NormalizedMessage }) {
  return (
    <div
      style={{
        padding: '10px 12px',
        borderRadius: 'var(--radius-md, 10px)',
        border: '1.5px solid var(--stroke, #111)',
        background: 'var(--bg-1, #fff)',
        display: 'grid',
        gap: 4,
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: 10,
          fontSize: 12,
          color: 'var(--text-dim)',
          flexWrap: 'wrap',
        }}
      >
        <span>
          <strong style={{ color: 'var(--text)' }}>{msg.senderName}</strong>
          {' · '}
          {msg.type}
          {msg.hasMedia ? ' · 📎' : ''}
        </span>
        <span>
          {formatDateTime(msg.at)} · w={msg.weight.toFixed(2)}
        </span>
      </div>
      <div
        style={{
          fontSize: 13,
          lineHeight: 1.45,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        {msg.content || <em style={{ color: 'var(--text-dim)' }}>(vazio)</em>}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* JSON dump                                                                  */
/* -------------------------------------------------------------------------- */

function JsonDump({
  conversation,
}: {
  conversation: NormalizedConversation;
}) {
  // JSON.stringify handles Date via toISOString — no custom replacer needed.
  const text = JSON.stringify(conversation, null, 2);
  return (
    <details className="card" style={{ padding: 20 }}>
      <summary
        style={{
          cursor: 'pointer',
          fontSize: 13,
          fontWeight: 700,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
        }}
      >
        raw json ({text.length.toLocaleString()} chars)
      </summary>
      <pre
        style={{
          marginTop: 14,
          padding: 14,
          background: 'var(--bg-2, #f4f4f4)',
          border: '1.5px solid var(--stroke, #111)',
          borderRadius: 'var(--radius-md, 10px)',
          maxHeight: 560,
          overflow: 'auto',
          fontSize: 12,
          lineHeight: 1.5,
          fontFamily:
            'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
          whiteSpace: 'pre',
        }}
      >
        {text}
      </pre>
    </details>
  );
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function formatDateTime(value: Date | string): string {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  const pad = (n: number) => String(n).padStart(2, '0');
  const y = d.getFullYear();
  const mo = pad(d.getMonth() + 1);
  const da = pad(d.getDate());
  const h = pad(d.getHours());
  const mi = pad(d.getMinutes());
  return `${y}-${mo}-${da} ${h}:${mi}`;
}
