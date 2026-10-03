/**
 * LOGIVOICE V1 — LAYERED VOICE RUNTIME CONTEXT ASSEMBLER
 * Implements SSOT Section 6.2.2 & 17.1.
 * Assembles runtime instructions in layers without loading the monolithic KB into prompts.
 */

import { db, DEFAULT_TENANT_ID } from '@/lib/db';
import { retrieveRelevantKnowledge } from '@/lib/knowledge/retrieval';
import { CallIntent, Customer } from '@/types/logivoice';

export interface ContextAssemblyParams {
  tenantId?: string;
  callerPhone?: string;
  probableIntent?: CallIntent;
  externalCallId?: string;
}

export async function assembleVoiceRuntimeContext(params: ContextAssemblyParams): Promise<{
  systemPrompt: string;
  customer: Customer | null;
  brandName: string;
}> {
  const tenantId = params.tenantId || DEFAULT_TENANT_ID;
  const config = await db.getClientConfig(tenantId);

  // 1. Customer Context
  let customer: Customer | null = null;
  if (params.callerPhone) {
    customer = await db.getCustomerByPhone(params.callerPhone, tenantId);
  }

  // 2. Relevant Operational Knowledge
  let relevantKnowledgeText = '';
  if (params.probableIntent) {
    const knowledgeItems = await retrieveRelevantKnowledge(params.probableIntent, tenantId);
    if (knowledgeItems.length > 0) {
      relevantKnowledgeText = `\nRELEVANT OPERATIONAL KNOWLEDGE:\n${knowledgeItems
        .map((k) => `[${k.category}] ${k.title}:\n${k.content}`)
        .join('\n\n')}`;
    }
  }

  // 3. Layered System Prompt incorporating runtime settings
  const personaInstruction = config.voice_persona
    ? `Persona & Acoustic Tone: ${config.voice_persona}`
    : 'Persona: Professional, respectful, and efficient logistics coordinator.';

  const languageInstruction = config.allow_language_switching
    ? `Primary language: ${config.primary_language}. Secondary: ${config.secondary_language}. Mirror the caller's language naturally across Hindi, Hinglish, and Indian English.`
    : `Primary language: ${config.primary_language}. Strictly maintain ${config.primary_language} throughout the conversation. Do not switch languages.`;

  const systemPrompt = `
You are LogiVoice, the automated inbound voice operations assistant for ${config.brand_name}.
You handle first-line customer and fleet inquiries.
Approved disclosure: "${config.ai_disclosure_wording}"

OPERATING BOUNDARIES:
- Primary hubs: ${config.primary_operating_cities.join(', ')}
- Operating hours: ${config.business_hours.start} to ${config.business_hours.end} (${config.business_hours.days})
- ${languageInstruction}
- ${personaInstruction}
- Keep responses concise (1-2 sentences). Never give long monologues.
- Confirm important commercial details (route, truck size, rate) before committing an action.
- "LLM reasons. CODE GOVERNS." Never invent rates, tracking statuses, or booking promises. Use your authorized tools.
- When caller demands a human manager or complains angrily, call the 'transfer_to_human' tool immediately.

${customer ? `CALLER CONTEXT:\n- Name: ${customer.name}\n- Company: ${customer.company || 'Individual Shipper'}\n- Phone: ${customer.phone}\n- Status: Verified Existing Customer` : 'CALLER CONTEXT: New / Unverified Caller'}
${relevantKnowledgeText}
`.trim();

  return {
    systemPrompt,
    customer,
    brandName: config.brand_name,
  };
}
