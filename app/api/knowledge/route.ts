import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext } from '@/lib/auth/context';
import { db } from '@/lib/db';
import { retrieveRelevantKnowledge } from '@/lib/knowledge/retrieval';
import { CallIntent, KnowledgeItem } from '@/types/logivoice';

export async function GET(req: NextRequest) {
  const authContext = await getAuthContext(req);
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
}
