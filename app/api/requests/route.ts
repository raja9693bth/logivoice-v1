import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext, requireRole, AuthorizationError } from '@/lib/auth/context';
import { db } from '@/lib/db';
import { RequestStatus, RequestPriority, RequestType } from '@/types/logivoice';

export async function GET(req: NextRequest) {
  try {
    const authContext = await getAuthContext(req);
    requireRole(authContext, ['DISPATCHER', 'OPS_MANAGER', 'ADMIN', 'SYSTEM']);

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

export async function POST(req: NextRequest) {
  try {
    const authContext = await getAuthContext(req);
    requireRole(authContext, ['DISPATCHER', 'OPS_MANAGER', 'ADMIN', 'SYSTEM']);

    const body = await req.json();
    const newRequest = await db.createRequest(body, authContext.tenantId);
    return NextResponse.json({ request: newRequest }, { status: 201 });
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
