import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext, requireRole, AuthorizationError } from '@/lib/auth/context';
import { db } from '@/lib/db';

export async function GET(req: NextRequest) {
  try {
    const authContext = await getAuthContext(req);
    requireRole(authContext, ['OPS_MANAGER', 'ADMIN', 'SYSTEM']);

    const { searchParams } = new URL(req.url);
    const limitStr = searchParams.get('limit');
    const limit = limitStr ? parseInt(limitStr, 10) : 50;

    const events = await db.listAuditEvents(authContext.tenantId, limit);
    return NextResponse.json({ events });
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal Server Error' },
      { status: 500 }
    );
  }
}
