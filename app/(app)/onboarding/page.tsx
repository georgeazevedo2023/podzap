// NOTE: `@/lib/whatsapp/service` is authored in parallel by another agent.
// This page imports `getCurrentInstance` + `InstanceView` from it — builds
// will fail until that module lands.

import { redirect } from 'next/navigation';

import { TopBar } from '@/components/shell/TopBar';
import { getCurrentUserAndTenant } from '@/lib/tenant';
import {
  getCurrentInstance,
  type InstanceView,
} from '@/lib/whatsapp/service';

import { startConnectAction } from './actions';
import { ConnectedPanel } from './ConnectedPanel';
import { QrCodePanel } from './QrCodePanel';

type Step = 0 | 1 | 2; // 0 = start / generate, 1 = scan QR, 2 = connected

function stepFromInstance(instance: InstanceView | null): Step {
  if (!instance) return 0;
  if (instance.status === 'connected') return 2;
  return 1;
}

/**
 * Onboarding page — user decides / shows QR / confirms connection.
 *
 * This is a pure server component: it reads the tenant's current WhatsApp
 * instance via the service layer and picks a variant. The only client
 * boundaries are `QrCodePanel` (polling) and `ConnectedPanel` (action
 * pending state); both receive a serializable `InstanceView`.
 *
 * Auth is enforced by the `(app)/layout.tsx` — we still re-fetch the
 * context here because we need the tenant id, and doing it locally keeps
 * the component self-contained.
 */
export default async function OnboardingPage() {
  const context = await getCurrentUserAndTenant();
  if (!context) {
    redirect('/login?error=Faça login para continuar');
  }

  const instance = await getCurrentInstance(context.tenant.id);
  const step = stepFromInstance(instance);

  return (
    <div style={{ minHeight: '100vh' }}>
      <TopBar
        title="Conectar WhatsApp"
        subtitle="escaneia o QR com o celular e a gente cuida do resto"
        accent="zap"
        breadcrumb="podZAP · Fase 2"
      />

      <div
        style={{
          padding: '28px 36px 40px',
          display: 'flex',
          flexDirection: 'column',
          gap: 24,
          maxWidth: 1080,
        }}
      >
        <Stepper current={step} />

        {step === 0 && <StartPanel />}
        {step === 1 && instance && <QrCodePanel instance={instance} />}
        {step === 2 && instance && <ConnectedPanel instance={instance} />}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Stepper                                                                    */
/* -------------------------------------------------------------------------- */

const STEPS: ReadonlyArray<{ label: string; hint: string }> = [
  { label: 'número', hint: 'gerar QR' },
  { label: 'QR code', hint: 'escanear' },
  { label: 'conectado', hint: 'pronto!' },
];

function Stepper({ current }: { current: Step }) {
  return (
    <div
      style={{
        display: 'flex',
        gap: 8,
        flexWrap: 'wrap',
      }}
    >
      {STEPS.map((s, i) => {
        const active = i === current;
        const done = i < current;
        const background = done
          ? 'var(--color-zap-500)'
          : active
            ? 'var(--color-purple-600)'
            : 'var(--color-surface)';
        const color = done || active ? '#fff' : 'var(--color-text-dim)';
        return (
          <div
            key={s.label}
            style={{
              flex: '1 1 180px',
              padding: '10px 14px',
              background,
              color,
              border: '2.5px solid var(--color-stroke)',
              borderRadius: 'var(--radius-pill)',
              fontSize: 12,
              fontWeight: 800,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              boxShadow: active ? 'var(--shadow-chunk)' : 'none',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
            }}
          >
            <span
              style={{
                width: 22,
                height: 22,
                borderRadius: '50%',
                background: done
                  ? 'var(--color-lime-500)'
                  : active
                    ? '#fff'
                    : 'transparent',
                color: 'var(--color-ink-900)',
                border: '2px solid var(--color-stroke)',
                display: 'grid',
                placeItems: 'center',
                fontSize: 11,
                fontWeight: 800,
                flexShrink: 0,
              }}
            >
              {done ? '✓' : i + 1}
            </span>
            <span>
              {i + 1}. {s.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Start panel (step 0 — no instance yet)                                     */
/* -------------------------------------------------------------------------- */

function StartPanel() {
  return (
    <div
      className="card"
      style={{
        padding: 32,
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1.2fr) minmax(0, 1fr)',
        gap: 28,
        alignItems: 'center',
      }}
    >
      <div>
        <span className="sticker sticker-zap" style={{ marginBottom: 12 }}>
          🟢 passo 1/3
        </span>
        <h2
          style={{
            margin: '10px 0 14px',
            fontFamily: 'var(--font-display)',
            fontSize: 48,
            fontWeight: 800,
            lineHeight: 1,
            letterSpacing: '-0.03em',
          }}
        >
          bora conectar seu{' '}
          <span style={{ color: 'var(--color-zap-500)' }}>zap</span>? 📱
        </h2>
        <p
          style={{
            margin: '0 0 22px',
            fontSize: 15,
            color: 'var(--color-text-dim)',
            lineHeight: 1.5,
            maxWidth: 480,
          }}
        >
          a gente usa a API oficial (uazapi) pra ler mensagens dos grupos que
          você escolher. nada de bot, nada de print — você autoriza, a gente
          resume.
        </p>

        <form action={startConnectAction}>
          <button type="submit" className="btn btn-zap">
            ⚡ gerar QR code
          </button>
        </form>

        <ul
          style={{
            listStyle: 'none',
            padding: 0,
            margin: '26px 0 0',
            display: 'grid',
            gap: 10,
          }}
        >
          {[
            ['🔒', 'sem print, sem bot', 'API oficial, token criptografado'],
            ['🎯', 'só os grupos que você marcar', 'nada de ler o zap inteiro'],
            ['⚡', 'setup em 2 minutos', 'sério, é rapidinho'],
          ].map(([icon, title, desc]) => (
            <li
              key={title}
              style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}
            >
              <div
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 10,
                  background: 'var(--color-lime-500)',
                  border: '2px solid var(--color-stroke)',
                  boxShadow: '2px 2px 0 var(--color-stroke)',
                  display: 'grid',
                  placeItems: 'center',
                  fontSize: 18,
                  flexShrink: 0,
                }}
              >
                {icon}
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{title}</div>
                <div
                  style={{
                    fontSize: 12,
                    color: 'var(--color-text-dim)',
                  }}
                >
                  {desc}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div style={{ display: 'grid', placeItems: 'center' }}>
        <div
          style={{
            width: 240,
            height: 240,
            borderRadius: 'var(--radius-lg)',
            background: 'var(--color-bg-2)',
            border: '3px solid var(--color-stroke)',
            boxShadow: 'var(--shadow-chunk-lg)',
            display: 'grid',
            placeItems: 'center',
            textAlign: 'center',
            padding: 20,
          }}
        >
          <div>
            <div style={{ fontSize: 64, marginBottom: 6 }}>📱</div>
            <div
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: 20,
                fontWeight: 800,
                lineHeight: 1.1,
                letterSpacing: '-0.02em',
              }}
            >
              seu zap<br />espera por aí
            </div>
            <div
              style={{
                fontSize: 12,
                color: 'var(--color-text-dim)',
                marginTop: 6,
              }}
            >
              clica em "gerar QR code"
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
