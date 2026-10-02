/**
 * LOGIVOICE V1 — POST-CALL PROCESSING PIPELINE
 * Authoritative pipeline executed after an inbound call terminates.
 *
 * Sequence:
 * 1. Ingest call payload & transcript
 * 2. Classify intent & extract structured operational facts
 * 3. Calculate deterministic lead temperature
 * 4. Persist to Supabase / authoritative DB
 * 5. Sync to Google Sheets operational view (idempotent)
 * 6. Evaluate follow-up eligibility & suppression rules
 * 7. Dispatch follow-up via WhatsApp/SMS adapter
 * 8. Log comprehensive audit trail event
 */

import { db, DEFAULT_TENANT_ID } from '@/lib/db';
import { getTenantConfig } from '@/lib/config/tenant';
import { Call, CallIntent, CallFacts, TranscriptTurn, CallOutcome, Lead } from '@/types/logivoice';
import { computeLeadTemperature } from '@/lib/rules/lead-temperature';
import { syncCallToGoogleSheets } from '@/lib/integrations/google-sheets';
import { sendFollowupMessage } from '@/lib/integrations/messaging';
import { createCorrelationContext, logTrace, logError } from '@/lib/observability/correlation';

export interface PostCallPayload {
  external_call_id: string;
  from_number?: string;
  to_number?: string;
  caller_name?: string;
  recording_url?: string;
  started_at?: string;
  ended_at?: string;
  duration_seconds?: number;
  transcript?: TranscriptTurn[] | string;
  summary?: string;
  intent?: CallIntent;
  sentiment?: 'POSITIVE' | 'NEUTRAL' | 'FRUSTRATED' | 'ANGRY';
  outcome?: CallOutcome;
  facts?: Partial<CallFacts>;
  is_escalated?: boolean;
  escalation_reason?: string;
  target_role?: string;
  tenant_id?: string;
}

export interface PostCallResult {
  success: boolean;
  call_id: string;
  external_call_id: string;
  lead_id?: string;
  lead_temperature: string;
  sheets_status: string;
  followup_status: string;
  message: string;
}

// In-memory set of processed call IDs to ensure idempotency across webhook retries
const processedCallIds = new Set<string>();
const inFlightPipelines = new Map<string, Promise<PostCallResult>>();

export function resetPostCallPipelineIdempotency(): void {
  processedCallIds.clear();
  inFlightPipelines.clear();
}

export async function processPostCallPipeline(
  payload: PostCallPayload
): Promise<PostCallResult> {
  const tenantId = payload.tenant_id || DEFAULT_TENANT_ID;
  const flightKey = `${tenantId}:${payload.external_call_id}`;

  const existingFlight = inFlightPipelines.get(flightKey);
  if (existingFlight) {
    return existingFlight;
  }

  const execution = executePostCallPipeline(payload, tenantId);
  inFlightPipelines.set(flightKey, execution);
  try {
    const result = await execution;
    return result;
  } finally {
    inFlightPipelines.delete(flightKey);
  }
}

async function executePostCallPipeline(
  payload: PostCallPayload,
  tenantId: string
): Promise<PostCallResult> {
  const correlation = createCorrelationContext(tenantId, undefined, 'POST_CALL_PIPELINE');
  logTrace(correlation, 'POST_CALL_STARTED', { external_call_id: payload.external_call_id });

  // 1. Idempotency Check: Prevent duplicate pipeline execution (Durable DB + In-Memory)
  // Only terminal follow-up states (SENT, DELIVERED, SUPPRESSED, OPTED_OUT, SKIPPED_NOT_ELIGIBLE) block retry
  const TERMINAL_FOLLOWUP_STATUSES = ['SENT', 'DELIVERED', 'SUPPRESSED', 'OPTED_OUT', 'SKIPPED_NOT_ELIGIBLE'];
  const existing = await db.getCallByExternalId(payload.external_call_id, tenantId);
  const isTerminal = existing?.followup_state && TERMINAL_FOLLOWUP_STATUSES.includes(existing.followup_state.status);

  if (existing && (processedCallIds.has(payload.external_call_id) || (existing.outcome !== 'IN_PROGRESS' && isTerminal))) {
    logTrace(correlation, 'POST_CALL_IDEMPOTENT_SKIP', { external_call_id: payload.external_call_id });
    return {
      success: true,
      call_id: existing.id,
      external_call_id: payload.external_call_id,
      lead_temperature: existing.lead_temperature,
      sheets_status: 'SKIPPED_DUPLICATE',
      followup_status: existing.followup_state?.status || 'ALREADY_PROCESSED',
      message: 'Idempotent replay: Call outcome already processed.',
    };
  }

  try {
    // 2. Resolve Customer Identity
    let customer = payload.from_number
      ? await db.getCustomerByPhone(payload.from_number, tenantId)
      : null;

    if (!customer && payload.from_number) {
      customer = await db.createCustomer(
        {
          tenant_id: tenantId,
          phone: payload.from_number,
          name: payload.caller_name || 'Inbound Shipper',
        },
        tenantId
      );
    }

    // 3. Normalize Intent and Facts
    const primaryIntent: CallIntent = payload.intent || 'GENERAL';
    const sentiment = payload.sentiment || 'NEUTRAL';
    const outcome: CallOutcome = payload.outcome || 'COMPLETED';

    // 4. Calculate Deterministic Lead Temperature
    const leadTemperature = computeLeadTemperature({
      intent: primaryIntent,
      facts: payload.facts,
      sentiment,
      isEscalated: payload.is_escalated,
      hasBookingRequest: Boolean(payload.facts?.booking_reference),
    });

    // 5. Persist Call Record
    let call: Call;
    const existingCall = await db.getCallByExternalId(payload.external_call_id, tenantId);

    if (existingCall) {
      const updated = await db.updateCall(
        existingCall.id,
        {
          ended_at: payload.ended_at || new Date().toISOString(),
          duration_seconds: payload.duration_seconds !== undefined ? payload.duration_seconds : existingCall.duration_seconds,
          primary_intent: primaryIntent,
          sentiment,
          outcome,
          lead_temperature: leadTemperature,
          summary: payload.summary || existingCall.summary,
          recording_url: payload.recording_url || existingCall.recording_url,
          facts: payload.facts ? { call_id: existingCall.id, ...payload.facts } : existingCall.facts,
          escalation_status: {
            is_escalated: Boolean(payload.is_escalated),
            reason: payload.escalation_reason,
            target_role: payload.target_role,
          },
        },
        tenantId
      );
      call = updated!;
    } else {
      call = await db.createCall(
        {
          external_call_id: payload.external_call_id,
          tenant_id: tenantId,
          customer_id: customer ? customer.id : undefined,
          started_at: payload.started_at || new Date(Date.now() - (payload.duration_seconds || 0) * 1000).toISOString(),
          ended_at: payload.ended_at || new Date().toISOString(),
          duration_seconds: payload.duration_seconds ?? 0,
          primary_intent: primaryIntent,
          sentiment,
          outcome,
          lead_temperature: leadTemperature,
          summary: payload.summary || 'Inbound logistics operations call completed.',
          recording_url: payload.recording_url,
          facts: {
            call_id: '',
            ...payload.facts,
          },
          escalation_status: {
            is_escalated: Boolean(payload.is_escalated),
            reason: payload.escalation_reason,
            target_role: payload.target_role,
          },
          agent_version: 'v1.0.0',
        },
        tenantId
      );
    }

    // 6. Create or Update Commercial Lead Record if Hot or Warm (Durable DB uniqueness)
    let lead: Lead | null = null;
    const contactPhone = customer ? customer.phone : payload.from_number;
    if ((leadTemperature === 'HOT' || leadTemperature === 'WARM') && contactPhone) {
      const existingLead = await db.getLeadByCallId(call.id, tenantId);
      if (existingLead) {
        lead = await db.updateLead(
          existingLead.id,
          {
            temperature: leadTemperature,
            requirement: payload.summary || `Inbound inquiry: ${primaryIntent}`,
            route: payload.facts?.route_from && payload.facts?.route_to ? `${payload.facts.route_from} -> ${payload.facts.route_to}` : existingLead.route,
            vehicle_type: payload.facts?.vehicle_type || existingLead.vehicle_type,
            weight: payload.facts?.weight || existingLead.weight,
          },
          tenantId
        );
      } else {
        lead = await db.createLead(
          {
            tenant_id: tenantId,
            customer_id: customer ? customer.id : undefined,
            customer_name: customer ? customer.name : (payload.caller_name || 'Inbound Shipper'),
            phone: contactPhone,
            source: 'INBOUND_CALL',
            status: 'QUALIFIED',
            temperature: leadTemperature,
            route: payload.facts?.route_from && payload.facts?.route_to ? `${payload.facts.route_from} -> ${payload.facts.route_to}` : undefined,
            vehicle_type: payload.facts?.vehicle_type,
            weight: payload.facts?.weight,
            requirement: payload.summary || `Inbound inquiry: ${primaryIntent}`,
            next_action: leadTemperature === 'HOT' ? 'Immediate vehicle placement & booking closure' : 'Follow up with corridor quote',
            assigned_to: 'LogiVoice Operations',
            followup_status: 'PENDING',
            last_call_at: new Date().toISOString(),
          },
          tenantId
        );
      }
    }

    // 7. Google Sheets Synchronization (Idempotent)
    const sheetsResult = await syncCallToGoogleSheets(call, lead);
    logTrace(correlation, 'SHEETS_SYNC_COMPLETED', { sheetsResult });

    // 8. Follow-up Message Eligibility, Suppression & Durable DB Persistence
    let followupStatus = 'SKIPPED_NOT_ELIGIBLE';

    // Durable check: has follow-up already been dispatched for this call?
    const existingFollowup = await db.getFollowupByCallId(call.id, tenantId);
    if (existingFollowup) {
      followupStatus = existingFollowup.status;
      logTrace(correlation, 'FOLLOWUP_ALREADY_EXISTS', { call_id: call.id, status: followupStatus });
    } else {
      const isEligibleForFollowup =
        Boolean(customer?.phone) &&
        !payload.is_escalated &&
        sentiment !== 'ANGRY' &&
        (leadTemperature === 'HOT' || leadTemperature === 'WARM' || Boolean(payload.facts?.quoted_amount));

      if (isEligibleForFollowup && customer?.phone) {
        const tenantConfig = await getTenantConfig(tenantId);
        const brand = tenantConfig.brand_name || tenantConfig.business_name || 'LogiVoice';
        const bookingNotice = tenantConfig.booking_url
          ? ` Booking confirmation link: ${tenantConfig.booking_url}`
          : ' Booking confirmation ke liye is number par reply karein.';

        let messageSnippet = '';
        if (payload.facts?.quoted_amount) {
          messageSnippet = `Namaste! Aaj aapne ${payload.facts.route_from || 'route'} se ${payload.facts.route_to || 'destination'} ke liye freight rate poocha tha. Quoted amount: ₹${payload.facts.quoted_amount.toLocaleString('en-IN')}.${bookingNotice}`;
        } else if (payload.facts?.tracking_id) {
          messageSnippet = `Namaste! Aapke consignment ${payload.facts.tracking_id} ka status update WhatsApp par share kar diya gaya hai. Sahayata ke liye ${brand} se judey rahein.`;
        } else {
          messageSnippet = `Namaste! ${brand} se call karne ke liye dhanyawad. Aapke requirement ka context dispatch team ko assign ho gaya hai.`;
        }

        const msgResult = await sendFollowupMessage({
          channel: 'WHATSAPP',
          recipient: customer.phone,
          messageContent: messageSnippet,
        });

        const mappedStatus =
          msgResult.status === 'SENT'
            ? 'SENT'
            : msgResult.status === 'MOCK'
            ? 'MOCK'
            : msgResult.status === 'UNCONFIGURED'
            ? 'UNCONFIGURED'
            : msgResult.status === 'OPTED_OUT'
            ? 'SUPPRESSED'
            : 'FAILED';

        followupStatus = mappedStatus;

        // Persist or update follow-up in authoritative followups table
        const existingFollowup = await db.getFollowupByCallId(call.id, tenantId);
        if (existingFollowup) {
          await db.updateFollowup(
            existingFollowup.id,
            {
              status: mappedStatus,
              recipient: customer.phone,
              message_content: messageSnippet,
              provider_message_id: msgResult.providerMessageId,
              suppression_reason: msgResult.error,
              sent_at: mappedStatus === 'SENT' ? new Date().toISOString() : undefined,
            },
            tenantId
          );
        } else {
          await db.createFollowup(
            {
              tenant_id: tenantId,
              call_id: call.id,
              customer_id: customer?.id,
              channel: 'WHATSAPP',
              status: mappedStatus,
              recipient: customer.phone,
              message_content: messageSnippet,
              provider_message_id: msgResult.providerMessageId,
              suppression_reason: msgResult.error,
              sent_at: mappedStatus === 'SENT' ? new Date().toISOString() : undefined,
            },
            tenantId
          );
        }

        await db.updateCall(
          call.id,
          {
            followup_state: {
              eligible: true,
              channel: 'WHATSAPP',
              status: mappedStatus,
              message_snippet: messageSnippet.slice(0, 100),
              sent_at: mappedStatus === 'SENT' ? new Date().toISOString() : undefined,
              suppression_reason: msgResult.error,
            },
          },
          tenantId
        );
      } else {
        followupStatus = 'SUPPRESSED';
        const suppressionReason = payload.is_escalated
          ? 'Call escalated to live human'
          : !customer?.phone
          ? 'Caller phone number missing'
          : 'Lead temperature / intent not eligible for automated messaging';

        // Persist or update suppression state in followups table without synthetic recipient
        const existingFollowup = await db.getFollowupByCallId(call.id, tenantId);
        if (existingFollowup) {
          await db.updateFollowup(
            existingFollowup.id,
            {
              status: 'SUPPRESSED',
              recipient: customer?.phone || '',
              message_content: '',
              suppression_reason: suppressionReason,
            },
            tenantId
          );
        } else {
          await db.createFollowup(
            {
              tenant_id: tenantId,
              call_id: call.id,
              customer_id: customer?.id,
              channel: 'WHATSAPP',
              status: 'SUPPRESSED',
              recipient: customer?.phone || '',
              message_content: '',
              suppression_reason: suppressionReason,
            },
            tenantId
          );
        }

        await db.updateCall(
          call.id,
          {
            followup_state: {
              eligible: false,
              status: 'SUPPRESSED',
              suppression_reason: suppressionReason,
            },
          },
          tenantId
        );
      }
    }

    // 9. Mark call as processed in idempotency set if reached terminal outcome or terminal followup
    if (TERMINAL_FOLLOWUP_STATUSES.includes(followupStatus)) {
      processedCallIds.add(payload.external_call_id);
    }

    // 10. Persist Pipeline Audit Log
    await db.logAuditEvent(
      {
        tenant_id: tenantId,
        call_id: call.id,
        event_type: 'POST_CALL_PIPELINE_SUCCESS',
        actor: 'SYSTEM',
        actor_type: 'SYSTEM',
        actor_id: 'post-call-worker',
        severity: 'INFO',
        details: {
          external_call_id: payload.external_call_id,
          lead_temperature: leadTemperature,
          sheets_status: sheetsResult.status,
          followup_status: followupStatus,
        },
      },
      tenantId
    );

    logTrace(correlation, 'POST_CALL_COMPLETED', {
      call_id: call.id,
      lead_temperature: leadTemperature,
      sheets_status: sheetsResult.status,
      followup_status: followupStatus,
    });

    processedCallIds.add(payload.external_call_id);

    return {
      success: true,
      call_id: call.id,
      external_call_id: payload.external_call_id,
      lead_id: lead?.id,
      lead_temperature: leadTemperature,
      sheets_status: sheetsResult.status,
      followup_status: followupStatus,
      message: 'Post-call pipeline executed cleanly.',
    };
  } catch (error) {
    logError(correlation, 'POST_CALL_PIPELINE_FAILURE', error);
    return {
      success: false,
      call_id: '',
      external_call_id: payload.external_call_id,
      lead_temperature: 'REVIEW',
      sheets_status: 'FAILED',
      followup_status: 'FAILED',
      message: error instanceof Error ? error.message : 'Post-call processing failed',
    };
  }
}
