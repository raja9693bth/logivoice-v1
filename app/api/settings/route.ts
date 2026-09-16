import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext } from '@/lib/auth/context';
import { db } from '@/lib/db';

export async function GET(req: NextRequest) {
  const authContext = await getAuthContext(req);
  const config = await db.getClientConfig(authContext.tenantId);
  return NextResponse.json({ config });
}

export async function PUT(req: NextRequest) {
  const authContext = await getAuthContext(req);
  const updates = await req.json();

  const updated = await db.updateClientConfig(authContext.tenantId, updates);
  return NextResponse.json({ config: updated });
}
