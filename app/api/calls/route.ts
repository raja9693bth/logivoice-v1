import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext, requireRole, AuthorizationError } from '@/lib/auth/context';
import { db } from '@/lib/db';
import { CallIntent, CallOutcome } from '@/types/logivoice';

export async function GET(req: NextRequest) {
  try {
    const authContext = await getAuthContext(req);
    requireRole(authContext, ['DISPATCHER', 'OPS_MANAGER', 'ADMIN', 'SYSTEM']);

    const { searchParams } = new URL(req.url);
    const intent = searchParams.get('intent') as CallIntent | null;
    const outcome = searchParams.get('outcome') as CallOutcome | null;
    const search = searchParams.get('search') || undefined;

    const calls = await db.listCalls(authContext.tenantId, {
      intent: intent || undefined,
      outcome: outcome || undefined,
      search,
    });

    return NextResponse.json({ calls });
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
    const newCall = await db.createCall(body, authContext.tenantId);
    return NextResponse.json({ call: newCall }, { status: 201 });
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
