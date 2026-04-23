import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { loginAction } from './actions';

type LoginSearchParams = {
  message?: string | string[];
  error?: string | string[];
};

function pickFirst(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<LoginSearchParams>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect('/home');
  }

  const params = await searchParams;
  const message = pickFirst(params.message);
  const error = pickFirst(params.error);

  return (
    <main data-theme="dark" className="login-stage">
      {/* Animated gradient blobs — sit on z-index 0 behind everything */}
      <div aria-hidden className="login-blob login-blob--purple" />
      <div aria-hidden className="login-blob login-blob--pink" />
      <div aria-hidden className="login-blob login-blob--lime" />

      {/* Subtle grid overlay — gives depth without being noisy */}
      <div aria-hidden className="login-grid" />

      {/* Decorative waveform at the bottom — reinforces the "podcast" idea */}
      <svg
        aria-hidden
        className="login-waveform"
        viewBox="0 0 1200 160"
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id="wavegrad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#7A3CFF" />
            <stop offset="50%" stopColor="#FF3DA5" />
            <stop offset="100%" stopColor="#C6FF3C" />
          </linearGradient>
        </defs>
        {/* Generated bars — pseudo-waveform */}
        {Array.from({ length: 60 }).map((_, i) => {
          const h = 20 + Math.sin(i * 0.6) * 30 + Math.cos(i * 0.25) * 20 + 40;
          const x = i * 20 + 10;
          return (
            <rect
              key={i}
              x={x}
              y={160 - h}
              width={8}
              height={h}
              rx={3}
              fill="url(#wavegrad)"
            />
          );
        })}
      </svg>

      <div className="login-card">
        <span
          className="sticker sticker-pink"
          style={{ boxShadow: '2px 2px 0 #000' }}
        >
          🎙 podZAP
        </span>

        <h1
          style={{
            fontFamily: 'var(--font-brand)',
            fontSize: 44,
            lineHeight: 1,
            fontWeight: 400,
            margin: '18px 0 8px',
            letterSpacing: '-0.02em',
            color: '#FFFBF2',
          }}
        >
          pod<span style={{ color: '#FF3DA5' }}>ZAP</span>
        </h1>
        <p
          style={{
            color: '#B4A8D1',
            fontSize: 15,
            marginBottom: 24,
            lineHeight: 1.45,
          }}
        >
          acesso por convite — entre com seu email e senha
        </p>

        {message ? (
          <div
            role="status"
            style={{
              marginBottom: 16,
              padding: '12px 16px',
              border: '2.5px solid #000',
              borderRadius: 16,
              background: '#D8FF66',
              color: '#0A0420',
              boxShadow: '3px 3px 0 #000',
              fontWeight: 700,
              fontSize: 14,
            }}
          >
            ✓ {message}
          </div>
        ) : null}

        {error ? (
          <div
            role="alert"
            style={{
              marginBottom: 16,
              padding: '12px 16px',
              border: '2.5px solid #000',
              borderRadius: 16,
              background: '#FF4D3C',
              color: '#fff',
              boxShadow: '3px 3px 0 #000',
              fontWeight: 700,
              fontSize: 14,
            }}
          >
            ✗ erro: {error}
          </div>
        ) : null}

        <form
          action={loginAction}
          style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
        >
          <label
            htmlFor="email"
            style={{
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: '#B4A8D1',
            }}
          >
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoFocus
            autoComplete="email"
            placeholder="voce@exemplo.com"
            style={{
              fontFamily: 'var(--font-body)',
              fontSize: 15,
              fontWeight: 500,
              padding: '12px 20px',
              border: '2.5px solid #000',
              borderRadius: 999,
              background: 'rgba(255, 251, 242, 0.08)',
              color: '#FFFBF2',
              outline: 'none',
              boxShadow: '3px 3px 0 #000',
            }}
          />

          <label
            htmlFor="password"
            style={{
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: '#B4A8D1',
              marginTop: 4,
            }}
          >
            Senha
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            minLength={6}
            autoComplete="current-password"
            placeholder="••••••••"
            style={{
              fontFamily: 'var(--font-body)',
              fontSize: 15,
              fontWeight: 500,
              padding: '12px 20px',
              border: '2.5px solid #000',
              borderRadius: 999,
              background: 'rgba(255, 251, 242, 0.08)',
              color: '#FFFBF2',
              outline: 'none',
              boxShadow: '3px 3px 0 #000',
            }}
          />

          <button
            type="submit"
            className="btn btn-purple"
            style={{ justifyContent: 'center', marginTop: 10 }}
          >
            entrar
          </button>
        </form>

        <p
          style={{
            marginTop: 20,
            paddingTop: 16,
            borderTop: '2px dashed rgba(255, 255, 255, 0.15)',
            fontSize: 11,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            fontWeight: 700,
            color: '#8B7FB0',
            textAlign: 'center',
          }}
        >
          🔒 cadastro apenas via administrador
        </p>
      </div>
    </main>
  );
}
