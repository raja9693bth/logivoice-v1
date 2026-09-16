import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext } from '@/lib/auth/context';
import { db } from '@/lib/db';
import { CallIntent, CallOutcome } from '@/types/logivoice';

export async function GET(req: NextRequest) {
  const authContext = await getAuthContext(req);
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
}

export async function POST(req: NextRequest) {
  const authContext = await getAuthContext(req);
  const body = await req.json();

  const newCall = await db.createCall(body, authContext.tenantId);
  return NextResponse.json({ call: newCall }, { status: 201 });
}
