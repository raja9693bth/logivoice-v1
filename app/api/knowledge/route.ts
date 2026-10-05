import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext, requireRole } from '@/lib/auth/context';
import { db } from '@/lib/db';
import { retrieveRelevantKnowledge } from '@/lib/knowledge/retrieval';
import { CreateKnowledgeApiSchema, UpdateKnowledgeApiSchema, ListKnowledgeQuerySchema } from '@/lib/schemas/api';
import { handleApiError } from '@/lib/api/error-handler';
import { parseAndValidateJson } from '@/lib/api/request-helper';

export async function GET(req: NextRequest) {
  try {
    const authContext = await getAuthContext(req);
    requireRole(authContext, ['DISPATCHER', 'OPS_MANAGER', 'ADMIN', 'SYSTEM']);

    const { searchParams } = new URL(req.url);
    const rawQuery = {
      intent: searchParams.get('intent') || undefined,
      category: searchParams.get('category') || undefined,
      search: searchParams.get('search') || undefined,
      limit: searchParams.get('limit') || undefined,
      offset: searchParams.get('offset') || undefined,
    };

    const parsedQuery = ListKnowledgeQuerySchema.safeParse(rawQuery);
    if (!parsedQuery.success) {
      return NextResponse.json(
        { error: 'Invalid query parameters', details: parsedQuery.error.flatten() },
        { status: 400 }
      );
    }

    const { intent, category, search, limit, offset } = parsedQuery.data;

    // Dynamic intent-specific retrieval
    if (intent) {
      const relevant = await retrieveRelevantKnowledge(intent, authContext.tenantId);
      return NextResponse.json({ intent, knowledge: relevant });
    }

    // Paginated category and search listing
    const { items, total } = await db.listKnowledgeItemsWithCount(authContext.tenantId, {
      category,
      search,
      limit,
      offset,
    });
    const safeOffset = offset ?? 0;
    return NextResponse.json({
      knowledge_items: items,
      total,
      limit: limit ?? 20,
      offset: safeOffset,
      has_more: safeOffset + items.length < total,
    });
  } catch (error) {
    return handleApiError(error, 'api/knowledge:GET');
  }
}

export async function POST(req: NextRequest) {
  try {
    const authContext = await getAuthContext(req);
    requireRole(authContext, ['ADMIN', 'OPS_MANAGER', 'SYSTEM']);

    const { data: val, errorResponse } = await parseAndValidateJson(req, CreateKnowledgeApiSchema);
    if (errorResponse) return errorResponse;

    // Policy rule: New knowledge items MUST always start in DRAFT status
    const newItem = await db.createKnowledgeItem(
      {
        tenant_id: authContext.tenantId,
        category: val.category,
        title: val.title,
        content: val.content,
        status: 'DRAFT',
        version: val.version,
        created_by: authContext.userId,
      },
      authContext.tenantId
    );

    await db.logAuditEvent(
      {
        tenant_id: authContext.tenantId,
        event_type: 'KNOWLEDGE_CREATED',
        actor: authContext.userId,
        actor_type: (authContext.role === 'VOICE_GATEWAY' ? 'AI_AGENT' : authContext.role) as any,
        actor_id: authContext.userId,
        severity: 'INFO',
        details: {
          knowledge_item_id: newItem.id,
          category: newItem.category,
          title: newItem.title,
          status: newItem.status,
        },
      },
      authContext.tenantId
    );

    return NextResponse.json({ knowledge_item: newItem }, { status: 201 });
  } catch (error) {
    return handleApiError(error, 'api/knowledge:POST');
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const authContext = await getAuthContext(req);
    requireRole(authContext, ['ADMIN', 'OPS_MANAGER', 'SYSTEM']);

    const { data: patchData, errorResponse } = await parseAndValidateJson(req, UpdateKnowledgeApiSchema);
    if (errorResponse) return errorResponse;

    const { id, ...updates } = patchData;
    const finalUpdates = {
      ...updates,
      ...(updates.status === 'APPROVED' ? { approved_by: authContext.userId, approved_at: new Date().toISOString() } : {}),
    };
    const updated = await db.updateKnowledgeItem(id, finalUpdates, authContext.tenantId);
    if (!updated) {
      return NextResponse.json({ error: 'Knowledge item not found' }, { status: 404 });
    }

    let eventType = 'KNOWLEDGE_UPDATED';
    if (updates.status === 'UNDER_REVIEW') eventType = 'KNOWLEDGE_SUBMITTED';
    else if (updates.status === 'APPROVED') eventType = 'KNOWLEDGE_APPROVED';
    else if (updates.status === 'ARCHIVED') eventType = 'KNOWLEDGE_ARCHIVED';

    await db.logAuditEvent(
      {
        tenant_id: authContext.tenantId,
        event_type: eventType,
        actor: authContext.userId,
        actor_type: (authContext.role === 'VOICE_GATEWAY' ? 'AI_AGENT' : authContext.role) as any,
        actor_id: authContext.userId,
        severity: 'INFO',
        details: {
          knowledge_item_id: id,
          new_status: updates.status,
          updated_fields: Object.keys(updates),
        },
      },
      authContext.tenantId
    );

    return NextResponse.json({ knowledge_item: updated });
  } catch (error) {
    return handleApiError(error, 'api/knowledge:PATCH');
  }
}
