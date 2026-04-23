import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

async function checkSupabase(): Promise<{ ok: boolean; detail: string }> {
  try {
    const supabase = createAdminClient();
    const { error } = await supabase.from('tenants').select('id').limit(1);

    if (error) {
      // `42P01` = Postgres "relation does not exist".
      // `PGRST205` = PostgREST "table not found in schema cache" (same root cause —
      // surfaces when the schema cache hasn't picked up a newly-created table yet).
      if (error.code === '42P01' || error.code === 'PGRST205') {
        return { ok: false, detail: 'Tabelas ainda não criadas (rode a migration)' };
      }
      return { ok: false, detail: `${error.code}: ${error.message}` };
    }
    return { ok: true, detail: 'conectado + tabela tenants acessível' };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

export default async function HealthPage() {
  const supabase = await checkSupabase();
  const env = {
    supabaseUrl: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
    supabaseAnon: !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    supabaseService: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    gemini: !!process.env.GEMINI_API_KEY,
    groq: !!process.env.GROQ_API_KEY,
    uazapi: !!process.env.UAZAPI_ADMIN_TOKEN,
  };

  return (
    <main
      style={{
        minHeight: '100vh',
        padding: 40,
        background: 'var(--color-bg)',
        color: 'var(--color-text)',
      }}
    >
      <div className="card" style={{ maxWidth: 640, margin: '0 auto', padding: 32 }}>
        <span className="sticker sticker-purple">health-check</span>
        <h1
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 32,
            margin: '16px 0 24px',
            fontWeight: 800,
          }}
        >
          Status do sistema
        </h1>

        <Row label="Supabase" ok={supabase.ok} detail={supabase.detail} />

        <h2 style={{ fontSize: 14, marginTop: 24, marginBottom: 12, fontWeight: 700 }}>
          Variáveis de ambiente
        </h2>
        <Row label="NEXT_PUBLIC_SUPABASE_URL" ok={env.supabaseUrl} />
        <Row label="NEXT_PUBLIC_SUPABASE_ANON_KEY" ok={env.supabaseAnon} />
        <Row label="SUPABASE_SERVICE_ROLE_KEY" ok={env.supabaseService} />
        <Row label="GEMINI_API_KEY" ok={env.gemini} />
        <Row label="GROQ_API_KEY" ok={env.groq} />
        <Row label="UAZAPI_ADMIN_TOKEN" ok={env.uazapi} />
      </div>
    </main>
  );
}

function Row({ label, ok, detail }: { label: string; ok: boolean; detail?: string }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '8px 0',
        borderBottom: '1px dashed var(--color-line)',
        fontSize: 14,
      }}
    >
      <span
        style={{
          width: 10,
          height: 10,
          borderRadius: '50%',
          background: ok ? 'var(--color-zap-500)' : 'var(--color-red-500)',
        }}
      />
      <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 500 }}>{label}</span>
      {detail && (
        <span style={{ marginLeft: 'auto', color: 'var(--color-text-dim)', fontSize: 12 }}>
          {detail}
        </span>
      )}
    </div>
  );
}
