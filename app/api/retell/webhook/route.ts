/**
 * LOGIVOICE V1 — RETELL WEBHOOK INGESTION ROUTE
 * POST /api/retell/webhook
 *
 * Handles live call lifecycle events from Retell AI:
 * - call_started
 * - call_ended
 * - call_analyzed
 *
 * Triggers the post-call processing pipeline idempotently.
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyRetellWebhookSignature } from '@/lib/auth/context';
import { processPostCallPipeline } from '@/lib/pipeline/post-call';
import { db, DEFAULT_TENANT_ID } from '@/lib/db';
import { createCorrelationContext, logTrace, logError } from '@/lib/observability/correlation';
import { CallIntent, CallOutcome } from '@/types/logivoice';

export async function POST(req: NextRequest) {
  const correlation = createCorrelationContext(DEFAULT_TENANT_ID, undefined, 'RETELL_WEBHOOK');

  try {
    const rawBodyText = await req.text();
    const signature = req.headers.get('x-retell-signature');
    const isTestBypass = process.env.NODE_ENV === 'test' && req.headers.get('x-test-bypass-sig') === 'true';

    // Verify cryptographic Retell signature using the exact raw HTTP request body bytes
    const hasValidSignature = isTestBypass || verifyRetellWebhookSignature(rawBodyText, signature);

    if (!hasValidSignature && (process.env.NODE_ENV === 'production' || process.env.RETELL_API_KEY)) {
      logError(correlation, 'RETELL_WEBHOOK_SIGNATURE_INVALID', { hasSignature: Boolean(signature) });
      return NextResponse.json(
        { error: 'Unauthorized: Invalid or missing X-Retell-Signature' },
        { status: 401 }
      );
    }

    let rawBody: any;
    try {
      rawBody = JSON.parse(rawBodyText);
    } catch {
      return NextResponse.json({ error: 'Malformed JSON payload' }, { status: 400 });
    }

    const SUPPORTED_EVENTS = ['call_started', 'call_ended', 'call_analyzed'] as const;
    const event = rawBody.event;

    // Strict event allowlist: fail closed on missing or unknown event
    if (!event || !SUPPORTED_EVENTS.includes(event as any)) {
      logError(correlation, 'RETELL_WEBHOOK_UNKNOWN_EVENT', { event });
      return NextResponse.json(
        { error: 'Unsupported or missing event type in webhook payload' },
        { status: 400 }
      );
    }

    const callData = rawBody.call || rawBody;
    const externalCallId = callData.call_id || rawBody.call_id;

    if (!externalCallId || typeof externalCallId !== 'string') {
      return NextResponse.json({ error: 'Missing or invalid call_id in webhook payload' }, { status: 400 });
    }

    // Resolve tenant ID securely from trusted server mapping in production
    let tenantId = DEFAULT_TENANT_ID;
    if (process.env.NODE_ENV === 'production') {
      const agentId = callData.agent_id || rawBody.agent_id;
      const configuredAgentId = process.env.RETELL_AGENT_ID;
      if (configuredAgentId && agentId && agentId !== configuredAgentId) {
        logError(correlation, 'RETELL_UNKNOWN_AGENT_ID', { agentId });
        return NextResponse.json({ error: 'Unknown agent identifier for tenant' }, { status: 400 });
      }
      // Production tenant resolution
      tenantId = process.env.AUTHORITATIVE_TENANT_ID || DEFAULT_TENANT_ID;
    } else {
      tenantId = rawBody.tenant_id || callData.tenant_id || DEFAULT_TENANT_ID;
    }

    logTrace(correlation, 'RETELL_WEBHOOK_RECEIVED', { event, external_call_id: externalCallId });

    // 1. Lifecycle Event: call_started
    if (event === 'call_started') {
      const existing = await db.getCallByExternalId(externalCallId, tenantId);
      if (!existing) {
        let customer = callData.from_number
          ? await db.getCustomerByPhone(callData.from_number, tenantId)
          : null;

        await db.createCall(
          {
            external_call_id: externalCallId,
            tenant_id: tenantId,
            customer_id: customer ? customer.id : undefined,
            started_at: callData.start_timestamp ? new Date(callData.start_timestamp).toISOString() : new Date().toISOString(),
            duration_seconds: 0,
            primary_intent: 'GENERAL',
            sentiment: 'NEUTRAL',
            outcome: 'IN_PROGRESS',
            lead_temperature: 'COLD',
            summary: 'Inbound call connected and active.',
            facts: { call_id: '' },
            agent_version: 'v1.0.0',
          },
          tenantId
        );
      }

      return NextResponse.json({ success: true, event: 'call_started_recorded' });
    }

    // 2. Lifecycle Event: call_ended / call_analyzed
    if (event === 'call_ended' || event === 'call_analyzed') {
      // Map sentiment if present
      let sentiment: 'POSITIVE' | 'NEUTRAL' | 'FRUSTRATED' | 'ANGRY' = 'NEUTRAL';
      const rawSentiment = callData.call_analysis?.in_call_sentiment?.toLowerCase();
      if (rawSentiment?.includes('pos')) sentiment = 'POSITIVE';
      else if (rawSentiment?.includes('ang')) sentiment = 'ANGRY';
      else if (rawSentiment?.includes('frust')) sentiment = 'FRUSTRATED';

      // Map intent from call_analysis or custom fields
      let intent: CallIntent = 'GENERAL';
      const customData = callData.custom_analysis_data || {};
      if (customData.intent) {
        intent = customData.intent as CallIntent;
      } else if (callData.call_analysis?.call_summary) {
        const sum = callData.call_analysis.call_summary.toLowerCase();
        if (sum.includes('rate') || sum.includes('quote') || sum.includes('price')) intent = 'RATE_QUOTE';
        else if (sum.includes('track') || sum.includes('consignment') || sum.includes('lr')) intent = 'TRACKING';
        else if (sum.includes('book') || sum.includes('pickup')) intent = 'BOOKING';
        else if (sum.includes('complain') || sum.includes('delay')) intent = 'COMPLAINT';
        else if (sum.includes('manager') || sum.includes('human') || sum.includes('transfer')) intent = 'HUMAN_REQUEST';
      }

      // Duration in seconds (never fabricate 60s if unmeasured)
      const durationSeconds = callData.duration_ms
        ? Math.round(callData.duration_ms / 1000)
        : (callData.duration_seconds ?? 0);

      // Deterministic outcome mapping
      let outcome: CallOutcome = 'COMPLETED';
      const reason = (callData.disconnection_reason || '').toLowerCase();
      if (customData.is_transferred || reason.includes('transfer')) {
        outcome = 'TRANSFERRED';
      } else if (customData.callback_scheduled || reason.includes('callback')) {
        outcome = 'CALLBACK_SCHEDULED';
      } else if (reason.includes('miss') || reason.includes('no_answer') || reason.includes('timeout')) {
        outcome = 'MISSED';
      } else if (reason.includes('fail') || reason.includes('error')) {
        outcome = 'FAILED';
      } else if (reason.includes('user_hangup') && durationSeconds < 10) {
        outcome = 'ABANDONED';
      }

      // Execute post-call processing pipeline
      const result = await processPostCallPipeline({
        external_call_id: externalCallId,
        from_number: callData.from_number,
        caller_name: callData.caller_name || customData.caller_name,
        summary: callData.call_analysis?.call_summary || 'Call concluded via Retell agent.',
        recording_url: callData.recording_url,
        transcript: callData.transcript_object || [],
        duration_seconds: durationSeconds,
        intent,
        sentiment,
        outcome,
        facts: customData.facts || {},
        is_escalated: customData.is_escalated || false,
        escalation_reason: customData.escalation_reason,
        tenant_id: tenantId,
      });

      return NextResponse.json({
        success: result.success,
        call_id: result.call_id,
        external_call_id: externalCallId,
        lead_temperature: result.lead_temperature,
        sheets_status: result.sheets_status,
        followup_status: result.followup_status,
      });
    }

    return NextResponse.json({ error: 'Unhandled event type' }, { status: 400 });
  } catch (error) {
    logError(correlation, 'RETELL_WEBHOOK_ERROR', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Internal webhook processing error',
      },
      { status: 500 }
    );
  }
}
