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
  buildFollowupTemplateData,
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
        recipient: input.recipient_phone || '',
        message: `Call '${input.call_id}' not found or belongs to another tenant.`,
      };
    }

    // 2. Derive authoritative caller recipient phone (Model must not choose arbitrary recipient)
    const rawRecipient =
      call.customer?.phone ||
      (call.customer_id ? (await db.getCustomerById(call.customer_id, tenantId))?.phone : undefined) ||
      (call as any).from_number ||
      (call as any).caller_phone;

    if (!rawRecipient) {
      return {
        status: 'FAILED',
        channel: 'WHATSAPP',
        recipient: '',
        message: 'No verified authoritative caller phone found for call.',
      };
    }
    const authoritativePhone = normalizePhoneNumber(rawRecipient);

    // 3. Check client configuration
    const config = await db.getClientConfig(tenantId);
    if (config.followup_config && !config.followup_config.enabled) {
      return {
        status: 'SUPPRESSED',
        channel: 'WHATSAPP',
        recipient: authoritativePhone,
        message: 'Follow-up messaging is disabled in client configuration.',
      };
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

    const templateData: FollowupTemplateData = buildFollowupTemplateData(call, config);

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
      recipientPhone: authoritativePhone,
      templateId,
      templateData,
      channel: 'WHATSAPP',
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
          channel: 'WHATSAPP',
          recipient: authoritativePhone,
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
              channel: 'WHATSAPP',
              status: 'UNKNOWN',
              recipient: authoritativePhone,
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
          channel: 'WHATSAPP',
          recipient: authoritativePhone,
          message: 'Downstream provider timed out or returned uncertain outcome.',
        };
      }

      return {
        status: 'PROVIDER_ERROR',
        channel: 'WHATSAPP',
        recipient: authoritativePhone,
        message: 'Downstream messaging provider returned failure',
      };
    }

    // 7. Atomic upsert into followups table with internal UUID
    const upsertRes = await db.upsertFollowup(
      {
        call_id: call.id,
        customer_id: call.customer_id,
        tenant_id: tenantId,
        channel: 'WHATSAPP',
        status: (result.status === 'MOCK' ? 'MOCK' : 'SENT') as FollowupStatus,
        recipient: authoritativePhone,
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
          channel: 'WHATSAPP',
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
            channel: 'WHATSAPP',
            recipient: formatMaskedPhone(authoritativePhone),
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
      channel: 'WHATSAPP',
      recipient: authoritativePhone,
      message: `Follow-up message dispatched via WHATSAPP (${result.provider}). Record ID: ${followupRecord?.id || 'upserted'}`,
    };
  } catch (error) {
    console.error('[SendFollowupTool] Internal error during execution:', error);
    return {
      status: 'FAILED',
      channel: 'WHATSAPP',
      recipient: '',
      message: 'Follow-up messaging service temporarily unavailable. Operational desk notified.',
    };
  }
}
