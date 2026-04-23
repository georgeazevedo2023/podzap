import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

async function handle(request: NextRequest): Promise<NextResponse> {
  const { origin } = new URL(request.url);
  const supabase = await createClient();
  await supabase.auth.signOut();

  return NextResponse.redirect(
    `${origin}/login?message=${encodeURIComponent('Até logo')}`,
  );
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  return handle(request);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  return handle(request);
}
