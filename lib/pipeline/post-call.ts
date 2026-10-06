/**
 * LOGIVOICE V1 — AUTHORITATIVE POST-CALL PROCESSING PIPELINE
 *
 * Sequence:
 * 1. Ingest call payload & transcript with durable database claim
 * 2. Classify intent & extract structured operational facts
 * 3. Calculate deterministic lead temperature
 * 4. Persist call, facts, and transcript segments (deterministic deduplication)
 * 5. Sync to Google Sheets operational view (idempotent claim-before-append)
 * 6. Evaluate follow-up eligibility & durable suppression
 * 7. Dispatch controlled follow-up template via WhatsApp provider
 * 8. Log comprehensive audit trail event
 */

import { db, DEFAULT_TENANT_ID } from '@/lib/db';
import { getTenantConfig } from '@/lib/config/tenant';
import { Call, CallIntent, CallFacts, TranscriptTurn, CallOutcome, Lead, FollowupStatus } from '@/types/logivoice';
import { computeLeadTemperature } from '@/lib/rules/lead-temperature';
import { syncCallToGoogleSheets } from '@/lib/integrations/google-sheets';
import { sendControlledFollowup, FollowupTemplateId } from '@/lib/integrations/messaging';
import { createCorrelationContext, logTrace, logError } from '@/lib/observability/correlation';
import { normalizePhoneNumber } from '@/lib/utils';

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

export async function processPostCallPipeline(
  payload: PostCallPayload
): Promise<PostCallResult> {
  const tenantId = payload.tenant_id || DEFAULT_TENANT_ID;
  const correlation = createCorrelationContext(tenantId, undefined, 'POST_CALL_PIPELINE');
  logTrace(correlation, 'POST_CALL_STARTED', { external_call_id: payload.external_call_id });

  // 1. Durable DB Claim-Before-Processing (PostgreSQL Outbox/Job Engine)
  const pipelineClaimKey = `pipeline:${tenantId}:${payload.external_call_id}`;
  const claimResult = await db.claimSideEffect(tenantId, pipelineClaimKey, 'POST_CALL_PIPELINE');

  if (!claimResult.claimed) {
    logTrace(correlation, 'POST_CALL_IDEMPOTENT_SKIP', {
      external_call_id: payload.external_call_id,
      status: claimResult.status,
    });

    let currentStatus = claimResult.status;
    let existingClaim = claimResult.claim;

    // If currently PROCESSING, wait briefly for in-flight execution to complete
    if (currentStatus === 'PROCESSING') {
      for (let attempt = 0; attempt < 8; attempt++) {
        await new Promise((res) => setTimeout(res, 40));
        const updated = await db.getSideEffectClaim(tenantId, pipelineClaimKey);
        if (updated) {
          existingClaim = updated;
          currentStatus = updated.status;
          if (updated.status !== 'PROCESSING') break;
        }
      }
    }

    let existingCall = await db.getCallByExternalId(payload.external_call_id, tenantId);

    if (currentStatus === 'PROCESSING') {
      return {
        success: true,
        call_id: existingCall?.id || 'processing',
        external_call_id: payload.external_call_id,
        lead_id: undefined,
        lead_temperature: existingCall?.lead_temperature || 'UNKNOWN',
        sheets_status: 'PROCESSING',
        followup_status: 'PROCESSING' as FollowupStatus,
        message: `Call ${payload.external_call_id} is currently PROCESSING in background.`,
      };
    }

    if (currentStatus === 'SUCCEEDED') {
      const resultObj = (existingClaim?.result as Record<string, unknown>) || {};
      return {
        success: true,
        call_id: existingCall?.id || (resultObj.call_id as string) || 'finalized',
        external_call_id: payload.external_call_id,
        lead_id: (resultObj.lead_id as string) || undefined,
        lead_temperature: existingCall?.lead_temperature || (resultObj.lead_temperature as string) || 'COLD',
        sheets_status: (resultObj.sheets_status as string) || 'SYNCED',
        followup_status: (existingCall?.followup_state?.status || (resultObj.followup_status as string) || 'SKIPPED') as FollowupStatus,
        message: `Call ${payload.external_call_id} previously finalized with success.`,
      };
    }

    if (currentStatus === 'RETRYABLE') {
      return {
        success: false,
        call_id: existingCall?.id || 'retry-pending',
        external_call_id: payload.external_call_id,
        lead_temperature: existingCall?.lead_temperature || 'UNKNOWN',
        sheets_status: 'RETRY_PENDING',
        followup_status: 'RETRY_PENDING',
        message: `Call ${payload.external_call_id} is RETRY_PENDING.`,
      };
    }

    if (currentStatus === 'FAILED') {
      return {
        success: false,
        call_id: existingCall?.id || 'failed',
        external_call_id: payload.external_call_id,
        lead_temperature: existingCall?.lead_temperature || 'UNKNOWN',
        sheets_status: 'FAILED',
        followup_status: 'FAILED',
        message: `Call ${payload.external_call_id} processing FAILED.`,
      };
    }

    return {
      success: false,
      call_id: existingCall?.id || 'unknown',
      external_call_id: payload.external_call_id,
      lead_temperature: existingCall?.lead_temperature || 'UNKNOWN',
      sheets_status: 'RECONCILIATION_REQUIRED',
      followup_status: 'RECONCILIATION_REQUIRED',
      message: `Call ${payload.external_call_id} outcome is UNKNOWN: reconciliation required.`,
    };
  }

  try {
    const rawNumber = payload.from_number || '';
    const normalizedPhone = rawNumber ? normalizePhoneNumber(rawNumber) : undefined;

    // 2. Identify or Create Customer with Phone Normalization
    let customer = normalizedPhone
      ? await db.getCustomerByPhone(normalizedPhone, tenantId)
      : null;

    if (!customer && normalizedPhone) {
      customer = await db.createCustomer(
        {
          tenant_id: tenantId,
          phone: normalizedPhone,
          phone_normalized: normalizedPhone,
          name: payload.caller_name || 'Inbound Caller',
          customer_type: 'SHIPPER',
        },
        tenantId
      );
    }
    // 3. Normalized Intent, Sentiment, and Provider-Verified Outcome (Phase 17)
    const primaryIntent: CallIntent = payload.intent || 'GENERAL';
    const sentiment = payload.sentiment || 'NEUTRAL';
    let outcome: CallOutcome = payload.outcome || 'COMPLETED';

    // Phase 17: Model/transcript analysis must never upgrade unconfirmed transfers to TRANSFERRED
    if (outcome === 'TRANSFERRED') {
      const confirmedTransfer = await db.getConfirmedTransferForCall(payload.external_call_id, tenantId);
      if (!confirmedTransfer || !confirmedTransfer.transferred) {
        const latestTransferExec = await db.getLatestSuccessfulToolExecution(
          payload.external_call_id,
          'transfer_to_human',
          tenantId
        );
        if (latestTransferExec?.business_status === 'TRANSFER_REQUEST_ACCEPTED') {
          outcome = 'CALLBACK_SCHEDULED';
        } else {
          outcome = 'COMPLETED';
        }
      }
    }

    // 4. Calculate Authoritative Lead Temperature
    const leadTemperature = computeLeadTemperature({
      intent: primaryIntent,
      sentiment,
      isEscalated: Boolean(payload.is_escalated),
      facts: payload.facts,
    });

    // 5. Parse and Normalize Transcript
    let transcriptTurns: TranscriptTurn[] = [];
    if (Array.isArray(payload.transcript)) {
      transcriptTurns = payload.transcript;
    } else if (typeof payload.transcript === 'string') {
      try {
        const parsed = JSON.parse(payload.transcript);
        if (Array.isArray(parsed)) transcriptTurns = parsed;
      } catch {
        transcriptTurns = [{ speaker: 'caller', text: payload.transcript, timestamp: '00:00' }];
      }
    }

    // 6. Authoritative Database Upsert (Call, Facts, Transcript)
    const existingCall = await db.getCallByExternalId(payload.external_call_id, tenantId);
    let call: Call;

    if (existingCall) {
      const updated = await db.updateCall(
        existingCall.id,
        {
          customer_id: customer ? customer.id : existingCall.customer_id,
          ended_at: payload.ended_at || new Date().toISOString(),
          duration_seconds: payload.duration_seconds ?? existingCall.duration_seconds,
          primary_intent: primaryIntent,
          sentiment,
          outcome,
          lead_temperature: leadTemperature,
          summary: payload.summary || existingCall.summary,
          facts: payload.facts ? { ...existingCall.facts, ...payload.facts } : existingCall.facts,
          transcript: transcriptTurns.length > 0 ? transcriptTurns : existingCall.transcript,
          escalation_status: {
            is_escalated: Boolean(payload.is_escalated),
            reason: payload.escalation_reason || existingCall.escalation_status?.reason,
            target_role: payload.target_role || existingCall.escalation_status?.target_role,
          },
          recording_url: payload.recording_url || existingCall.recording_url,
        },
        tenantId
      );
      call = updated || existingCall;
    } else {
      call = await db.createCall(
        {
          external_call_id: payload.external_call_id,
          tenant_id: tenantId,
          customer_id: customer ? customer.id : undefined,
          started_at: payload.started_at || new Date().toISOString(),
          ended_at: payload.ended_at || new Date().toISOString(),
          duration_seconds: payload.duration_seconds || 0,
          primary_intent: primaryIntent,
          sentiment,
          outcome,
          lead_temperature: leadTemperature,
          summary: payload.summary || 'Inbound logistics operations call.',
          facts: payload.facts ? { call_id: '', ...payload.facts } : { call_id: '' },
          transcript: transcriptTurns,
          escalation_status: {
            is_escalated: Boolean(payload.is_escalated),
            reason: payload.escalation_reason,
            target_role: payload.target_role,
          },
          recording_url: payload.recording_url,
          agent_version: 'v1.0.2',
        },
        tenantId
      );
    }

    // 7. Lead Creation / Nurturing Record
    let lead: Lead | null = null;
    const contactPhone = customer?.phone || normalizedPhone;
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
            call_id: call.id,
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

    // 8. Google Sheets Synchronization (Durable Claim-Before-Append)
    const sheetsResult = await syncCallToGoogleSheets(call, lead);
    logTrace(correlation, 'SHEETS_SYNC_COMPLETED', { sheetsResult });

    // 9. Controlled Follow-up Message Dispatch
    let followupStatus: FollowupStatus = 'SKIPPED_NOT_ELIGIBLE';

    if (payload.is_escalated || sentiment === 'ANGRY') {
      followupStatus = 'SUPPRESSED';
      await db.updateCall(
        call.id,
        {
          followup_state: {
            eligible: false,
            status: 'SUPPRESSED',
            suppression_reason: payload.is_escalated
              ? 'Call escalated to human dispatcher'
              : 'Caller sentiment indicates frustration/complaint',
          },
        },
        tenantId
      );
    }

    const isEligibleForFollowup =
      followupStatus !== 'SUPPRESSED' &&
      Boolean(contactPhone) &&
      (leadTemperature === 'HOT' || leadTemperature === 'WARM' || Boolean(payload.facts?.quoted_amount));

    if (isEligibleForFollowup && contactPhone) {
      const tenantConfig = await getTenantConfig(tenantId);
      const brand = tenantConfig.brand_name || tenantConfig.business_name || 'LogiVoice';

      let verifiedTrackingStatus: string | undefined;
      let verifiedTrackingLocation: string | undefined;
      let verifiedTrackingEta: string | undefined;

      if (payload.facts?.tracking_id) {
        const trackingRec = await db.getTrackingRecord(payload.facts.tracking_id, tenantId);
        if (trackingRec && trackingRec.status) {
          verifiedTrackingStatus = trackingRec.status;
          verifiedTrackingLocation = trackingRec.current_location;
          verifiedTrackingEta = trackingRec.eta_if_verified;
        }
      }

      let templateId: FollowupTemplateId = 'INQUIRY_RECEIVED';
      if (payload.facts?.quoted_amount) {
        templateId = payload.facts.quote_type === 'CONFIRMED' ? 'QUOTE_CONFIRMED' : 'QUOTE_ESTIMATE';
      } else if (payload.facts?.tracking_id && verifiedTrackingStatus) {
        templateId = 'TRACKING_STATUS';
      }

      // Upsert durable followup record in PENDING status BEFORE external provider send (Prompt Item 36)
      const { followup } = await db.upsertFollowup(
        {
          tenant_id: tenantId,
          call_id: call.id,
          customer_id: customer?.id,
          channel: 'WHATSAPP',
          status: 'PENDING',
          recipient: contactPhone,
          template_id: templateId,
        },
        tenantId
      );

      const msgResult = await sendControlledFollowup({
        tenantId,
        callId: call.id,
        recipientPhone: contactPhone,
        templateId,
        templateData: {
          customerName: customer?.name || payload.caller_name,
          brand,
          origin: payload.facts?.route_from,
          destination: payload.facts?.route_to,
          vehicleType: payload.facts?.vehicle_type,
          quotedAmount: payload.facts?.quoted_amount,
          trackingId: payload.facts?.tracking_id,
          currentStatus: verifiedTrackingStatus,
          currentLocation: verifiedTrackingLocation,
          etaFormatted: verifiedTrackingEta,
          bookingUrl: tenantConfig.booking_url,
        },
      });

      followupStatus = (msgResult.status === 'SKIPPED' ? 'SUPPRESSED' : msgResult.status) as FollowupStatus;

      // Update call record with authoritative follow-up state
      await db.updateCall(
        call.id,
        {
          followup_state: {
            eligible: true,
            channel: 'WHATSAPP',
            status: followupStatus,
            message_snippet: msgResult.renderedText.slice(0, 100),
            sent_at: msgResult.success ? new Date().toISOString() : undefined,
          },
        },
        tenantId
      );

      // Update the same durable followup record in DB with final authoritative outcome
      await db.updateFollowup(
        followup.id,
        {
          status: followupStatus as any,
          message_content: msgResult.renderedText,
          provider_message_id: msgResult.providerMessageId,
          sent_at: msgResult.success ? new Date().toISOString() : undefined,
        },
        tenantId
      );
    }

    // 10. Complete durable pipeline claim
    await db.completeSideEffect(
      tenantId,
      pipelineClaimKey,
      {
        call_id: call.id,
        lead_id: lead?.id,
        lead_temperature: leadTemperature,
        sheets_status: sheetsResult.status,
        followup_status: followupStatus,
      },
      claimResult.claim_token
    );

    // 11. Audit Event Logging (Best-effort observability: failure does NOT revert confirmed state)
    try {
      await db.logAuditEvent(
        {
          tenant_id: tenantId,
          call_id: call.id,
          external_call_id: payload.external_call_id,
          event_type: 'POST_CALL_PIPELINE_COMPLETED',
          actor: 'SYSTEM',
          actor_type: 'SYSTEM',
          actor_id: 'post-call-pipeline',
          tool_name: 'post_call_pipeline',
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
    } catch (auditErr) {
      console.warn('[PostCallPipeline] Best-effort audit logging degraded:', auditErr);
    }

    return {
      success: true,
      call_id: call.id,
      external_call_id: payload.external_call_id,
      lead_id: lead?.id,
      lead_temperature: leadTemperature,
      sheets_status: sheetsResult.status,
      followup_status: followupStatus,
      message: `Call ${payload.external_call_id} processed authoritatively. Temperature: ${leadTemperature}, Sheets: ${sheetsResult.status}, Follow-up: ${followupStatus}.`,
    };
  } catch (error) {
    logError(correlation, 'POST_CALL_PIPELINE_ERROR', error);
    await db.failSideEffect(
      tenantId,
      pipelineClaimKey,
      error instanceof Error ? error.message : 'Unknown pipeline error',
      true,
      60000,
      claimResult.claim_token
    );
    throw error;
  }
}

/**
 * Resets durable idempotency locks for testing suites.
 */
export function resetPostCallPipelineIdempotency(): void {
  // Handled via database reset in test environment
}
