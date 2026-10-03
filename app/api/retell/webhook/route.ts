/**
 * LOGIVOICE V1 — RETELL WEBHOOK INGESTION ROUTE
 * POST /api/retell/webhook
 *
 * Deterministic Webhook Lifecycle State Machine:
 * 1. `call_started`:
 *    - Ingests initial call shell (`IN_PROGRESS`). Idempotent on repeated events.
 * 2. `call_ended`:
 *    - Records end timestamp, duration, disconnection reason, and basic call facts.
 *    - Does NOT execute the final post-call side-effect pipeline.
 * 3. `call_analyzed`:
 *    - Authoritative finalization event.
 *    - Persists final analysis, sentiment, structured facts, and full transcript.
 *    - Executes the durable post-call processing pipeline exactly once.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { verifyRetellWebhookSignature } from '@/lib/auth/context';
import { processPostCallPipeline } from '@/lib/pipeline/post-call';
import { db, DEFAULT_TENANT_ID } from '@/lib/db';
import { createCorrelationContext, logTrace, logError } from '@/lib/observability/correlation';
import { CallFacts, CallIntent, CallOutcome, TranscriptTurn } from '@/types/logivoice';
import { normalizePhoneNumber } from '@/lib/utils';

// Strict schema validation for Retell webhook payloads with bounded limits
const RetellCallDataSchema = z.object({
  call_id: z.string().min(1).max(128),
  agent_id: z.string().max(128).optional(),
  start_timestamp: z.number().optional(),
  end_timestamp: z.number().optional(),
  duration_ms: z.number().max(86400000).optional(),
  duration_seconds: z.number().max(86400).optional(),
  from_number: z.string().max(32).optional(),
  to_number: z.string().max(32).optional(),
  caller_name: z.string().max(128).optional(),
  disconnection_reason: z.string().max(256).optional(),
  recording_url: z.string().max(2048).optional(),
  call_analysis: z
    .object({
      call_summary: z.string().max(4000).optional(),
      in_call_sentiment: z.string().max(64).optional(),
      user_sentiment: z.string().max(64).optional(),
    })
    .optional(),
  custom_analysis_data: z.record(z.string().max(64), z.unknown()).optional(),
  transcript_object: z
    .array(
      z.object({
        role: z.string().max(32),
        content: z.string().max(10000),
        words: z.array(z.unknown()).optional(),
      })
    )
    .max(500)
    .optional(),
});

const RetellWebhookEventSchema = z.object({
  event: z.enum(['call_started', 'call_ended', 'call_analyzed']),
  call: RetellCallDataSchema.optional(),
  call_id: z.string().optional(),
  agent_id: z.string().optional(),
  tenant_id: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const correlation = createCorrelationContext(DEFAULT_TENANT_ID, undefined, 'RETELL_WEBHOOK');

  try {
    const rawBodyText = await req.text();
    const signature = req.headers.get('x-retell-signature');
    const isTestBypass = process.env.NODE_ENV === 'test' && req.headers.get('x-test-bypass-sig') === 'true';

    // Verify cryptographic Retell signature using exact raw body bytes
    const hasValidSignature = isTestBypass || (await verifyRetellWebhookSignature(rawBodyText, signature));

    if (!hasValidSignature && (process.env.NODE_ENV === 'production' || process.env.RETELL_API_KEY)) {
      logError(correlation, 'RETELL_WEBHOOK_SIGNATURE_INVALID', { hasSignature: Boolean(signature) });
      return NextResponse.json(
        { error: 'Unauthorized: Invalid or missing X-Retell-Signature', correlation_id: correlation.correlationId },
        { status: 401 }
      );
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(rawBodyText);
    } catch {
      return NextResponse.json(
        { error: 'Malformed JSON payload', correlation_id: correlation.correlationId },
        { status: 400 }
      );
    }

    const parseResult = RetellWebhookEventSchema.safeParse(parsedJson);
    if (!parseResult.success) {
      logError(correlation, 'RETELL_WEBHOOK_SCHEMA_MISMATCH', parseResult.error.flatten());
      return NextResponse.json(
        { error: 'Unsupported or malformed webhook payload schema', correlation_id: correlation.correlationId },
        { status: 400 }
      );
    }

    const { event, call, call_id, agent_id: rootAgentId, tenant_id: rootTenantId } = parseResult.data;
    const callData = call || (parsedJson as Record<string, unknown>);
    const externalCallId = call?.call_id || call_id || (callData.call_id as string);

    if (!externalCallId || typeof externalCallId !== 'string') {
      return NextResponse.json(
        { error: 'Missing or invalid call_id in webhook payload', correlation_id: correlation.correlationId },
        { status: 400 }
      );
    }

    // Resolve tenant ID securely from trusted server mapping in production
    let tenantId: string;
    const isProduction = process.env.NODE_ENV === 'production';
    const agentId = call?.agent_id || rootAgentId || (callData.agent_id as string);
    const configuredAgentId = process.env.RETELL_AGENT_ID;

    if (isProduction) {
      // Production must require a valid configured agent mapping
      if (!configuredAgentId) {
        logError(correlation, 'PRODUCTION_RETELL_AGENT_ID_UNCONFIGURED', {});
        return NextResponse.json(
          { error: 'RETELL_AGENT_ID unconfigured on server', correlation_id: correlation.correlationId },
          { status: 500 }
        );
      }

      if (!agentId || agentId !== configuredAgentId) {
        logError(correlation, 'RETELL_UNKNOWN_AGENT_ID', { agentId, configuredAgentId });
        return NextResponse.json(
          { error: 'Unknown, missing or unmapped Retell agent identifier', correlation_id: correlation.correlationId },
          { status: 400 }
        );
      }

      const authoritativeTenantId = process.env.AUTHORITATIVE_TENANT_ID;
      if (!authoritativeTenantId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(authoritativeTenantId)) {
        logError(correlation, 'PRODUCTION_TENANT_MAPPING_MISSING', {});
        return NextResponse.json(
          { error: 'Authoritative tenant mapping missing or invalid in production configuration', correlation_id: correlation.correlationId },
          { status: 403 }
        );
      }
      tenantId = authoritativeTenantId;
    } else {
      tenantId = rootTenantId || ((callData as any).tenant_id as string) || DEFAULT_TENANT_ID;
    }

    logTrace(correlation, 'RETELL_WEBHOOK_RECEIVED', { event, external_call_id: externalCallId });

    const fromNumber = call?.from_number || ((callData as any).from_number as string);
    const normalizedFrom = fromNumber ? normalizePhoneNumber(fromNumber) : undefined;

    // -----------------------------------------------------------------------
    // LIFECYCLE EVENT 1: call_started
    // -----------------------------------------------------------------------
    if (event === 'call_started') {
      const existing = await db.getCallByExternalId(externalCallId, tenantId);
      if (!existing) {
        const customer = normalizedFrom
          ? await db.getCustomerByPhone(normalizedFrom, tenantId)
          : null;

        const startTimestamp = call?.start_timestamp || (callData.start_timestamp as number);

        await db.createCall(
          {
            external_call_id: externalCallId,
            tenant_id: tenantId,
            customer_id: customer ? customer.id : undefined,
            started_at: startTimestamp ? new Date(startTimestamp).toISOString() : new Date().toISOString(),
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

      return NextResponse.json({ success: true, event: 'call_started_recorded', external_call_id: externalCallId });
    }

    // -----------------------------------------------------------------------
    // LIFECYCLE EVENT 2: call_ended
    // Records ended telemetry ONLY. Does NOT run the post-call side effect pipeline.
    // -----------------------------------------------------------------------
    if (event === 'call_ended') {
      const existing = await db.getCallByExternalId(externalCallId, tenantId);
      const durationMs = call?.duration_ms || (callData.duration_ms as number);
      const durationSec = durationMs ? Math.round(durationMs / 1000) : (call?.duration_seconds || (callData.duration_seconds as number) || 0);
      const endTimestamp = call?.end_timestamp || (callData.end_timestamp as number);

      const reason = (call?.disconnection_reason || (callData.disconnection_reason as string) || '').toLowerCase();
      let outcome: CallOutcome = 'COMPLETED';
      if (reason.includes('transfer')) outcome = 'TRANSFERRED';
      else if (reason.includes('callback')) outcome = 'CALLBACK_SCHEDULED';
      else if (reason.includes('miss') || reason.includes('no_answer') || reason.includes('timeout')) outcome = 'MISSED';
      else if (reason.includes('fail') || reason.includes('error')) outcome = 'FAILED';
      else if (reason.includes('user_hangup') && durationSec < 10) outcome = 'ABANDONED';

      if (existing) {
        // Update basic call shell without overwriting if already finalized
        if (existing.outcome === 'IN_PROGRESS') {
          await db.updateCall(
            existing.id,
            {
              ended_at: endTimestamp ? new Date(endTimestamp).toISOString() : new Date().toISOString(),
              duration_seconds: durationSec,
              outcome,
            },
            tenantId
          );
        }
      }

      return NextResponse.json({
        success: true,
        event: 'call_ended_recorded',
        external_call_id: externalCallId,
        outcome,
        duration_seconds: durationSec,
      });
    }

    // -----------------------------------------------------------------------
    // LIFECYCLE EVENT 3: call_analyzed
    // Authoritative finalization event. Stores transcript and executes post-call pipeline.
    // -----------------------------------------------------------------------
    if (event === 'call_analyzed') {
      // Map sentiment
      let sentiment: 'POSITIVE' | 'NEUTRAL' | 'FRUSTRATED' | 'ANGRY' = 'NEUTRAL';
      const rawSentiment = (
        call?.call_analysis?.in_call_sentiment ||
        call?.call_analysis?.user_sentiment ||
        (callData.call_analysis as any)?.in_call_sentiment
      )?.toLowerCase();

      if (rawSentiment?.includes('pos')) sentiment = 'POSITIVE';
      else if (rawSentiment?.includes('ang')) sentiment = 'ANGRY';
      else if (rawSentiment?.includes('frust')) sentiment = 'FRUSTRATED';

      // Map intent across all 9 canonical LogiVoice intents
      const VALID_INTENTS: CallIntent[] = [
        'RATE_QUOTE',
        'TRACKING',
        'BOOKING',
        'SERVICE_AREA',
        'GENERAL',
        'COMPLAINT',
        'HUMAN_REQUEST',
        'EXISTING_CUSTOMER',
        'UNSUPPORTED_REQUEST',
      ];
      let intent: CallIntent = 'GENERAL';
      const customData = (call?.custom_analysis_data || (callData.custom_analysis_data as any) || {}) as Record<string, unknown>;

      if (customData.intent && typeof customData.intent === 'string' && VALID_INTENTS.includes(customData.intent as CallIntent)) {
        intent = customData.intent as CallIntent;
      } else {
        const sum = (
          call?.call_analysis?.call_summary ||
          (callData.call_analysis as any)?.call_summary ||
          ''
        ).toLowerCase();

        if (sum.includes('rate') || sum.includes('quote') || sum.includes('price') || sum.includes('freight')) intent = 'RATE_QUOTE';
        else if (sum.includes('track') || sum.includes('consignment') || sum.includes('lr') || sum.includes('location')) intent = 'TRACKING';
        else if (sum.includes('book') || sum.includes('pickup') || sum.includes('vehicle request')) intent = 'BOOKING';
        else if (sum.includes('area') || sum.includes('corridor') || sum.includes('hub') || sum.includes('network')) intent = 'SERVICE_AREA';
        else if (sum.includes('complain') || sum.includes('delay') || sum.includes('damaged') || sum.includes('late')) intent = 'COMPLAINT';
        else if (sum.includes('human') || sum.includes('manager') || sum.includes('dispatcher') || sum.includes('transfer')) intent = 'HUMAN_REQUEST';
        else if (sum.includes('account') || sum.includes('existing customer')) intent = 'EXISTING_CUSTOMER';
        else if (sum.includes('unsupported') || sum.includes('international') || sum.includes('air freight')) intent = 'UNSUPPORTED_REQUEST';
      }

      const durationMs = call?.duration_ms || (callData.duration_ms as number);
      const durationSeconds = durationMs ? Math.round(durationMs / 1000) : (call?.duration_seconds || (callData.duration_seconds as number) || 0);

      // Deterministic outcome mapping governed by code and DB, NOT LLM analysis
      let outcome: CallOutcome = 'COMPLETED';
      const reason = (call?.disconnection_reason || (callData.disconnection_reason as string) || '').toLowerCase();

      // Check verified transfer / callback from DB
      const existingCallRecord = await db.getCallByExternalId(externalCallId, tenantId);
      const callAuditEvents = await db.listAuditEvents(tenantId, 50);
      const relevantAudit = callAuditEvents.filter(
        (a) => a.call_id === externalCallId || (existingCallRecord && a.call_id === existingCallRecord.id)
      );

      const hasConfirmedTransfer = relevantAudit.some(
        (a) => a.event_type === 'CALL_ESCALATED' && (a.details as Record<string, unknown>)?.provider_confirmed === true
      );

      const requestsForCall = await db.listRequests(tenantId);
      const hasDurableCallback = requestsForCall.some(
        (r) => (r.call_id === externalCallId || (existingCallRecord && r.call_id === existingCallRecord.id)) && r.type === 'CALLBACK_REQUEST'
      );

      if (hasConfirmedTransfer) {
        outcome = 'TRANSFERRED';
      } else if (hasDurableCallback) {
        outcome = 'CALLBACK_SCHEDULED';
      } else if (reason.includes('miss') || reason.includes('no_answer') || reason.includes('timeout')) {
        outcome = 'MISSED';
      } else if (reason.includes('fail') || reason.includes('error')) {
        outcome = 'FAILED';
      } else if (reason.includes('user_hangup') && durationSeconds < 10) {
        outcome = 'ABANDONED';
      }

      // Distinguish caller-captured/unverified facts from verified operational facts
      const rawFacts = ((customData.facts as any) || {}) as Record<string, unknown>;
      const capturedFacts: Partial<CallFacts> = {
        route_from: typeof rawFacts.route_from === 'string' ? rawFacts.route_from : undefined,
        route_to: typeof rawFacts.route_to === 'string' ? rawFacts.route_to : undefined,
        weight: typeof rawFacts.weight === 'string' ? rawFacts.weight : undefined,
        quantity: typeof rawFacts.quantity === 'string' ? rawFacts.quantity : undefined,
        vehicle_type: typeof rawFacts.vehicle_type === 'string' ? rawFacts.vehicle_type : undefined,
        material_type: typeof rawFacts.material_type === 'string' ? rawFacts.material_type : undefined,
        pickup_date: typeof rawFacts.pickup_date === 'string' ? rawFacts.pickup_date : undefined,
        pickup_time: typeof rawFacts.pickup_time === 'string' ? rawFacts.pickup_time : undefined,
        special_requirements: typeof rawFacts.special_requirements === 'string' ? rawFacts.special_requirements : undefined,
      };

      // Verified operational facts MUST come from tool execution / DB records
      const quoteAuditEvent = relevantAudit.find(
        (a) => a.event_type === 'TOOL_EXECUTION' && a.tool_name === 'get_rate_quote' && (a.details as Record<string, unknown>)?.success === true
      );
      if (quoteAuditEvent) {
        const d = (quoteAuditEvent.details as Record<string, unknown>) || {};
        if (typeof d.price_inr === 'number') {
          capturedFacts.quoted_amount = d.price_inr;
          capturedFacts.quote_type = d.supports_confirmed_quote ? 'CONFIRMED' : 'ESTIMATE';
        }
      }

      const trackingAuditEvent = relevantAudit.find(
        (a) => a.event_type === 'TOOL_EXECUTION' && a.tool_name === 'get_tracking_status' && (a.details as Record<string, unknown>)?.success === true
      );
      if (trackingAuditEvent) {
        const d = (trackingAuditEvent.details as Record<string, unknown>) || {};
        if (typeof d.tracking_id === 'string') {
          capturedFacts.tracking_id = d.tracking_id;
          capturedFacts.tracking_status = typeof d.status === 'string' ? d.status : undefined;
          capturedFacts.tracking_location = typeof d.current_location === 'string' ? d.current_location : undefined;
          capturedFacts.verified_eta = typeof d.eta === 'string' ? d.eta : undefined;
        }
      }

      if (hasConfirmedTransfer) {
        capturedFacts.transfer_status = 'TRANSFERRED';
      } else if (hasDurableCallback) {
        capturedFacts.transfer_status = 'CALLBACK_SCHEDULED';
      }

      // Convert Retell transcript object to domain transcript turns
      const rawTranscript = (call?.transcript_object || (callData.transcript_object as any) || []) as Array<{
        role: string;
        content: string;
      }>;
      const transcriptTurns: TranscriptTurn[] = rawTranscript.map((t, idx) => ({
        speaker: t.role === 'agent' ? ('agent' as const) : ('caller' as const),
        text: t.content,
        timestamp: `${idx}`,
      }));

      // Execute authoritative post-call processing pipeline exactly once
      const result = await processPostCallPipeline({
        external_call_id: externalCallId,
        from_number: normalizedFrom,
        caller_name: call?.caller_name || (callData.caller_name as string) || (customData.caller_name as string),
        summary: call?.call_analysis?.call_summary || (callData.call_analysis as any)?.call_summary || 'Call concluded via Retell agent.',
        recording_url: call?.recording_url || (callData.recording_url as string),
        transcript: transcriptTurns,
        duration_seconds: durationSeconds,
        intent,
        sentiment,
        outcome,
        facts: capturedFacts,
        is_escalated: hasConfirmedTransfer || Boolean(customData.is_escalated),
        escalation_reason: customData.escalation_reason as string | undefined,
        tenant_id: tenantId,
      });

      return NextResponse.json({
        success: result.success,
        event: 'call_analyzed_processed',
        call_id: result.call_id,
        external_call_id: externalCallId,
        lead_temperature: result.lead_temperature,
        sheets_status: result.sheets_status,
        followup_status: result.followup_status,
        correlation_id: correlation.correlationId,
      });
    }

    return NextResponse.json(
      { error: 'Unhandled event type', correlation_id: correlation.correlationId },
      { status: 400 }
    );
  } catch (error) {
    logError(correlation, 'RETELL_WEBHOOK_ERROR', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Internal webhook processing error',
        correlation_id: correlation.correlationId,
      },
      { status: 500 }
    );
  }
}
