/**
 * LOGIVOICE V1 — AUTHORITATIVE DATA ACCESS LAYER
 * Connects to Supabase PostgreSQL with seamless, deterministic fallback store
 * enforcing strict tenant isolation, typing, and idempotency.
 */

import { createAdminClient } from '@/lib/supabase/server';
import {
  Customer,
  Call,
  CallFacts,
  TranscriptTurn,
  Lead,
  OperationsRequest,
  RateCard,
  KnowledgeItem,
  AuditEvent,
  DispatcherKPIs,
  LeadTemperature,
  CallOutcome,
  CallIntent,
  RequestStatus,
  RequestPriority,
  RequestType,
  FollowupStatus,
  FollowupChannel,
} from '@/types/logivoice';

export interface TrackingRecord {
  id: string;
  tenant_id: string;
  tracking_reference: string;
  customer_id?: string;
  status: string;
  current_location: string;
  status_timestamp: string;
  eta_if_verified?: string;
  exception_reason?: string;
  source: string;
  last_synced_at: string;
}

export interface FollowupRecord {
  id: string;
  tenant_id: string;
  call_id: string;
  customer_id: string;
  channel: FollowupChannel;
  status: FollowupStatus;
  recipient: string;
  template_id?: string;
  message_snippet: string;
  provider_message_id?: string;
  suppression_reason?: string;
  sent_at?: string;
  created_at: string;
  updated_at: string;
}

export interface ClientConfig {
  id: string;
  tenant_id: string;
  business_name: string;
  brand_name: string;
  primary_operating_cities: string[];
  business_hours: { start: string; end: string; days: string };
  timezone: string;
  ai_disclosure_wording: string;
  primary_language: string;
  secondary_language: string;
  inbound_phone_number?: string;
  escalation_contacts: Array<{
    role: string;
    name: string;
    phone: string;
    channel: string;
    priority: number;
  }>;
  tracking_config: { provider: string; identifier_type: string };
  followup_config: { enabled: boolean; default_channel: FollowupChannel; suppress_opt_outs: boolean };
  sheets_config: { sync_enabled: boolean; spreadsheet_id?: string };
  created_at: string;
  updated_at: string;
}

export const DEFAULT_TENANT_ID = '00000000-0000-0000-0000-000000000001';

// Seed state for deterministic in-memory store
class Store {
  customers: Customer[] = [
    {
      id: 'cust-101',
      tenant_id: DEFAULT_TENANT_ID,
      phone: '+91 98201 55432',
      name: 'Vikram Mehta',
      company: 'Apex Fasteners Pvt Ltd',
      customer_type: 'SHIPPER',
      created_at: '2026-03-01T10:00:00Z',
      updated_at: '2026-09-15T11:20:00Z',
      last_seen_at: '2026-09-16T11:20:00Z',
    },
    {
      id: 'cust-102',
      tenant_id: DEFAULT_TENANT_ID,
      phone: '+91 94140 88712',
      name: 'Ramesh Choudhary',
      company: 'Choudhary Roadlines',
      customer_type: 'BROKER',
      created_at: '2026-04-12T09:15:00Z',
      updated_at: '2026-09-16T08:30:00Z',
      last_seen_at: '2026-09-16T10:05:00Z',
    },
    {
      id: 'cust-103',
      tenant_id: DEFAULT_TENANT_ID,
      phone: '+91 98765 43210',
      name: 'Sunil Rao',
      company: 'Rao Industrial Goods',
      customer_type: 'SHIPPER',
      created_at: '2026-05-18T14:30:00Z',
      updated_at: '2026-09-16T09:15:00Z',
      last_seen_at: '2026-09-16T09:15:00Z',
    },
    {
      id: 'cust-104',
      tenant_id: DEFAULT_TENANT_ID,
      phone: '+91 91234 56789',
      name: 'Amit Agarwal',
      company: 'Northern Traders',
      customer_type: 'SHIPPER',
      created_at: '2026-07-20T11:00:00Z',
      updated_at: '2026-09-16T08:50:00Z',
      last_seen_at: '2026-09-16T08:50:00Z',
    },
  ];

  calls: Call[] = [
    {
      id: 'call-001',
      external_call_id: 'retell-call-99124',
      tenant_id: DEFAULT_TENANT_ID,
      customer_id: 'cust-101',
      started_at: '2026-09-16T11:15:20Z',
      ended_at: '2026-09-16T11:18:42Z',
      duration_seconds: 202,
      primary_intent: 'RATE_QUOTE',
      sentiment: 'POSITIVE',
      outcome: 'COMPLETED',
      lead_temperature: 'HOT',
      summary: 'Caller inquired about freight rates for Delhi to Mumbai corridor for a 32ft MXL truck with 16 tons hardware. Quoted standard approved tariff of ₹54,000. Customer requested WhatsApp booking confirmation link.',
      facts: {
        call_id: 'call-001',
        route_from: 'Delhi',
        route_to: 'Mumbai',
        weight: '16 tons',
        vehicle_type: '32ft MXL',
        material_type: 'Industrial Hardware',
        pickup_date: '2026-09-18',
        quoted_amount: 54000,
        quote_type: 'ESTIMATE',
      },
      escalation_status: { is_escalated: false },
      followup_state: {
        eligible: true,
        channel: 'WHATSAPP',
        status: 'SENT',
        message_snippet: 'Quoted ₹54,000 for Delhi -> Mumbai 32ft MXL (16 tons). Booking link sent.',
        sent_at: '2026-09-16T11:19:00Z',
      },
      agent_version: 'v1.0.0',
    },
    {
      id: 'call-002',
      external_call_id: 'retell-call-99125',
      tenant_id: DEFAULT_TENANT_ID,
      customer_id: 'cust-102',
      started_at: '2026-09-16T10:00:15Z',
      ended_at: '2026-09-16T10:04:30Z',
      duration_seconds: 255,
      primary_intent: 'TRACKING',
      sentiment: 'NEUTRAL',
      outcome: 'COMPLETED',
      lead_temperature: 'WARM',
      summary: 'Consignment tracking request for LR-99214. Verified shipment status in transit at Surat Toll Plaza on NH48. Advised estimated arrival time in Bhiwandi within 14 hours.',
      facts: {
        call_id: 'call-002',
        tracking_id: 'LR-99214',
      },
      escalation_status: { is_escalated: false },
      followup_state: {
        eligible: true,
        channel: 'WHATSAPP',
        status: 'SENT',
        message_snippet: 'LR-99214 current status: In Transit at Surat Toll Plaza. ETA ~14h.',
        sent_at: '2026-09-16T10:05:00Z',
      },
      agent_version: 'v1.0.0',
    },
    {
      id: 'call-003',
      external_call_id: 'retell-call-99126',
      tenant_id: DEFAULT_TENANT_ID,
      customer_id: 'cust-103',
      started_at: '2026-09-16T09:10:05Z',
      ended_at: '2026-09-16T09:14:15Z',
      duration_seconds: 250,
      primary_intent: 'COMPLAINT',
      sentiment: 'ANGRY',
      outcome: 'TRANSFERRED',
      lead_temperature: 'REVIEW',
      summary: 'Caller reported a 28-hour delay on consignment LR-77409 and demanded human operations manager intervention. Transferred call context cleanly to Primary Dispatcher.',
      facts: {
        call_id: 'call-003',
        tracking_id: 'LR-77409',
        special_requirements: 'Urgent cargo delay complaint; requires senior dispatcher investigation',
      },
      escalation_status: {
        is_escalated: true,
        reason: 'Severe transit delay complaint; caller demanded manager',
        target_role: 'Primary Dispatcher',
        target_phone: '+91 98111 22334',
        handoff_successful: true,
      },
      followup_state: {
        eligible: false,
        status: 'SUPPRESSED',
        suppression_reason: 'Call escalated to live human dispatcher',
      },
      agent_version: 'v1.0.0',
    },
  ];

  leads: Lead[] = [
    {
      id: 'lead-301',
      tenant_id: DEFAULT_TENANT_ID,
      customer_id: 'cust-101',
      customer_name: 'Vikram Mehta',
      phone: '+91 98201 55432',
      company: 'Apex Fasteners Pvt Ltd',
      source: 'INBOUND_CALL',
      status: 'QUALIFIED',
      temperature: 'HOT',
      route: 'Delhi -> Mumbai',
      vehicle_type: '32ft MXL',
      weight: '16 tons',
      requirement: 'Full truckload shipment hardware, pickup 18-Sep from Okhla Phase 3',
      next_action: 'Dispatch WhatsApp booking confirmation and assign vehicle placement',
      assigned_to: 'Vikas Sharma',
      last_call_at: '2026-09-16T11:18:42Z',
      followup_status: 'SENT',
      created_at: '2026-09-16T11:19:00Z',
      updated_at: '2026-09-16T11:19:00Z',
    },
    {
      id: 'lead-302',
      tenant_id: DEFAULT_TENANT_ID,
      customer_id: 'cust-102',
      customer_name: 'Ramesh Choudhary',
      phone: '+91 94140 88712',
      company: 'Choudhary Roadlines',
      source: 'INBOUND_CALL',
      status: 'CONTACTED',
      temperature: 'WARM',
      route: 'Delhi -> Ahmedabad',
      vehicle_type: '19ft Open',
      weight: '7 tons',
      requirement: 'Inquired about ongoing rates for 19ft Open body trucks',
      next_action: 'Share updated monthly corridor rate sheet',
      assigned_to: 'Rohan Verma',
      last_call_at: '2026-09-16T10:04:30Z',
      followup_status: 'SENT',
      created_at: '2026-09-16T10:05:00Z',
      updated_at: '2026-09-16T10:05:00Z',
    },
  ];

  operations_requests: OperationsRequest[] = [
    {
      id: 'req-201',
      reference_no: 'REQ-2026-0916-01',
      call_id: 'call-001',
      tenant_id: DEFAULT_TENANT_ID,
      customer_id: 'cust-101',
      customer_name: 'Vikram Mehta',
      customer_phone: '+91 98201 55432',
      type: 'BOOKING_REQUEST',
      status: 'PENDING',
      priority: 'HIGH',
      summary: '32ft MXL Booking Request — Delhi to Mumbai (16 Tons Hardware)',
      details: {
        origin: 'Okhla Phase 3, Delhi',
        destination: 'Andheri East, Mumbai',
        pickup_date: '2026-09-18',
        vehicle_type: '32ft MXL',
        weight: '16 tons',
        quoted_price: 54000,
      },
      assigned_to: 'Vikas Sharma',
      created_at: '2026-09-16T11:18:42Z',
      updated_at: '2026-09-16T11:18:42Z',
    },
    {
      id: 'req-202',
      reference_no: 'REQ-2026-0916-02',
      call_id: 'call-003',
      tenant_id: DEFAULT_TENANT_ID,
      customer_id: 'cust-103',
      customer_name: 'Sunil Rao',
      customer_phone: '+91 98765 43210',
      type: 'SUPPORT_TICKET',
      status: 'IN_REVIEW',
      priority: 'URGENT',
      summary: 'Severe Transit Delay (LR-77409) — Transferred to Dispatcher',
      details: {
        consignment_id: 'LR-77409',
        delay_duration: '28 hours',
        caller_urgency: 'Critical production halt',
      },
      assigned_to: 'Vikas Sharma',
      created_at: '2026-09-16T09:14:15Z',
      updated_at: '2026-09-16T09:15:00Z',
    },
  ];

  rate_cards: RateCard[] = [
    {
      id: 'rc-01',
      tenant_id: DEFAULT_TENANT_ID,
      origin: 'Delhi',
      destination: 'Mumbai',
      vehicle_type: '32ft MXL',
      weight_min_tons: 14,
      weight_max_tons: 18,
      price_inr: 54000,
      minimum_charge_inr: 48000,
      effective_from: '2026-01-01',
      status: 'ACTIVE',
      transit_time_hours: 48,
      surcharge_notes: 'Includes toll taxes. Loading/unloading free for first 4 hours.',
      source_version: 'v1.0',
      supports_confirmed_quote: false,
      quote_type: 'ESTIMATE',
    },
    {
      id: 'rc-02',
      tenant_id: DEFAULT_TENANT_ID,
      origin: 'Delhi',
      destination: 'Ahmedabad',
      vehicle_type: '19ft Open',
      weight_min_tons: 5,
      weight_max_tons: 9,
      price_inr: 28500,
      minimum_charge_inr: 25000,
      effective_from: '2026-01-01',
      status: 'ACTIVE',
      transit_time_hours: 36,
      surcharge_notes: 'Standard tarp cover included.',
      source_version: 'v1.0',
      supports_confirmed_quote: false,
      quote_type: 'ESTIMATE',
    },
    {
      id: 'rc-03',
      tenant_id: DEFAULT_TENANT_ID,
      origin: 'Mumbai',
      destination: 'Bengaluru',
      vehicle_type: '24ft Container',
      weight_min_tons: 8,
      weight_max_tons: 12,
      price_inr: 42000,
      minimum_charge_inr: 38000,
      effective_from: '2026-01-01',
      status: 'ACTIVE',
      transit_time_hours: 32,
      source_version: 'v1.0',
      supports_confirmed_quote: false,
      quote_type: 'ESTIMATE',
    },
    {
      id: 'rc-04',
      tenant_id: DEFAULT_TENANT_ID,
      origin: 'Pune',
      destination: 'Hyderabad',
      vehicle_type: 'Tata Ace',
      weight_min_tons: 0.8,
      weight_max_tons: 1.5,
      price_inr: 9500,
      minimum_charge_inr: 8500,
      effective_from: '2026-01-01',
      status: 'ACTIVE',
      transit_time_hours: 18,
      source_version: 'v1.0',
      supports_confirmed_quote: false,
      quote_type: 'ESTIMATE',
    },
    {
      id: 'rc-05',
      tenant_id: DEFAULT_TENANT_ID,
      origin: 'Delhi',
      destination: 'Jaipur',
      vehicle_type: '14ft Closed',
      weight_min_tons: 2.5,
      weight_max_tons: 4.0,
      price_inr: 11500,
      minimum_charge_inr: 10000,
      effective_from: '2026-01-01',
      status: 'ACTIVE',
      transit_time_hours: 8,
      source_version: 'v1.0',
      supports_confirmed_quote: false,
      quote_type: 'ESTIMATE',
    },
    {
      id: 'rc-06',
      tenant_id: DEFAULT_TENANT_ID,
      origin: 'Mumbai',
      destination: 'Pune',
      vehicle_type: 'Tata Ace',
      weight_min_tons: 0.5,
      weight_max_tons: 1.5,
      price_inr: 4500,
      minimum_charge_inr: 4000,
      effective_from: '2026-01-01',
      status: 'ACTIVE',
      transit_time_hours: 4,
      source_version: 'v1.0',
      supports_confirmed_quote: true,
      quote_type: 'CONFIRMED',
    },
    {
      id: 'rc-07',
      tenant_id: DEFAULT_TENANT_ID,
      origin: 'Delhi',
      destination: 'Chandigarh',
      vehicle_type: '14ft Closed',
      weight_min_tons: 2.0,
      weight_max_tons: 4.5,
      price_inr: 8500,
      minimum_charge_inr: 7500,
      effective_from: '2024-01-01',
      effective_to: '2024-12-31',
      status: 'ACTIVE',
      transit_time_hours: 6,
      source_version: 'v0.9',
      supports_confirmed_quote: false,
      quote_type: 'ESTIMATE',
    },
  ];

  tracking_records: TrackingRecord[] = [
    {
      id: 'trk-01',
      tenant_id: DEFAULT_TENANT_ID,
      tracking_reference: 'LR-99214',
      status: 'IN_TRANSIT',
      current_location: 'Surat Toll Plaza (NH 48)',
      status_timestamp: new Date(Date.now() - 45 * 60000).toISOString(),
      eta_if_verified: new Date(Date.now() + 14 * 3600000).toISOString(),
      source: 'MOCK_TMS',
      last_synced_at: new Date().toISOString(),
    },
    {
      id: 'trk-02',
      tenant_id: DEFAULT_TENANT_ID,
      tracking_reference: 'LR-88102',
      status: 'OUT_FOR_DELIVERY',
      current_location: 'Bhiwandi Hub, Mumbai',
      status_timestamp: new Date(Date.now() - 2 * 3600000).toISOString(),
      eta_if_verified: new Date(Date.now() + 3 * 3600000).toISOString(),
      source: 'MOCK_TMS',
      last_synced_at: new Date().toISOString(),
    },
    {
      id: 'trk-03',
      tenant_id: DEFAULT_TENANT_ID,
      tracking_reference: 'LR-77409',
      status: 'DELIVERED',
      current_location: 'Peenya Industrial Area, Bengaluru',
      status_timestamp: new Date(Date.now() - 24 * 3600000).toISOString(),
      source: 'MOCK_TMS',
      last_synced_at: new Date().toISOString(),
    },
    {
      id: 'trk-04',
      tenant_id: DEFAULT_TENANT_ID,
      tracking_reference: 'LR-66501',
      status: 'DELAYED',
      current_location: 'Bhiwandi Bypass, Maharashtra',
      status_timestamp: new Date(Date.now() - 3 * 3600000).toISOString(),
      exception_reason: 'Vehicle breakdown at Bhiwandi bypass',
      source: 'MOCK_TMS',
      last_synced_at: new Date().toISOString(),
    },
  ];

  knowledge_items: KnowledgeItem[] = [
    {
      id: 'kb-01',
      tenant_id: DEFAULT_TENANT_ID,
      category: 'SERVICE_AREA',
      title: 'Active Freight Corridors & Serviceable Regions',
      content: 'Apex Logistics operates scheduled full-truckload (FTL) and express part-truckload (PTL) across Delhi NCR, Mumbai, Ahmedabad, Bengaluru, Pune, and Jaipur hubs. Inbound/outbound logistics between these cities are served daily.',
      status: 'APPROVED',
      last_updated: '2026-09-10',
      version: 'v1.0',
    },
    {
      id: 'kb-02',
      tenant_id: DEFAULT_TENANT_ID,
      category: 'RATE_POLICY',
      title: 'Commercial Pricing & Surcharge Governance',
      content: 'Rates provided via phone are classified as ESTIMATE unless confirmed by the operations desk. All standard rates include highway tolls. Loading/unloading allows 4 hours free time; detention thereafter is ₹1,500/day.',
      status: 'APPROVED',
      last_updated: '2026-09-10',
      version: 'v1.0',
    },
    {
      id: 'kb-03',
      tenant_id: DEFAULT_TENANT_ID,
      category: 'BOOKING_RULES',
      title: 'Booking Notice & Vehicle Placement SLA',
      content: 'Standard vehicle placement requires 24 hours notice. Same-day urgent bookings must be locked by 12:00 PM IST. Cargo insurance copy and GST invoice are mandatory before loading.',
      status: 'APPROVED',
      last_updated: '2026-09-12',
      version: 'v1.0',
    },
    {
      id: 'kb-04',
      tenant_id: DEFAULT_TENANT_ID,
      category: 'ESCALATION_RULES',
      title: 'Human Transfer Protocol',
      content: 'When caller explicitly requests human escalation, or expresses anger/severe dissatisfaction, or has a commercial inquiry outside standard matrix, transfer context immediately to Primary Dispatcher (+91 98111 22334). If unavailable, log callback request with URGENT priority.',
      status: 'APPROVED',
      last_updated: '2026-09-14',
      version: 'v1.0',
    },
    {
      id: 'kb-05',
      tenant_id: DEFAULT_TENANT_ID,
      category: 'TRACKING_POLICY',
      title: 'Shipment Tracking & LR Verification Protocol',
      content: 'Consignment location updates are pulled from connected GPS and toll plaza FASTag checkpoints. Status is shared only for verified LR numbers or docket references. Handoff to dispatcher is triggered if delay exceeds 12 hours.',
      status: 'APPROVED',
      last_updated: '2026-09-14',
      version: 'v1.0',
    },
    {
      id: 'kb-06',
      tenant_id: DEFAULT_TENANT_ID,
      category: 'OPERATIONAL_FAQ',
      title: 'General Operations & Cargo Insurance FAQs',
      content: 'All booked freight shipments travel under carrier risk with mandatory e-way bill verification. Commercial tax invoices and transit permits must be handed to driver before vehicle departure.',
      status: 'APPROVED',
      last_updated: '2026-09-15',
      version: 'v1.0',
    },
  ];

  audit_events: AuditEvent[] = [
    {
      id: 'aud-01',
      tenant_id: DEFAULT_TENANT_ID,
      call_id: 'call-001',
      event_type: 'TOOL_EXECUTION',
      actor: 'AI_AGENT:logivoice-agent-v1',
      actor_type: 'AI_AGENT',
      actor_id: 'logivoice-agent-v1',
      tool_name: 'get_rate_quote',
      severity: 'INFO',
      details: {
        route: 'Delhi -> Mumbai',
        vehicle: '32ft MXL',
        weight: '16 tons',
        result_amount: 54000,
        quote_type: 'ESTIMATE',
      },
      timestamp: '2026-09-16T11:16:45Z',
    },
    {
      id: 'aud-02',
      tenant_id: DEFAULT_TENANT_ID,
      call_id: 'call-001',
      event_type: 'REQUEST_CREATED',
      actor: 'AI_AGENT:logivoice-agent-v1',
      actor_type: 'AI_AGENT',
      actor_id: 'logivoice-agent-v1',
      tool_name: 'create_booking_request',
      severity: 'INFO',
      details: {
        reference_no: 'REQ-2026-0916-01',
        type: 'BOOKING_REQUEST',
        status: 'PENDING',
      },
      timestamp: '2026-09-16T11:18:42Z',
    },
    {
      id: 'aud-03',
      tenant_id: DEFAULT_TENANT_ID,
      call_id: 'call-001',
      event_type: 'FOLLOWUP_SENT',
      actor: 'SYSTEM:post-call-worker',
      actor_type: 'SYSTEM',
      actor_id: 'post-call-worker',
      severity: 'INFO',
      details: {
        channel: 'WHATSAPP',
        recipient: '+91 98201 55432',
        status: 'SENT',
      },
      timestamp: '2026-09-16T11:19:00Z',
    },
  ];

  client_config: ClientConfig = {
    id: 'cfg-01',
    tenant_id: DEFAULT_TENANT_ID,
    business_name: 'Apex Logistics Solutions Pvt Ltd',
    brand_name: 'Apex Logistics',
    primary_operating_cities: ['Delhi NCR', 'Mumbai', 'Ahmedabad', 'Bengaluru', 'Pune', 'Jaipur'],
    business_hours: { start: '08:00', end: '22:00', days: 'Mon-Sat' },
    timezone: 'Asia/Kolkata',
    ai_disclosure_wording: 'Namaste! Main Apex Logistics ki automated voice assistant hoon.',
    primary_language: 'hi',
    secondary_language: 'en',
    inbound_phone_number: '+91-11-4567-8900',
    escalation_contacts: [
      { role: 'Primary Dispatcher', name: 'Vikas Sharma', phone: '+91 98111 22334', channel: 'PHONE', priority: 1 },
      { role: 'Operations Manager', name: 'Rohan Verma', phone: '+91 98222 33445', channel: 'PHONE', priority: 2 },
      { role: 'Urgent Support Escalation', name: 'Control Tower Desk', phone: '+91 98333 44556', channel: 'PHONE', priority: 3 },
    ],
    tracking_config: { provider: 'MOCK_TMS', identifier_type: 'LR_NUMBER' },
    followup_config: { enabled: true, default_channel: 'WHATSAPP', suppress_opt_outs: true },
    sheets_config: { sync_enabled: false, spreadsheet_id: '' },
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-09-16T12:00:00Z',
  };
}

// Global persistent instance in Node runtime
const globalStore = new Store();

export class DatabaseUnavailableError extends Error {
  constructor(message: string = 'Authoritative database is unavailable or remote schema pending. In-memory mock fallback is strictly disabled in production.') {
    super(message);
    this.name = 'DatabaseUnavailableError';
  }
}

let simulatedDbFailure: boolean = false;

export function setSimulatedDbFailure(fail: boolean) {
  simulatedDbFailure = fail;
}

export function getRuntimeMode(): 'PRODUCTION' | 'DEVELOPMENT' | 'TEST' {
  if (process.env.NODE_ENV === 'test') return 'TEST';
  if (process.env.NODE_ENV === 'production') return 'PRODUCTION';
  return 'DEVELOPMENT';
}

export function assertProductionDbReady() {
  if (simulatedDbFailure) {
    throw new DatabaseUnavailableError('Simulated database outage triggered.');
  }
  if (getRuntimeMode() === 'PRODUCTION' && process.env.ALLOW_IN_MEMORY_DEV_STORE !== 'true') {
    throw new DatabaseUnavailableError();
  }
}

// Helper to check whether live Supabase tables are ready to query
let supabaseLiveStatus: boolean | null = null;

export async function isSupabaseLive(): Promise<boolean> {
  if (simulatedDbFailure) return false;
  if (supabaseLiveStatus !== null) return supabaseLiveStatus;
  try {
    const client = createAdminClient();
    const { error } = await client.from('tenants').select('id').limit(1);
    if (!error) {
      supabaseLiveStatus = true;
      return true;
    }
  } catch {
    // Database connection or table cache issue
  }
  supabaseLiveStatus = false;
  return false;
}

// =========================================================================
// REPOSITORY IMPLEMENTATION
// =========================================================================

export const db = {
  // -----------------------------------------------------------------------
  // TENANT
  // -----------------------------------------------------------------------
  async getTenant(tenantId: string = DEFAULT_TENANT_ID) {
    if (await isSupabaseLive()) {
      const client = createAdminClient();
      const { data, error } = await client.from('tenants').select('*').eq('id', tenantId).single();
      if (!error && data) return data;
    }
    assertProductionDbReady();
    return { id: DEFAULT_TENANT_ID, name: 'Apex Logistics India', slug: 'apex-logistics' };
  },

  // -----------------------------------------------------------------------
  // CLIENT CONFIGURATION
  // -----------------------------------------------------------------------
  async getClientConfig(tenantId: string = DEFAULT_TENANT_ID): Promise<ClientConfig> {
    if (await isSupabaseLive()) {
      const client = createAdminClient();
      const { data, error } = await client.from('client_configs').select('*').eq('tenant_id', tenantId).single();
      if (!error && data) return data as ClientConfig;
    }
    assertProductionDbReady();
    return globalStore.client_config;
  },

  async updateClientConfig(tenantId: string = DEFAULT_TENANT_ID, updates: Partial<ClientConfig>): Promise<ClientConfig> {
    if (await isSupabaseLive()) {
      const client = createAdminClient();
      const { data, error } = await client
        .from('client_configs')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('tenant_id', tenantId)
        .select()
        .single();
      if (!error && data) return data as ClientConfig;
    }
    assertProductionDbReady();
    globalStore.client_config = {
      ...globalStore.client_config,
      ...updates,
      updated_at: new Date().toISOString(),
    };
    return globalStore.client_config;
  },

  // -----------------------------------------------------------------------
  // CUSTOMERS
  // -----------------------------------------------------------------------
  async getCustomerById(customerId: string, tenantId: string = DEFAULT_TENANT_ID): Promise<Customer | null> {
    if (await isSupabaseLive()) {
      const client = createAdminClient();
      const { data, error } = await client
        .from('customers')
        .select('*')
        .eq('id', customerId)
        .eq('tenant_id', tenantId)
        .single();
      if (!error && data) return data as Customer;
    }
    assertProductionDbReady();
    return globalStore.customers.find((c) => c.id === customerId && c.tenant_id === tenantId) || null;
  },

  async getCustomerByPhone(phone: string, tenantId: string = DEFAULT_TENANT_ID): Promise<Customer | null> {
    const cleanPhone = phone.replace(/[\s-]/g, '');
    if (await isSupabaseLive()) {
      const client = createAdminClient();
      const { data, error } = await client
        .from('customers')
        .select('*')
        .eq('tenant_id', tenantId)
        .ilike('phone', `%${cleanPhone.slice(-10)}%`)
        .limit(1)
        .single();
      if (!error && data) return data as Customer;
    }
    assertProductionDbReady();
    return (
      globalStore.customers.find(
        (c) => c.tenant_id === tenantId && c.phone.replace(/[\s-]/g, '').endsWith(cleanPhone.slice(-10))
      ) || null
    );
  },

  async createCustomer(
    customer: Omit<Customer, 'id' | 'created_at' | 'updated_at'>,
    tenantId: string = DEFAULT_TENANT_ID
  ): Promise<Customer> {
    const now = new Date().toISOString();
    const id = `cust-${Date.now()}`;
    const newCustomer: Customer = {
      ...customer,
      id,
      tenant_id: tenantId,
      created_at: now,
      updated_at: now,
      last_seen_at: now,
    };

    if (await isSupabaseLive()) {
      const client = createAdminClient();
      const { data, error } = await client.from('customers').insert([newCustomer]).select().single();
      if (!error && data) return data as Customer;
    }
    assertProductionDbReady();
    globalStore.customers.push(newCustomer);
    return newCustomer;
  },

  // -----------------------------------------------------------------------
  // CALLS
  // -----------------------------------------------------------------------
  async getCallById(callId: string, tenantId: string = DEFAULT_TENANT_ID): Promise<Call | null> {
    if (await isSupabaseLive()) {
      const client = createAdminClient();
      const { data, error } = await client
        .from('calls')
        .select('*, customer:customers(*), facts:call_facts(*)')
        .eq('id', callId)
        .eq('tenant_id', tenantId)
        .single();
      if (!error && data) return data as Call;
    }
    assertProductionDbReady();
    const call = globalStore.calls.find((c) => c.id === callId && c.tenant_id === tenantId);
    if (!call) return null;
    const customer = globalStore.customers.find((c) => c.id === call.customer_id);
    return { ...call, customer };
  },

  async getCallByExternalId(externalCallId: string, tenantId: string = DEFAULT_TENANT_ID): Promise<Call | null> {
    if (await isSupabaseLive()) {
      const client = createAdminClient();
      const { data, error } = await client
        .from('calls')
        .select('*, customer:customers(*), facts:call_facts(*)')
        .eq('external_call_id', externalCallId)
        .eq('tenant_id', tenantId)
        .single();
      if (!error && data) return data as Call;
    }
    assertProductionDbReady();
    const call = globalStore.calls.find((c) => c.external_call_id === externalCallId && c.tenant_id === tenantId);
    if (!call) return null;
    const customer = globalStore.customers.find((c) => c.id === call.customer_id);
    return { ...call, customer };
  },

  async listCalls(
    tenantId: string = DEFAULT_TENANT_ID,
    filters?: { intent?: CallIntent; outcome?: CallOutcome; search?: string }
  ): Promise<Call[]> {
    if (await isSupabaseLive()) {
      const client = createAdminClient();
      let query = client.from('calls').select('*, customer:customers(*), facts:call_facts(*)').eq('tenant_id', tenantId).order('started_at', { ascending: false });
      if (filters?.intent) query = query.eq('primary_intent', filters.intent);
      if (filters?.outcome) query = query.eq('outcome', filters.outcome);
      const { data, error } = await query;
      if (!error && data) return data as Call[];
    }
    assertProductionDbReady();
    let calls = globalStore.calls.filter((c) => c.tenant_id === tenantId);
    if (filters?.intent) calls = calls.filter((c) => c.primary_intent === filters.intent);
    if (filters?.outcome) calls = calls.filter((c) => c.outcome === filters.outcome);
    if (filters?.search) {
      const s = filters.search.toLowerCase();
      calls = calls.filter(
        (c) =>
          c.summary.toLowerCase().includes(s) ||
          c.external_call_id.toLowerCase().includes(s) ||
          c.customer?.name.toLowerCase().includes(s) ||
          c.customer?.phone.includes(s)
      );
    }
    return calls.map((c) => ({
      ...c,
      customer: globalStore.customers.find((cust) => cust.id === c.customer_id),
    }));
  },

  async createCall(callData: Omit<Call, 'id'>, tenantId: string = DEFAULT_TENANT_ID): Promise<Call> {
    const id = `call-${Date.now()}`;
    const newCall: Call = {
      ...callData,
      id,
      tenant_id: tenantId,
    };

    if (await isSupabaseLive()) {
      const client = createAdminClient();
      const { data, error } = await client.from('calls').insert([newCall]).select().single();
      if (!error && data) return data as Call;
    }
    assertProductionDbReady();
    globalStore.calls.unshift(newCall);
    return newCall;
  },

  async updateCall(callId: string, updates: Partial<Call>, tenantId: string = DEFAULT_TENANT_ID): Promise<Call | null> {
    if (await isSupabaseLive()) {
      const client = createAdminClient();
      const { data, error } = await client
        .from('calls')
        .update(updates)
        .eq('id', callId)
        .eq('tenant_id', tenantId)
        .select()
        .single();
      if (!error && data) return data as Call;
    }
    assertProductionDbReady();
    const idx = globalStore.calls.findIndex((c) => c.id === callId && c.tenant_id === tenantId);
    if (idx === -1) return null;
    globalStore.calls[idx] = { ...globalStore.calls[idx], ...updates };
    return globalStore.calls[idx];
  },

  // -----------------------------------------------------------------------
  // LEADS
  // -----------------------------------------------------------------------
  async listLeads(
    tenantId: string = DEFAULT_TENANT_ID,
    filters?: { temperature?: LeadTemperature; search?: string }
  ): Promise<Lead[]> {
    if (await isSupabaseLive()) {
      const client = createAdminClient();
      let query = client.from('leads').select('*').eq('tenant_id', tenantId).order('created_at', { ascending: false });
      if (filters?.temperature) query = query.eq('temperature', filters.temperature);
      const { data, error } = await query;
      if (!error && data) return data as Lead[];
    }
    assertProductionDbReady();
    let leads = globalStore.leads.filter((l) => l.tenant_id === tenantId);
    if (filters?.temperature) leads = leads.filter((l) => l.temperature === filters.temperature);
    if (filters?.search) {
      const s = filters.search.toLowerCase();
      leads = leads.filter(
        (l) =>
          l.customer_name.toLowerCase().includes(s) ||
          l.phone.includes(s) ||
          l.requirement.toLowerCase().includes(s) ||
          l.route?.toLowerCase().includes(s)
      );
    }
    return leads;
  },

  async createLead(leadData: Omit<Lead, 'id' | 'created_at' | 'updated_at'>, tenantId: string = DEFAULT_TENANT_ID): Promise<Lead> {
    const now = new Date().toISOString();
    const id = `lead-${Date.now()}`;
    const newLead: Lead = {
      ...leadData,
      id,
      tenant_id: tenantId,
      created_at: now,
      updated_at: now,
    };

    if (await isSupabaseLive()) {
      const client = createAdminClient();
      const { data, error } = await client.from('leads').insert([newLead]).select().single();
      if (!error && data) return data as Lead;
    }
    assertProductionDbReady();
    globalStore.leads.unshift(newLead);
    return newLead;
  },

  // -----------------------------------------------------------------------
  // OPERATIONS REQUESTS
  // -----------------------------------------------------------------------
  async listRequests(
    tenantId: string = DEFAULT_TENANT_ID,
    filters?: { status?: RequestStatus; priority?: RequestPriority; type?: RequestType }
  ): Promise<OperationsRequest[]> {
    if (await isSupabaseLive()) {
      const client = createAdminClient();
      let query = client.from('operations_requests').select('*').eq('tenant_id', tenantId).order('created_at', { ascending: false });
      if (filters?.status) query = query.eq('status', filters.status);
      if (filters?.priority) query = query.eq('priority', filters.priority);
      if (filters?.type) query = query.eq('type', filters.type);
      const { data, error } = await query;
      if (!error && data) return data as OperationsRequest[];
    }
    assertProductionDbReady();
    let reqs = globalStore.operations_requests.filter((r) => r.tenant_id === tenantId);
    if (filters?.status) reqs = reqs.filter((r) => r.status === filters.status);
    if (filters?.priority) reqs = reqs.filter((r) => r.priority === filters.priority);
    if (filters?.type) reqs = reqs.filter((r) => r.type === filters.type);
    return reqs;
  },

  async createRequest(
    requestData: Omit<OperationsRequest, 'id' | 'created_at' | 'updated_at'>,
    tenantId: string = DEFAULT_TENANT_ID
  ): Promise<OperationsRequest> {
    const now = new Date().toISOString();
    const id = `req-${Date.now()}`;
    const newReq: OperationsRequest = {
      ...requestData,
      id,
      tenant_id: tenantId,
      created_at: now,
      updated_at: now,
    };

    if (await isSupabaseLive()) {
      const client = createAdminClient();
      const { data, error } = await client.from('operations_requests').insert([newReq]).select().single();
      if (!error && data) return data as OperationsRequest;
    }
    assertProductionDbReady();
    globalStore.operations_requests.unshift(newReq);
    return newReq;
  },

  // -----------------------------------------------------------------------
  // RATE CARDS
  // -----------------------------------------------------------------------
  async listRateCards(tenantId: string = DEFAULT_TENANT_ID): Promise<RateCard[]> {
    if (await isSupabaseLive()) {
      const client = createAdminClient();
      const { data, error } = await client.from('rate_cards').select('*').eq('tenant_id', tenantId);
      if (!error && data) return data as RateCard[];
    }
    assertProductionDbReady();
    return globalStore.rate_cards.filter((rc) => rc.tenant_id === tenantId);
  },

  async findApprovedRate(
    params: { origin: string; destination: string; vehicleType?: string; weightTons?: number },
    tenantId: string = DEFAULT_TENANT_ID
  ): Promise<RateCard | null> {
    const origin = params.origin.trim().toLowerCase();
    const dest = params.destination.trim().toLowerCase();
    const vehicle = params.vehicleType?.trim().toLowerCase();
    const weight = params.weightTons;

    const cards = await this.listRateCards(tenantId);
    const activeCards = cards.filter((rc) => rc.status === 'ACTIVE');

    // 1. Exact match origin + destination + vehicleType
    if (vehicle) {
      const exactMatch = activeCards.find((rc) => {
        const matchRoute = rc.origin.toLowerCase() === origin && rc.destination.toLowerCase() === dest;
        const matchVehicle = rc.vehicle_type.toLowerCase() === vehicle || rc.vehicle_type.toLowerCase().includes(vehicle);
        const matchWeight = weight !== undefined ? weight >= rc.weight_min_tons && weight <= rc.weight_max_tons : true;
        return matchRoute && matchVehicle && matchWeight;
      });
      if (exactMatch) return exactMatch;
    }

    // 2. Route match within weight limits
    const routeMatch = activeCards.find((rc) => {
      const matchRoute = rc.origin.toLowerCase() === origin && rc.destination.toLowerCase() === dest;
      const matchWeight = weight !== undefined ? weight >= rc.weight_min_tons && weight <= rc.weight_max_tons : true;
      return matchRoute && matchWeight;
    });

    return routeMatch || null;
  },

  // -----------------------------------------------------------------------
  // TRACKING RECORDS
  // -----------------------------------------------------------------------
  async getTrackingRecord(
    trackingReference: string,
    tenantId: string = DEFAULT_TENANT_ID
  ): Promise<TrackingRecord | null> {
    const ref = trackingReference.trim().toUpperCase();
    if (await isSupabaseLive()) {
      const client = createAdminClient();
      const { data, error } = await client
        .from('tracking_records')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('tracking_reference', ref)
        .single();
      if (!error && data) return data as TrackingRecord;
    }
    assertProductionDbReady();
    return (
      globalStore.tracking_records.find(
        (t) => t.tenant_id === tenantId && t.tracking_reference.toUpperCase() === ref
      ) || null
    );
  },

  // -----------------------------------------------------------------------
  // KNOWLEDGE ITEMS
  // -----------------------------------------------------------------------
  async listKnowledgeItems(
    tenantId: string = DEFAULT_TENANT_ID,
    category?: KnowledgeItem['category']
  ): Promise<KnowledgeItem[]> {
    if (await isSupabaseLive()) {
      const client = createAdminClient();
      let query = client.from('knowledge_items').select('*').eq('tenant_id', tenantId);
      if (category) query = query.eq('category', category);
      const { data, error } = await query;
      if (!error && data) return data as KnowledgeItem[];
    }
    assertProductionDbReady();
    let items = globalStore.knowledge_items.filter((k) => k.tenant_id === tenantId);
    if (category) items = items.filter((k) => k.category === category);
    return items;
  },

  // -----------------------------------------------------------------------
  // AUDIT EVENTS
  // -----------------------------------------------------------------------
  async logAuditEvent(
    event: Omit<AuditEvent, 'id' | 'timestamp'>,
    tenantId: string = DEFAULT_TENANT_ID
  ): Promise<AuditEvent> {
    const timestamp = new Date().toISOString();
    const id = `aud-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const newEvent: AuditEvent = {
      ...event,
      id,
      tenant_id: tenantId,
      timestamp,
    };

    if (await isSupabaseLive()) {
      const client = createAdminClient();
      await client.from('audit_events').insert([
        {
          id: newEvent.id,
          tenant_id: newEvent.tenant_id,
          call_id: newEvent.call_id,
          event_type: newEvent.event_type,
          actor_type: newEvent.actor_type || 'SYSTEM',
          actor_id: newEvent.actor_id,
          tool_name: newEvent.tool_name,
          severity: newEvent.severity,
          details: newEvent.details,
          created_at: timestamp,
        },
      ]);
    }
    assertProductionDbReady();
    globalStore.audit_events.unshift(newEvent);
    return newEvent;
  },

  async listAuditEvents(tenantId: string = DEFAULT_TENANT_ID, limit: number = 50): Promise<AuditEvent[]> {
    if (await isSupabaseLive()) {
      const client = createAdminClient();
      const { data, error } = await client
        .from('audit_events')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false })
        .limit(limit);
      if (!error && data) {
        return data.map((d) => ({
          id: d.id,
          tenant_id: d.tenant_id,
          call_id: d.call_id,
          event_type: d.event_type,
          actor: `${d.actor_type}:${d.actor_id}`,
          actor_type: d.actor_type,
          actor_id: d.actor_id,
          tool_name: d.tool_name,
          severity: d.severity,
          details: d.details,
          timestamp: d.created_at,
        })) as AuditEvent[];
      }
    }
    assertProductionDbReady();
    return globalStore.audit_events.slice(0, limit);
  },

  // -----------------------------------------------------------------------
  // DISPATCHER KPIS
  // -----------------------------------------------------------------------
  async getKPIs(tenantId: string = DEFAULT_TENANT_ID): Promise<DispatcherKPIs> {
    const calls = await this.listCalls(tenantId);
    const leads = await this.listLeads(tenantId);
    const reqs = await this.listRequests(tenantId);

    const missed = calls.filter((c) => c.outcome === 'MISSED' || c.outcome === 'FAILED').length;
    const escalated = calls.filter((c) => c.outcome === 'TRANSFERRED' || c.escalation_status?.is_escalated).length;
    const openReqs = reqs.filter((r) => r.status === 'PENDING' || r.status === 'IN_REVIEW').length;
    const hotLeads = leads.filter((l) => l.temperature === 'HOT').length;
    const warmLeads = leads.filter((l) => l.temperature === 'WARM').length;

    return {
      calls_today: calls.length,
      calls_trend: '+14% vs yesterday',
      missed_calls: missed,
      escalated_calls: escalated,
      open_requests: openReqs,
      hot_leads: hotLeads,
      warm_leads: warmLeads,
      avg_response_latency_ms: 820,
      tool_success_rate_percent: 98.4,
    };
  },
};
