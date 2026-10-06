import { NextResponse, type NextRequest } from 'next/server';
import { handleRoutingAuth } from '@/lib/supabase/proxy';

/**
 * Next.js 16 Routing Proxy
 * Guards /admin routes with bounded authentication and fail-closed security.
 */
export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  if (!path.startsWith('/admin')) {
    return NextResponse.next();
  }
  return handleRoutingAuth(request);
}

export const config = {
  matcher: ['/admin', '/admin/:path*'],
};

export const middleware = proxy;
