import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext } from '@/lib/auth/context';
import { db } from '@/lib/db';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authContext = await getAuthContext(req);
  const { id } = await params;

  const call = await db.getCallById(id, authContext.tenantId);
  if (!call) {
    return NextResponse.json({ error: 'Call not found' }, { status: 404 });
  }

  return NextResponse.json({ call });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authContext = await getAuthContext(req);
  const { id } = await params;
  const updates = await req.json();

  const updated = await db.updateCall(id, updates, authContext.tenantId);
  if (!updated) {
    return NextResponse.json({ error: 'Call not found' }, { status: 404 });
  }

  return NextResponse.json({ call: updated });
}
