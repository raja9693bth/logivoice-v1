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

    const event = rawBody.event;
    const callData = rawBody.call || rawBody;
    const externalCallId = callData.call_id || rawBody.call_id;

    if (!externalCallId) {
      return NextResponse.json({ error: 'Missing call_id in webhook payload' }, { status: 400 });
    }

    // Resolve tenant ID securely
    const tenantId = (process.env.NODE_ENV !== 'production' && (rawBody.tenant_id || callData.tenant_id)) || DEFAULT_TENANT_ID;
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
    if (event === 'call_ended' || event === 'call_analyzed' || !event) {
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
      } else if (reason.includes('busy') || reason.includes('no_answer') || reason.includes('voicemail')) {
        outcome = 'MISSED';
      } else if (reason.includes('error') || reason.includes('failed')) {
        outcome = 'FAILED';
      } else if (durationSeconds < 5 && (reason.includes('hangup') || reason.includes('inactivity'))) {
        outcome = 'ABANDONED';
      }

      // Execute authoritative post-call pipeline
      const result = await processPostCallPipeline({
        external_call_id: externalCallId,
        from_number: callData.from_number,
        to_number: callData.to_number,
        started_at: callData.start_timestamp ? new Date(callData.start_timestamp).toISOString() : undefined,
        ended_at: callData.end_timestamp ? new Date(callData.end_timestamp).toISOString() : new Date().toISOString(),
        duration_seconds: durationSeconds,
        summary: callData.call_analysis?.call_summary || callData.summary,
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

    return NextResponse.json({ success: true, event: 'unhandled_event_ignored' });
  } catch (error) {
    logError(correlation, 'RETELL_WEBHOOK_ERROR', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Webhook ingestion failure',
      },
      { status: 500 }
    );
  }
}
