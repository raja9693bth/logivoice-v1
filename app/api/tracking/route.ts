import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext, requireRole } from '@/lib/auth/context';
import { db } from '@/lib/db';
import { handleApiError } from '@/lib/api/error-handler';

export async function GET(req: NextRequest) {
  try {
    const authContext = await getAuthContext(req);
    requireRole(authContext, ['DISPATCHER', 'OPS_MANAGER', 'ADMIN', 'SYSTEM', 'VOICE_GATEWAY']);

    const { searchParams } = new URL(req.url);
    const ref = searchParams.get('ref');

    if (!ref) {
      return NextResponse.json({ error: 'Tracking reference ref is required' }, { status: 400 });
    }

    const record = await db.getTrackingRecord(ref, authContext.tenantId);
    if (!record) {
      return NextResponse.json(
        { found: false, message: `No tracking record found for '${ref}'` },
        { status: 404 }
      );
    }

    if (process.env.NODE_ENV === 'production' && record.source === 'MOCK_TMS') {
      return NextResponse.json(
        {
          found: false,
          status: 'PROVIDER_UNAVAILABLE',
          error: 'Live TMS provider integration is unconfigured in production environment.',
        },
        { status: 503 }
      );
    }

    return NextResponse.json({ found: true, record });
  } catch (error) {
    return handleApiError(error, 'api/tracking:GET');
  }
}
