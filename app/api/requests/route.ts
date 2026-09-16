import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext } from '@/lib/auth/context';
import { db } from '@/lib/db';
import { RequestStatus, RequestPriority, RequestType } from '@/types/logivoice';

export async function GET(req: NextRequest) {
  const authContext = await getAuthContext(req);
  const { searchParams } = new URL(req.url);

  const status = searchParams.get('status') as RequestStatus | null;
  const priority = searchParams.get('priority') as RequestPriority | null;
  const type = searchParams.get('type') as RequestType | null;

  const requests = await db.listRequests(authContext.tenantId, {
    status: status || undefined,
    priority: priority || undefined,
    type: type || undefined,
  });

  return NextResponse.json({ requests });
}

export async function POST(req: NextRequest) {
  const authContext = await getAuthContext(req);
  const body = await req.json();

  const newRequest = await db.createRequest(body, authContext.tenantId);
  return NextResponse.json({ request: newRequest }, { status: 201 });
}
