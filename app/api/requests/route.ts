import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext, requireRole } from '@/lib/auth/context';
import { db } from '@/lib/db';
import { RequestStatus, RequestPriority, RequestType } from '@/types/logivoice';
import { CreateRequestApiSchema, UpdateRequestApiSchema, ListRequestsQuerySchema } from '@/lib/schemas/api';
import { handleApiError } from '@/lib/api/error-handler';
import { parseJsonBody } from '@/lib/api/request-helper';

export async function GET(req: NextRequest) {
  try {
    const authContext = await getAuthContext(req);
    requireRole(authContext, ['DISPATCHER', 'OPS_MANAGER', 'ADMIN', 'SYSTEM']);

    const { searchParams } = new URL(req.url);
    const rawQuery = {
      status: searchParams.get('status') || undefined,
      priority: searchParams.get('priority') || undefined,
      type: searchParams.get('type') || undefined,
      search: searchParams.get('search') || undefined,
      limit: searchParams.get('limit') || undefined,
      offset: searchParams.get('offset') || undefined,
    };

    const parsedQuery = ListRequestsQuerySchema.safeParse(rawQuery);
    if (!parsedQuery.success) {
      return NextResponse.json(
        { error: 'Invalid query parameters', details: parsedQuery.error.flatten() },
        { status: 400 }
      );
    }

    const { status, priority, type, search, limit, offset } = parsedQuery.data;

    const { requests, total } = await db.listRequestsWithCount(authContext.tenantId, {
      status,
      priority,
      type,
      search,
      limit,
      offset,
    });

    const safeLimit = limit ?? 50;
    const safeOffset = offset ?? 0;
    return NextResponse.json({
      requests,
      total,
      limit: safeLimit,
      offset: safeOffset,
      has_more: safeOffset + requests.length < total,
    });
  } catch (error) {
    return handleApiError(error, 'api/requests:GET');
  }
}

export async function POST(req: NextRequest) {
  try {
    const authContext = await getAuthContext(req);
    requireRole(authContext, ['DISPATCHER', 'OPS_MANAGER', 'ADMIN', 'SYSTEM']);

    const { data: body, errorResponse } = await parseJsonBody(req);
    if (errorResponse) return errorResponse;

    const parseResult = CreateRequestApiSchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parseResult.error.flatten() },
        { status: 400 }
      );
    }

    const val = parseResult.data;
    let customerId: string | undefined = undefined;
    if (val.customer_phone) {
      const cust = await db.getCustomerByPhone(val.customer_phone, authContext.tenantId);
      if (cust) customerId = cust.id;
    }

    const newRequest = await db.createRequest(
      {
        tenant_id: authContext.tenantId,
        customer_id: customerId,
        call_id: val.call_id || undefined,
        reference_no: `REQ-${Date.now().toString().slice(-6)}`,
        type: val.type,
        status: 'PENDING',
        priority: val.priority,
        customer_name: val.customer_name,
        customer_phone: val.customer_phone,
        summary: val.summary,
        details: val.payload || {},
        payload: val.payload || {},
        assigned_to: val.assigned_to || undefined,
      },
      authContext.tenantId
    );

    return NextResponse.json({ request: newRequest }, { status: 201 });
  } catch (error) {
    return handleApiError(error, 'api/requests:POST');
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const authContext = await getAuthContext(req);
    requireRole(authContext, ['DISPATCHER', 'OPS_MANAGER', 'ADMIN', 'SYSTEM']);

    const { data: body, errorResponse } = await parseJsonBody(req);
    if (errorResponse) return errorResponse;

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
    return handleApiError(error, 'api/requests:PATCH');
  }
}
