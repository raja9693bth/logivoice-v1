/**
 * LOGIVOICE V1 — API MUTATION SCHEMAS & INPUT VALIDATION
 * Strict Zod validation schemas for all REST API mutation endpoints.
 * Protects database and business logic from malformed payloads, oversized inputs,
 * type confusion, and unauthorized client parameter injection.
 */

import { z } from 'zod';

// =========================================================================
// CALLS API SCHEMAS
// =========================================================================
export const CreateCallApiSchema = z.object({
  external_call_id: z.string().min(3).max(128),
  customer_id: z.string().max(128).optional(),
  from_number: z.string().max(32).optional(),
  to_number: z.string().max(32).optional(),
  started_at: z.string().datetime().optional(),
  ended_at: z.string().datetime().optional(),
  duration_seconds: z.number().int().nonnegative().max(86400).default(0),
  primary_intent: z
    .enum([
      'RATE_QUOTE',
      'TRACKING',
      'BOOKING',
      'SERVICE_AREA',
      'GENERAL',
      'COMPLAINT',
      'HUMAN_REQUEST',
      'EXISTING_CUSTOMER',
      'UNSUPPORTED_REQUEST',
    ])
    .default('GENERAL'),
  sentiment: z.enum(['POSITIVE', 'NEUTRAL', 'FRUSTRATED', 'ANGRY']).default('NEUTRAL'),
  outcome: z.enum(['IN_PROGRESS', 'COMPLETED', 'TRANSFERRED', 'CALLBACK_SCHEDULED', 'MISSED', 'FAILED', 'ABANDONED']).default('IN_PROGRESS'),
  summary: z.string().max(4000).default(''),
  facts: z
    .object({
      route_from: z.string().max(100).optional(),
      route_to: z.string().max(100).optional(),
      weight: z.string().max(50).optional(),
      vehicle_type: z.string().max(50).optional(),
      material_type: z.string().max(100).optional(),
      pickup_date: z.string().max(50).optional(),
      quoted_amount: z.number().nonnegative().optional(),
      quote_type: z.enum(['ESTIMATE', 'CONFIRMED']).optional(),
      tracking_id: z.string().max(50).optional(),
      booking_reference: z.string().max(50).optional(),
      special_requirements: z.string().max(500).optional(),
    })
    .optional(),
  escalation_status: z
    .object({
      is_escalated: z.boolean(),
      reason: z.string().max(500).optional(),
      target_role: z.string().max(100).optional(),
      target_phone: z.string().max(32).optional(),
    })
    .optional(),
  agent_version: z.string().max(32).default('v1.0.0'),
}).strict();

export const UpdateCallApiSchema = z.object({
  ended_at: z.string().datetime().optional(),
  duration_seconds: z.number().int().nonnegative().max(86400).optional(),
  primary_intent: z
    .enum([
      'RATE_QUOTE',
      'TRACKING',
      'BOOKING',
      'SERVICE_AREA',
      'GENERAL',
      'COMPLAINT',
      'HUMAN_REQUEST',
      'EXISTING_CUSTOMER',
      'UNSUPPORTED_REQUEST',
    ])
    .optional(),
  sentiment: z.enum(['POSITIVE', 'NEUTRAL', 'FRUSTRATED', 'ANGRY']).optional(),
  outcome: z.enum(['IN_PROGRESS', 'COMPLETED', 'TRANSFERRED', 'CALLBACK_SCHEDULED', 'MISSED', 'FAILED', 'ABANDONED']).optional(),
  lead_temperature: z.enum(['HOT', 'WARM', 'COLD', 'REVIEW']).optional(),
  summary: z.string().max(4000).optional(),
  facts: z
    .object({
      route_from: z.string().max(100).optional(),
      route_to: z.string().max(100).optional(),
      weight: z.string().max(50).optional(),
      vehicle_type: z.string().max(50).optional(),
      material_type: z.string().max(100).optional(),
      pickup_date: z.string().max(50).optional(),
      quoted_amount: z.number().nonnegative().optional(),
      quote_type: z.enum(['ESTIMATE', 'CONFIRMED']).optional(),
      tracking_id: z.string().max(50).optional(),
      booking_reference: z.string().max(50).optional(),
      special_requirements: z.string().max(500).optional(),
    })
    .optional(),
  escalation_status: z
    .object({
      is_escalated: z.boolean(),
      reason: z.string().max(500).optional(),
      target_role: z.string().max(100).optional(),
      target_phone: z.string().max(32).optional(),
      handoff_successful: z.boolean().optional(),
    })
    .optional(),
}).strict();

// =========================================================================
// REQUESTS API SCHEMAS
// =========================================================================
export const CreateRequestApiSchema = z.object({
  call_id: z.string().max(128).optional(),
  type: z.enum(['BOOKING_REQUEST', 'SUPPORT_TICKET', 'CALLBACK_REQUEST', 'RATE_REQUEST']),
  priority: z.enum(['URGENT', 'HIGH', 'NORMAL', 'LOW']).default('NORMAL'),
  customer_name: z.string().min(2).max(100),
  customer_phone: z.string().min(5).max(32),
  summary: z.string().min(3).max(2000),
  payload: z.record(z.string(), z.unknown()).default({}),
  assigned_to: z.string().max(100).optional(),
}).strict();

export const UpdateRequestApiSchema = z.object({
  id: z.string().min(1),
  status: z.enum(['PENDING', 'CONFIRMED', 'IN_REVIEW', 'COMPLETED', 'REJECTED', 'FAILED']).optional(),
  priority: z.enum(['URGENT', 'HIGH', 'NORMAL', 'LOW']).optional(),
  assigned_to: z.string().max(100).optional(),
  resolution_notes: z.string().max(2000).optional(),
}).strict();

// =========================================================================
// LEADS API SCHEMAS
// =========================================================================
export const CreateLeadApiSchema = z.object({
  customer_id: z.string().max(128).optional(),
  customer_name: z.string().min(2).max(100),
  phone: z.string().min(5).max(32),
  company: z.string().max(100).optional(),
  source: z.enum(['INBOUND_CALL', 'WHATSAPP_INQUIRY', 'WEB_FORM', 'DIRECT_DISPATCHER']).default('INBOUND_CALL'),
  status: z.enum(['NEW', 'CONTACTED', 'QUALIFIED', 'CONVERTED', 'LOST', 'WON']).default('NEW'),
  temperature: z.enum(['HOT', 'WARM', 'COLD', 'REVIEW']).default('WARM'),
  route: z.string().max(150).optional(),
  vehicle_type: z.string().max(50).optional(),
  weight: z.string().max(50).optional(),
  requirement: z.string().min(3).max(1000),
  next_action: z.string().max(250).optional(),
  assigned_to: z.string().max(100).optional(),
  followup_status: z
    .enum(['PENDING', 'SENT', 'DELIVERED', 'FAILED', 'SUPPRESSED', 'UNCONFIGURED', 'MOCK', 'COMPLETED', 'SKIPPED_NOT_ELIGIBLE'])
    .default('PENDING'),
}).strict();

export const UpdateLeadApiSchema = z.object({
  id: z.string().min(1),
  status: z.enum(['NEW', 'CONTACTED', 'QUALIFIED', 'CONVERTED', 'LOST', 'WON']).optional(),
  temperature: z.enum(['HOT', 'WARM', 'COLD', 'REVIEW']).optional(),
  next_action: z.string().max(250).optional(),
  assigned_to: z.string().max(100).optional(),
  followup_status: z
    .enum(['PENDING', 'SENT', 'DELIVERED', 'FAILED', 'SUPPRESSED', 'UNCONFIGURED', 'MOCK', 'COMPLETED', 'SKIPPED_NOT_ELIGIBLE'])
    .optional(),
}).strict();

// =========================================================================
// RATE CARDS API SCHEMAS
// =========================================================================
export const CreateRateCardApiSchema = z.object({
  origin: z.string().min(2).max(100),
  destination: z.string().min(2).max(100),
  vehicle_type: z.string().min(2).max(50),
  weight_min_tons: z.number().nonnegative().max(100),
  weight_max_tons: z.number().positive().max(100),
  price_inr: z.number().positive().max(10000000),
  minimum_charge_inr: z.number().nonnegative().max(10000000),
  effective_from: z.string().max(50),
  effective_to: z.string().max(50).optional(),
  status: z.enum(['ACTIVE', 'DRAFT', 'EXPIRED']).default('ACTIVE'),
  transit_time_hours: z.number().int().nonnegative().max(720).default(24),
  quote_type: z.enum(['ESTIMATE', 'CONFIRMED']).default('ESTIMATE'),
  supports_confirmed_quote: z.boolean().default(false),
  surcharge_notes: z.string().max(500).optional(),
}).strict();

export const UpdateRateCardApiSchema = z.object({
  id: z.string().min(1),
  origin: z.string().min(2).max(100).optional(),
  destination: z.string().min(2).max(100).optional(),
  vehicle_type: z.string().min(2).max(50).optional(),
  weight_min_tons: z.number().nonnegative().max(100).optional(),
  weight_max_tons: z.number().positive().max(100).optional(),
  price_inr: z.number().positive().max(10000000).optional(),
  minimum_charge_inr: z.number().nonnegative().max(10000000).optional(),
  effective_from: z.string().max(50).optional(),
  effective_to: z.string().max(50).optional(),
  status: z.enum(['ACTIVE', 'DRAFT', 'EXPIRED']).optional(),
  transit_time_hours: z.number().int().nonnegative().max(720).optional(),
  quote_type: z.enum(['ESTIMATE', 'CONFIRMED']).optional(),
  supports_confirmed_quote: z.boolean().optional(),
  surcharge_notes: z.string().max(500).optional(),
}).strict();

// =========================================================================
// KNOWLEDGE BASE API SCHEMAS
// =========================================================================
export const CreateKnowledgeApiSchema = z.object({
  category: z.enum([
    'RATE_POLICY',
    'TRACKING_POLICY',
    'SERVICE_AREA',
    'BOOKING_RULES',
    'OPERATIONAL_FAQ',
    'ESCALATION_RULES',
    'SERVICE_RULE',
    'SURCHARGE_POLICY',
    'COMMERCIAL_CLAUSE',
  ]),
  title: z.string().min(3).max(200),
  content: z.string().min(5).max(5000),
  status: z.enum(['APPROVED', 'DRAFT', 'UNDER_REVIEW', 'ARCHIVED']).default('APPROVED'),
  version: z.string().max(32).default('1.0'),
}).strict();

export const UpdateKnowledgeApiSchema = z.object({
  id: z.string().min(1),
  category: z
    .enum([
      'RATE_POLICY',
      'TRACKING_POLICY',
      'SERVICE_AREA',
      'BOOKING_RULES',
      'OPERATIONAL_FAQ',
      'ESCALATION_RULES',
      'SERVICE_RULE',
      'SURCHARGE_POLICY',
      'COMMERCIAL_CLAUSE',
    ])
    .optional(),
  title: z.string().min(3).max(200).optional(),
  content: z.string().min(5).max(5000).optional(),
  status: z.enum(['APPROVED', 'DRAFT', 'UNDER_REVIEW', 'ARCHIVED']).optional(),
}).strict();

// =========================================================================
// SETTINGS API SCHEMAS
// =========================================================================
export const UpdateSettingsApiSchema = z.object({
  business_name: z.string().min(2).max(150).optional(),
  brand_name: z.string().min(2).max(100).optional(),
  business_type: z.string().max(100).optional(),
  primary_operating_cities: z.array(z.string().min(2).max(50)).max(50).optional(),
  business_hours: z
    .object({
      start: z.string().max(20),
      end: z.string().max(20),
      days: z.string().max(50),
    })
    .optional(),
  timezone: z.string().max(50).optional(),
  ai_disclosure_wording: z.string().max(500).optional(),
  primary_language: z.string().max(50).optional(),
  secondary_language: z.string().max(50).optional(),
  inbound_phone_number: z.string().max(32).optional(),
  booking_url: z.string().url().max(250).optional(),
  voice_persona: z.string().max(100).optional(),
  barge_in_enabled: z.boolean().optional(),
  allow_language_switching: z.boolean().optional(),
  escalation_contacts: z
    .array(
      z.object({
        role: z.string().max(50),
        name: z.string().max(100),
        phone: z.string().max(32),
        channel: z.string().max(32),
        priority: z.number().int(),
      })
    )
    .max(20)
    .optional(),
  tracking_config: z
    .object({
      provider: z.string().max(50),
      identifier_type: z.string().max(50),
    })
    .optional(),
  followup_config: z
    .object({
      enabled: z.boolean(),
      default_channel: z.enum(['WHATSAPP', 'SMS', 'EMAIL']),
      suppress_opt_outs: z.boolean(),
    })
    .optional(),
  sheets_config: z
    .object({
      sync_enabled: z.boolean(),
      spreadsheet_id: z.string().max(100).optional(),
    })
    .optional(),
}).strict();

// =========================================================================
// QUERY PARAMETER VALIDATION SCHEMAS (SECTION 38)
// =========================================================================

export const ListCallsQuerySchema = z.object({
  intent: z
    .enum([
      'RATE_QUOTE',
      'TRACKING',
      'BOOKING',
      'SERVICE_AREA',
      'GENERAL',
      'COMPLAINT',
      'HUMAN_REQUEST',
      'EXISTING_CUSTOMER',
      'UNSUPPORTED_REQUEST',
    ])
    .optional(),
  outcome: z
    .enum([
      'IN_PROGRESS',
      'COMPLETED',
      'TRANSFERRED',
      'CALLBACK_SCHEDULED',
      'MISSED',
      'FAILED',
      'ABANDONED',
    ])
    .optional(),
  search: z.string().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
}).strict();

export const ListRequestsQuerySchema = z.object({
  status: z
    .enum(['PENDING', 'CONFIRMED', 'IN_REVIEW', 'COMPLETED', 'REJECTED', 'FAILED'])
    .optional(),
  priority: z.enum(['URGENT', 'HIGH', 'NORMAL', 'LOW']).optional(),
  type: z
    .enum(['BOOKING_REQUEST', 'SUPPORT_TICKET', 'CALLBACK_REQUEST', 'RATE_REQUEST'])
    .optional(),
  search: z.string().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
}).strict();

export const ListLeadsQuerySchema = z.object({
  temperature: z.enum(['HOT', 'WARM', 'COLD', 'REVIEW']).optional(),
  status: z.enum(['NEW', 'CONTACTED', 'QUALIFIED', 'CONVERTED', 'LOST', 'WON']).optional(),
  search: z.string().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
}).strict();

export const ListKnowledgeQuerySchema = z.object({
  intent: z
    .enum([
      'RATE_QUOTE',
      'TRACKING',
      'BOOKING',
      'SERVICE_AREA',
      'GENERAL',
      'COMPLAINT',
      'HUMAN_REQUEST',
      'EXISTING_CUSTOMER',
      'UNSUPPORTED_REQUEST',
    ])
    .optional(),
  category: z
    .enum([
      'RATE_POLICY',
      'TRACKING_POLICY',
      'SERVICE_AREA',
      'BOOKING_RULES',
      'OPERATIONAL_FAQ',
      'ESCALATION_RULES',
      'SERVICE_RULE',
      'SURCHARGE_POLICY',
      'COMMERCIAL_CLAUSE',
    ])
    .optional(),
}).strict();

export const GetRateQuoteQuerySchema = z.object({
  origin: z.string().max(100).optional(),
  destination: z.string().max(100).optional(),
  vehicle_type: z.string().max(50).optional(),
  weight_tons: z.coerce.number().positive().max(1000).optional(),
  pickup_date: z.string().max(50).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'EXPIRED']).optional(),
  search: z.string().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
}).strict();

export const ListRateCardsQuerySchema = GetRateQuoteQuerySchema;

export const ListAuditQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  event_type: z.string().max(100).optional(),
  severity: z.enum(['INFO', 'WARNING', 'ERROR', 'CRITICAL']).optional(),
}).strict();

export const BulkCreateRateCardsApiSchema = z.object({
  bulk: z.literal(true),
  items: z.array(CreateRateCardApiSchema).min(1).max(200),
}).strict();

// =========================================================================
// TOOL EXECUTION API SCHEMA (SECTION 43)
// =========================================================================

export const ExecuteToolApiSchema = z.object({
  tool_name: z.enum([
    'lookup_customer',
    'get_rate_quote',
    'get_tracking_status',
    'create_booking_request',
    'create_support_ticket',
    'transfer_to_human',
    'save_call_outcome',
    'send_followup',
  ]),
  arguments: z.record(z.string(), z.unknown()).default({}),
  call_id: z.string().max(128).optional(),
}).strict();

