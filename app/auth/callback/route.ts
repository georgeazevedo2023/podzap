import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// Relative Location headers. Browsers resolve against the current URL so
// the redirect survives `0.0.0.0` (Chrome 128+ blocks it) and reverse
// proxies that rewrite Host. Keeps the redirect same-origin by design.
function redirect(path: string): NextResponse {
  return new NextResponse(null, {
    status: 307,
    headers: { Location: path },
  });
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '/home';

  const errorParam = searchParams.get('error_description') ?? searchParams.get('error');
  if (errorParam) {
    return redirect(`/login?error=${encodeURIComponent(errorParam)}`);
  }

  if (!code) {
    return redirect(`/login?error=${encodeURIComponent('Código de autenticação ausente')}`);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return redirect(`/login?error=${encodeURIComponent(error.message)}`);
  }

  // Only allow same-origin relative paths — avoids open-redirect.
  const safeNext = next.startsWith('/') ? next : '/home';
  return redirect(safeNext);
}
