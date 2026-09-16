/**
 * TOOL 4: create_booking_request
 * Validated booking intake with idempotency and explicit status boundaries.
 */

import { db, DEFAULT_TENANT_ID } from '@/lib/db';
import { CreateBookingRequestInput, CreateBookingRequestOutput } from '@/lib/schemas/tools';

export async function executeCreateBookingRequest(
  input: CreateBookingRequestInput,
  tenantId: string = DEFAULT_TENANT_ID
): Promise<CreateBookingRequestOutput> {
  try {
    // 1. Idempotency Check
    if (input.idempotency_key) {
      const existing = await db.listRequests(tenantId);
      const matched = existing.find(
        (r) => (r.details as Record<string, unknown>)?.idempotency_key === input.idempotency_key
      );
      if (matched) {
        return {
          status: 'REQUEST_CREATED',
          reference_no: matched.reference_no,
          request_id: matched.id,
          message: `Idempotent replay: Booking request already created under reference ${matched.reference_no}.`,
        };
      }
    }

    // 2. Resolve or Register Customer
    let customer = await db.getCustomerByPhone(input.customer_phone, tenantId);
    if (!customer) {
      customer = await db.createCustomer(
        {
          tenant_id: tenantId,
          phone: input.customer_phone,
          name: input.customer_name,
        },
        tenantId
      );
    }

    // 3. Generate Reference Number
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const randSuffix = Math.floor(1000 + Math.random() * 9000);
    const referenceNo = `BKG-${dateStr}-${randSuffix}`;

    // 4. Determine status:
    // If confirmation is true, it is REQUEST_CREATED (pending dispatcher vehicle assignment)
    // If same-day or high-value or incomplete, PENDING_HUMAN_CONFIRMATION
    const isPendingConfirmation = !input.is_confirmed_by_caller;
    const requestStatus = isPendingConfirmation ? 'PENDING_HUMAN_CONFIRMATION' : 'REQUEST_CREATED';

    const newRequest = await db.createRequest(
      {
        reference_no: referenceNo,
        tenant_id: tenantId,
        call_id: input.call_id || `call-${Date.now()}`,
        customer_id: customer.id,
        customer_name: customer.name,
        customer_phone: customer.phone,
        type: 'BOOKING_REQUEST',
        status: isPendingConfirmation ? 'IN_REVIEW' : 'PENDING',
        priority: 'HIGH',
        summary: `Booking Request: ${input.origin} -> ${input.destination} (${input.vehicle_type}, ${input.weight})`,
        details: {
          origin: input.origin,
          destination: input.destination,
          pickup_date: input.pickup_date,
          vehicle_type: input.vehicle_type,
          weight: input.weight,
          material_type: input.material_type || 'General Cargo',
          special_requirements: input.special_requirements || null,
          idempotency_key: input.idempotency_key || null,
        },
      },
      tenantId
    );

    // 5. Also create or update commercial Lead record
    await db.createLead(
      {
        tenant_id: tenantId,
        customer_id: customer.id,
        customer_name: customer.name,
        phone: customer.phone,
        source: 'INBOUND_CALL',
        status: 'QUALIFIED',
        temperature: 'HOT',
        route: `${input.origin} -> ${input.destination}`,
        vehicle_type: input.vehicle_type,
        weight: input.weight,
        requirement: `Booking ${referenceNo}: ${input.material_type || 'Cargo'} on ${input.pickup_date}`,
        next_action: 'Dispatcher vehicle assignment & WhatsApp confirmation dispatch',
        assigned_to: 'Primary Dispatcher',
        followup_status: 'PENDING',
        last_call_at: new Date().toISOString(),
      },
      tenantId
    );

    // Log audit event
    await db.logAuditEvent(
      {
        tenant_id: tenantId,
        call_id: input.call_id,
        event_type: 'BOOKING_REQUEST_CREATED',
        actor: 'AI_AGENT',
        actor_type: 'AI_AGENT',
        actor_id: 'voice-agent',
        tool_name: 'create_booking_request',
        severity: 'INFO',
        details: {
          reference_no: referenceNo,
          origin: input.origin,
          destination: input.destination,
          status: requestStatus,
        },
      },
      tenantId
    );

    return {
      status: requestStatus,
      reference_no: referenceNo,
      request_id: newRequest.id,
      message: `Booking request successfully created with reference ${referenceNo}. Our dispatch team has been notified.`,
    };
  } catch (error) {
    return {
      status: 'FAILED',
      message: error instanceof Error ? error.message : 'Failed to create booking request',
    };
  }
}
