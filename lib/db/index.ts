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
  FollowupRecord,
} from '@/types/logivoice';
import {
  domainCallToDbRow,
  dbCallToDomain,
  domainLeadToDbRow,
  dbLeadToDomain,
  domainRequestToDbRow,
  dbRequestToDomain,
  domainKnowledgeToDbRow,
  dbKnowledgeToDomain,
  domainCustomerToDbRow,
  dbCustomerToDomain,
  domainFollowupToDbRow,
  dbFollowupToDomain,
  domainAuditToDbRow,
  CallsDbRow,
  CallFactsDbRow,
  LeadsDbRow,
  OperationsRequestsDbRow,
  KnowledgeItemsDbRow,
  FollowupsDbRow,
  CustomersDbRow,
  AuditEventsDbRow,
} from './mappers';

export {
  domainCallToDbRow,
  dbCallToDomain,
  domainLeadToDbRow,
  dbLeadToDomain,
  domainRequestToDbRow,
  dbRequestToDomain,
  domainKnowledgeToDbRow,
  dbKnowledgeToDomain,
  domainCustomerToDbRow,
  dbCustomerToDomain,
  domainFollowupToDbRow,
  dbFollowupToDomain,
  domainAuditToDbRow,
};
export type {
  CallsDbRow,
  CallFactsDbRow,
  LeadsDbRow,
  OperationsRequestsDbRow,
  KnowledgeItemsDbRow,
  FollowupsDbRow,
  CustomersDbRow,
  AuditEventsDbRow,
};

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

export interface ClientConfig {
  id: string;
  tenant_id: string;
  business_name: string;
  brand_name: string;
  business_type?: string;
  primary_operating_cities: string[];
  business_hours: { start: string; end: string; days: string };
  timezone: string;
  ai_disclosure_wording: string;
  primary_language: string;
  secondary_language: string;
  inbound_phone_number?: string;
  booking_url?: string;
  voice_persona?: string;
  barge_in_enabled?: boolean;
  allow_language_switching?: boolean;
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
    {
      id: 'trk-05',
      tenant_id: DEFAULT_TENANT_ID,
      tracking_reference: 'LR-88291',
      status: 'IN_TRANSIT',
      current_location: 'Kotputli Toll Plaza (NH 48)',
      status_timestamp: new Date(Date.now() - 30 * 60000).toISOString(),
      eta_if_verified: new Date(Date.now() + 4 * 3600000).toISOString(),
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
    business_type: '3PL & Full Truckload (FTL) Fleet Operator',
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

  followups: FollowupRecord[] = [];
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
  if (getRuntimeMode() === 'PRODUCTION') {
    throw new DatabaseUnavailableError();
  }
}

// Helper to check whether live Supabase tables are ready to query
let supabaseLiveStatus: boolean | null = null;
let lastSupabaseCheckTime: number = 0;
const SUPABASE_CHECK_TTL_MS = 15000; // 15 seconds cache to allow recovery detection

export async function isSupabaseLive(): Promise<boolean> {
  if (simulatedDbFailure) return false;
  const now = Date.now();
  if (supabaseLiveStatus !== null && now - lastSupabaseCheckTime < SUPABASE_CHECK_TTL_MS) {
    return supabaseLiveStatus;
  }
  try {
    const client = createAdminClient();
    const { error } = await client.from('tenants').select('id').limit(1);
    lastSupabaseCheckTime = now;
    if (!error) {
      supabaseLiveStatus = true;
      return true;
    }
  } catch {
    // Database connection or table cache issue
  }
  lastSupabaseCheckTime = now;
  supabaseLiveStatus = false;
  return false;
}

// Cross-tenant relationship validation helper
async function validateTenantEntityOwnership(
  entity: 'customer' | 'call',
  entityId: string | undefined | null,
  tenantId: string
): Promise<void> {
  if (!entityId || entityId.startsWith('cust-unknown') || entityId.startsWith('call-unknown')) return;
  if (entity === 'customer') {
    const cust = await db.getCustomerById(entityId, tenantId);
    if (!cust && getRuntimeMode() === 'PRODUCTION') {
      throw new Error(`Tenant isolation violation: Customer '${entityId}' not found or does not belong to tenant '${tenantId}'.`);
    }
  } else if (entity === 'call') {
    const call = await db.getCallById(entityId, tenantId);
    if (!call && getRuntimeMode() === 'PRODUCTION') {
      throw new Error(`Tenant isolation violation: Call '${entityId}' not found or does not belong to tenant '${tenantId}'.`);
    }
  }
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
    const sanitizedUpdates: Partial<ClientConfig> = {};
    if (updates.brand_name !== undefined) sanitizedUpdates.brand_name = updates.brand_name;
    if (updates.business_name !== undefined) sanitizedUpdates.business_name = updates.business_name;
    if (updates.business_type !== undefined) sanitizedUpdates.business_type = updates.business_type;
    if ((updates as any).legal_business_name !== undefined) sanitizedUpdates.business_name = (updates as any).legal_business_name;
    if (updates.primary_operating_cities !== undefined) sanitizedUpdates.primary_operating_cities = updates.primary_operating_cities;
    if ((updates as any).operating_cities !== undefined) sanitizedUpdates.primary_operating_cities = (updates as any).operating_cities;
    if (updates.business_hours !== undefined) sanitizedUpdates.business_hours = updates.business_hours;
    if (updates.timezone !== undefined) sanitizedUpdates.timezone = updates.timezone;
    if (updates.ai_disclosure_wording !== undefined) sanitizedUpdates.ai_disclosure_wording = updates.ai_disclosure_wording;
    if ((updates as any).call_recording_disclosure !== undefined) sanitizedUpdates.ai_disclosure_wording = (updates as any).call_recording_disclosure;
    if (updates.primary_language !== undefined) sanitizedUpdates.primary_language = updates.primary_language;
    if (updates.secondary_language !== undefined) sanitizedUpdates.secondary_language = updates.secondary_language;
    if (updates.escalation_contacts !== undefined) sanitizedUpdates.escalation_contacts = updates.escalation_contacts;
    if (updates.inbound_phone_number !== undefined) sanitizedUpdates.inbound_phone_number = updates.inbound_phone_number;
    if (updates.booking_url !== undefined) sanitizedUpdates.booking_url = updates.booking_url;
    if ((updates as any).booking_link_base_url !== undefined) sanitizedUpdates.booking_url = (updates as any).booking_link_base_url;
    if (updates.tracking_config !== undefined) sanitizedUpdates.tracking_config = updates.tracking_config;
    if (updates.followup_config !== undefined) sanitizedUpdates.followup_config = updates.followup_config;
    if (updates.sheets_config !== undefined) sanitizedUpdates.sheets_config = updates.sheets_config;
    if (updates.voice_persona !== undefined) sanitizedUpdates.voice_persona = updates.voice_persona;
    if (updates.barge_in_enabled !== undefined) sanitizedUpdates.barge_in_enabled = updates.barge_in_enabled;
    if (updates.allow_language_switching !== undefined) sanitizedUpdates.allow_language_switching = updates.allow_language_switching;

    const now = new Date().toISOString();
    if (await isSupabaseLive()) {
      const client = createAdminClient();
      const { data, error } = await client
        .from('client_configs')
        .update({ ...sanitizedUpdates, updated_at: now })
        .eq('tenant_id', tenantId)
        .select()
        .single();
      if (!error && data) return data as ClientConfig;
    }
    assertProductionDbReady();
    globalStore.client_config = {
      ...globalStore.client_config,
      ...sanitizedUpdates,
      updated_at: now,
    };
    return globalStore.client_config;
  },

  async getSettings(tenantId: string = DEFAULT_TENANT_ID): Promise<ClientConfig> {
    return this.getClientConfig(tenantId);
  },

  async updateSettings(tenantId: string = DEFAULT_TENANT_ID, updates: Partial<ClientConfig>): Promise<ClientConfig> {
    return this.updateClientConfig(tenantId, updates);
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
    const rawClean = phone.replace(/[\s-]/g, '');
    const normalized = rawClean.startsWith('+')
      ? rawClean
      : rawClean.length === 10
      ? `+91${rawClean}`
      : rawClean.length === 12 && rawClean.startsWith('91')
      ? `+${rawClean}`
      : rawClean;

    if (await isSupabaseLive()) {
      const client = createAdminClient();
      const { data, error } = await client
        .from('customers')
        .select('*')
        .eq('tenant_id', tenantId)
        .or(`phone.eq.${normalized},phone.eq.${rawClean},phone.eq.${phone}`)
        .limit(1)
        .maybeSingle();
      if (!error && data) return data as Customer;
    }
    assertProductionDbReady();
    return (
      globalStore.customers.find((c) => {
        if (c.tenant_id !== tenantId) return false;
        const cClean = c.phone.replace(/[\s-]/g, '');
        const cNorm = cClean.startsWith('+')
          ? cClean
          : cClean.length === 10
          ? `+91${cClean}`
          : cClean.length === 12 && cClean.startsWith('91')
          ? `+${cClean}`
          : cClean;
        return cNorm === normalized || cClean === rawClean || c.phone === phone;
      }) || null
    );
  },

  async createCustomer(
    customer: Omit<Customer, 'id' | 'created_at' | 'updated_at'>,
    tenantId: string = DEFAULT_TENANT_ID
  ): Promise<Customer> {
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
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
      const dbRow = domainCustomerToDbRow(newCustomer);
      const { data, error } = await client.from('customers').insert([dbRow]).select().single();
      if (!error && data) return dbCustomerToDomain(data);
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
        .select('*, customer:customers(*), facts:call_facts(*), transcript:transcript_segments(*)')
        .eq('id', callId)
        .eq('tenant_id', tenantId)
        .single();
      if (!error && data) {
        const factsRow = Array.isArray(data.facts) ? data.facts[0] : data.facts;
        const customerRow = Array.isArray(data.customer) ? data.customer[0] : data.customer;
        return dbCallToDomain(data, factsRow, customerRow, data.transcript);
      }
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
        .select('*, customer:customers(*), facts:call_facts(*), transcript:transcript_segments(*)')
        .eq('external_call_id', externalCallId)
        .eq('tenant_id', tenantId)
        .single();
      if (!error && data) {
        const factsRow = Array.isArray(data.facts) ? data.facts[0] : data.facts;
        const customerRow = Array.isArray(data.customer) ? data.customer[0] : data.customer;
        return dbCallToDomain(data, factsRow, customerRow, data.transcript);
      }
    }
    assertProductionDbReady();
    const call = globalStore.calls.find((c) => c.external_call_id === externalCallId && c.tenant_id === tenantId);
    if (!call) return null;
    const customer = globalStore.customers.find((c) => c.id === call.customer_id);
    return { ...call, customer };
  },

  async listCalls(
    tenantId: string = DEFAULT_TENANT_ID,
    filters?: { intent?: CallIntent; outcome?: CallOutcome; search?: string; limit?: number; offset?: number }
  ): Promise<Call[]> {
    const limit = Math.min(Math.max(filters?.limit || 50, 1), 100);
    const offset = Math.max(filters?.offset || 0, 0);

    if (await isSupabaseLive()) {
      const client = createAdminClient();
      let query = client
        .from('calls')
        .select('*, customer:customers(*), facts:call_facts(*)')
        .eq('tenant_id', tenantId)
        .order('started_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (filters?.intent) query = query.eq('primary_intent', filters.intent);
      if (filters?.outcome) query = query.eq('outcome', filters.outcome);
      if (filters?.search) {
        const s = filters.search.trim();
        if (s) {
          query = query.or(`summary.ilike.%${s}%,external_call_id.ilike.%${s}%`);
        }
      }
      const { data, error } = await query;
      if (!error && data) {
        return data.map((d: any) => {
          const factsRow = Array.isArray(d.facts) ? d.facts[0] : d.facts;
          const customerRow = Array.isArray(d.customer) ? d.customer[0] : d.customer;
          return dbCallToDomain(d, factsRow, customerRow);
        });
      }
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
    return calls.slice(offset, offset + limit).map((c) => ({
      ...c,
      customer: globalStore.customers.find((cust) => cust.id === c.customer_id),
    }));
  },

  async createCall(callData: Omit<Call, 'id'>, tenantId: string = DEFAULT_TENANT_ID): Promise<Call> {
    if (callData.customer_id) {
      await validateTenantEntityOwnership('customer', callData.customer_id, tenantId);
    }

    const id = crypto.randomUUID();
    const newCall: Call = {
      ...callData,
      id,
      tenant_id: tenantId,
      customer_id: callData.customer_id && !callData.customer_id.startsWith('cust-unknown') ? callData.customer_id : undefined,
    };

    if (await isSupabaseLive()) {
      const client = createAdminClient();
      const { callRow, factsRow } = domainCallToDbRow(newCall);
      const { data, error } = await client.from('calls').insert([callRow]).select().single();
      if (error) {
        throw new Error(`Failed to persist call record: ${error.message}`);
      }
      if (data) {
        if (factsRow) {
          const { error: factsErr } = await client.from('call_facts').upsert([factsRow]);
          if (factsErr) {
            throw new Error(`Failed to persist call_facts for call ${id}: ${factsErr.message}`);
          }
        }
        if (newCall.transcript && newCall.transcript.length > 0) {
          const transcriptRows = newCall.transcript.map((t) => ({
            id: crypto.randomUUID(),
            call_id: id,
            tenant_id: tenantId,
            speaker: t.speaker,
            text: t.text,
            timestamp: t.timestamp,
            language: t.language || null,
            created_at: new Date().toISOString(),
          }));
          const { error: transcriptErr } = await client.from('transcript_segments').insert(transcriptRows);
          if (transcriptErr) {
            throw new Error(`Failed to persist transcript_segments for call ${id}: ${transcriptErr.message}`);
          }
        }
        return dbCallToDomain(data, factsRow);
      }
    }
    assertProductionDbReady();
    globalStore.calls.unshift(newCall);
    return newCall;
  },

  async updateCall(callId: string, updates: Partial<Call>, tenantId: string = DEFAULT_TENANT_ID): Promise<Call | null> {
    if (updates.customer_id) {
      await validateTenantEntityOwnership('customer', updates.customer_id, tenantId);
    }

    if (await isSupabaseLive()) {
      const client = createAdminClient();
      const { callRow, factsRow } = domainCallToDbRow({
        ...updates,
        id: callId,
        tenant_id: tenantId,
        external_call_id: updates.external_call_id || '',
      } as any);

      const updatePayload: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (updates.ended_at !== undefined) updatePayload.ended_at = updates.ended_at;
      if (updates.duration_seconds !== undefined) updatePayload.duration_seconds = updates.duration_seconds;
      if (updates.primary_intent !== undefined) updatePayload.primary_intent = updates.primary_intent;
      if (updates.sentiment !== undefined) updatePayload.sentiment = updates.sentiment;
      if (updates.outcome !== undefined) updatePayload.outcome = updates.outcome;
      if (updates.lead_temperature !== undefined) updatePayload.lead_temperature = updates.lead_temperature;
      if (updates.summary !== undefined) updatePayload.summary = updates.summary;
      if (updates.escalation_status !== undefined) updatePayload.escalation_status = updates.escalation_status;
      if (updates.followup_state !== undefined) updatePayload.followup_state = updates.followup_state;
      if (updates.customer_id !== undefined) updatePayload.customer_id = updates.customer_id;
      if (updates.recording_url !== undefined) updatePayload.recording_url = updates.recording_url;
      if (updates.agent_version !== undefined) updatePayload.agent_version = updates.agent_version;
      if (updates.intent_confidence !== undefined) updatePayload.intent_confidence = updates.intent_confidence;

      const { data, error } = await client
        .from('calls')
        .update(updatePayload)
        .eq('id', callId)
        .eq('tenant_id', tenantId)
        .select()
        .single();

      if (error) {
        throw new Error(`Failed to update call record ${callId}: ${error.message}`);
      }

      if (data) {
        if (factsRow && updates.facts) {
          const { error: factsErr } = await client.from('call_facts').upsert([factsRow]);
          if (factsErr) {
            throw new Error(`Failed to update call_facts for call ${callId}: ${factsErr.message}`);
          }
        }
        if (updates.transcript && updates.transcript.length > 0) {
          const transcriptRows = updates.transcript.map((t) => ({
            id: crypto.randomUUID(),
            call_id: callId,
            tenant_id: tenantId,
            speaker: t.speaker,
            text: t.text,
            timestamp: t.timestamp,
            language: t.language || null,
            created_at: new Date().toISOString(),
          }));
          const { error: transcriptErr } = await client.from('transcript_segments').insert(transcriptRows);
          if (transcriptErr) {
            throw new Error(`Failed to update transcript_segments for call ${callId}: ${transcriptErr.message}`);
          }
        }
        return dbCallToDomain(data, factsRow);
      }
    }
    assertProductionDbReady();
    const idx = globalStore.calls.findIndex((c) => c.id === callId && c.tenant_id === tenantId);
    if (idx === -1) return null;
    globalStore.calls[idx] = {
      ...globalStore.calls[idx],
      ...updates,
      facts: updates.facts ? { ...globalStore.calls[idx].facts, ...updates.facts } : globalStore.calls[idx].facts,
      transcript: updates.transcript || globalStore.calls[idx].transcript,
    };
    return globalStore.calls[idx];
  },

  // -----------------------------------------------------------------------
  // LEADS
  // -----------------------------------------------------------------------
  async listLeads(
    tenantId: string = DEFAULT_TENANT_ID,
    filters?: { temperature?: LeadTemperature; status?: string; search?: string; limit?: number; offset?: number }
  ): Promise<Lead[]> {
    const limit = Math.min(Math.max(filters?.limit || 50, 1), 100);
    const offset = Math.max(filters?.offset || 0, 0);

    if (await isSupabaseLive()) {
      const client = createAdminClient();
      let query = client
        .from('leads')
        .select('*, customer:customers(*)')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (filters?.temperature) query = query.eq('temperature', filters.temperature);
      if (filters?.status) query = query.eq('status', filters.status);
      if (filters?.search) {
        const s = filters.search.trim();
        if (s) {
          query = query.or(`requirement.ilike.%${s}%,route.ilike.%${s}%`);
        }
      }
      const { data, error } = await query;
      if (!error && data) {
        return data.map((d: any) => {
          const customer = Array.isArray(d.customer) ? d.customer[0] : d.customer;
          return dbLeadToDomain(d, customer);
        });
      }
    }
    assertProductionDbReady();
    let leads = globalStore.leads.filter((l) => l.tenant_id === tenantId);
    if (filters?.temperature) leads = leads.filter((l) => l.temperature === filters.temperature);
    if (filters?.status) leads = leads.filter((l) => l.status === filters.status);
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
    return leads.slice(offset, offset + limit);
  },

  async createLead(
    leadData: Partial<Omit<Lead, 'id' | 'created_at' | 'updated_at'>> & {
      customer_name: string;
      phone: string;
      requirement: string;
    },
    tenantId: string = DEFAULT_TENANT_ID
  ): Promise<Lead> {
    let customerId = leadData.customer_id;
    if (customerId) {
      await validateTenantEntityOwnership('customer', customerId, tenantId);
    } else if (leadData.phone && leadData.phone.trim()) {
      const existingCustomer = await this.getCustomerByPhone(leadData.phone, tenantId);
      if (existingCustomer) {
        customerId = existingCustomer.id;
      } else {
        const newCustomer = await this.createCustomer(
          {
            tenant_id: tenantId,
            name: leadData.customer_name || 'Inbound Caller',
            phone: leadData.phone,
            company: leadData.company,
          },
          tenantId
        );
        customerId = newCustomer.id;
      }
    } else {
      throw new Error('Foreign key integrity violation: Cannot create lead without valid customer_id or phone to resolve customer.');
    }

    if (leadData.call_id) {
      await validateTenantEntityOwnership('call', leadData.call_id, tenantId);
    }

    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    const newLead: Lead = {
      source: 'INBOUND_CALL',
      status: 'NEW',
      temperature: 'WARM',
      next_action: 'Operations review',
      last_call_at: now,
      followup_status: 'PENDING',
      ...leadData,
      id,
      customer_id: customerId,
      tenant_id: leadData.tenant_id || tenantId,
      created_at: now,
      updated_at: now,
    };

    if (await isSupabaseLive()) {
      const client = createAdminClient();
      const dbRow = domainLeadToDbRow(newLead);
      const { data, error } = await client.from('leads').insert([dbRow]).select('*, customer:customers(*)').single();
      if (!error && data) {
        const customer = Array.isArray(data.customer) ? data.customer[0] : data.customer;
        return dbLeadToDomain(data, customer);
      }
    }
    assertProductionDbReady();
    globalStore.leads.unshift(newLead);
    return newLead;
  },

  async updateLead(
    id: string,
    updates: Partial<Lead>,
    tenantId: string = DEFAULT_TENANT_ID
  ): Promise<Lead | null> {
    const now = new Date().toISOString();
    if (updates.customer_id) {
      await validateTenantEntityOwnership('customer', updates.customer_id, tenantId);
    }

    // Explicit field allowlist: protect id, tenant_id, created_at
    const sanitizedUpdates: Partial<Lead> = {};
    if (updates.status !== undefined) sanitizedUpdates.status = updates.status;
    if (updates.temperature !== undefined) sanitizedUpdates.temperature = updates.temperature;
    if (updates.requirement !== undefined) sanitizedUpdates.requirement = updates.requirement;
    if (updates.route !== undefined) sanitizedUpdates.route = updates.route;
    if (updates.vehicle_type !== undefined) sanitizedUpdates.vehicle_type = updates.vehicle_type;
    if (updates.weight !== undefined) sanitizedUpdates.weight = updates.weight;
    if (updates.next_action !== undefined) sanitizedUpdates.next_action = updates.next_action;
    if (updates.assigned_to !== undefined) sanitizedUpdates.assigned_to = updates.assigned_to;
    if (updates.followup_status !== undefined) sanitizedUpdates.followup_status = updates.followup_status;
    if (updates.last_call_at !== undefined) sanitizedUpdates.last_call_at = updates.last_call_at;
    if (updates.customer_id !== undefined) sanitizedUpdates.customer_id = updates.customer_id;

    if (await isSupabaseLive()) {
      const client = createAdminClient();
      const { data, error } = await client
        .from('leads')
        .update({ ...sanitizedUpdates, updated_at: now })
        .eq('id', id)
        .eq('tenant_id', tenantId)
        .select('*, customer:customers(*)')
        .single();
      if (!error && data) {
        const customer = Array.isArray(data.customer) ? data.customer[0] : data.customer;
        return dbLeadToDomain(data, customer);
      }
    }
    assertProductionDbReady();
    const idx = globalStore.leads.findIndex((l) => l.id === id && l.tenant_id === tenantId);
    if (idx === -1) return null;
    globalStore.leads[idx] = {
      ...globalStore.leads[idx],
      ...sanitizedUpdates,
      updated_at: now,
    };
    return globalStore.leads[idx];
  },

  async getLeadById(id: string, tenantId: string = DEFAULT_TENANT_ID): Promise<Lead | null> {
    if (await isSupabaseLive()) {
      const client = createAdminClient();
      const { data, error } = await client
        .from('leads')
        .select('*, customer:customers(*)')
        .eq('id', id)
        .eq('tenant_id', tenantId)
        .maybeSingle();
      if (!error && data) {
        const customer = Array.isArray(data.customer) ? data.customer[0] : data.customer;
        return dbLeadToDomain(data, customer);
      }
    }
    assertProductionDbReady();
    return globalStore.leads.find((l) => l.id === id && l.tenant_id === tenantId) || null;
  },

  async getLeadByCallId(callId: string, tenantId: string = DEFAULT_TENANT_ID): Promise<Lead | null> {
    if (await isSupabaseLive()) {
      const client = createAdminClient();
      const { data, error } = await client
        .from('leads')
        .select('*, customer:customers(*)')
        .eq('call_id', callId)
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!error && data) {
        const customer = Array.isArray(data.customer) ? data.customer[0] : data.customer;
        return dbLeadToDomain(data, customer);
      }
    }
    assertProductionDbReady();
    return globalStore.leads.find((l) => l.call_id === callId && l.tenant_id === tenantId) || null;
  },

  // -----------------------------------------------------------------------
  // OPERATIONS REQUESTS
  // -----------------------------------------------------------------------
  async listRequests(
    tenantId: string = DEFAULT_TENANT_ID,
    filters?: { status?: RequestStatus; priority?: RequestPriority; type?: RequestType; search?: string; limit?: number; offset?: number }
  ): Promise<OperationsRequest[]> {
    const limit = Math.min(Math.max(filters?.limit || 50, 1), 100);
    const offset = Math.max(filters?.offset || 0, 0);

    if (await isSupabaseLive()) {
      const client = createAdminClient();
      let query = client
        .from('operations_requests')
        .select('*, customer:customers(*)')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (filters?.status) query = query.eq('status', filters.status);
      if (filters?.priority) query = query.eq('priority', filters.priority);
      if (filters?.type) query = query.eq('type', filters.type);
      if (filters?.search) {
        const s = filters.search.trim();
        if (s) {
          query = query.or(`summary.ilike.%${s}%,reference_no.ilike.%${s}%`);
        }
      }
      const { data, error } = await query;
      if (!error && data) {
        return data.map((d: any) => {
          const customer = Array.isArray(d.customer) ? d.customer[0] : d.customer;
          return dbRequestToDomain(d, customer);
        });
      }
    }
    assertProductionDbReady();
    let reqs = globalStore.operations_requests.filter((r) => r.tenant_id === tenantId);
    if (filters?.status) reqs = reqs.filter((r) => r.status === filters.status);
    if (filters?.priority) reqs = reqs.filter((r) => r.priority === filters.priority);
    if (filters?.type) reqs = reqs.filter((r) => r.type === filters.type);
    if (filters?.search) {
      const s = filters.search.toLowerCase();
      reqs = reqs.filter(
        (r) =>
          r.summary.toLowerCase().includes(s) ||
          (r.reference_no && r.reference_no.toLowerCase().includes(s)) ||
          (r.customer_name && r.customer_name.toLowerCase().includes(s)) ||
          (r.customer_phone && r.customer_phone.includes(s))
      );
    }
    return reqs.slice(offset, offset + limit);
  },

  async getRequestByIdempotencyKey(
    key: string,
    tenantId: string = DEFAULT_TENANT_ID
  ): Promise<OperationsRequest | null> {
    if (!key) return null;
    if (await isSupabaseLive()) {
      const client = createAdminClient();
      const { data, error } = await client
        .from('operations_requests')
        .select('*, customer:customers(*)')
        .eq('tenant_id', tenantId)
        .eq('idempotency_key', key)
        .maybeSingle();
      if (!error && data) {
        const customer = Array.isArray(data.customer) ? data.customer[0] : data.customer;
        return dbRequestToDomain(data, customer);
      }
    }
    assertProductionDbReady();
    return (
      globalStore.operations_requests.find(
        (r) =>
          r.tenant_id === tenantId &&
          (r.idempotency_key === key || (r.details as Record<string, unknown>)?.idempotency_key === key)
      ) || null
    );
  },

  async createRequest(
    requestData: Omit<OperationsRequest, 'id' | 'created_at' | 'updated_at'>,
    tenantId: string = DEFAULT_TENANT_ID
  ): Promise<OperationsRequest> {
    if (requestData.customer_id) {
      await validateTenantEntityOwnership('customer', requestData.customer_id, tenantId);
    }
    if (requestData.call_id) {
      await validateTenantEntityOwnership('call', requestData.call_id, tenantId);
    }

    if (requestData.idempotency_key) {
      const existing = await this.getRequestByIdempotencyKey(requestData.idempotency_key, tenantId);
      if (existing) {
        return existing;
      }
    }

    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    const newReq: OperationsRequest = {
      ...requestData,
      id,
      tenant_id: tenantId,
      customer_id: requestData.customer_id && !requestData.customer_id.startsWith('cust-unknown') ? requestData.customer_id : undefined,
      call_id: requestData.call_id && !requestData.call_id.startsWith('call-') ? requestData.call_id : undefined,
      idempotency_key: requestData.idempotency_key,
      created_at: now,
      updated_at: now,
    };

    if (await isSupabaseLive()) {
      const client = createAdminClient();
      const dbRow = domainRequestToDbRow(newReq);
      const { data, error } = await client.from('operations_requests').insert([dbRow]).select('*, customer:customers(*)').single();
      if (!error && data) {
        const customer = Array.isArray(data.customer) ? data.customer[0] : data.customer;
        return dbRequestToDomain(data, customer);
      }
    }
    assertProductionDbReady();
    globalStore.operations_requests.unshift(newReq);
    return newReq;
  },

  async updateRequest(
    id: string,
    updates: Partial<OperationsRequest>,
    tenantId: string = DEFAULT_TENANT_ID
  ): Promise<OperationsRequest | null> {
    const now = new Date().toISOString();

    // Explicit field allowlist: protect id, tenant_id, created_at, reference_no, idempotency_key, call_id
    const sanitizedUpdates: Partial<OperationsRequest> = {};
    if (updates.status !== undefined) sanitizedUpdates.status = updates.status;
    if (updates.priority !== undefined) sanitizedUpdates.priority = updates.priority;
    if (updates.resolution_notes !== undefined) sanitizedUpdates.resolution_notes = updates.resolution_notes;
    if (updates.assigned_to !== undefined) sanitizedUpdates.assigned_to = updates.assigned_to;
    if (updates.summary !== undefined) sanitizedUpdates.summary = updates.summary;
    if (updates.details !== undefined) sanitizedUpdates.details = updates.details;

    if (await isSupabaseLive()) {
      const client = createAdminClient();
      const { data, error } = await client
        .from('operations_requests')
        .update({ ...sanitizedUpdates, updated_at: now })
        .eq('id', id)
        .eq('tenant_id', tenantId)
        .select('*, customer:customers(*)')
        .single();
      if (!error && data) {
        const customer = Array.isArray(data.customer) ? data.customer[0] : data.customer;
        return dbRequestToDomain(data, customer);
      }
    }
    assertProductionDbReady();
    const idx = globalStore.operations_requests.findIndex((r) => r.id === id && r.tenant_id === tenantId);
    if (idx === -1) return null;
    globalStore.operations_requests[idx] = {
      ...globalStore.operations_requests[idx],
      ...sanitizedUpdates,
      updated_at: now,
    };
    return globalStore.operations_requests[idx];
  },

  // -----------------------------------------------------------------------
  // RATE CARDS
  // -----------------------------------------------------------------------
  async listRateCards(
    tenantId: string = DEFAULT_TENANT_ID,
    filters?: { status?: string; search?: string; limit?: number; offset?: number }
  ): Promise<RateCard[]> {
    const limit = Math.min(Math.max(filters?.limit || 100, 1), 500);
    const offset = Math.max(filters?.offset || 0, 0);

    if (await isSupabaseLive()) {
      const client = createAdminClient();
      let query = client.from('rate_cards').select('*').eq('tenant_id', tenantId);
      if (filters?.status) query = query.eq('status', filters.status);
      if (filters?.search) {
        const s = filters.search.trim();
        if (s) {
          query = query.or(`origin.ilike.%${s}%,destination.ilike.%${s}%,vehicle_type.ilike.%${s}%`);
        }
      }
      query = query.range(offset, offset + limit - 1);
      const { data, error } = await query;
      if (!error && data) return data as RateCard[];
    }
    assertProductionDbReady();
    let cards = globalStore.rate_cards.filter((rc) => rc.tenant_id === tenantId);
    if (filters?.status) cards = cards.filter((rc) => rc.status === filters.status);
    if (filters?.search) {
      const s = filters.search.toLowerCase();
      cards = cards.filter(
        (rc) =>
          rc.origin.toLowerCase().includes(s) ||
          rc.destination.toLowerCase().includes(s) ||
          rc.vehicle_type.toLowerCase().includes(s)
      );
    }
    return cards.slice(offset, offset + limit);
  },

  async bulkCreateRateCards(
    cardsData: Array<Omit<RateCard, 'id' | 'tenant_id' | 'source_version' | 'effective_from'> & { tenant_id?: string; source_version?: string; effective_from?: string }>,
    tenantId: string = DEFAULT_TENANT_ID
  ): Promise<{ inserted: RateCard[]; count: number }> {
    for (let i = 0; i < cardsData.length; i++) {
      const c = cardsData[i];
      if (c.weight_max_tons < c.weight_min_tons) {
        throw new Error(`Row ${i + 1}: weight_max_tons (${c.weight_max_tons}) cannot be less than weight_min_tons (${c.weight_min_tons}).`);
      }
      if (c.effective_to && c.effective_from && c.effective_to < c.effective_from) {
        throw new Error(`Row ${i + 1}: effective_to cannot be earlier than effective_from.`);
      }
    }

    const cardsToInsert: RateCard[] = cardsData.map((d) => ({
      ...d,
      id: crypto.randomUUID(),
      tenant_id: d.tenant_id || tenantId,
      source_version: d.source_version || 'v1.2-csv-bulk-import',
      effective_from: d.effective_from || new Date().toISOString().split('T')[0],
      status: d.status || 'ACTIVE',
      quote_type: d.quote_type || 'ESTIMATE',
      supports_confirmed_quote: Boolean(d.supports_confirmed_quote),
    }));

    if (await isSupabaseLive()) {
      const client = createAdminClient();
      const { data, error } = await client.from('rate_cards').insert(cardsToInsert).select();
      if (error) {
        throw new Error(`Database bulk insert failed: ${error.message}`);
      }
      if (data) {
        return { inserted: data as RateCard[], count: data.length };
      }
    }

    assertProductionDbReady();
    for (const c of cardsToInsert) {
      globalStore.rate_cards.unshift(c);
    }
    return { inserted: cardsToInsert, count: cardsToInsert.length };
  },

  async findApprovedRate(
    params: { origin: string; destination: string; vehicleType?: string; weightTons?: number; date?: string; includeExpired?: boolean },
    tenantId: string = DEFAULT_TENANT_ID
  ): Promise<RateCard | null> {
    const origin = params.origin.trim().toLowerCase();
    const dest = params.destination.trim().toLowerCase();
    const vehicle = params.vehicleType?.trim().toLowerCase();
    const weight = params.weightTons;
    const queryDateStr = params.date || new Date().toISOString().split('T')[0];

    const cards = await this.listRateCards(tenantId);
    // Filter active cards
    const activeCards = cards.filter((rc) => rc.status === 'ACTIVE');
    const validCards = activeCards.filter((rc) => {
      if (rc.effective_from && rc.effective_from > queryDateStr) return false;
      if (rc.effective_to && rc.effective_to < queryDateStr) return false;
      return true;
    });

    const matchesRoute = (rc: RateCard) =>
      rc.origin.trim().toLowerCase() === origin &&
      rc.destination.trim().toLowerCase() === dest;

    const matchesVehicle = (rc: RateCard) => {
      if (!vehicle) return true;
      return rc.vehicle_type.trim().toLowerCase() === vehicle;
    };

    // Deterministic half-open interval for weight bounds [min, max)
    // with boundary check: weight >= rc.weight_min_tons && weight < rc.weight_max_tons
    // If at upper boundary, include only if no other active card starts at that weight
    const matchesWeight = (rc: RateCard, cardPool: RateCard[]) => {
      if (weight === undefined) return true;
      if (weight < rc.weight_min_tons) return false;
      if (weight < rc.weight_max_tons) return true;
      if (weight === rc.weight_max_tons) {
        const hasUpperStart = cardPool.some(
          (other) =>
            other.id !== rc.id &&
            matchesRoute(other) &&
            matchesVehicle(other) &&
            other.weight_min_tons === rc.weight_max_tons
        );
        return !hasUpperStart;
      }
      return false;
    };

    // Deterministic precedence ordering: vehicle match -> weight match -> effective_from recency -> price
    const candidateMatches = validCards.filter((rc) => matchesRoute(rc));
    candidateMatches.sort((a, b) => {
      const aVehicle = vehicle && a.vehicle_type.trim().toLowerCase() === vehicle ? 1 : 0;
      const bVehicle = vehicle && b.vehicle_type.trim().toLowerCase() === vehicle ? 1 : 0;
      if (aVehicle !== bVehicle) return bVehicle - aVehicle;

      const aWeight = matchesWeight(a, validCards) ? 1 : 0;
      const bWeight = matchesWeight(b, validCards) ? 1 : 0;
      if (aWeight !== bWeight) return bWeight - aWeight;

      const aDate = a.effective_from || '';
      const bDate = b.effective_from || '';
      if (aDate !== bDate) return bDate.localeCompare(aDate);

      return a.price_inr - b.price_inr;
    });

    // 1. Exact match origin + destination + vehicleType + weight among currently valid cards
    if (vehicle) {
      const exactMatch = candidateMatches.find((rc) => matchesVehicle(rc) && matchesWeight(rc, validCards));
      if (exactMatch) return exactMatch;
    }

    // 2. Route match within weight limits among currently valid cards (highest precedence first)
    const routeMatch = candidateMatches.find((rc) => matchesWeight(rc, validCards));
    if (routeMatch) return routeMatch;

    // 3. If no valid card found and includeExpired is requested, check for an expired card on this corridor
    // so get_rate_quote can return explicit EXPIRED status rather than reporting corridor unavailable.
    if (!params.includeExpired) {
      return null;
    }

    const expiredCards = activeCards.filter((rc) => rc.effective_to && rc.effective_to < queryDateStr);
    if (vehicle) {
      const exactExpired = expiredCards.find((rc) => matchesRoute(rc) && matchesVehicle(rc) && matchesWeight(rc, expiredCards));
      if (exactExpired) return exactExpired;
    }
    const routeExpired = expiredCards.find((rc) => matchesRoute(rc) && matchesWeight(rc, expiredCards));
    return routeExpired || null;
  },

  async createRateCard(
    rateCardData: Omit<RateCard, 'id' | 'tenant_id' | 'source_version'> & { tenant_id?: string; source_version?: string },
    tenantId: string = DEFAULT_TENANT_ID
  ): Promise<RateCard> {
    if (rateCardData.weight_max_tons < rateCardData.weight_min_tons) {
      throw new Error('Invalid rate interval: weight_max_tons cannot be less than weight_min_tons.');
    }
    if (rateCardData.effective_to && rateCardData.effective_from && rateCardData.effective_to < rateCardData.effective_from) {
      throw new Error('Invalid rate interval: effective_to cannot be earlier than effective_from.');
    }

    const id = crypto.randomUUID();
    const newCard: RateCard = {
      ...rateCardData,
      id,
      tenant_id: rateCardData.tenant_id || tenantId,
      source_version: rateCardData.source_version || 'v1.0',
    };
    if (await isSupabaseLive()) {
      const client = createAdminClient();
      const { data, error } = await client.from('rate_cards').insert([newCard]).select().single();
      if (!error && data) return data as RateCard;
    }
    assertProductionDbReady();
    globalStore.rate_cards.unshift(newCard);
    return newCard;
  },

  async updateRateCard(
    id: string,
    updates: Partial<RateCard>,
    tenantId: string = DEFAULT_TENANT_ID
  ): Promise<RateCard | null> {
    if (
      updates.weight_min_tons !== undefined &&
      updates.weight_max_tons !== undefined &&
      updates.weight_max_tons < updates.weight_min_tons
    ) {
      throw new Error('Invalid rate interval: weight_max_tons cannot be less than weight_min_tons.');
    }
    if (
      updates.effective_from !== undefined &&
      updates.effective_to !== undefined &&
      updates.effective_to < updates.effective_from
    ) {
      throw new Error('Invalid rate interval: effective_to cannot be earlier than effective_from.');
    }

    // Explicit field allowlist: protect id, tenant_id, created_at
    const sanitizedUpdates: Partial<RateCard> = {};
    if (updates.origin !== undefined) sanitizedUpdates.origin = updates.origin;
    if (updates.destination !== undefined) sanitizedUpdates.destination = updates.destination;
    if (updates.vehicle_type !== undefined) sanitizedUpdates.vehicle_type = updates.vehicle_type;
    if (updates.weight_min_tons !== undefined) sanitizedUpdates.weight_min_tons = updates.weight_min_tons;
    if (updates.weight_max_tons !== undefined) sanitizedUpdates.weight_max_tons = updates.weight_max_tons;
    if (updates.price_inr !== undefined) sanitizedUpdates.price_inr = updates.price_inr;
    if (updates.minimum_charge_inr !== undefined) sanitizedUpdates.minimum_charge_inr = updates.minimum_charge_inr;
    if (updates.status !== undefined) sanitizedUpdates.status = updates.status;
    if (updates.effective_from !== undefined) sanitizedUpdates.effective_from = updates.effective_from;
    if (updates.effective_to !== undefined) sanitizedUpdates.effective_to = updates.effective_to;
    if (updates.transit_time_hours !== undefined) sanitizedUpdates.transit_time_hours = updates.transit_time_hours;
    if (updates.surcharge_notes !== undefined) sanitizedUpdates.surcharge_notes = updates.surcharge_notes;
    if (updates.quote_type !== undefined) sanitizedUpdates.quote_type = updates.quote_type;
    if (updates.supports_confirmed_quote !== undefined) sanitizedUpdates.supports_confirmed_quote = updates.supports_confirmed_quote;

    if (await isSupabaseLive()) {
      const client = createAdminClient();
      const { data, error } = await client
        .from('rate_cards')
        .update(sanitizedUpdates)
        .eq('id', id)
        .eq('tenant_id', tenantId)
        .select()
        .single();
      if (!error && data) return data as RateCard;
    }
    assertProductionDbReady();
    const idx = globalStore.rate_cards.findIndex((rc) => rc.id === id && rc.tenant_id === tenantId);
    if (idx === -1) return null;
    globalStore.rate_cards[idx] = {
      ...globalStore.rate_cards[idx],
      ...sanitizedUpdates,
    };
    return globalStore.rate_cards[idx];
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
      if (!error && data) return data.map((d) => dbKnowledgeToDomain(d as any));
    }
    assertProductionDbReady();
    let items = globalStore.knowledge_items.filter((k) => k.tenant_id === tenantId);
    if (category) items = items.filter((k) => k.category === category);
    return items;
  },

  async createKnowledgeItem(
    itemData: Omit<KnowledgeItem, 'id' | 'last_updated'>,
    tenantId: string = DEFAULT_TENANT_ID
  ): Promise<KnowledgeItem> {
    const now = new Date().toISOString().split('T')[0];
    const id = crypto.randomUUID();
    const newItem: KnowledgeItem = {
      ...itemData,
      id,
      tenant_id: tenantId,
      last_updated: now,
    };
    if (await isSupabaseLive()) {
      const client = createAdminClient();
      const dbRow = domainKnowledgeToDbRow(newItem);
      const { data, error } = await client.from('knowledge_items').insert([dbRow]).select().single();
      if (!error && data) return dbKnowledgeToDomain(data as any);
    }
    assertProductionDbReady();
    globalStore.knowledge_items.unshift(newItem);
    return newItem;
  },

  async updateKnowledgeItem(
    id: string,
    updates: Partial<KnowledgeItem>,
    tenantId: string = DEFAULT_TENANT_ID
  ): Promise<KnowledgeItem | null> {
    const now = new Date().toISOString().split('T')[0];
    if (await isSupabaseLive()) {
      const client = createAdminClient();
      const updatePayload: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (updates.category) updatePayload.category = updates.category;
      if (updates.title) updatePayload.title = updates.title;
      if (updates.content) updatePayload.content = updates.content;
      if (updates.status) updatePayload.status = updates.status;
      if (updates.version) updatePayload.version = updates.version;

      const { data, error } = await client
        .from('knowledge_items')
        .update(updatePayload)
        .eq('id', id)
        .eq('tenant_id', tenantId)
        .select()
        .single();
      if (!error && data) return dbKnowledgeToDomain(data as any);
    }
    assertProductionDbReady();
    const idx = globalStore.knowledge_items.findIndex((k) => k.id === id && k.tenant_id === tenantId);
    if (idx === -1) return null;
    globalStore.knowledge_items[idx] = {
      ...globalStore.knowledge_items[idx],
      ...updates,
      last_updated: now,
    };
    return globalStore.knowledge_items[idx];
  },

  // -----------------------------------------------------------------------
  // AUDIT EVENTS
  // -----------------------------------------------------------------------
  async logAuditEvent(
    event: Omit<AuditEvent, 'id' | 'timestamp'>,
    tenantId: string = DEFAULT_TENANT_ID
  ): Promise<AuditEvent> {
    const timestamp = new Date().toISOString();
    const id = crypto.randomUUID();
    const newEvent: AuditEvent = {
      ...event,
      id,
      tenant_id: tenantId,
      call_id: event.call_id && !event.call_id.startsWith('call-') ? event.call_id : undefined,
      timestamp,
    };

    if (await isSupabaseLive()) {
      const client = createAdminClient();
      const dbRow = domainAuditToDbRow(newEvent);
      const { error } = await client.from('audit_events').insert([dbRow]);
      if (error) {
        console.error('[DB] logAuditEvent insert error:', error);
        if (getRuntimeMode() === 'PRODUCTION') {
          throw new Error(`Audit event failed to persist: ${error.message}`);
        }
      } else {
        return newEvent;
      }
    }
    assertProductionDbReady();
    globalStore.audit_events.unshift(newEvent);
    return newEvent;
  },

  async listAuditEvents(
    tenantId: string = DEFAULT_TENANT_ID,
    options: number | { limit?: number; offset?: number; event_type?: string; severity?: string } = 50
  ): Promise<AuditEvent[]> {
    const opts = typeof options === 'number' ? { limit: options } : options;
    const limit = Math.min(Math.max(opts.limit || 50, 1), 500);
    const offset = Math.max(opts.offset || 0, 0);

    if (await isSupabaseLive()) {
      const client = createAdminClient();
      let query = client
        .from('audit_events')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false });

      if (opts.event_type) query = query.eq('event_type', opts.event_type);
      if (opts.severity) query = query.eq('severity', opts.severity);
      query = query.range(offset, offset + limit - 1);

      const { data, error } = await query;
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
    let events = globalStore.audit_events.filter((e) => e.tenant_id === tenantId);
    if (opts.event_type) events = events.filter((e) => e.event_type === opts.event_type);
    if (opts.severity) events = events.filter((e) => e.severity === opts.severity);
    return events.slice(offset, offset + limit);
  },

  // -----------------------------------------------------------------------
  // FOLLOWUPS
  // -----------------------------------------------------------------------
  async createFollowup(
    followupData: Omit<FollowupRecord, 'id' | 'created_at' | 'updated_at'>,
    tenantId: string = DEFAULT_TENANT_ID
  ): Promise<FollowupRecord> {
    if (followupData.call_id) {
      await validateTenantEntityOwnership('call', followupData.call_id, tenantId);
    }
    if (followupData.customer_id) {
      await validateTenantEntityOwnership('customer', followupData.customer_id, tenantId);
    }

    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    const newFollowup: FollowupRecord = {
      ...followupData,
      id,
      tenant_id: tenantId,
      created_at: now,
      updated_at: now,
    };

    if (await isSupabaseLive()) {
      const client = createAdminClient();
      const dbRow = domainFollowupToDbRow(newFollowup);
      const { data, error } = await client.from('followups').insert([dbRow]).select().single();
      if (!error && data) return dbFollowupToDomain(data as any);
    }
    assertProductionDbReady();
    globalStore.followups.unshift(newFollowup);
    return newFollowup;
  },

  async updateFollowup(
    id: string,
    updates: Partial<FollowupRecord>,
    tenantId: string = DEFAULT_TENANT_ID
  ): Promise<FollowupRecord | null> {
    const now = new Date().toISOString();
    const sanitizedUpdates: Partial<FollowupRecord> = {};
    if (updates.status !== undefined) sanitizedUpdates.status = updates.status;
    if (updates.recipient !== undefined) sanitizedUpdates.recipient = updates.recipient;
    if (updates.message_content !== undefined) sanitizedUpdates.message_content = updates.message_content;
    if (updates.provider_message_id !== undefined) sanitizedUpdates.provider_message_id = updates.provider_message_id;
    if (updates.suppression_reason !== undefined) sanitizedUpdates.suppression_reason = updates.suppression_reason;
    if (updates.sent_at !== undefined) sanitizedUpdates.sent_at = updates.sent_at;

    if (await isSupabaseLive()) {
      const client = createAdminClient();
      const { data, error } = await client
        .from('followups')
        .update({ ...sanitizedUpdates, updated_at: now })
        .eq('id', id)
        .eq('tenant_id', tenantId)
        .select()
        .single();
      if (!error && data) return dbFollowupToDomain(data as any);
    }
    assertProductionDbReady();
    const idx = globalStore.followups.findIndex((f) => f.id === id && f.tenant_id === tenantId);
    if (idx === -1) return null;
    globalStore.followups[idx] = {
      ...globalStore.followups[idx],
      ...sanitizedUpdates,
      updated_at: now,
    };
    return globalStore.followups[idx];
  },

  async getFollowupByCallId(
    callId: string,
    tenantId: string = DEFAULT_TENANT_ID
  ): Promise<FollowupRecord | null> {
    if (await isSupabaseLive()) {
      const client = createAdminClient();
      const { data, error } = await client
        .from('followups')
        .select('*')
        .eq('call_id', callId)
        .eq('tenant_id', tenantId)
        .single();
      if (!error && data) return dbFollowupToDomain(data as any);
    }
    assertProductionDbReady();
    return globalStore.followups.find((f: FollowupRecord) => f.call_id === callId && f.tenant_id === tenantId) || null;
  },

  async listFollowups(tenantId: string = DEFAULT_TENANT_ID): Promise<FollowupRecord[]> {
    if (await isSupabaseLive()) {
      const client = createAdminClient();
      const { data, error } = await client
        .from('followups')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false });
      if (!error && data) return data.map((d) => dbFollowupToDomain(d as any));
    }
    assertProductionDbReady();
    return globalStore.followups.filter((f: FollowupRecord) => f.tenant_id === tenantId);
  },

  // -----------------------------------------------------------------------
  // DISPATCHER KPIS
  // -----------------------------------------------------------------------
  async getKPIs(tenantId: string = DEFAULT_TENANT_ID): Promise<DispatcherKPIs> {
    const calls = await this.listCalls(tenantId);
    const leads = await this.listLeads(tenantId);
    const reqs = await this.listRequests(tenantId);
    const auditEvents = await this.listAuditEvents(tenantId, 100);

    const missed = calls.filter((c) => c.outcome === 'MISSED' || c.outcome === 'FAILED').length;
    const escalated = calls.filter((c) => c.outcome === 'TRANSFERRED' || c.escalation_status?.is_escalated).length;
    const openReqs = reqs.filter((r) => r.status === 'PENDING' || r.status === 'IN_REVIEW').length;
    const hotLeads = leads.filter((l) => l.temperature === 'HOT').length;
    const warmLeads = leads.filter((l) => l.temperature === 'WARM').length;

    // Truthful calculation of calls occurring today in business timezone (Asia/Kolkata)
    const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    const callsToday = calls.filter((c) => {
      const d = c.started_at;
      if (!d) return false;
      const callDateStr = new Date(d).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
      return callDateStr === todayStr;
    });

    // Truthful calculation of tool success rate and response latency from measured tool executions
    const measuredLatencies: number[] = [];
    let totalToolAttempts = 0;
    let successfulToolExecutions = 0;

    for (const c of calls) {
      if (c.tool_events && c.tool_events.length > 0) {
        for (const te of c.tool_events) {
          totalToolAttempts++;
          if (te.execution_status === 'SUCCESS' || te.status === 'SUCCESS' || te.status === 'PENDING') {
            successfulToolExecutions++;
          }
          if (typeof te.latency_ms === 'number' && te.latency_ms > 0) {
            measuredLatencies.push(te.latency_ms);
          }
        }
      }
    }

    for (const ae of auditEvents) {
      if (ae.event_type.startsWith('TOOL_')) {
        const details = (ae.details as Record<string, unknown>) || {};
        if (typeof details.latency_ms === 'number' && details.latency_ms > 0) {
          measuredLatencies.push(details.latency_ms);
        }
      }
    }

    if (totalToolAttempts === 0) {
      const toolAudit = auditEvents.filter((e) => e.event_type.startsWith('TOOL_'));
      totalToolAttempts = toolAudit.length;
      successfulToolExecutions = toolAudit.filter(
        (e) => e.event_type === 'TOOL_EXECUTION' && (e.details as Record<string, unknown>)?.success !== false
      ).length;
    }

    const toolSuccessRate = totalToolAttempts > 0
      ? Math.round((successfulToolExecutions / totalToolAttempts) * 100)
      : 100;

    const avgToolLatencyMs = measuredLatencies.length > 0
      ? Math.round(measuredLatencies.reduce((acc, l) => acc + l, 0) / measuredLatencies.length)
      : 0;

    return {
      calls_today: callsToday.length,
      calls_trend: callsToday.length > 0 ? `${callsToday.length} active calls today` : 'No calls today',
      missed_calls: missed,
      escalated_calls: escalated,
      open_requests: openReqs,
      hot_leads: hotLeads,
      warm_leads: warmLeads,
      avg_response_latency_ms: avgToolLatencyMs,
      tool_success_rate_percent: toolSuccessRate,
    };
  },
};
