/**
 * LOGIVOICE V1 — DOMAIN CONTRACTS & TYPE DEFINITIONS
 * Matching SSOT Table 7 and Knowledge Base 03_STRUCTURED_DATA_MODEL.txt
 */

export type CallIntent =
  | 'RATE_QUOTE'
  | 'TRACKING'
  | 'BOOKING'
  | 'SERVICE_AREA'
  | 'GENERAL'
  | 'COMPLAINT'
  | 'HUMAN_REQUEST'
  | 'EXISTING_CUSTOMER'
  | 'UNSUPPORTED_REQUEST';

export type CallOutcome =
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'TRANSFERRED'
  | 'CALLBACK_SCHEDULED'
  | 'MISSED'
  | 'FAILED'
  | 'ABANDONED';

export type LeadTemperature = 'HOT' | 'WARM' | 'COLD' | 'REVIEW';

export type RequestStatus =
  | 'PENDING'
  | 'CONFIRMED'
  | 'IN_REVIEW'
  | 'COMPLETED'
  | 'REJECTED'
  | 'FAILED';

export type RequestPriority = 'URGENT' | 'HIGH' | 'NORMAL' | 'LOW';

export type RequestType = 'BOOKING_REQUEST' | 'SUPPORT_TICKET' | 'CALLBACK_REQUEST' | 'RATE_REQUEST';

export type FollowupChannel = 'WHATSAPP' | 'SMS' | 'EMAIL';

export type FollowupStatus =
  | 'PENDING'
  | 'SENT'
  | 'DELIVERED'
  | 'FAILED'
  | 'SUPPRESSED'
  | 'UNCONFIGURED'
  | 'MOCK'
  | 'COMPLETED'
  | 'SKIPPED'
  | 'SKIPPED_NOT_ELIGIBLE'
  | 'UNKNOWN';

export type AuditSeverity = 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL';

export interface Customer {
  id: string;
  tenant_id: string;
  phone: string;
  phone_normalized?: string;
  name: string;
  company?: string;
  customer_type?: 'BROKER' | 'SHIPPER' | 'CONSIGNEE' | 'FLEET_OPERATOR';
  created_at: string;
  updated_at: string;
  last_seen_at?: string;
}

export type SideEffectStatus =
  | 'PENDING'
  | 'PROCESSING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'RETRYABLE'
  | 'UNKNOWN';

export interface SideEffectClaim {
  id: string;
  tenant_id: string;
  claim_key: string;
  job_type: string;
  call_id?: string;
  status: SideEffectStatus;
  attempt_count: number;
  max_attempts: number;
  payload?: Record<string, unknown>;
  result?: Record<string, unknown>;
  last_error?: string;
  claimed_at: string;
  claimed_by?: string;
  claim_token?: string;
  lease_expires_at?: string;
  next_retry_at?: string;
  completed_at?: string;
  last_reconciled_at?: string;
  reconciliation_attempts?: number;
  provider_reference?: string;
  reconciliation_result?: string | Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface CustomerSuppression {
  id: string;
  tenant_id: string;
  phone_normalized: string;
  channel: string;
  opt_out: boolean;
  reason?: string;
  source: string;
  created_at: string;
  updated_at: string;
}


export interface CallerCapturedFacts {
  route_from?: string;
  route_to?: string;
  weight?: string;
  quantity?: string;
  vehicle_type?: string;
  material_type?: string;
  pickup_date?: string;
  pickup_time?: string;
  special_requirements?: string;
}

export interface VerifiedOperationalFacts {
  quoted_amount?: number;
  quote_type?: 'ESTIMATE' | 'CONFIRMED';
  tracking_id?: string;
  tracking_status?: string;
  tracking_location?: string;
  verified_eta?: string;
  booking_reference?: string;
  transfer_status?: 'TRANSFERRED' | 'TRANSFER_UNAVAILABLE' | 'CALLBACK_SCHEDULED';
  provider_message_status?: string;
}

export interface CallFacts extends CallerCapturedFacts, VerifiedOperationalFacts {
  call_id: string;
}

export interface TranscriptTurn {
  speaker: 'agent' | 'caller';
  text: string;
  timestamp: string; // e.g. "00:04"
  language?: 'hi' | 'en' | 'hinglish';
}

export interface ToolExecutionEvent {
  id: string;
  call_id: string;
  tool_name: string;
  input_params: Record<string, unknown>;
  output_result: Record<string, unknown>;
  execution_status: 'SUCCESS' | 'FAILED' | 'TIMEOUT' | 'UNAVAILABLE';
  status?: string;
  latency_ms: number;
  timestamp: string;
}

export interface Call {
  id: string;
  external_call_id: string;
  tenant_id: string;
  customer_id?: string;
  customer?: Customer;
  started_at: string;
  ended_at?: string;
  duration_seconds: number;
  primary_intent: CallIntent;
  sentiment: 'POSITIVE' | 'NEUTRAL' | 'FRUSTRATED' | 'ANGRY';
  outcome: CallOutcome;
  lead_temperature: LeadTemperature;
  summary: string;
  facts: CallFacts;
  escalation_status?: {
    is_escalated: boolean;
    reason?: string;
    target_role?: string;
    target_phone?: string;
    handoff_successful?: boolean;
  };
  followup_state?: {
    eligible: boolean;
    channel?: FollowupChannel;
    status: FollowupStatus;
    message_snippet?: string;
    sent_at?: string;
    suppression_reason?: string;
  };
  transcript?: TranscriptTurn[];
  tool_events?: ToolExecutionEvent[];
  agent_version: string;
  recording_url?: string;
  intent_confidence?: number;
}

export interface OperationsRequest {
  id: string;
  reference_no: string;
  call_id?: string;
  tenant_id: string;
  customer_id?: string;
  customer_name: string;
  customer_phone: string;
  type: RequestType;
  status: RequestStatus;
  priority: RequestPriority;
  summary: string;
  details: Record<string, unknown>;
  payload?: Record<string, unknown>;
  notes?: string;
  resolution_notes?: string;
  assigned_to?: string;
  idempotency_key?: string;
  created_at: string;
  updated_at: string;
}

export interface Lead {
  id: string;
  tenant_id: string;
  call_id?: string;
  customer_id?: string;
  customer_name: string;
  phone: string;
  company?: string;
  source: string;
  status: 'NEW' | 'CONTACTED' | 'QUALIFIED' | 'CONVERTED' | 'LOST' | 'WON';
  temperature: LeadTemperature;
  route?: string;
  vehicle_type?: string;
  weight?: string;
  requirement: string;
  next_action: string;
  assigned_to?: string;
  last_call_at: string;
  followup_status: FollowupStatus;
  created_at: string;
  updated_at: string;
}

export interface FollowupRecord {
  id: string;
  tenant_id: string;
  call_id: string;
  customer_id?: string;
  channel: FollowupChannel;
  status: FollowupStatus;
  recipient: string;
  message_content?: string;
  template_id?: string;
  provider_message_id?: string;
  suppression_reason?: string;
  sent_at?: string;
  created_at: string;
  updated_at: string;
}

export interface RateCard {
  id: string;
  tenant_id: string;
  origin: string;
  destination: string;
  vehicle_type: string;
  weight_min_tons: number;
  weight_max_tons: number;
  price_inr: number;
  minimum_charge_inr?: number | null;
  effective_from: string;
  effective_to?: string;
  status: 'ACTIVE' | 'DRAFT' | 'EXPIRED';
  transit_time_hours?: number;
  surcharge_notes?: string;
  source_version: string;
  quote_type?: 'ESTIMATE' | 'CONFIRMED';
  supports_confirmed_quote?: boolean;
}

export interface KnowledgeItem {
  id: string;
  tenant_id: string;
  category:
    | 'RATE_POLICY'
    | 'TRACKING_POLICY'
    | 'SERVICE_AREA'
    | 'BOOKING_RULES'
    | 'OPERATIONAL_FAQ'
    | 'ESCALATION_RULES'
    | 'SERVICE_RULE'
    | 'SURCHARGE_POLICY'
    | 'COMMERCIAL_CLAUSE';
  title: string;
  content: string;
  status: 'APPROVED' | 'DRAFT' | 'UNDER_REVIEW' | 'ARCHIVED';
  last_updated: string;
  version: string;
  approved_by?: string;
  approved_at?: string;
  created_by?: string;
}

export interface AuditEvent {
  id: string;
  tenant_id: string;
  call_id?: string | null;
  external_call_id?: string | null;
  event_type: string;
  actor: string;
  actor_type?: 'AI_AGENT' | 'DISPATCHER' | 'ADMIN' | 'OPS_MANAGER' | 'SYSTEM' | 'WEBHOOK' | 'USER';
  actor_id?: string;
  severity: AuditSeverity;
  tool_name?: string;
  details: Record<string, unknown>;
  timestamp: string;
  created_at?: string;
}

export interface ToolExecution {
  id: string;
  tenant_id: string;
  call_id?: string | null;
  external_call_id?: string | null;
  tool_name: string;
  execution_status: string;
  business_status?: string | null;
  verified?: boolean;
  success: boolean;
  safe_result?: Record<string, unknown> | null;
  latency_ms?: number | null;
  provider_reference?: string | null;
  created_at: string;
}

export interface DispatcherKPIs {
  calls_today: number;
  calls_trend: string;
  missed_calls: number;
  escalated_calls: number;
  open_requests: number;
  hot_leads: number;
  warm_leads: number;
  avg_response_latency_ms: number | null;
  tool_success_rate_percent: number | null;
}
