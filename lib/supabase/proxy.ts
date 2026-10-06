import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { createBoundedFetch } from './bounded-fetch';

export interface HandleRoutingAuthOptions {
  timeoutMs?: number;
}

/**
 * LOGIVOICE V1 — AUTHORITATIVE NEXT.JS 16 ROUTING PROXY AUTH HANDLER
 *
 * Enforces:
 * 1. Zero Network Delay when Unauthenticated: If no Supabase session cookies exist,
 *    immediately redirects to /login without calling external networks.
 * 2. Hard-Bounded Auth Verification: External Supabase Auth requests are bound to
 *    max 2000ms. If Supabase is unreachable or paused, fails closed FAST to
 *    /login?error=AUTH_TEMPORARILY_UNAVAILABLE instead of hanging into a 504 MIDDLEWARE_INVOCATION_TIMEOUT.
 * 3. Cryptographically Verified Identity: Never trusts spoofable raw cookies alone.
 * 4. Production Hardened: Dev bypass is impossible in production.
 */
export async function handleRoutingAuth(
  request: NextRequest,
  options: HandleRoutingAuthOptions = {}
): Promise<NextResponse> {
  const path = request.nextUrl.pathname;
  const timeoutMs = options.timeoutMs ?? 2000;
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

  // 2. Fast Cookie Pre-Check: Do NOT invoke external networks if no auth cookies exist
  const allCookies = request.cookies.getAll();
  const hasAuthCookie = allCookies.some((c) =>
    c.name.includes('-auth-token') ||
    c.name.startsWith('sb-') ||
    c.name === 'supabase-auth-token'
  );

  if (!hasAuthCookie) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('redirect', path);
    return NextResponse.redirect(loginUrl);
  }

  // 3. Supabase Environment Presence Check
  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    (!isProduction ? process.env.SUPABASE_URL : '') ||
    '';
  const supabaseKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    '';

  if (isProduction && (!supabaseUrl || !supabaseKey)) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('error', 'DEPLOYMENT_CONFIGURATION_REQUIRED');
    return NextResponse.redirect(loginUrl);
  }

  if (!supabaseUrl || !supabaseKey) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('redirect', path);
    return NextResponse.redirect(loginUrl);
  }

  // 4. Bounded SSR Client Verification
  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  });

  try {
    const boundedFetch = createBoundedFetch(timeoutMs, 'Routing Proxy Supabase Auth');

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
          cookiesToSet.forEach(({ name, value, options: cookieOpts }) =>
            response.cookies.set(name, value, cookieOpts)
          );
        },
      },
      global: {
        fetch: boundedFetch,
      },
    });

    // Check claims first with bounded fetch
    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();

    if (!claimsError && claimsData?.claims) {
      return response;
    }

    // Fallback: bounded getUser() call
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (!userError && user) {
      return response;
    }

    // Session exists but was invalid or expired: clear cookies and redirect to login
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('redirect', path);
    const redirectRes = NextResponse.redirect(loginUrl);
    // Clear stale auth cookies to prevent redirect loops
    allCookies.forEach((c) => {
      if (c.name.startsWith('sb-') || c.name.includes('-auth-token')) {
        redirectRes.cookies.set(c.name, '', { maxAge: 0, path: '/' });
      }
    });
    return redirectRes;
  } catch (err: unknown) {
    const isTimeout =
      (err instanceof Error && (err.name === 'SupabaseTimeoutError' || err.name === 'AbortError' || err.name === 'TimeoutError')) ||
      (typeof err === 'object' && err !== null && 'name' in err && (err as { name: string }).name === 'SupabaseTimeoutError');

    const loginUrl = new URL('/login', request.url);
    if (isTimeout) {
      loginUrl.searchParams.set('error', 'AUTH_TEMPORARILY_UNAVAILABLE');
    } else {
      loginUrl.searchParams.set('redirect', path);
    }
    return NextResponse.redirect(loginUrl);
  }
}
