/**
 * TOOL 6: transfer_to_human
 * Human escalation handler. Reads client escalation directory.
 * Preserves caller context, intent, and reasons for handoff.
 * Falls back to an urgent callback task if transfer target is unreachable.
 */

import { db, DEFAULT_TENANT_ID } from '@/lib/db';
import { TransferToHumanInput, TransferToHumanOutput } from '@/lib/schemas/tools';

export async function executeTransferToHuman(
  input: TransferToHumanInput,
  tenantId: string = DEFAULT_TENANT_ID
): Promise<TransferToHumanOutput> {
  try {
    const config = await db.getClientConfig(tenantId);
    const contacts = config.escalation_contacts || [];

    // Find requested or top-priority escalation contact
    const targetContact =
      contacts.find((c) => c.role.toLowerCase().includes(input.target_role.toLowerCase())) ||
      contacts[0];

    // Check if live SIP / PSTN telephony transfer provider is active and confirms execution.
    // A contact phone number in client configuration is NOT proof that live transfer is available.
    const isTelephonyTransferActive = process.env.ENABLE_LIVE_TELEPHONY_TRANSFER === 'true';

    if (isTelephonyTransferActive && targetContact?.phone) {
      // Audit log live escalation
      await db.logAuditEvent(
        {
          tenant_id: tenantId,
          call_id: input.call_id,
          event_type: 'CALL_ESCALATED',
          actor: 'AI_AGENT',
          actor_type: 'AI_AGENT',
          actor_id: 'voice-agent',
          tool_name: 'transfer_to_human',
          severity: 'WARNING',
          details: {
            reason: input.reason,
            target_role: targetContact.role,
            target_phone: targetContact.phone,
            context_summary: input.context_summary,
          },
        },
        tenantId
      );

      return {
        status: 'TRANSFERRED',
        target_role: targetContact.role,
        target_phone: targetContact.phone,
        message: `Transferring caller to ${targetContact.name} (${targetContact.role}) at ${targetContact.phone}. Escalation reason: ${input.reason}.`,
      };
    }

    // If caller phone is missing, live transfer cannot fall back to a callback with verified caller
    if (!input.caller_phone) {
      await db.logAuditEvent(
        {
          tenant_id: tenantId,
          call_id: input.call_id,
          event_type: 'CALL_ESCALATION_FAILED',
          actor: 'AI_AGENT',
          actor_type: 'AI_AGENT',
          actor_id: 'voice-agent',
          tool_name: 'transfer_to_human',
          severity: 'WARNING',
          details: {
            reason: input.reason,
            error: 'Live transfer provider unavailable and caller phone not provided.',
          },
        },
        tenantId
      );

      return {
        status: 'TRANSFER_UNAVAILABLE',
        target_role: targetContact?.role,
        message: 'Live dispatch transfer is currently unavailable, and no callback phone number was provided.',
      };
    }

    // Fallback: Urgent Callback Task with real UUID references
    const existingCustomer = await db.getCustomerByPhone(input.caller_phone, tenantId);
    const customerId = existingCustomer ? existingCustomer.id : undefined;
    const callbackRef = `CB-${Date.now().toString().slice(-6)}`;

    await db.createRequest(
      {
        reference_no: callbackRef,
        tenant_id: tenantId,
        call_id: input.call_id || undefined,
        customer_id: customerId,
        customer_name: input.caller_name || existingCustomer?.name || 'Inbound Caller',
        customer_phone: input.caller_phone,
        type: 'CALLBACK_REQUEST',
        status: 'PENDING',
        priority: 'URGENT',
        summary: `Urgent Callback Required: ${input.reason}`,
        details: {
          reason: input.reason,
          context: input.context_summary,
          target_role: targetContact?.role,
          requested_at: new Date().toISOString(),
        },
      },
      tenantId
    );

    await db.logAuditEvent(
      {
        tenant_id: tenantId,
        call_id: input.call_id,
        event_type: 'CALLBACK_TASK_CREATED',
        actor: 'AI_AGENT',
        actor_type: 'AI_AGENT',
        actor_id: 'voice-agent',
        tool_name: 'transfer_to_human',
        severity: 'WARNING',
        details: {
          callback_ref: callbackRef,
          reason: input.reason,
          target_role: targetContact?.role,
        },
      },
      tenantId
    );

    return {
      status: 'CALLBACK_SCHEDULED',
      callback_reference: callbackRef,
      target_role: targetContact?.role,
      message: `Live dispatch transfer is currently unavailable. An urgent priority callback ticket (${callbackRef}) has been scheduled with ${targetContact?.role || 'our dispatch desk'}.`,
    };
  } catch (error) {
    return {
      status: 'FAILED',
      message: error instanceof Error ? error.message : 'Error executing transfer to human',
    };
  }
}
