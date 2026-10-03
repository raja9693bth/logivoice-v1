/**
 * LOGIVOICE V1 — DOMAIN MODEL VS SQL SCHEMA MAPPERS
 * Strictly converts rich TypeScript domain objects to/from normalized PostgreSQL schema rows.
 * Prevents denormalized UI fields from leaking into SQL insert/update statements.
 * Conforms to PostgreSQL Migration 20260917000000_init_logivoice_schema.sql.
 */

import {
  Customer,
  Call,
  CallFacts,
  TranscriptTurn,
  Lead,
  OperationsRequest,
  KnowledgeItem,
  AuditEvent,
  FollowupRecord,
  CallIntent,
  CallOutcome,
  LeadTemperature,
  RequestType,
  RequestStatus,
  RequestPriority,
  FollowupChannel,
  FollowupStatus,
  AuditSeverity,
} from '@/types/logivoice';
import { normalizePhoneNumber } from '@/lib/utils';

// =========================================================================
// 1. DATABASE ROW INTERFACES (Normalized SQL Schema Contract)
// =========================================================================

export interface CustomersDbRow {
  id: string;
  tenant_id: string;
  phone: string;
  phone_normalized: string;
  name: string;
  company: string | null;
  customer_type: 'BROKER' | 'SHIPPER' | 'CONSIGNEE' | 'FLEET_OPERATOR' | null;
  created_at: string;
  updated_at: string;
  last_seen_at: string | null;
}

export interface CallsDbRow {
  id: string;
  tenant_id: string;
  external_call_id: string;
  customer_id: string | null;
  started_at: string;
  ended_at: string | null;
  duration_seconds: number;
  primary_intent: CallIntent;
  intent_confidence: number;
  sentiment: 'POSITIVE' | 'NEUTRAL' | 'FRUSTRATED' | 'ANGRY';
  outcome: CallOutcome;
  lead_temperature: LeadTemperature;
  summary: string | null;
  agent_version: string;
  recording_url: string | null;
  escalation_status: Record<string, unknown>;
  followup_state: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface CallFactsDbRow {
  call_id: string;
  tenant_id: string;
  route_from: string | null;
  route_to: string | null;
  weight: string | null;
  quantity: string | null;
  vehicle_type: string | null;
  material_type: string | null;
  pickup_date: string | null;
  pickup_time: string | null;
  quoted_amount: number | null;
  quote_type: 'ESTIMATE' | 'CONFIRMED' | null;
  tracking_id: string | null;
  booking_reference: string | null;
  special_requirements: string | null;
  created_at: string;
  updated_at: string;
}

export interface TranscriptSegmentsDbRow {
  id: string;
  call_id: string;
  tenant_id: string;
  speaker: 'agent' | 'caller';
  text: string;
  timestamp: string;
  language: string | null;
  created_at: string;
}

export interface LeadsDbRow {
  id: string;
  tenant_id: string;
  customer_id: string;
  call_id: string | null;
  source: string;
  status: 'NEW' | 'CONTACTED' | 'QUALIFIED' | 'CONVERTED' | 'LOST' | 'WON';
  temperature: LeadTemperature;
  requirement: string;
  route: string | null;
  vehicle_type: string | null;
  weight: string | null;
  next_action: string;
  assigned_to: string | null;
  followup_status: FollowupStatus;
  last_call_at: string;
  created_at: string;
  updated_at: string;
}

export interface OperationsRequestsDbRow {
  id: string;
  reference_no: string;
  tenant_id: string;
  call_id: string | null;
  customer_id: string | null;
  type: RequestType;
  status: RequestStatus;
  priority: RequestPriority;
  summary: string;
  details: Record<string, unknown>;
  idempotency_key: string | null;
  assigned_to: string | null;
  created_at: string;
  updated_at: string;
}

export interface FollowupsDbRow {
  id: string;
  tenant_id: string;
  call_id: string;
  customer_id: string | null;
  channel: FollowupChannel;
  status: FollowupStatus;
  recipient: string;
  template_id: string | null;
  message_content: string | null;
  message_snippet: string | null;
  provider_message_id: string | null;
  suppression_reason: string | null;
  sent_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AuditEventsDbRow {
  id: string;
  tenant_id: string;
  call_id: string | null;
  external_call_id?: string | null;
  event_type: string;
  actor_type: 'AI_AGENT' | 'DISPATCHER' | 'ADMIN' | 'OPS_MANAGER' | 'SYSTEM' | 'WEBHOOK' | 'USER';
  actor_id: string;
  tool_name: string | null;
  severity: AuditSeverity;
  details: Record<string, unknown>;
  created_at: string;
}

export interface KnowledgeItemsDbRow {
  id: string;
  tenant_id: string;
  category: KnowledgeItem['category'];
  title: string;
  content: string;
  status: KnowledgeItem['status'];
  version: string;
  approved_by?: string | null;
  approved_at?: string | null;
  created_at: string;
  updated_at: string;
}

// =========================================================================
// 2. BIDIRECTIONAL DOMAIN <-> DATABASE MAPPERS
// =========================================================================

/**
 * Maps TypeScript Call domain object to normalized PostgreSQL `calls` and `call_facts` rows.
 * Explicitly strips out UI-only nested fields (e.g. `customer`, `transcript`, `tool_events`).
 */
export function domainCallToDbRow(
  call: Partial<Call> & { id: string; external_call_id: string; tenant_id: string }
): { callRow: CallsDbRow; factsRow?: CallFactsDbRow } {
  const now = new Date().toISOString();

  const callRow: CallsDbRow = {
    id: call.id,
    tenant_id: call.tenant_id,
    external_call_id: call.external_call_id,
    customer_id: call.customer_id && !call.customer_id.startsWith('cust-') ? call.customer_id : (call.customer?.id && !call.customer.id.startsWith('cust-') ? call.customer.id : null),
    started_at: call.started_at || now,
    ended_at: call.ended_at || null,
    duration_seconds: typeof call.duration_seconds === 'number' ? call.duration_seconds : 0,
    primary_intent: call.primary_intent || 'GENERAL',
    intent_confidence: 1.0,
    sentiment: call.sentiment || 'NEUTRAL',
    outcome: call.outcome || 'IN_PROGRESS',
    lead_temperature: call.lead_temperature || 'COLD',
    summary: call.summary || null,
    agent_version: call.agent_version || 'v1.0.0',
    recording_url: call.recording_url || null,
    escalation_status: (call.escalation_status as Record<string, unknown>) || { is_escalated: false },
    followup_state: (call.followup_state as Record<string, unknown>) || { eligible: false, status: 'PENDING' },
    created_at: call.started_at || now,
    updated_at: now,
  };

  let factsRow: CallFactsDbRow | undefined;
  if (call.facts) {
    factsRow = {
      call_id: call.id,
      tenant_id: call.tenant_id,
      route_from: call.facts.route_from || null,
      route_to: call.facts.route_to || null,
      weight: call.facts.weight || null,
      quantity: call.facts.quantity || null,
      vehicle_type: call.facts.vehicle_type || null,
      material_type: call.facts.material_type || null,
      pickup_date: call.facts.pickup_date || null,
      pickup_time: call.facts.pickup_time || null,
      quoted_amount: call.facts.quoted_amount ?? null,
      quote_type: call.facts.quote_type || null,
      tracking_id: call.facts.tracking_id || null,
      booking_reference: call.facts.booking_reference || null,
      special_requirements: call.facts.special_requirements || null,
      created_at: now,
      updated_at: now,
    };
  }

  return { callRow, factsRow };
}

/**
 * Reconstructs rich TypeScript Call domain object from normalized SQL rows.
 */
export function dbCallToDomain(
  row: CallsDbRow,
  factsRow?: CallFactsDbRow | null,
  customerRow?: Customer | null,
  transcripts?: TranscriptSegmentsDbRow[]
): Call {
  const facts: CallFacts = {
    call_id: row.id,
    route_from: factsRow?.route_from || undefined,
    route_to: factsRow?.route_to || undefined,
    weight: factsRow?.weight || undefined,
    quantity: factsRow?.quantity || undefined,
    vehicle_type: factsRow?.vehicle_type || undefined,
    material_type: factsRow?.material_type || undefined,
    pickup_date: factsRow?.pickup_date || undefined,
    pickup_time: factsRow?.pickup_time || undefined,
    quoted_amount: factsRow?.quoted_amount ?? undefined,
    quote_type: factsRow?.quote_type || undefined,
    tracking_id: factsRow?.tracking_id || undefined,
    booking_reference: factsRow?.booking_reference || undefined,
    special_requirements: factsRow?.special_requirements || undefined,
  };

  const transcript: TranscriptTurn[] | undefined = transcripts?.map((t) => ({
    speaker: t.speaker,
    text: t.text,
    timestamp: t.timestamp,
    language: (t.language as 'hi' | 'en' | 'hinglish') || undefined,
  }));

  return {
    id: row.id,
    external_call_id: row.external_call_id,
    tenant_id: row.tenant_id,
    customer_id: row.customer_id || undefined,
    customer: customerRow || undefined,
    started_at: row.started_at,
    ended_at: row.ended_at || undefined,
    duration_seconds: row.duration_seconds,
    primary_intent: row.primary_intent,
    sentiment: row.sentiment,
    outcome: row.outcome,
    lead_temperature: row.lead_temperature,
    summary: row.summary || '',
    facts,
    escalation_status: row.escalation_status as Call['escalation_status'],
    followup_state: row.followup_state as Call['followup_state'],
    transcript,
    agent_version: row.agent_version,
    recording_url: row.recording_url || undefined,
    intent_confidence: row.intent_confidence,
  };
}

/**
 * Maps Lead domain object to normalized PostgreSQL `leads` row.
 * Strips customer details (customer_name, phone, company) which belong in the `customers` table.
 */
export function isValidUuid(id: string | null | undefined): boolean {
  if (!id) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
}

export function domainLeadToDbRow(
  lead: Partial<Lead> & { id: string; tenant_id: string }
): LeadsDbRow {
  const now = new Date().toISOString();
  if (!lead.customer_id) {
    throw new Error('Foreign key integrity violation: Lead record must have a valid customer_id pointing to a customer.');
  }
  return {
    id: lead.id,
    tenant_id: lead.tenant_id,
    customer_id: lead.customer_id,
    call_id: isValidUuid(lead.call_id) ? lead.call_id! : null,
    source: lead.source || 'INBOUND_CALL',
    status: lead.status || 'NEW',
    temperature: lead.temperature || 'WARM',
    requirement: lead.requirement || 'Freight Inquiry',
    route: lead.route || null,
    vehicle_type: lead.vehicle_type || null,
    weight: lead.weight || null,
    next_action: lead.next_action || 'Review and follow up',
    assigned_to: lead.assigned_to || null,
    followup_status: lead.followup_status || 'PENDING',
    last_call_at: lead.last_call_at || now,
    created_at: lead.created_at || now,
    updated_at: now,
  };
}

/**
 * Reconstructs Lead domain object from normalized `leads` row and linked Customer record.
 */
export function dbLeadToDomain(
  row: LeadsDbRow,
  customer?: Customer | null
): Lead {
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    call_id: row.call_id || undefined,
    customer_id: row.customer_id,
    customer_name: customer?.name || 'Inbound Lead',
    phone: customer?.phone || '',
    company: customer?.company || undefined,
    source: row.source,
    status: row.status,
    temperature: row.temperature,
    requirement: row.requirement,
    route: row.route || undefined,
    vehicle_type: row.vehicle_type || undefined,
    weight: row.weight || undefined,
    next_action: row.next_action,
    assigned_to: row.assigned_to || undefined,
    followup_status: row.followup_status,
    last_call_at: row.last_call_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/**
 * Maps OperationsRequest domain object to normalized PostgreSQL `operations_requests` row.
 */
export function domainRequestToDbRow(
  req: Partial<OperationsRequest> & { id: string; reference_no: string; tenant_id: string }
): OperationsRequestsDbRow {
  const now = new Date().toISOString();

  // Consolidate non-column domain fields inside `details` JSONB
  const detailsPayload: Record<string, unknown> = {
    ...(req.details || {}),
    customer_name: req.customer_name,
    customer_phone: req.customer_phone,
    notes: req.notes,
    resolution_notes: req.resolution_notes,
  };

  return {
    id: req.id,
    reference_no: req.reference_no,
    tenant_id: req.tenant_id,
    call_id: isValidUuid(req.call_id) ? req.call_id! : null,
    customer_id: isValidUuid(req.customer_id) ? req.customer_id! : null,
    type: req.type || 'BOOKING_REQUEST',
    status: req.status || 'PENDING',
    priority: req.priority || 'NORMAL',
    summary: req.summary || 'Operational Request',
    details: detailsPayload,
    idempotency_key: req.idempotency_key || (detailsPayload.idempotency_key as string) || null,
    assigned_to: req.assigned_to || null,
    created_at: req.created_at || now,
    updated_at: now,
  };
}

/**
 * Reconstructs OperationsRequest domain object from normalized SQL row.
 */
export function dbRequestToDomain(
  row: OperationsRequestsDbRow,
  customer?: Customer | null
): OperationsRequest {
  const details = (row.details as Record<string, unknown>) || {};
  return {
    id: row.id,
    reference_no: row.reference_no,
    tenant_id: row.tenant_id,
    call_id: row.call_id || undefined,
    customer_id: row.customer_id || undefined,
    customer_name: customer?.name || (details.customer_name as string) || 'Inbound Caller',
    customer_phone: customer?.phone || (details.customer_phone as string) || '',
    type: row.type,
    status: row.status,
    priority: row.priority,
    summary: row.summary,
    details,
    notes: (details.notes as string) || undefined,
    resolution_notes: (details.resolution_notes as string) || undefined,
    assigned_to: row.assigned_to || undefined,
    idempotency_key: row.idempotency_key || (details.idempotency_key as string) || undefined,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/**
 * Maps KnowledgeItem domain object to normalized PostgreSQL `knowledge_items` row.
 * Converts domain `last_updated` to SQL column `updated_at`.
 */
export function domainKnowledgeToDbRow(
  kb: Partial<KnowledgeItem> & { id: string; tenant_id: string }
): KnowledgeItemsDbRow {
  const now = new Date().toISOString();
  return {
    id: kb.id,
    tenant_id: kb.tenant_id,
    category: kb.category || 'OPERATIONAL_FAQ',
    title: kb.title || '',
    content: kb.content || '',
    status: kb.status || 'DRAFT',
    version: kb.version || 'v1.0',
    approved_by: kb.approved_by || null,
    approved_at: kb.approved_at || null,
    created_at: now,
    updated_at: kb.last_updated ? new Date(kb.last_updated).toISOString() : now,
  };
}

/**
 * Reconstructs KnowledgeItem domain object from normalized `knowledge_items` row.
 * Maps SQL column `updated_at` to domain `last_updated`.
 */
export function dbKnowledgeToDomain(row: KnowledgeItemsDbRow): KnowledgeItem {
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    category: row.category,
    title: row.title,
    content: row.content,
    status: row.status,
    last_updated: row.updated_at ? row.updated_at.split('T')[0] : new Date().toISOString().split('T')[0],
    version: row.version,
    approved_by: row.approved_by || undefined,
    approved_at: row.approved_at || undefined,
  };
}

/**
 * Maps Customer domain object to normalized PostgreSQL `customers` row.
 */
export function domainCustomerToDbRow(
  customer: Partial<Customer> & { id: string; tenant_id: string; phone: string; name: string }
): CustomersDbRow {
  const now = new Date().toISOString();
  const phoneNormalized = customer.phone_normalized || normalizePhoneNumber(customer.phone);

  return {
    id: customer.id,
    tenant_id: customer.tenant_id,
    phone: customer.phone,
    phone_normalized: phoneNormalized,
    name: customer.name,
    company: customer.company || null,
    customer_type: customer.customer_type || null,
    created_at: customer.created_at || now,
    updated_at: now,
    last_seen_at: customer.last_seen_at || now,
  };
}

/**
 * Maps FollowupRecord domain object to normalized PostgreSQL `followups` row.
 */
export function domainFollowupToDbRow(
  flw: Partial<FollowupRecord> & { id: string; tenant_id: string; call_id: string; recipient: string }
): FollowupsDbRow {
  const now = new Date().toISOString();
  return {
    id: flw.id,
    tenant_id: flw.tenant_id,
    call_id: flw.call_id,
    customer_id: flw.customer_id && !flw.customer_id.startsWith('cust-') ? flw.customer_id : null,
    channel: flw.channel || 'WHATSAPP',
    status: flw.status || 'PENDING',
    recipient: flw.recipient,
    template_id: flw.template_id || null,
    message_content: flw.message_content || null,
    message_snippet: flw.message_content ? flw.message_content.slice(0, 100) : null,
    provider_message_id: flw.provider_message_id || null,
    suppression_reason: flw.suppression_reason || null,
    sent_at: flw.sent_at || null,
    created_at: flw.created_at || now,
    updated_at: now,
  };
}

/**
 * Maps AuditEvent domain object to normalized PostgreSQL `audit_events` row.
 */
export function domainAuditToDbRow(
  event: Partial<AuditEvent> & { id: string; tenant_id: string; event_type: string }
): AuditEventsDbRow {
  const now = new Date().toISOString();
  const isUuid = isValidUuid(event.call_id);
  return {
    id: event.id,
    tenant_id: event.tenant_id,
    call_id: isUuid ? event.call_id! : null,
    external_call_id: event.external_call_id || (!isUuid && event.call_id ? event.call_id : null),
    event_type: event.event_type,
    actor_type: event.actor_type || 'SYSTEM',
    actor_id: event.actor_id || event.actor || 'system',
    tool_name: event.tool_name || null,
    severity: event.severity || 'INFO',
    details: event.details || {},
    created_at: event.timestamp || now,
  };
}

/**
 * Reconstructs Customer domain object from normalized `customers` row.
 */
export function dbCustomerToDomain(row: CustomersDbRow): Customer {
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    phone: row.phone,
    phone_normalized: row.phone_normalized || undefined,
    name: row.name,
    company: row.company || undefined,
    customer_type: row.customer_type || undefined,
    created_at: row.created_at,
    updated_at: row.updated_at,
    last_seen_at: row.last_seen_at || undefined,
  };
}

/**
 * Reconstructs FollowupRecord domain object from normalized `followups` row.
 */
export function dbFollowupToDomain(row: FollowupsDbRow): FollowupRecord {
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    call_id: row.call_id,
    customer_id: row.customer_id || undefined,
    channel: row.channel,
    status: row.status,
    recipient: row.recipient,
    template_id: row.template_id || undefined,
    message_content: row.message_content || undefined,
    provider_message_id: row.provider_message_id || undefined,
    suppression_reason: row.suppression_reason || undefined,
    sent_at: row.sent_at || undefined,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

