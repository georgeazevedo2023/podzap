import Link from 'next/link';
import { redirect } from 'next/navigation';
import { TopBar } from '@/components/shell/TopBar';
import { Sticker } from '@/components/ui/Sticker';
import { getCurrentUserAndTenant } from '@/lib/tenant';

/**
 * Landing screen for authenticated users. This is intentionally simple for
 * Fase 1 — the fancy player / stats / recent-eps dashboard (see
 * `podZAP/screen_home.jsx` mockup) lands once Fase 2+ populates real data.
 *
 * For now the screen surfaces:
 *   - "Quem sou eu?" → user email + tenant name
 *   - "Próximo passo" → CTA to connect WhatsApp (onboarding placeholder)
 *   - Tenant summary card (plan / role)
 *   - Roadmap checklist
 */
export default async function HomePage() {
  const context = await getCurrentUserAndTenant();

  // The parent layout already redirects unauthenticated users, but type-narrow
  // for TS and guard against a direct hit to this file in edge cases.
  if (!context) {
    redirect('/login?error=Faça login para continuar');
  }

  const { user, tenant } = context;

  return (
    <div style={{ minHeight: '100vh' }}>
      <TopBar
        title="Bem-vindo de volta"
        subtitle={`Conectado como ${user.email}`}
        accent="purple"
        breadcrumb="podZAP · Fase 1"
        actions={<Sticker variant="lime">✨ beta</Sticker>}
      />

      <div
        style={{
          padding: '28px 36px 40px',
          display: 'grid',
          gap: 20,
          gridTemplateColumns: 'minmax(0, 2fr) minmax(280px, 1fr)',
        }}
      >
        {/* LEFT: primary CTA + next steps */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Hero CTA */}
          <div
            className="card sprinkle"
            style={{
              padding: 28,
              background: 'var(--purple-600)',
              color: '#fff',
              position: 'relative',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                position: 'absolute',
                right: -40,
                bottom: -40,
                width: 220,
                height: 220,
                background: 'var(--pink-500)',
                borderRadius: '50%',
                opacity: 0.3,
              }}
            />
            <div style={{ position: 'relative', zIndex: 2, maxWidth: 520 }}>
              <Sticker variant="yellow" style={{ marginBottom: 12 }}>
                🎙 primeiro passo
              </Sticker>
              <h2
                style={{
                  margin: '0 0 8px',
                  fontFamily: 'var(--font-display)',
                  fontSize: 34,
                  fontWeight: 800,
                  lineHeight: 1.05,
                  letterSpacing: '-0.025em',
                }}
              >
                conecta teu whatsapp e vira podcast
              </h2>
              <p
                style={{
                  margin: '0 0 18px',
                  fontSize: 14,
                  lineHeight: 1.5,
                  opacity: 0.9,
                }}
              >
                escaneia o QR, escolhe os grupos e a gente transforma o caos em
                um podcast decente — com aprovação humana antes de publicar.
              </p>
              <Link href="/onboarding" className="btn">
                conectar whatsapp →
              </Link>
            </div>
          </div>

          {/* Next steps checklist */}
          <div className="card" style={{ padding: 24 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                marginBottom: 14,
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
                próximos passos
              </h3>
              <Sticker variant="pink">roadmap</Sticker>
            </div>
            <ol
              style={{
                margin: 0,
                padding: 0,
                listStyle: 'none',
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
              }}
            >
              {[
                {
                  label: 'conectar instância do WhatsApp (UAZAPI)',
                  done: false,
                },
                { label: 'selecionar grupos pra monitorar', done: false },
                { label: 'configurar agenda de resumo', done: false },
                { label: 'aprovar primeiro episódio', done: false },
              ].map((step, i) => (
                <li
                  key={i}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '12px 14px',
                    border: '2px solid var(--stroke)',
                    borderRadius: 'var(--r-md)',
                    background: 'var(--bg-2)',
                  }}
                >
                  <div
                    style={{
                      width: 24,
                      height: 24,
                      borderRadius: '50%',
                      border: '2px solid var(--stroke)',
                      background: step.done ? 'var(--lime-500)' : 'transparent',
                      display: 'grid',
                      placeItems: 'center',
                      fontSize: 11,
                      fontWeight: 800,
                      flexShrink: 0,
                    }}
                  >
                    {step.done ? '✓' : i + 1}
                  </div>
                  <span style={{ fontSize: 14, fontWeight: 600 }}>
                    {step.label}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        </div>

        {/* RIGHT: tenant summary + tip */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="card" style={{ padding: 20 }}>
            <div
              style={{
                fontSize: 10,
                fontWeight: 800,
                letterSpacing: '0.14em',
                textTransform: 'uppercase',
                color: 'var(--text-dim)',
                marginBottom: 8,
              }}
            >
              tenant atual
            </div>
            <div
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: 22,
                fontWeight: 800,
                lineHeight: 1.1,
                letterSpacing: '-0.02em',
                marginBottom: 12,
                wordBreak: 'break-word',
              }}
            >
              {tenant.name}
            </div>
            <div
              style={{
                display: 'flex',
                gap: 6,
                flexWrap: 'wrap',
              }}
            >
              <Sticker variant="purple">plano {tenant.plan}</Sticker>
              <Sticker variant="yellow">role {tenant.role}</Sticker>
            </div>
            <div
              style={{
                marginTop: 16,
                paddingTop: 14,
                borderTop: '2px dashed var(--stroke)',
                fontSize: 12,
                color: 'var(--text-dim)',
                lineHeight: 1.5,
              }}
            >
              teu tenant foi criado automaticamente no primeiro login. convites
              pra outros membros chegam na Fase 2.
            </div>
          </div>

          <div
            className="card"
            style={{
              padding: 18,
              background: 'var(--yellow-500)',
              color: 'var(--ink-900)',
            }}
          >
            <div
              style={{
                fontSize: 10,
                fontWeight: 800,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
              }}
            >
              💡 sacada
            </div>
            <div
              style={{
                fontSize: 13,
                fontWeight: 600,
                marginTop: 6,
                lineHeight: 1.4,
              }}
            >
              assim que rolar o primeiro episódio, ele aparece aqui. enquanto
              isso, bora no botão roxo ali em cima.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
