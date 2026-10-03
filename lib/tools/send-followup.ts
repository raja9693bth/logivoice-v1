/**
 * LOGIVOICE V1 — DETERMINISTIC POST-CALL FOLLOWUP TOOL
 * TOOL 8: send_followup
 *
 * Enforces:
 * 1. Controlled Template Rendering: Outbound messages strictly use pre-approved templates
 *    with verified operational facts; never accepts arbitrary LLM message text.
 * 2. Channel Truth: Rejects EMAIL / unconfigured SMS without silent fallthrough to WhatsApp.
 * 3. Durable Idempotency & Concurrency: Uses atomic upsert_followup and side-effect locks.
 * 4. PII Minimization: Audit logs store masked phone numbers.
 * 5. Uncertainty Handling: Distinguishes provider timeouts as UNKNOWN.
 */

import { db, DEFAULT_TENANT_ID, isValidUuid } from '@/lib/db';
import { SendFollowupInput, SendFollowupOutput } from '@/lib/schemas/tools';
import {
  sendControlledFollowup,
  renderApprovedTemplate,
  FollowupTemplateId,
  FollowupTemplateData,
} from '@/lib/integrations/messaging';
import { formatMaskedPhone, normalizePhoneNumber } from '@/lib/utils';
import { FollowupStatus } from '@/types/logivoice';

export async function executeSendFollowup(
  input: SendFollowupInput,
  tenantId: string = DEFAULT_TENANT_ID
): Promise<SendFollowupOutput> {
  try {
    // 1. Resolve internal call UUID and verify tenant ownership
    const callUuid = isValidUuid(input.call_id)
      ? input.call_id
      : await db.resolveInternalCallId({ tenantId, externalCallId: input.call_id });

    const call = callUuid
      ? await db.getCallById(callUuid, tenantId)
      : await db.getCallByExternalId(input.call_id, tenantId);

    if (!call) {
      return {
        status: 'FAILED',
        channel: input.channel,
        recipient: input.recipient_phone,
        message: `Call '${input.call_id}' not found or belongs to another tenant.`,
      };
    }

    // 2. Check client configuration
    const config = await db.getClientConfig(tenantId);
    if (config.followup_config && !config.followup_config.enabled) {
      return {
        status: 'SUPPRESSED',
        channel: input.channel,
        recipient: input.recipient_phone,
        message: 'Follow-up messaging is disabled in client configuration.',
      };
    }

    // 3. Channel validation: Reject EMAIL or unconfigured SMS without fallthrough
    if (input.channel === 'EMAIL') {
      return {
        status: 'FAILED',
        channel: input.channel,
        recipient: input.recipient_phone,
        message: 'EMAIL channel is not supported / unconfigured.',
      };
    }

    if (input.channel === 'SMS') {
      const isSmsConfigured = Boolean(
        process.env.SMS_API_KEY || process.env.TWILIO_AUTH_TOKEN || process.env.ENABLE_MOCK_INTEGRATIONS === 'true'
      );
      if (!isSmsConfigured) {
        return {
          status: 'FAILED',
          channel: input.channel,
          recipient: input.recipient_phone,
          message: 'SMS channel is unconfigured.',
        };
      }
    }

    // 4. Deterministic template selection and rendering (No arbitrary LLM authoring)
    const validTemplates: FollowupTemplateId[] = [
      'QUOTE_ESTIMATE',
      'QUOTE_CONFIRMED',
      'TRACKING_STATUS',
      'INQUIRY_RECEIVED',
    ];
    let templateId: FollowupTemplateId = 'INQUIRY_RECEIVED';
    if (input.template_id && validTemplates.includes(input.template_id as FollowupTemplateId)) {
      templateId = input.template_id as FollowupTemplateId;
    } else if (call.facts?.tracking_id) {
      templateId = 'TRACKING_STATUS';
    } else if (call.facts?.quoted_amount) {
      templateId = call.facts.quote_type === 'CONFIRMED' ? 'QUOTE_CONFIRMED' : 'QUOTE_ESTIMATE';
    }

    const templateData: FollowupTemplateData = {
      customerName: call.customer?.name || (input.template_data as any)?.customerName,
      origin: call.facts?.route_from || (input.template_data as any)?.origin,
      destination: call.facts?.route_to || (input.template_data as any)?.destination,
      vehicleType: call.facts?.vehicle_type || (input.template_data as any)?.vehicleType,
      quotedAmount: call.facts?.quoted_amount || (input.template_data as any)?.quotedAmount,
      trackingId: call.facts?.tracking_id || (input.template_data as any)?.trackingId,
      currentStatus: call.facts?.tracking_status || (input.template_data as any)?.currentStatus,
      currentLocation: call.facts?.tracking_location || (input.template_data as any)?.currentLocation,
      etaFormatted: call.facts?.verified_eta || (input.template_data as any)?.etaFormatted,
      ...(input.template_data || {}),
    };

    const renderedMessage = renderApprovedTemplate(templateId, templateData);

    // 5. Durable DB idempotency check: query followups table
    const existingFollowup = await db.getFollowupByCallId(call.id, tenantId);
    if (existingFollowup && (existingFollowup.status === 'SENT' || existingFollowup.status === 'DELIVERED')) {
      return {
        status: 'SENT',
        followup_id: existingFollowup.id,
        provider_message_id: existingFollowup.provider_message_id || undefined,
        channel: existingFollowup.channel,
        recipient: existingFollowup.recipient,
        message: `Idempotent replay: Follow-up message already dispatched under record ${existingFollowup.id}.`,
      };
    }

    // 6. Dispatch via authoritative messaging engine
    const result = await sendControlledFollowup({
      tenantId,
      callId: call.id,
      recipientPhone: input.recipient_phone,
      templateId,
      templateData,
      channel: input.channel === 'SMS' ? 'SMS' : 'WHATSAPP',
    });

    if (!result.success) {
      if (result.status === 'SUPPRESSED') {
        await db.updateCall(
          call.id,
          {
            followup_state: {
              eligible: false,
              status: 'SUPPRESSED',
              suppression_reason: result.error || 'Recipient opted out',
            },
          },
          tenantId
        );

        return {
          status: 'OPTED_OUT',
          channel: input.channel,
          recipient: input.recipient_phone,
          message: 'Message suppressed: Recipient has opted out of automated communications.',
        };
      }

      if (result.status === 'UNKNOWN') {
        try {
          await db.upsertFollowup(
            {
              call_id: call.id,
              customer_id: call.customer_id,
              tenant_id: tenantId,
              channel: input.channel,
              status: 'UNKNOWN',
              recipient: normalizePhoneNumber(input.recipient_phone),
              template_id: templateId,
              message_content: renderedMessage,
              provider_message_id: result.providerMessageId || null,
            },
            tenantId
          );
        } catch {
          // Best-effort persistence
        }

        return {
          status: 'PROVIDER_ERROR',
          channel: input.channel,
          recipient: input.recipient_phone,
          message: result.error || 'Downstream provider timed out or returned uncertain outcome.',
        };
      }

      return {
        status: 'PROVIDER_ERROR',
        channel: input.channel,
        recipient: input.recipient_phone,
        message: result.error || 'Downstream messaging provider returned failure',
      };
    }

    // 7. Atomic upsert into followups table with internal UUID
    const upsertRes = await db.upsertFollowup(
      {
        call_id: call.id,
        customer_id: call.customer_id,
        tenant_id: tenantId,
        channel: input.channel,
        status: (result.status === 'MOCK' ? 'MOCK' : 'SENT') as FollowupStatus,
        recipient: normalizePhoneNumber(input.recipient_phone),
        template_id: templateId,
        message_content: renderedMessage,
        provider_message_id: result.providerMessageId || null,
        sent_at: new Date().toISOString(),
      },
      tenantId
    );

    const followupRecord = upsertRes.followup;

    // 8. Update call followup state
    await db.updateCall(
      call.id,
      {
        followup_state: {
          eligible: true,
          channel: input.channel,
          status: (result.status === 'MOCK' ? 'MOCK' : 'SENT') as FollowupStatus,
          message_snippet: renderedMessage.slice(0, 100),
          sent_at: new Date().toISOString(),
        },
      },
      tenantId
    );

    // 9. Log Audit Event wrapped in try/catch with masked phone
    try {
      await db.logAuditEvent(
        {
          tenant_id: tenantId,
          call_id: call.id,
          event_type: 'FOLLOWUP_DISPATCHED',
          actor: 'AI_AGENT',
          actor_type: 'AI_AGENT',
          actor_id: 'voice-agent',
          tool_name: 'send_followup',
          severity: 'INFO',
          details: {
            channel: input.channel,
            recipient: formatMaskedPhone(input.recipient_phone),
            followup_id: followupRecord?.id,
            provider_message_id: result.providerMessageId,
            provider: result.provider,
            template_id: templateId,
          },
        },
        tenantId
      );
    } catch {
      // Best-effort audit logging
    }

    return {
      status: 'SENT',
      followup_id: followupRecord?.id,
      provider_message_id: result.providerMessageId,
      channel: input.channel,
      recipient: input.recipient_phone,
      message: `Follow-up message dispatched via ${input.channel} (${result.provider}). Record ID: ${followupRecord?.id || 'upserted'}`,
    };
  } catch (error) {
    return {
      status: 'FAILED',
      channel: input.channel,
      recipient: input.recipient_phone,
      message: error instanceof Error ? error.message : 'Error executing send followup',
    };
  }
}
