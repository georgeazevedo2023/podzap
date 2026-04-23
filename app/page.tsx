import Link from 'next/link';

export default function HomePage() {
  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        padding: '40px',
        background: 'var(--color-bg)',
        color: 'var(--color-text)',
      }}
    >
      <div className="card" style={{ maxWidth: 560, padding: 32 }}>
        <span className="sticker sticker-pink">🎙 podZAP</span>
        <h1
          style={{
            fontFamily: 'var(--font-brand)',
            fontSize: 56,
            lineHeight: 1,
            margin: '16px 0 8px',
            letterSpacing: '-0.03em',
          }}
        >
          pod<span style={{ color: 'var(--color-pink-500)' }}>ZAP</span>
        </h1>
        <p style={{ color: 'var(--color-text-dim)', fontSize: 16, marginBottom: 24 }}>
          Transforme caos de mensagens em um podcast inteligente — com controle humano
          antes da publicação.
        </p>

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <Link href="/login" className="btn btn-purple">
            entrar
          </Link>
          <a
            href="https://github.com/georgeazevedo2023/podzap"
            target="_blank"
            rel="noreferrer"
            className="btn btn-ghost"
          >
            repo
          </a>
        </div>

        <div
          style={{
            marginTop: 32,
            paddingTop: 20,
            borderTop: '2px dashed var(--color-stroke)',
            fontSize: 12,
            color: 'var(--color-text-dim)',
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            fontWeight: 700,
          }}
        >
          Fase 0 · Scaffolding ✅
        </div>
      </div>
    </main>
  );
}
