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
    // F13: dark theme for login — matches the `(app)` route group so the
    // look stays consistent across authenticated vs. pre-auth screens.
    // Landing page at `/` stays on the default light palette.
    <main
      data-theme="dark"
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        padding: '40px',
        background: 'var(--color-bg)',
        color: 'var(--color-text)',
      }}
    >
      <div
        className="card"
        style={{ maxWidth: 480, width: '100%', padding: 32 }}
      >
        <span className="sticker sticker-pink">🎙 podZAP</span>

        <h1
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 32,
            lineHeight: 1.05,
            fontWeight: 700,
            margin: '16px 0 8px',
            letterSpacing: '-0.02em',
          }}
        >
          Entrar
        </h1>
        <p
          style={{
            color: 'var(--color-text-dim)',
            fontSize: 15,
            marginBottom: 20,
          }}
        >
          acesso por convite — use seu email e senha corporativos
        </p>

        {message ? (
          <div
            role="status"
            style={{
              marginBottom: 16,
              padding: '12px 16px',
              border: '2.5px solid var(--color-stroke)',
              borderRadius: 16,
              background: 'var(--color-lime-400)',
              color: 'var(--color-ink-900)',
              boxShadow: '3px 3px 0 var(--color-stroke)',
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
              border: '2.5px solid var(--color-stroke)',
              borderRadius: 16,
              background: 'var(--color-red-500)',
              color: '#fff',
              boxShadow: '3px 3px 0 var(--color-stroke)',
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
              color: 'var(--color-text-dim)',
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
              border: '2.5px solid var(--color-stroke)',
              borderRadius: 999,
              background: 'var(--color-surface)',
              color: 'var(--color-text)',
              outline: 'none',
              boxShadow: '3px 3px 0 var(--color-stroke)',
            }}
          />

          <label
            htmlFor="password"
            style={{
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: 'var(--color-text-dim)',
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
              border: '2.5px solid var(--color-stroke)',
              borderRadius: 999,
              background: 'var(--color-surface)',
              color: 'var(--color-text)',
              outline: 'none',
              boxShadow: '3px 3px 0 var(--color-stroke)',
            }}
          />

          <button
            type="submit"
            className="btn btn-purple"
            style={{ justifyContent: 'center', marginTop: 8 }}
          >
            entrar
          </button>
        </form>
      </div>
    </main>
  );
}
