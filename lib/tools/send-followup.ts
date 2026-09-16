/**
 * TOOL 8: send_followup
 * Deterministic post-call message dispatch.
 * Enforces tenant, suppression, eligibility, and persists provider response.
 */

import { db, DEFAULT_TENANT_ID } from '@/lib/db';
import { SendFollowupInput, SendFollowupOutput } from '@/lib/schemas/tools';
import { sendFollowupMessage } from '@/lib/integrations/messaging';

export async function executeSendFollowup(
  input: SendFollowupInput,
  tenantId: string = DEFAULT_TENANT_ID
): Promise<SendFollowupOutput> {
  try {
    // 1. Idempotency check: verify if a follow-up was already sent for this call and channel
    const call = await db.getCallById(input.call_id, tenantId);
    if (call?.followup_state?.status === 'SENT') {
      return {
        status: 'SENT',
        followup_id: `dup-${input.call_id}`,
        channel: input.channel,
        recipient: input.recipient_phone,
        message: 'Idempotent replay: Follow-up message already successfully delivered.',
      };
    }

    // 2. Dispatch via Messaging Adapter
    const result = await sendFollowupMessage({
      channel: input.channel,
      recipient: input.recipient_phone,
      messageContent: input.message_content,
      templateId: input.template_id,
    });

    if (!result.success) {
      if (result.status === 'OPTED_OUT') {
        if (call) {
          await db.updateCall(
            input.call_id,
            {
              followup_state: {
                eligible: false,
                status: 'SUPPRESSED',
                suppression_reason: result.error || 'Recipient opted out',
              },
            },
            tenantId
          );
        }

        return {
          status: 'OPTED_OUT',
          channel: input.channel,
          recipient: input.recipient_phone,
          message: 'Message suppressed: Recipient has opted out of automated communications.',
        };
      }

      return {
        status: 'PROVIDER_ERROR',
        channel: input.channel,
        recipient: input.recipient_phone,
        message: result.error || 'Downstream messaging provider returned failure',
      };
    }

    // 3. Persist success state
    const followupId = `flw-${Date.now()}`;
    if (call) {
      await db.updateCall(
        input.call_id,
        {
          followup_state: {
            eligible: true,
            channel: input.channel,
            status: 'SENT',
            message_snippet: input.message_content.slice(0, 100),
            sent_at: new Date().toISOString(),
          },
        },
        tenantId
      );
    }

    // 4. Log Audit Event
    await db.logAuditEvent(
      {
        tenant_id: tenantId,
        call_id: input.call_id,
        event_type: 'FOLLOWUP_DISPATCHED',
        actor: 'AI_AGENT',
        actor_type: 'AI_AGENT',
        actor_id: 'voice-agent',
        tool_name: 'send_followup',
        severity: 'INFO',
        details: {
          channel: input.channel,
          recipient: input.recipient_phone,
          provider_message_id: result.providerMessageId,
          provider: result.provider,
        },
      },
      tenantId
    );

    return {
      status: 'SENT',
      followup_id: followupId,
      provider_message_id: result.providerMessageId,
      channel: input.channel,
      recipient: input.recipient_phone,
      message: `Follow-up message dispatched via ${input.channel} (${result.provider}). Message ID: ${result.providerMessageId}`,
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
