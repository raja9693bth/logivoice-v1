import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext } from '@/lib/auth/context';
import { db } from '@/lib/db';

export async function GET(req: NextRequest) {
  const authContext = await getAuthContext(req);
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

  return NextResponse.json({ found: true, record });
}
