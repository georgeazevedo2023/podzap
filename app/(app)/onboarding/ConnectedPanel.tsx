'use client';

// NOTE: `@/lib/whatsapp/service` is authored in parallel by another agent.
// Only the `InstanceView` type is imported.

import { useState, useTransition } from 'react';

import type { InstanceView } from '@/lib/whatsapp/service';

import { disconnectAction } from './actions';

export interface ConnectedPanelProps {
  instance: InstanceView;
}

/**
 * Rendered on the onboarding screen once the tenant has a `connected`
 * instance. Shows phone + connection timestamp + a disconnect CTA.
 *
 * The disconnect button is wired to the server action (not the API route)
 * so the server page re-renders the empty state on success.
 */
export function ConnectedPanel({ instance }: ConnectedPanelProps) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleDisconnect = (): void => {
    setError(null);
    startTransition(async () => {
      try {
        await disconnectAction(instance.id);
      } catch (err) {
        // `redirect()` inside a server action throws an internal Next signal
        // that we MUST rethrow — otherwise the navigation never happens. If
        // it reaches us as a real Error, something else went wrong.
        if (
          err instanceof Error &&
          'digest' in err &&
          typeof (err as { digest?: unknown }).digest === 'string' &&
          (err as { digest: string }).digest.startsWith('NEXT_REDIRECT')
        ) {
          throw err;
        }
        setError(
          err instanceof Error ? err.message : 'Erro ao desconectar',
        );
      }
    });
  };

  const connectedAt = instance.connectedAt
    ? new Date(instance.connectedAt).toLocaleString('pt-BR')
    : null;

  return (
    <div
      className="card"
      style={{
        padding: 28,
        display: 'grid',
        gap: 20,
        maxWidth: 640,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span className="sticker sticker-zap">
          <span className="live-dot" /> conectado
        </span>
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: 'var(--color-text-dim)',
          }}
        >
          instância ativa
        </span>
      </div>

      <div>
        <h2
          style={{
            margin: '0 0 6px',
            fontFamily: 'var(--font-display)',
            fontSize: 44,
            fontWeight: 800,
            lineHeight: 1,
            letterSpacing: '-0.025em',
          }}
        >
          zap <span style={{ color: 'var(--color-zap-500)' }}>conectado!</span> 🎉
        </h2>
        <p
          style={{
            margin: 0,
            fontSize: 14,
            color: 'var(--color-text-dim)',
            lineHeight: 1.5,
          }}
        >
          seu WhatsApp tá linkado. próximo passo: escolher os grupos que a
          gente vai transformar em podcast.
        </p>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 12,
          padding: 16,
          background: 'var(--color-bg-2)',
          border: '2.5px solid var(--color-stroke)',
          borderRadius: 'var(--radius-md)',
        }}
      >
        <Field label="número">
          {instance.phone ?? <span style={{ opacity: 0.6 }}>—</span>}
        </Field>
        <Field label="conectado em">
          {connectedAt ?? <span style={{ opacity: 0.6 }}>agora há pouco</span>}
        </Field>
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <button
          type="button"
          className="btn btn-ghost"
          disabled={pending}
          onClick={handleDisconnect}
          style={{ color: 'var(--color-red-500)' }}
        >
          {pending ? 'desconectando…' : 'desconectar'}
        </button>
      </div>

      {error && (
        <div
          role="alert"
          style={{
            padding: 12,
            border: '2px solid var(--color-red-500)',
            borderRadius: 'var(--radius-md)',
            background: 'rgba(255, 77, 60, 0.08)',
            color: 'var(--color-red-500)',
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          ⚠ {error}
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div
        style={{
          fontSize: 10,
          fontWeight: 800,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: 'var(--color-text-dim)',
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 14,
          fontWeight: 600,
          color: 'var(--color-text)',
          wordBreak: 'break-word',
        }}
      >
        {children}
      </div>
    </div>
  );
}

export default ConnectedPanel;
