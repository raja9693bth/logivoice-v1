import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext } from '@/lib/auth/context';
import { db } from '@/lib/db';

export async function GET(req: NextRequest) {
  const authContext = await getAuthContext(req);
  const { searchParams } = new URL(req.url);

  const limitStr = searchParams.get('limit');
  const limit = limitStr ? parseInt(limitStr, 10) : 50;

  const events = await db.listAuditEvents(authContext.tenantId, limit);
  return NextResponse.json({ events });
}
