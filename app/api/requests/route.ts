import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext, requireRole, AuthorizationError } from '@/lib/auth/context';
import { db } from '@/lib/db';
import { RequestStatus, RequestPriority, RequestType } from '@/types/logivoice';
import { CreateRequestApiSchema, UpdateRequestApiSchema } from '@/lib/schemas/api';

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

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Malformed JSON payload' }, { status: 400 });
    }

    const parseResult = CreateRequestApiSchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parseResult.error.flatten() },
        { status: 400 }
      );
    }

    const val = parseResult.data;
    const newRequest = await db.createRequest(
      {
        tenant_id: authContext.tenantId,
        customer_id: 'cust-unknown',
        call_id: val.call_id || '',
        reference_no: `REQ-${Date.now().toString().slice(-6)}`,
        type: val.type,
        status: 'PENDING',
        priority: val.priority,
        customer_name: val.customer_name,
        customer_phone: val.customer_phone,
        summary: val.summary,
        details: val.payload || {},
        payload: val.payload || {},
        assigned_to: val.assigned_to || 'Primary Dispatcher',
      },
      authContext.tenantId
    );

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

export async function PATCH(req: NextRequest) {
  try {
    const authContext = await getAuthContext(req);
    requireRole(authContext, ['DISPATCHER', 'OPS_MANAGER', 'ADMIN', 'SYSTEM']);

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Malformed JSON payload' }, { status: 400 });
    }

    const parseResult = UpdateRequestApiSchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parseResult.error.flatten() },
        { status: 400 }
      );
    }

    const { id, ...updates } = parseResult.data;
    const updated = await db.updateRequest(id, updates, authContext.tenantId);
    if (!updated) {
      return NextResponse.json({ error: 'Operations request not found' }, { status: 404 });
    }

    return NextResponse.json({ request: updated });
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
