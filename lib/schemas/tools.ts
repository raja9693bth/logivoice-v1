/**
 * LOGIVOICE V1 — TOOL CONTRACTS & INPUT/OUTPUT ZOD SCHEMAS
 * Authoritative schema definitions for the 8 core controlled tools.
 */

import { z } from 'zod';

// =========================================================================
// 1. lookup_customer
// =========================================================================
export const LookupCustomerInputSchema = z.object({
  phone: z.string().min(5, 'Phone number must have at least 5 digits').describe('Caller phone number or customer reference'),
});

export const LookupCustomerOutputSchema = z.object({
  status: z.enum(['FOUND', 'NOT_FOUND', 'AMBIGUOUS', 'INVALID_INPUT', 'FAILED']),
  customer: z
    .object({
      id: z.string(),
      phone: z.string(),
      name: z.string(),
      company: z.string().optional(),
      customer_type: z.string().optional(),
    })
    .nullable()
    .optional(),
  message: z.string(),
});

export type LookupCustomerInput = z.infer<typeof LookupCustomerInputSchema>;
export type LookupCustomerOutput = z.infer<typeof LookupCustomerOutputSchema>;

// =========================================================================
// 2. get_rate_quote
// =========================================================================
export const GetRateQuoteInputSchema = z.object({
  origin: z.string().min(2, 'Origin city is required').describe('Pickup city/hub'),
  destination: z.string().min(2, 'Destination city is required').describe('Drop city/hub'),
  vehicle_type: z.string().optional().describe('Vehicle type, e.g., 32ft MXL, 19ft Open, Tata Ace'),
  weight_tons: z.number().positive().optional().describe('Weight in metric tons'),
  pickup_date: z.string().optional().describe('Requested pickup date (YYYY-MM-DD or descriptive)'),
});

export const GetRateQuoteOutputSchema = z.object({
  status: z.enum(['QUOTED', 'UNAVAILABLE', 'MISSING_FIELDS', 'EXPIRED', 'FAILED']),
  quote_type: z.enum(['ESTIMATE', 'CONFIRMED']).optional(),
  price_inr: z.number().optional(),
  minimum_charge_inr: z.number().optional(),
  transit_time_hours: z.number().optional(),
  route: z.string().optional(),
  vehicle_type: z.string().optional(),
  source_version: z.string().optional(),
  surcharge_notes: z.string().optional(),
  message: z.string(),
});

export type GetRateQuoteInput = z.infer<typeof GetRateQuoteInputSchema>;
export type GetRateQuoteOutput = z.infer<typeof GetRateQuoteOutputSchema>;

// =========================================================================
// 3. get_tracking_status
// =========================================================================
export const GetTrackingStatusInputSchema = z.object({
  tracking_reference: z.string().min(3, 'Tracking/LR reference is required').describe('LR number, Consignment number, or Docket ID'),
  caller_phone: z.string().optional().describe('Caller phone number for ownership verification'),
});

export const GetTrackingStatusOutputSchema = z.object({
  status: z.enum(['FOUND', 'NOT_FOUND', 'PROVIDER_UNAVAILABLE', 'UNAUTHORIZED_ACCESS', 'FAILED']),
  tracking_reference: z.string(),
  current_status: z.string().optional(),
  current_location: z.string().optional(),
  status_timestamp: z.string().optional(),
  eta_if_verified: z.string().nullable().optional(),
  exception_reason: z.string().nullable().optional(),
  message: z.string(),
});

export type GetTrackingStatusInput = z.infer<typeof GetTrackingStatusInputSchema>;
export type GetTrackingStatusOutput = z.infer<typeof GetTrackingStatusOutputSchema>;

// =========================================================================
// 4. create_booking_request
// =========================================================================
export const CreateBookingRequestInputSchema = z.object({
  call_id: z.string().optional(),
  customer_name: z.string().min(2, 'Customer name is required'),
  customer_phone: z.string().min(5, 'Customer phone is required'),
  origin: z.string().min(2, 'Origin is required'),
  destination: z.string().min(2, 'Destination is required'),
  pickup_date: z.string().min(2, 'Pickup date is required'),
  vehicle_type: z.string().min(2, 'Vehicle type is required'),
  weight: z.string().min(1, 'Weight is required'),
  material_type: z.string().optional(),
  special_requirements: z.string().optional(),
  is_confirmed_by_caller: z.boolean().default(false).describe('Explicit confirmation obtained from caller'),
  idempotency_key: z.string().optional().describe('Unique key to prevent duplicate booking creation'),
});

export const CreateBookingRequestOutputSchema = z.object({
  status: z.enum(['REQUEST_CREATED', 'PENDING_HUMAN_CONFIRMATION', 'BOOKING_CONFIRMED', 'FAILED']),
  reference_no: z.string().optional(),
  request_id: z.string().optional(),
  message: z.string(),
});

export type CreateBookingRequestInput = z.infer<typeof CreateBookingRequestInputSchema>;
export type CreateBookingRequestOutput = z.infer<typeof CreateBookingRequestOutputSchema>;

// =========================================================================
// 5. create_support_ticket
// =========================================================================
export const CreateSupportTicketInputSchema = z.object({
  call_id: z.string().optional(),
  customer_name: z.string().min(2, 'Customer name is required'),
  customer_phone: z.string().min(5, 'Customer phone is required'),
  issue: z.string().min(5, 'Issue description is required'),
  priority: z.enum(['URGENT', 'HIGH', 'NORMAL', 'LOW']).default('NORMAL'),
  tracking_reference: z.string().optional(),
  idempotency_key: z.string().optional().describe('Unique key to prevent duplicate support ticket creation'),
});

export const CreateSupportTicketOutputSchema = z.object({
  status: z.enum(['SUCCESS', 'FAILED']),
  ticket_id: z.string().optional(),
  reference_no: z.string().optional(),
  priority: z.string(),
  message: z.string(),
});

export type CreateSupportTicketInput = z.infer<typeof CreateSupportTicketInputSchema>;
export type CreateSupportTicketOutput = z.infer<typeof CreateSupportTicketOutputSchema>;

// =========================================================================
// 6. transfer_to_human
// =========================================================================
export const TransferToHumanInputSchema = z.object({
  call_id: z.string().optional(),
  reason: z.string().min(3, 'Reason for transfer is required'),
  caller_name: z.string().optional(),
  caller_phone: z.string().optional(),
  intent: z.string().optional(),
  context_summary: z.string().optional(),
  target_role: z.string().default('Primary Dispatcher'),
});

export const TransferToHumanOutputSchema = z.object({
  status: z.enum(['TRANSFERRED', 'TRANSFER_UNAVAILABLE', 'CALLBACK_SCHEDULED', 'FAILED']),
  target_phone: z.string().optional(),
  target_role: z.string().optional(),
  callback_reference: z.string().optional(),
  message: z.string(),
});

export type TransferToHumanInput = z.infer<typeof TransferToHumanInputSchema>;
export type TransferToHumanOutput = z.infer<typeof TransferToHumanOutputSchema>;

// =========================================================================
// 7. save_call_outcome
// =========================================================================
export const SaveCallOutcomeInputSchema = z.object({
  external_call_id: z.string(),
  customer_phone: z.string().optional(),
  customer_name: z.string().optional(),
  primary_intent: z.enum([
    'RATE_QUOTE',
    'TRACKING',
    'BOOKING',
    'SERVICE_AREA',
    'GENERAL',
    'COMPLAINT',
    'HUMAN_REQUEST',
    'EXISTING_CUSTOMER',
    'UNSUPPORTED_REQUEST',
  ]),
  outcome: z.enum(['COMPLETED', 'TRANSFERRED', 'CALLBACK_SCHEDULED', 'MISSED', 'FAILED', 'ABANDONED']),
  sentiment: z.enum(['POSITIVE', 'NEUTRAL', 'FRUSTRATED', 'ANGRY']).default('NEUTRAL'),
  summary: z.string(),
  duration_seconds: z.number().default(0),
  facts: z
    .object({
      route_from: z.string().optional(),
      route_to: z.string().optional(),
      weight: z.string().optional(),
      vehicle_type: z.string().optional(),
      material_type: z.string().optional(),
      pickup_date: z.string().optional(),
      quoted_amount: z.number().optional(),
      quote_type: z.enum(['ESTIMATE', 'CONFIRMED']).optional(),
      tracking_id: z.string().optional(),
      booking_reference: z.string().optional(),
      special_requirements: z.string().optional(),
    })
    .optional(),
  escalation_status: z
    .object({
      is_escalated: z.boolean(),
      reason: z.string().optional(),
      target_role: z.string().optional(),
      target_phone: z.string().optional(),
      handoff_successful: z.boolean().optional(),
    })
    .optional(),
  transcript: z
    .array(
      z.object({
        speaker: z.enum(['agent', 'caller']),
        text: z.string(),
        timestamp: z.string(),
        language: z.enum(['hi', 'en', 'hinglish']).optional(),
      })
    )
    .optional(),
});

export const SaveCallOutcomeOutputSchema = z.object({
  status: z.enum(['SAVED', 'ALREADY_EXISTS', 'FAILED']),
  call_id: z.string().optional(),
  lead_id: z.string().optional(),
  computed_temperature: z.enum(['HOT', 'WARM', 'COLD', 'REVIEW']).optional(),
  message: z.string(),
});

export type SaveCallOutcomeInput = z.infer<typeof SaveCallOutcomeInputSchema>;
export type SaveCallOutcomeOutput = z.infer<typeof SaveCallOutcomeOutputSchema>;

// =========================================================================
// 8. send_followup
// =========================================================================
export const SendFollowupInputSchema = z.object({
  call_id: z.string(),
  recipient_phone: z.string().min(5),
  channel: z.enum(['WHATSAPP', 'SMS', 'EMAIL']).default('WHATSAPP'),
  message_content: z.string().min(5),
  template_id: z.string().optional(),
  idempotency_key: z.string().optional(),
});

export const SendFollowupOutputSchema = z.object({
  status: z.enum(['SENT', 'SUPPRESSED', 'OPTED_OUT', 'PROVIDER_ERROR', 'FAILED']),
  followup_id: z.string().optional(),
  provider_message_id: z.string().optional(),
  channel: z.string(),
  recipient: z.string(),
  message: z.string(),
});

export type SendFollowupInput = z.infer<typeof SendFollowupInputSchema>;
export type SendFollowupOutput = z.infer<typeof SendFollowupOutputSchema>;
