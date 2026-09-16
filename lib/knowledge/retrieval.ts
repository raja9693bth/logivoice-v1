/**
 * LOGIVOICE V1 — LAYER 02 OPERATIONAL KNOWLEDGE RETRIEVAL RUNTIME
 * Enforces dynamic, intent-specific retrieval.
 * NEVER injects the monolithic Knowledge Base into live voice turns.
 */

import { db, DEFAULT_TENANT_ID } from '@/lib/db';
import { CallIntent, KnowledgeItem } from '@/types/logivoice';

export interface RetrievedKnowledge {
  category: KnowledgeItem['category'];
  title: string;
  content: string;
  version: string;
}

/**
 * Maps a caller's classified or probable intent to relevant operational knowledge category.
 */
function mapIntentToCategory(intent: CallIntent): KnowledgeItem['category'] {
  switch (intent) {
    case 'RATE_QUOTE':
      return 'RATE_POLICY';
    case 'TRACKING':
      return 'TRACKING_POLICY';
    case 'BOOKING':
      return 'BOOKING_RULES';
    case 'SERVICE_AREA':
      return 'SERVICE_AREA';
    case 'COMPLAINT':
    case 'HUMAN_REQUEST':
      return 'ESCALATION_RULES';
    default:
      return 'OPERATIONAL_FAQ';
  }
}

/**
 * Retrieves only the minimal, relevant operational knowledge for a specific intent.
 */
export async function retrieveRelevantKnowledge(
  intent: CallIntent,
  tenantId: string = DEFAULT_TENANT_ID
): Promise<RetrievedKnowledge[]> {
  const category = mapIntentToCategory(intent);
  const items = await db.listKnowledgeItems(tenantId, category);

  // Return approved items only
  return items
    .filter((item) => item.status === 'APPROVED')
    .map((item) => ({
      category: item.category,
      title: item.title,
      content: item.content,
      version: item.version,
    }));
}
