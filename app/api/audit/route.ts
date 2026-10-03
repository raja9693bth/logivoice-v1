import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext, requireRole } from '@/lib/auth/context';
import { db } from '@/lib/db';
import { ListAuditQuerySchema } from '@/lib/schemas/api';
import { handleApiError } from '@/lib/api/error-handler';

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
      search: searchParams.get('search') || undefined,
    };

    const parsedQuery = ListAuditQuerySchema.safeParse(rawQuery);
    if (!parsedQuery.success) {
      return NextResponse.json(
        { error: 'Invalid query parameters', details: parsedQuery.error.flatten() },
        { status: 400 }
      );
    }

    const { limit, offset, event_type, severity, search } = parsedQuery.data;
    const { events, total } = await db.listAuditEventsWithCount(authContext.tenantId, {
      limit,
      offset,
      event_type,
      severity,
      search,
    });

    const safeLimit = limit ?? 50;
    const safeOffset = offset ?? 0;
    return NextResponse.json({
      events,
      total,
      limit: safeLimit,
      offset: safeOffset,
      has_more: safeOffset + events.length < total,
    });
  } catch (error) {
    return handleApiError(error, 'api/audit:GET');
  }
}
