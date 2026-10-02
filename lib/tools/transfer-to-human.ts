/**
 * TOOL 6: transfer_to_human
 * Human escalation handler. Reads client escalation directory.
 * Preserves caller context, intent, and reasons for handoff.
 * 
 * Strict Commercial Rule:
 * `TRANSFERRED` is ONLY returned when an actual provider transfer operation is invoked
 * and confirmed by the telephony provider.
 * When provider transfer is unconfigured, rejected, timed out, or unavailable:
 * - Falls back to an urgent callback task if caller phone is present.
 * - Returns `TRANSFER_UNAVAILABLE` if caller phone is absent.
 */

import crypto from 'crypto';
import { db, DEFAULT_TENANT_ID } from '@/lib/db';
import { TransferToHumanInput, TransferToHumanOutput } from '@/lib/schemas/tools';
import { executeProviderCallTransfer } from '@/lib/integrations/telephony';
import { normalizePhoneNumber } from '@/lib/utils';

export async function executeTransferToHuman(
  input: TransferToHumanInput,
  tenantId: string = DEFAULT_TENANT_ID
): Promise<TransferToHumanOutput> {
  try {
    const config = await db.getClientConfig(tenantId);
    const contacts = config.escalation_contacts || [];

    // Canonical role mapping & lookup
    const canonicalRoles: Record<string, string[]> = {
      DISPATCHER: ['dispatcher', 'primary dispatcher', 'dispatch'],
      OPS_MANAGER: ['ops_manager', 'operations manager', 'ops manager', 'manager'],
      AFTER_HOURS: ['after_hours', 'urgent', 'after hours', 'night dispatch', 'emergency'],
    };
    const targetInputNorm = (input.target_role || '').trim().toUpperCase();
    const targetContact =
      contacts.find((c) => {
        const cRoleUpper = c.role.trim().toUpperCase();
        if (cRoleUpper === targetInputNorm) return true;
        for (const [canon, aliases] of Object.entries(canonicalRoles)) {
          if (
            (canon === targetInputNorm || aliases.includes(input.target_role?.toLowerCase() || '')) &&
            (canon === cRoleUpper || aliases.includes(c.role.toLowerCase()))
          ) {
            return true;
          }
        }
        return false;
      }) || contacts[0];

    const targetPhone = targetContact?.phone ? normalizePhoneNumber(targetContact.phone) : undefined;

    // Check if live telephony transfer is configured & invoke actual provider
    if (targetPhone) {
      const providerResult = await executeProviderCallTransfer({
        callId: input.call_id,
        callerPhone: input.caller_phone ? normalizePhoneNumber(input.caller_phone) : undefined,
        targetPhone,
        targetRole: targetContact.role,
        targetName: targetContact.name,
        reason: input.reason,
        contextSummary: input.context_summary,
        tenantId,
      });

      if (providerResult.success && providerResult.status === 'TRANSFERRED') {
        // Audit log verified provider escalation
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
              target_phone: targetPhone,
              context_summary: input.context_summary,
              provider: providerResult.provider,
              provider_transfer_id: providerResult.providerTransferId,
              provider_confirmed: true,
            },
          },
          tenantId
        );

        return {
          status: 'TRANSFERRED',
          target_role: targetContact.role,
          target_phone: targetPhone,
          message: `Transferring caller to ${targetContact.name} (${targetContact.role}) at ${targetPhone}. Escalation reason: ${input.reason}.`,
        };
      }

      // If provider was invoked but failed or rejected, log audit failure event
      if (providerResult.status !== 'UNCONFIGURED') {
        await db.logAuditEvent(
          {
            tenant_id: tenantId,
            call_id: input.call_id,
            event_type: 'CALL_ESCALATION_FAILED',
            actor: 'AI_AGENT',
            actor_type: 'AI_AGENT',
            actor_id: 'voice-agent',
            tool_name: 'transfer_to_human',
            severity: 'ERROR',
            details: {
              reason: input.reason,
              target_role: targetContact?.role,
              target_phone: targetPhone,
              provider: providerResult.provider,
              provider_status: providerResult.status,
              error: providerResult.error,
            },
          },
          tenantId
        );
      }
    }

    // Fallback: If caller phone is missing, live transfer cannot fall back to a callback
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

    // Fallback: Urgent Callback Task with deterministic idempotency & collision-safe reference
    const normalizedCallerPhone = normalizePhoneNumber(input.caller_phone);
    const idempotencyKey = `cb-${tenantId}-${input.call_id || 'direct'}-${Buffer.from(input.reason).toString('hex').slice(0, 16)}`;
    const matched = await db.getRequestByIdempotencyKey(idempotencyKey, tenantId);
    if (matched) {
      return {
        status: 'CALLBACK_SCHEDULED',
        target_role: targetContact?.role,
        message: `Idempotent replay: Urgent callback already scheduled under reference ${matched.reference_no}. Operations team has the context.`,
      };
    }

    const existingCustomer = await db.getCustomerByPhone(normalizedCallerPhone, tenantId);
    const customerId = existingCustomer ? existingCustomer.id : undefined;
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const entropy = crypto.randomBytes(4).toString('hex').toUpperCase();
    const callbackRef = `CB-${dateStr}-${entropy}`;

    await db.createRequest(
      {
        reference_no: callbackRef,
        tenant_id: tenantId,
        call_id: input.call_id || undefined,
        customer_id: customerId,
        customer_name: input.caller_name || existingCustomer?.name || 'Inbound Caller',
        customer_phone: normalizedCallerPhone,
        type: 'CALLBACK_REQUEST',
        status: 'PENDING',
        priority: 'URGENT',
        idempotency_key: idempotencyKey,
        summary: `Urgent Callback Required: ${input.reason}`,
        details: {
          reason: input.reason,
          context: input.context_summary,
          target_role: targetContact?.role,
          idempotency_key: idempotencyKey,
          requested_at: new Date().toISOString(),
        },
      },
      tenantId
    );

    // Audit log fallback callback creation
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
          target_role: targetContact?.role,
          target_phone: targetPhone,
          callback_reference: callbackRef,
          fallback_mode: 'URGENT_CALLBACK',
          provider_confirmed: false,
        },
      },
      tenantId
    );

    return {
      status: 'CALLBACK_SCHEDULED',
      target_role: targetContact?.role,
      callback_reference: callbackRef,
      message: `Live transfer is currently unavailable. An urgent callback task has been created for ${targetContact?.name || 'dispatch supervisor'} (Reference: ${callbackRef}). Our fleet desk will call you back shortly.`,
    };
  } catch (error) {
    return {
      status: 'TRANSFER_UNAVAILABLE',
      message: 'Escalation service error occurred. Operations desk notified.',
    };
  }
}
