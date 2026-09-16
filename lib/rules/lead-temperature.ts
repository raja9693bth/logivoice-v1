/**
 * LOGIVOICE V1 — DETERMINISTIC LEAD TEMPERATURE ENGINE
 * Governed strictly by SSOT Table 12 & Knowledge Base Section 10 rules.
 *
 * BASELINE RULES:
 * HOT:
 *   - Explicit booking or quote confirmation request
 *   - Core operational details captured (origin, destination, weight or vehicle)
 *   - High intent without unresolvable blocks
 *
 * WARM:
 *   - Real freight inquiry (rate quote, route check, service area)
 *   - Inquiry has clear interest but decision/timing/specs remain open
 *
 * COLD:
 *   - General inquiry, wrong number, unsupported area, or no active freight requirement
 *
 * REVIEW:
 *   - Escalated complaints, severe dissatisfaction, high-value negotiations, or ambiguous edge cases
 */

import { CallIntent, CallFacts, LeadTemperature } from '@/types/logivoice';

export interface LeadTemperatureInput {
  intent: CallIntent;
  facts?: Partial<CallFacts>;
  sentiment?: 'POSITIVE' | 'NEUTRAL' | 'FRUSTRATED' | 'ANGRY';
  isEscalated?: boolean;
  hasBookingRequest?: boolean;
  transcriptSnippet?: string;
}

export function computeLeadTemperature(input: LeadTemperatureInput): LeadTemperature {
  const { intent, facts, sentiment, isEscalated, hasBookingRequest } = input;

  // 1. REVIEW rule:
  // Complaints, severe frustration, or human escalation for edge cases must be flagged for human review
  if (intent === 'COMPLAINT' || sentiment === 'ANGRY' || isEscalated) {
    return 'REVIEW';
  }

  // 2. HOT rule:
  // Explicit booking request, or rate quote where all core routing parameters are captured
  if (hasBookingRequest || intent === 'BOOKING') {
    return 'HOT';
  }

  if (intent === 'RATE_QUOTE') {
    const hasOrigin = Boolean(facts?.route_from);
    const hasDest = Boolean(facts?.route_to);
    const hasVehicleOrWeight = Boolean(facts?.vehicle_type || facts?.weight);
    const hasQuote = Boolean(facts?.quoted_amount && facts.quoted_amount > 0);

    // If customer has route + cargo spec + received a quote, they are HOT
    if (hasOrigin && hasDest && hasVehicleOrWeight && hasQuote) {
      return 'HOT';
    }

    // If route is present but vehicle/weight is still pending, they are WARM
    if (hasOrigin && hasDest) {
      return 'WARM';
    }
  }

  // 3. WARM rule:
  // Inquiries about service areas, active shipments, or general freight capability
  if (intent === 'SERVICE_AREA' || intent === 'EXISTING_CUSTOMER' || intent === 'TRACKING') {
    return 'WARM';
  }

  // 4. COLD rule:
  // Unsupported requests, generic questions, or no concrete shipment requirement
  if (intent === 'UNSUPPORTED_REQUEST' || intent === 'GENERAL') {
    return 'COLD';
  }

  return 'COLD';
}
