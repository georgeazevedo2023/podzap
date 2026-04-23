import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { updateSession } from '@/lib/supabase/middleware';
import type { Database } from '@/lib/supabase/types';

/**
 * Protected URL prefixes. Every path that the `app/(app)/*` route group renders
 * must appear here. Keep this list in sync with
 * `components/shell/AppSidebar.tsx::ROUTES` — the sidebar is the source of
 * truth for which screens live behind auth.
 *
 * The paths DO NOT include the `(app)` segment because Next.js route groups
 * are URL-invisible: the folder `app/(app)/home/page.tsx` resolves to `/home`.
 */
const PROTECTED_PREFIXES = [
  '/home',
  '/groups',
  '/approval',
  '/history',
  '/schedule',
  '/settings',
  '/onboarding',
] as const;

function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

/**
 * Edge proxy. Two responsibilities:
 *
 *   1. Refresh the Supabase auth cookie on every request via `updateSession()`
 *      (stale cookies cause intermittent `getUser()` failures in Server
 *      Components — this is the documented SSR pattern).
 *
 *   2. Belt-and-suspenders: for protected routes, redirect unauthenticated
 *      users BEFORE Next.js renders the layout. The server layout at
 *      `app/(app)/layout.tsx` ALSO enforces auth (and it's the source of
 *      truth because it has tenant context), but catching it here avoids a
 *      pointless render pass + keeps the attack surface tighter.
 *
 * Intentionally NOT protected: `/`, `/login`, `/auth/*`, `/logout`, `/health`,
 * `/_next/*`, `/api/webhooks/*` (webhooks are excluded by the matcher below).
 */
export async function proxy(request: NextRequest) {
  const response = await updateSession(request);
  const pathname = request.nextUrl.pathname;

  if (!isProtectedPath(pathname)) {
    return response;
  }

  // Re-check the user after session refresh. We build a second client here
  // that shares cookies with the already-updated response so we don't clobber
  // any Set-Cookie headers `updateSession` may have written.
  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        // Read-only: the first `updateSession()` call already handled cookie
        // refresh. We just need to read the current session state.
        setAll() {
          /* no-op */
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', pathname);
    url.searchParams.set('error', 'Faça login para continuar');
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico, images
     * - api/webhooks (external webhooks must not go through auth middleware)
     */
    '/((?!_next/static|_next/image|favicon.ico|api/webhooks|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
