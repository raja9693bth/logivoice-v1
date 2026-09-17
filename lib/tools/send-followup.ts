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
    // 1. Verify call exists and tenant ownership
    const call = await db.getCallById(input.call_id, tenantId);
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

    // 3. Durable DB idempotency check: query followups table
    const existingFollowup = await db.getFollowupByCallId(input.call_id, tenantId);
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

    // 4. Dispatch via Messaging Adapter
    const result = await sendFollowupMessage({
      channel: input.channel,
      recipient: input.recipient_phone,
      messageContent: input.message_content,
      templateId: input.template_id,
    });

    if (!result.success) {
      if (result.status === 'OPTED_OUT') {
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

    // 5. Persist durable record into followups table with real UUID
    const newFollowup = await db.createFollowup(
      {
        call_id: input.call_id,
        customer_id: call.customer_id,
        tenant_id: tenantId,
        channel: input.channel,
        status: 'SENT',
        recipient: input.recipient_phone,
        template_id: input.template_id,
        message_content: input.message_content,
        provider_message_id: result.providerMessageId || undefined,
        sent_at: new Date().toISOString(),
      },
      tenantId
    );

    // 6. Update call state
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

    // 7. Log Audit Event
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
          followup_id: newFollowup.id,
          provider_message_id: result.providerMessageId,
          provider: result.provider,
        },
      },
      tenantId
    );

    return {
      status: 'SENT',
      followup_id: newFollowup.id,
      provider_message_id: result.providerMessageId,
      channel: input.channel,
      recipient: input.recipient_phone,
      message: `Follow-up message dispatched via ${input.channel} (${result.provider}). Record ID: ${newFollowup.id}`,
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
