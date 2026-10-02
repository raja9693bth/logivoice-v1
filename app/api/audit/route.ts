import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext, requireRole, AuthorizationError } from '@/lib/auth/context';
import { db } from '@/lib/db';

import { ListAuditQuerySchema } from '@/lib/schemas/api';

export async function GET(req: NextRequest) {
  try {
    const authContext = await getAuthContext(req);
    requireRole(authContext, ['DISPATCHER', 'OPS_MANAGER', 'ADMIN', 'SYSTEM']);

    const { searchParams } = new URL(req.url);
    const rawQuery = {
      limit: searchParams.get('limit') || undefined,
      offset: searchParams.get('offset') || undefined,
      event_type: searchParams.get('event_type') || undefined,
      severity: searchParams.get('severity') || undefined,
    };

    const parsedQuery = ListAuditQuerySchema.safeParse(rawQuery);
    if (!parsedQuery.success) {
      return NextResponse.json(
        { error: 'Invalid query parameters', details: parsedQuery.error.flatten() },
        { status: 400 }
      );
    }

    const { limit, offset, event_type, severity } = parsedQuery.data;
    const events = await db.listAuditEvents(authContext.tenantId, { limit, offset, event_type, severity });
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
