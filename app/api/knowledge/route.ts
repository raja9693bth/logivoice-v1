import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext, requireRole, AuthorizationError } from '@/lib/auth/context';
import { db } from '@/lib/db';
import { retrieveRelevantKnowledge } from '@/lib/knowledge/retrieval';
import { CallIntent, KnowledgeItem } from '@/types/logivoice';

export async function GET(req: NextRequest) {
  try {
    const authContext = await getAuthContext(req);
    requireRole(authContext, ['DISPATCHER', 'OPS_MANAGER', 'ADMIN', 'SYSTEM', 'VOICE_GATEWAY']);

    const { searchParams } = new URL(req.url);
    const intent = searchParams.get('intent') as CallIntent | null;
    const category = searchParams.get('category') as KnowledgeItem['category'] | null;

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
