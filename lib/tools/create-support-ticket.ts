/**
 * TOOL 5: create_support_ticket
 * Support ticket intake with automatic priority ranking and audit logging.
 */

import crypto from 'crypto';
import { db, DEFAULT_TENANT_ID } from '@/lib/db';
import { CreateSupportTicketInput, CreateSupportTicketOutput } from '@/lib/schemas/tools';

export async function executeCreateSupportTicket(
  input: CreateSupportTicketInput,
  tenantId: string = DEFAULT_TENANT_ID
): Promise<CreateSupportTicketOutput> {
  try {
    if (input.idempotency_key) {
      const matched = await db.getRequestByIdempotencyKey(input.idempotency_key, tenantId);
      if (matched) {
        return {
          status: 'SUCCESS',
          ticket_id: matched.id,
          reference_no: matched.reference_no,
          priority: matched.priority,
          message: `Idempotent replay: Support ticket already registered under ID ${matched.reference_no}.`,
        };
      }
    }

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

    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const entropy = crypto.randomBytes(4).toString('hex').toUpperCase();
    const referenceNo = `TCK-${dateStr}-${entropy}`;

    const newTicket = await db.createRequest(
      {
        reference_no: referenceNo,
        tenant_id: tenantId,
        call_id: input.call_id || undefined,
        customer_id: customer.id,
        customer_name: customer.name,
        customer_phone: customer.phone,
        type: 'SUPPORT_TICKET',
        status: 'PENDING',
        priority: input.priority || 'NORMAL',
        idempotency_key: input.idempotency_key || undefined,
        summary: input.issue,
        details: {
          issue: input.issue,
          tracking_reference: input.tracking_reference || null,
          idempotency_key: input.idempotency_key || null,
          reported_at: new Date().toISOString(),
        },
      },
      tenantId
    );

    // Audit log
    await db.logAuditEvent(
      {
        tenant_id: tenantId,
        call_id: input.call_id,
        event_type: 'SUPPORT_TICKET_CREATED',
        actor: 'AI_AGENT',
        actor_type: 'AI_AGENT',
        actor_id: 'voice-agent',
        tool_name: 'create_support_ticket',
        severity: input.priority === 'URGENT' ? 'WARNING' : 'INFO',
        details: {
          ticket_id: newTicket.id,
          reference_no: referenceNo,
          priority: input.priority,
        },
      },
      tenantId
    );

    return {
      status: 'SUCCESS',
      ticket_id: newTicket.id,
      reference_no: referenceNo,
      priority: input.priority,
      message: `Support ticket registered under ticket ID ${referenceNo}. Assigned priority: ${input.priority}.`,
    };
  } catch (error) {
    return {
      status: 'FAILED',
      priority: input.priority,
      message: error instanceof Error ? error.message : 'Error registering support ticket',
    };
  }
}
