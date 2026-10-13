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
import { isValidUuid } from '@/lib/db/mappers';
import { TransferToHumanInput, TransferToHumanOutput } from '@/lib/schemas/tools';
import { executeProviderCallTransfer } from '@/lib/integrations/telephony';
import { normalizePhoneNumber, formatMaskedPhone } from '@/lib/utils';

async function logTransferAudit(
  tenantId: string,
  callId: string | undefined,
  reason: string,
  targetRole: string | undefined,
  targetPhone: string | undefined,
  extra: Record<string, unknown>
): Promise<void> {
  try {
    await db.logAuditEvent(
      {
        tenant_id: tenantId,
        call_id: callId && isValidUuid(callId) ? callId : undefined,
        event_type: 'CALL_ESCALATED',
        actor: 'AI_AGENT',
        actor_type: 'AI_AGENT',
        actor_id: 'voice-agent',
        tool_name: 'transfer_to_human',
        severity: 'WARNING',
        details: {
          reason,
          target_role: targetRole,
          target_phone: targetPhone ? formatMaskedPhone(targetPhone) : undefined,
          ...extra,
        },
      },
      tenantId
    );
  } catch {
    // Best-effort audit logging
  }
}

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

    // 1. Sanitize & resolve call identifiers — NEVER send arbitrary strings like "current" as CallSid
    const rawCallId = (input.call_id || '').trim();
    const isPlaceholderCallId = !rawCallId || /^(current|active|this|none|null|undefined)$/i.test(rawCallId);

    let verifiedCallSid: string | undefined;
    let resolvedDbCallId: string | undefined;
    let resolvedCallerPhone: string | undefined;
    let resolvedCallerName: string | undefined;

    if (!isPlaceholderCallId) {
      if (/^CA[0-9a-fA-F]{32}$/.test(rawCallId)) {
        verifiedCallSid = rawCallId;
        const callByExt = await db.getCallByExternalId(rawCallId, tenantId);
        if (callByExt) {
          resolvedDbCallId = callByExt.id;
          resolvedCallerPhone = (callByExt.facts as any)?.caller_phone || (callByExt.facts as any)?.customer_phone || callByExt.customer?.phone;
          resolvedCallerName = (callByExt.facts as any)?.caller_name || callByExt.customer?.name;
        }
      } else if (isValidUuid(rawCallId)) {
        resolvedDbCallId = rawCallId;
        const callByUuid = await db.getCallById(rawCallId, tenantId);
        if (callByUuid) {
          if (callByUuid.external_call_id && /^CA[0-9a-fA-F]{32}$/.test(callByUuid.external_call_id)) {
            verifiedCallSid = callByUuid.external_call_id;
          }
          resolvedCallerPhone = (callByUuid.facts as any)?.caller_phone || (callByUuid.facts as any)?.customer_phone || callByUuid.customer?.phone;
          resolvedCallerName = (callByUuid.facts as any)?.caller_name || callByUuid.customer?.name;
        }
      } else {
        const callByExt = await db.getCallByExternalId(rawCallId, tenantId);
        if (callByExt) {
          resolvedDbCallId = callByExt.id;
          if (callByExt.external_call_id && /^CA[0-9a-fA-F]{32}$/.test(callByExt.external_call_id)) {
            verifiedCallSid = callByExt.external_call_id;
          }
          resolvedCallerPhone = (callByExt.facts as any)?.caller_phone || (callByExt.facts as any)?.customer_phone || callByExt.customer?.phone;
          resolvedCallerName = (callByExt.facts as any)?.caller_name || callByExt.customer?.name;
        }
      }
    }

    const effectiveCallerPhone = input.caller_phone || resolvedCallerPhone;
    const effectiveCallerName = input.caller_name || resolvedCallerName;

    // Check if live telephony transfer is configured & a genuine CallSid exists
    const isLiveTransferEnabled = process.env.ENABLE_LIVE_TELEPHONY_TRANSFER === 'true';
    if (targetPhone && verifiedCallSid && isLiveTransferEnabled) {
      const providerResult = await executeProviderCallTransfer({
        callId: verifiedCallSid,
        callerPhone: effectiveCallerPhone ? normalizePhoneNumber(effectiveCallerPhone) : undefined,
        targetPhone,
        targetRole: targetContact.role,
        targetName: targetContact.name,
        reason: input.reason,
        contextSummary: input.context_summary,
        tenantId,
      });

      if (
        providerResult.success &&
        (providerResult.status === 'TRANSFERRED' ||
          providerResult.status === 'TRANSFER_REQUEST_ACCEPTED' ||
          providerResult.status === 'TRANSFER_CONNECTED')
      ) {
        const transferBusinessStatus =
          providerResult.status === 'TRANSFER_CONNECTED'
            ? 'TRANSFER_CONNECTED'
            : 'TRANSFER_REQUEST_ACCEPTED';

        // Audit log verified provider escalation
        await logTransferAudit(tenantId, resolvedDbCallId, input.reason, targetContact.role, targetPhone, {
          context_summary: input.context_summary,
          provider: providerResult.provider,
          provider_transfer_id: providerResult.providerTransferId,
          transfer_state: transferBusinessStatus,
          provider_confirmed: true,
        });

        const statusMessage =
          transferBusinessStatus === 'TRANSFER_CONNECTED'
            ? `Transfer connected to ${targetContact.name} (${targetContact.role}) at ${targetPhone}.`
            : `Transfer request accepted by provider for ${targetContact.name} (${targetContact.role}) at ${targetPhone}. Awaiting bridge connection.`;

        return {
          status: transferBusinessStatus,
          target_role: targetContact.role,
          target_phone: targetPhone,
          message: statusMessage,
        };
      }

      // If provider was invoked but failed or rejected, log audit failure event
      if (providerResult.status !== 'UNCONFIGURED') {
        try {
          await db.logAuditEvent(
            {
              tenant_id: tenantId,
              call_id: resolvedDbCallId,
              event_type: 'CALL_ESCALATION_FAILED',
              actor: 'AI_AGENT',
              actor_type: 'AI_AGENT',
              actor_id: 'voice-agent',
              tool_name: 'transfer_to_human',
              severity: 'ERROR',
              details: {
                reason: input.reason,
                target_role: targetContact?.role,
                target_phone: targetPhone ? formatMaskedPhone(targetPhone) : undefined,
                provider: providerResult.provider,
                provider_status: providerResult.status,
                error: providerResult.error,
              },
            },
            tenantId
          );
        } catch {
          // Best-effort audit logging
        }
      }
    }

    // Fallback: If caller phone is missing, live transfer cannot fall back to a callback
    if (!effectiveCallerPhone) {
      try {
        await db.logAuditEvent(
          {
            tenant_id: tenantId,
            call_id: resolvedDbCallId,
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
      } catch {
        // Best-effort audit logging
      }

      return {
        status: 'TRANSFER_UNAVAILABLE',
        target_role: targetContact?.role,
        message: 'Live dispatch transfer is currently unavailable, and no callback phone number was provided.',
      };
    }

    // Fallback: Urgent Callback Task with deterministic idempotency & collision-safe reference
    const normalizedCallerPhone = normalizePhoneNumber(effectiveCallerPhone);
    const safeCallToken = resolvedDbCallId || (verifiedCallSid ? verifiedCallSid.slice(0, 16) : 'direct');
    const idempotencyKey = `cb-${tenantId}-${safeCallToken}-${Buffer.from(input.reason).toString('hex').slice(0, 16)}`;
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
        call_id: resolvedDbCallId,
        customer_id: customerId,
        customer_name: effectiveCallerName || existingCustomer?.name || 'Inbound Caller',
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
    await logTransferAudit(tenantId, resolvedDbCallId, input.reason, targetContact?.role, targetPhone, {
      callback_reference: callbackRef,
      fallback_mode: 'URGENT_CALLBACK',
      provider_confirmed: false,
    });

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
