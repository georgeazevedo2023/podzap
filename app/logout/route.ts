import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

async function handle(_request: NextRequest): Promise<NextResponse> {
  const supabase = await createClient();
  await supabase.auth.signOut();

  // Relative Location — browsers resolve against the current URL. Avoids
  // breakage when the server was reached via `0.0.0.0` (Chrome 128+ blocks
  // that host) or via a reverse proxy that rewrites the Host header.
  return new NextResponse(null, {
    status: 307,
    headers: {
      Location: `/login?message=${encodeURIComponent('Até logo')}`,
    },
  });
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  return handle(request);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  return handle(request);
}
