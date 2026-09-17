import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext, requireRole, AuthorizationError } from '@/lib/auth/context';
import { db } from '@/lib/db';
import { retrieveRelevantKnowledge } from '@/lib/knowledge/retrieval';
import { CreateKnowledgeApiSchema, UpdateKnowledgeApiSchema, ListKnowledgeQuerySchema } from '@/lib/schemas/api';

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
      },
      authContext.tenantId
    );

    return NextResponse.json({ knowledge_item: newItem }, { status: 201 });
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
    const updated = await db.updateKnowledgeItem(id, updates, authContext.tenantId);
    if (!updated) {
      return NextResponse.json({ error: 'Knowledge item not found' }, { status: 404 });
    }

    return NextResponse.json({ knowledge_item: updated });
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
