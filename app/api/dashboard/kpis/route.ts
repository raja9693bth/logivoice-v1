import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext, requireRole } from '@/lib/auth/context';
import { db } from '@/lib/db';
import { handleApiError } from '@/lib/api/error-handler';

export async function GET(req: NextRequest) {
  try {
    const authContext = await getAuthContext(req);
    requireRole(authContext, ['DISPATCHER', 'OPS_MANAGER', 'ADMIN', 'SYSTEM']);

    const kpis = await db.getKPIs(authContext.tenantId);
    return NextResponse.json({ kpis });
  } catch (error) {
    return handleApiError(error, 'api/dashboard/kpis:GET');
  }
}
