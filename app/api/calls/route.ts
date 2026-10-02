import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext, requireRole } from '@/lib/auth/context';
import { db } from '@/lib/db';
import { CallIntent, CallOutcome } from '@/types/logivoice';
import { CreateCallApiSchema, ListCallsQuerySchema } from '@/lib/schemas/api';
import { handleApiError } from '@/lib/api/error-handler';

export async function GET(req: NextRequest) {
  try {
    const authContext = await getAuthContext(req);
    requireRole(authContext, ['DISPATCHER', 'OPS_MANAGER', 'ADMIN', 'SYSTEM']);

    const { searchParams } = new URL(req.url);
    const rawQuery = {
      intent: searchParams.get('intent') || undefined,
      outcome: searchParams.get('outcome') || undefined,
      search: searchParams.get('search') || undefined,
      limit: searchParams.get('limit') || undefined,
      offset: searchParams.get('offset') || undefined,
    };

    const parsedQuery = ListCallsQuerySchema.safeParse(rawQuery);
    if (!parsedQuery.success) {
      return NextResponse.json(
        { error: 'Invalid query parameters', details: parsedQuery.error.flatten() },
        { status: 400 }
      );
    }

    const { intent, outcome, search, limit, offset } = parsedQuery.data;

    const calls = await db.listCalls(authContext.tenantId, {
      intent,
      outcome,
      search,
      limit,
      offset,
    });

    return NextResponse.json({ calls });
  } catch (error) {
    return handleApiError(error, 'api/calls:GET');
  }
}

export async function POST(req: NextRequest) {
  try {
    const authContext = await getAuthContext(req);
    requireRole(authContext, ['DISPATCHER', 'OPS_MANAGER', 'ADMIN', 'SYSTEM']);

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Malformed JSON payload' }, { status: 400 });
    }

    const parseResult = CreateCallApiSchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parseResult.error.flatten() },
        { status: 400 }
      );
    }

    const validated = parseResult.data;
    const newCall = await db.createCall(
      {
        external_call_id: validated.external_call_id,
        tenant_id: authContext.tenantId,
        customer_id: validated.customer_id || undefined,
        started_at: validated.started_at || new Date().toISOString(),
        ended_at: validated.ended_at,
        duration_seconds: validated.duration_seconds,
        primary_intent: validated.primary_intent,
        sentiment: validated.sentiment,
        outcome: validated.outcome,
        lead_temperature: 'WARM',
        summary: validated.summary,
        facts: validated.facts ? { call_id: '', ...validated.facts } : { call_id: '' },
        escalation_status: validated.escalation_status,
        agent_version: validated.agent_version,
      },
      authContext.tenantId
    );

    return NextResponse.json({ call: newCall }, { status: 201 });
  } catch (error) {
    return handleApiError(error, 'api/calls:POST');
  }
}
