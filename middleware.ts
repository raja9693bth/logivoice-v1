import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

export async function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;

  // Only guard /admin and nested routes
  if (!path.startsWith('/admin')) {
    return NextResponse.next();
  }

  const isProduction = process.env.NODE_ENV === 'production';

  // 1. Non-production test bypass: Strictly forbidden in production under all conditions
  const allowDevBypass =
    !isProduction &&
    (process.env.PLAYWRIGHT_TEST === '1' ||
      process.env.ALLOW_DEV_SESSION === '1' ||
      process.env.NODE_ENV === 'development' ||
      process.env.NODE_ENV === 'test');

  if (allowDevBypass) {
    const devCookie = request.cookies.get('logivoice_dev_session')?.value;
    if (devCookie === 'true') {
      return NextResponse.next();
    }
  }

  // 2. Supabase Session Verification via SSR Cookies
  // Browser middleware MUST strictly use public Supabase configuration (never SUPABASE_SECRET_KEY)
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || (!isProduction ? process.env.SUPABASE_URL : '') || '';
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

  if (isProduction && (!supabaseUrl || !supabaseKey)) {
    // Missing production Supabase public configuration: fail closed
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('error', 'DEPLOYMENT_CONFIGURATION_REQUIRED');
    return NextResponse.redirect(loginUrl);
  }

  if (supabaseUrl && supabaseKey) {
    try {
      let response = NextResponse.next({
        request: {
          headers: request.headers,
        },
      });

      const supabase = createServerClient(supabaseUrl, supabaseKey, {
        cookies: {
          getAll() {
            return request.cookies.getAll();
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
            response = NextResponse.next({
              request,
            });
            cookiesToSet.forEach(({ name, value, options }) =>
              response.cookies.set(name, value, options)
            );
          },
        },
      });

      const {
        data: { user },
        error,
      } = await supabase.auth.getUser();

      if (!error && user) {
        return response;
      }
    } catch {
      // Supabase verification failure triggers unauthenticated redirect
    }
  }

  // Unauthenticated user attempting to access /admin: redirect to /login
  const loginUrl = new URL('/login', request.url);
  loginUrl.searchParams.set('redirect', path);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ['/admin', '/admin/:path*'],
};
