/**
 * LOGIVOICE V1 — RETELL CUSTOM TOOL DEFINITIONS
 * Formats the 8 core controlled tools for Retell AI Agent configuration.
 */

export const RETELL_TOOL_DEFINITIONS = [
  {
    name: 'lookup_customer',
    description: 'Look up an existing customer and relationship history using their phone number or caller ID.',
    parameters: {
      type: 'object',
      properties: {
        phone: {
          type: 'string',
          description: 'Caller phone number (e.g. +91 98201 55432)',
        },
      },
      required: ['phone'],
    },
  },
  {
    name: 'get_rate_quote',
    description: 'Get an approved freight rate quote from the commercial rate matrix for a specific corridor.',
    parameters: {
      type: 'object',
      properties: {
        origin: {
          type: 'string',
          description: 'Pickup city/hub (e.g., Delhi, Mumbai, Pune)',
        },
        destination: {
          type: 'string',
          description: 'Drop city/hub (e.g., Ahmedabad, Bengaluru, Jaipur)',
        },
        vehicle_type: {
          type: 'string',
          description: 'Vehicle type, e.g. 32ft MXL, 19ft Open, 24ft Container, Tata Ace',
        },
        weight_tons: {
          type: 'number',
          description: 'Cargo weight in metric tons',
        },
        pickup_date: {
          type: 'string',
          description: 'Requested pickup date',
        },
      },
      required: ['origin', 'destination'],
    },
  },
  {
    name: 'get_tracking_status',
    description: 'Retrieve real-time verified shipment status and location for a consignment or LR number.',
    parameters: {
      type: 'object',
      properties: {
        tracking_reference: {
          type: 'string',
          description: 'LR number or docket identifier (e.g. LR-99214)',
        },
      },
      required: ['tracking_reference'],
    },
  },
  {
    name: 'create_booking_request',
    description: 'Create an official booking intake request after confirming all mandatory route and cargo details with the caller.',
    parameters: {
      type: 'object',
      properties: {
        customer_name: { type: 'string', description: 'Name of the booking caller' },
        customer_phone: { type: 'string', description: 'Contact phone number' },
        origin: { type: 'string', description: 'Pickup location' },
        destination: { type: 'string', description: 'Delivery location' },
        pickup_date: { type: 'string', description: 'Requested pickup date' },
        vehicle_type: { type: 'string', description: 'Required truck size/type' },
        weight: { type: 'string', description: 'Weight or cargo quantity' },
        material_type: { type: 'string', description: 'Nature of cargo' },
        special_requirements: { type: 'string', description: 'Any special loading/handling instructions' },
        is_confirmed_by_caller: { type: 'boolean', description: 'Whether caller explicitly confirmed details' },
        idempotency_key: { type: 'string', description: 'Unique request key to prevent duplicate booking' },
      },
      required: ['customer_name', 'customer_phone', 'origin', 'destination', 'pickup_date', 'vehicle_type', 'weight'],
    },
  },
  {
    name: 'create_support_ticket',
    description: 'Log an operational support ticket or complaint for issues like delivery delay or cargo exception.',
    parameters: {
      type: 'object',
      properties: {
        customer_name: { type: 'string', description: 'Caller name' },
        customer_phone: { type: 'string', description: 'Caller contact phone' },
        issue: { type: 'string', description: 'Description of the problem' },
        priority: {
          type: 'string',
          enum: ['URGENT', 'HIGH', 'NORMAL', 'LOW'],
          description: 'Ticket urgency level',
        },
        tracking_reference: { type: 'string', description: 'Associated LR number if applicable' },
      },
      required: ['customer_name', 'customer_phone', 'issue'],
    },
  },
  {
    name: 'transfer_to_human',
    description: 'Transfer the live call to a human dispatcher or operations manager when complex negotiation, severe complaints, or explicit human requests occur.',
    parameters: {
      type: 'object',
      properties: {
        reason: { type: 'string', description: 'Specific reason for human escalation' },
        caller_name: { type: 'string', description: 'Caller name' },
        caller_phone: { type: 'string', description: 'Caller phone' },
        intent: { type: 'string', description: 'Primary intent of the call' },
        context_summary: { type: 'string', description: 'Summary of discussion so far' },
        target_role: { type: 'string', description: 'Primary Dispatcher or Operations Manager' },
      },
      required: ['reason'],
    },
  },
  {
    name: 'save_call_outcome',
    description: 'Record final structured outcome and facts of the conversation at the conclusion of the call.',
    parameters: {
      type: 'object',
      properties: {
        external_call_id: { type: 'string', description: 'Retell call ID' },
        customer_phone: { type: 'string', description: 'Caller phone' },
        customer_name: { type: 'string', description: 'Caller name' },
        primary_intent: {
          type: 'string',
          enum: ['RATE_QUOTE', 'TRACKING', 'BOOKING', 'SERVICE_AREA', 'GENERAL', 'COMPLAINT', 'HUMAN_REQUEST', 'EXISTING_CUSTOMER', 'UNSUPPORTED_REQUEST'],
        },
        outcome: {
          type: 'string',
          enum: ['COMPLETED', 'TRANSFERRED', 'CALLBACK_SCHEDULED', 'MISSED', 'FAILED', 'ABANDONED'],
        },
        sentiment: {
          type: 'string',
          enum: ['POSITIVE', 'NEUTRAL', 'FRUSTRATED', 'ANGRY'],
        },
        summary: { type: 'string', description: 'Concise factual summary of call' },
        duration_seconds: { type: 'number', description: 'Call duration in seconds' },
      },
      required: ['external_call_id', 'primary_intent', 'outcome', 'summary'],
    },
  },
  {
    name: 'send_followup',
    description: 'Dispatch an approved post-call template message (quote, tracking, or inquiry confirmation) to the caller via WhatsApp.',
    parameters: {
      type: 'object',
      properties: {
        call_id: { type: 'string', description: 'Reference call ID' },
        recipient_phone: { type: 'string', description: 'Destination mobile number' },
        channel: {
          type: 'string',
          enum: ['WHATSAPP', 'SMS', 'EMAIL'],
          description: 'Channel to send on (WHATSAPP supported)',
        },
        template_id: {
          type: 'string',
          enum: ['QUOTE_ESTIMATE', 'QUOTE_CONFIRMED', 'TRACKING_STATUS', 'INQUIRY_RECEIVED'],
          description: 'Approved template identifier',
        },
      },
      required: ['call_id', 'recipient_phone'],
    },
  },
];
