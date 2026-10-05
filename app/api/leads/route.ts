import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext, requireRole } from '@/lib/auth/context';
import { db } from '@/lib/db';
import { LeadTemperature } from '@/types/logivoice';
import { CreateLeadApiSchema, UpdateLeadApiSchema, ListLeadsQuerySchema } from '@/lib/schemas/api';
import { handleApiError } from '@/lib/api/error-handler';
import { parseJsonBody } from '@/lib/api/request-helper';

export async function GET(req: NextRequest) {
  try {
    const authContext = await getAuthContext(req);
    requireRole(authContext, ['DISPATCHER', 'OPS_MANAGER', 'ADMIN', 'SYSTEM']);

    const { searchParams } = new URL(req.url);
    const rawQuery = {
      temperature: searchParams.get('temperature') || undefined,
      status: searchParams.get('status') || undefined,
      search: searchParams.get('search') || undefined,
      limit: searchParams.get('limit') || undefined,
      offset: searchParams.get('offset') || undefined,
    };

    const parsedQuery = ListLeadsQuerySchema.safeParse(rawQuery);
    if (!parsedQuery.success) {
      return NextResponse.json(
        { error: 'Invalid query parameters', details: parsedQuery.error.flatten() },
        { status: 400 }
      );
    }

    const { temperature, status, search, limit, offset } = parsedQuery.data;

    const { leads, total } = await db.listLeadsWithCount(authContext.tenantId, {
      temperature,
      status,
      search,
      limit,
      offset,
    });

    const safeLimit = limit ?? 50;
    const safeOffset = offset ?? 0;
    return NextResponse.json({
      leads,
      total,
      limit: safeLimit,
      offset: safeOffset,
      has_more: safeOffset + leads.length < total,
    });
  } catch (error) {
    return handleApiError(error, 'api/leads:GET');
  }
}

export async function POST(req: NextRequest) {
  try {
    const authContext = await getAuthContext(req);
    requireRole(authContext, ['DISPATCHER', 'OPS_MANAGER', 'ADMIN', 'SYSTEM']);

    const { data: body, errorResponse } = await parseJsonBody(req);
    if (errorResponse) return errorResponse;

    const parseResult = CreateLeadApiSchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parseResult.error.flatten() },
        { status: 400 }
      );
    }

    const val = parseResult.data;
    const newLead = await db.createLead(
      {
        tenant_id: authContext.tenantId,
        customer_id: val.customer_id || undefined,
        customer_name: val.customer_name,
        phone: val.phone,
        company: val.company,
        source: val.source,
        status: val.status,
        temperature: val.temperature,
        route: val.route,
        vehicle_type: val.vehicle_type,
        weight: val.weight,
        requirement: val.requirement,
        next_action: val.next_action || 'Follow up with corridor quote',
        assigned_to: val.assigned_to || undefined,
        last_call_at: new Date().toISOString(),
        followup_status: val.followup_status,
      },
      authContext.tenantId
    );

    return NextResponse.json({ lead: newLead }, { status: 201 });
  } catch (error) {
    return handleApiError(error, 'api/leads:POST');
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const authContext = await getAuthContext(req);
    requireRole(authContext, ['DISPATCHER', 'OPS_MANAGER', 'ADMIN', 'SYSTEM']);

    const { data: body, errorResponse } = await parseJsonBody(req);
    if (errorResponse) return errorResponse;

    const parseResult = UpdateLeadApiSchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parseResult.error.flatten() },
        { status: 400 }
      );
    }

    const { id, ...updates } = parseResult.data;
    const updated = await db.updateLead(id, updates, authContext.tenantId);
    if (!updated) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
    }

    return NextResponse.json({ lead: updated });
  } catch (error) {
    return handleApiError(error, 'api/leads:PATCH');
  }
}
