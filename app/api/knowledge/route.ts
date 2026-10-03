import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext, requireRole } from '@/lib/auth/context';
import { db } from '@/lib/db';
import { retrieveRelevantKnowledge } from '@/lib/knowledge/retrieval';
import { CreateKnowledgeApiSchema, UpdateKnowledgeApiSchema, ListKnowledgeQuerySchema } from '@/lib/schemas/api';
import { handleApiError } from '@/lib/api/error-handler';

export async function GET(req: NextRequest) {
  try {
    const authContext = await getAuthContext(req);
    requireRole(authContext, ['DISPATCHER', 'OPS_MANAGER', 'ADMIN', 'SYSTEM', 'VOICE_GATEWAY']);

    const { searchParams } = new URL(req.url);
    const rawQuery = {
      intent: searchParams.get('intent') || undefined,
      category: searchParams.get('category') || undefined,
    };

    const parsedQuery = ListKnowledgeQuerySchema.safeParse(rawQuery);
    if (!parsedQuery.success) {
      return NextResponse.json(
        { error: 'Invalid query parameters', details: parsedQuery.error.flatten() },
        { status: 400 }
      );
    }

    const { intent, category } = parsedQuery.data;

    // Dynamic intent-specific retrieval
    if (intent) {
      const relevant = await retrieveRelevantKnowledge(intent, authContext.tenantId);
      return NextResponse.json({ intent, knowledge: relevant });
    }

    // Full category listing
    const items = await db.listKnowledgeItems(authContext.tenantId, category || undefined);
    return NextResponse.json({ knowledge_items: items });
  } catch (error) {
    return handleApiError(error, 'api/knowledge:GET');
  }
}

export async function POST(req: NextRequest) {
  try {
    const authContext = await getAuthContext(req);
    requireRole(authContext, ['ADMIN', 'OPS_MANAGER', 'SYSTEM']);

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Malformed JSON payload' }, { status: 400 });
    }

    const parseResult = CreateKnowledgeApiSchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parseResult.error.flatten() },
        { status: 400 }
      );
    }

    const val = parseResult.data;
    const newItem = await db.createKnowledgeItem(
      {
        tenant_id: authContext.tenantId,
        category: val.category,
        title: val.title,
        content: val.content,
        status: val.status,
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

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Malformed JSON payload' }, { status: 400 });
    }

    const parseResult = UpdateKnowledgeApiSchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parseResult.error.flatten() },
        { status: 400 }
      );
    }

    const { id, ...updates } = parseResult.data;
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
