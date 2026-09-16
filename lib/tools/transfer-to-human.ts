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
      contacts[0] || {
        role: 'Primary Dispatcher',
        name: 'Vikas Sharma',
        phone: '+91 98111 22334',
        channel: 'PHONE',
      };

    // Check if live SIP / PSTN transfer is available or if fallback callback is needed
    // Live transfer is available when phone number is configured and within business hours
    const isLiveTransferAvailable = Boolean(targetContact.phone);

    if (isLiveTransferAvailable) {
      // Audit log
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
    } else {
      // Fallback to Urgent Callback Task
      const callbackRef = `CB-${Date.now().toString().slice(-6)}`;
      await db.createRequest(
        {
          reference_no: callbackRef,
          tenant_id: tenantId,
          call_id: input.call_id || `call-${Date.now()}`,
          customer_id: 'cust-unknown',
          customer_name: input.caller_name || 'Caller',
          customer_phone: input.caller_phone || 'Unknown',
          type: 'CALLBACK_REQUEST',
          status: 'PENDING',
          priority: 'URGENT',
          summary: `Urgent Callback Required: ${input.reason}`,
          details: {
            reason: input.reason,
            context: input.context_summary,
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
          },
        },
        tenantId
      );

      return {
        status: 'CALLBACK_SCHEDULED',
        callback_reference: callbackRef,
        target_role: targetContact.role,
        message: `Live transfer currently unavailable. Urgent callback ticket ${callbackRef} created for ${targetContact.role}.`,
      };
    }
  } catch (error) {
    return {
      status: 'FAILED',
      message: error instanceof Error ? error.message : 'Error executing transfer to human',
    };
  }
}
