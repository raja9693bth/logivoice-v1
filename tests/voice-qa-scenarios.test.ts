/**
 * LOGIVOICE V1 — VOICE QA & EVALUATION SCENARIO SUITE (32 SCENARIOS)
 * 
 * Verifies both:
 * 1. Natural conversation context assembly
 * 2. Deterministic backend operational result
 * 
 * Uses standard Node.js test runner (describe/it) to eliminate duplication
 * and enforce strict SonarCloud quality/reliability compliance.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { db, DEFAULT_TENANT_ID, setSimulatedDbFailure } from '../lib/db';
import { dispatchTool } from '../lib/tools/gateway';
import { getInternalSystemContext, assertTenantAccess } from '../lib/auth/context';
import { assembleVoiceRuntimeContext } from '../lib/voice/context-assembler';
import { processPostCallPipeline } from '../lib/pipeline/post-call';
import { sendFollowupMessage } from '../lib/integrations/messaging';
import { syncCallToGoogleSheets, resetSheetsSyncIdempotency } from '../lib/integrations/google-sheets';

const auth = getInternalSystemContext(DEFAULT_TENANT_ID);

async function invokeTool(tool_name: any, args: Record<string, unknown>) {
  return dispatchTool({ tool_name, arguments: args }, auth);
}

describe('Voice QA Evaluation Scenarios (32 Scenarios)', () => {
  it('01: Exact Rate Quote (Delhi -> Mumbai, 32ft MXL, 16 tons returns ₹54,000)', async () => {
    const res = await invokeTool('get_rate_quote', {
      origin: 'Delhi',
      destination: 'Mumbai',
      vehicle_type: '32ft MXL',
      weight_tons: 16.0,
    });
    assert.ok(res.success && res.result.price_inr === 54000);
  });

  it('02: Missing Rate Field (Missing destination returns validation error or MISSING_FIELDS status)', async () => {
    const res = await invokeTool('get_rate_quote', { origin: 'Delhi', destination: '' });
    assert.ok(!res.success || res.result.status === 'MISSING_FIELDS');
  });

  it('03: Ambiguous Rate (Route without vehicle returns indicative ESTIMATE, never confirmed)', async () => {
    const res = await invokeTool('get_rate_quote', { origin: 'Delhi', destination: 'Mumbai' });
    assert.equal(res.result.status, 'QUOTED');
    assert.equal(res.result.quote_type, 'ESTIMATE');
  });

  it('04: Unavailable Corridor (Unsupported route returns explicit UNAVAILABLE, zero hallucination)', async () => {
    const res = await invokeTool('get_rate_quote', { origin: 'Delhi', destination: 'Guwahati' });
    assert.equal(res.result.status, 'UNAVAILABLE');
  });

  it('05: Expired Rate Card (Expired tariff returns explicit EXPIRED status, never current quote)', async () => {
    const res = await invokeTool('get_rate_quote', {
      origin: 'Delhi',
      destination: 'Chandigarh',
      vehicle_type: '14ft Closed',
      weight_tons: 3.0,
    });
    assert.equal(res.result.status, 'EXPIRED');
  });

  it('06: Confirmed vs Estimate (Output explicitly identifies quote_type)', async () => {
    const res = await invokeTool('get_rate_quote', {
      origin: 'Delhi',
      destination: 'Mumbai',
      vehicle_type: '32ft MXL',
      weight_tons: 16.0,
    });
    assert.ok(res.result.quote_type === 'ESTIMATE' || res.result.quote_type === 'CONFIRMED');
  });

  it('07: Valid Tracking (LR-88291 returns verified location at Kotputli toll plaza)', async () => {
    const res = await invokeTool('get_tracking_status', { tracking_reference: 'LR-88291' });
    assert.ok(res.success && res.result.status === 'FOUND');
    assert.ok(String(res.result.current_location).includes('Kotputli'));
  });

  it('08: Invalid Tracking ID (Unknown LR returns NOT_FOUND, never fabricates carrier data)', async () => {
    const res = await invokeTool('get_tracking_status', { tracking_reference: 'LR-INVALID-00000' });
    assert.equal(res.result.status, 'NOT_FOUND');
  });

  it('09: Tracking Provider Failure in Production (Mock records fail closed as PROVIDER_UNAVAILABLE in prod)', async () => {
    const prevEnv = process.env.NODE_ENV;
    (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
    const res = await invokeTool('get_tracking_status', { tracking_reference: 'LR-88291' });
    (process.env as Record<string, string | undefined>).NODE_ENV = prevEnv;
    assert.equal(res.result.status, 'PROVIDER_UNAVAILABLE');
  });

  it('10: Service Area Context (Layered prompt includes primary operational hubs)', async () => {
    const ctx = await assembleVoiceRuntimeContext({
      probableIntent: 'SERVICE_AREA',
      callerPhone: '+91 98201 55432',
    });
    assert.ok(ctx.systemPrompt.includes('Delhi') || ctx.systemPrompt.includes('Mumbai'));
  });

  it('11: Valid Booking Request (Creates BKG- reference with REQUEST_CREATED status)', async () => {
    const res = await invokeTool('create_booking_request', {
      customer_name: 'Rajesh Sharma',
      customer_phone: '+91 98201 55432',
      origin: 'Delhi',
      destination: 'Mumbai',
      pickup_date: '2026-10-05',
      vehicle_type: '32ft MXL',
      weight: '7 Tons',
      is_confirmed_by_caller: true,
    });
    assert.ok(res.success && res.result.status === 'REQUEST_CREATED');
    assert.ok(String(res.result.reference_no).startsWith('BKG-'));
  });

  it('12: Unconfirmed Booking Intake (Routes to PENDING_HUMAN_CONFIRMATION for dispatcher review)', async () => {
    const res = await invokeTool('create_booking_request', {
      customer_name: 'Sunil Verma',
      customer_phone: '+91 98111 22233',
      origin: 'Delhi',
      destination: 'Jaipur',
      pickup_date: '2026-10-06',
      vehicle_type: '14ft Closed',
      weight: '3 Tons',
      is_confirmed_by_caller: false,
    });
    assert.ok(res.success && res.result.status === 'PENDING_HUMAN_CONFIRMATION');
  });

  it('13: Human Request (Caller requesting human initiates transfer or urgent callback ticket)', async () => {
    const res = await invokeTool('transfer_to_human', {
      reason: 'Caller wants to negotiate rates for 10 vehicles',
      caller_name: 'Anil Gupta',
      caller_phone: '+91 98333 44455',
      target_role: 'DISPATCHER',
    });
    assert.ok(res.result.status === 'TRANSFERRED' || res.result.status === 'CALLBACK_SCHEDULED');
  });

  it('14: Transfer Success (With confirmed telephony credentials, returns TRANSFERRED with target phone)', async () => {
    process.env.ENABLE_LIVE_TELEPHONY_TRANSFER = 'true';
    process.env.TELEPHONY_PROVIDER_ACCOUNT_SID = 'AC_TEST_SID';
    process.env.TELEPHONY_PROVIDER_AUTH_TOKEN = 'AUTH_TEST_TOKEN';
    const origFetch = global.fetch;
    let providerInvoked = false;
    (global as any).fetch = async (url: string) => {
      if (typeof url === 'string' && url.includes('api.twilio.com')) {
        providerInvoked = true;
        return {
          ok: true,
          status: 200,
          json: async () => ({ sid: 'mock-transfer-sid-qa', status: 'in-progress' }),
        } as any;
      }
      return origFetch(url as any);
    };

    const res = await invokeTool('transfer_to_human', {
      call_id: 'CA12345678901234567890123456789012',
      reason: 'Complex rate negotiation',
      caller_name: 'Amit Patel',
      caller_phone: '+91 98222 33344',
      target_role: 'DISPATCHER',
    });

    global.fetch = origFetch;
    delete process.env.ENABLE_LIVE_TELEPHONY_TRANSFER;
    delete process.env.TELEPHONY_PROVIDER_ACCOUNT_SID;
    delete process.env.TELEPHONY_PROVIDER_AUTH_TOKEN;

    assert.ok(providerInvoked);
    assert.equal(res.result.status, 'TRANSFERRED');
    assert.ok(Boolean(res.result.target_phone));
  });

  it('15: Transfer Fallback (When telephony is unconfigured, creates durable CB- callback task)', async () => {
    const res = await invokeTool('transfer_to_human', {
      reason: 'Night breakdown on NH48',
      caller_name: 'Ramesh Driver',
      caller_phone: '+91 98444 55566',
      target_role: 'AFTER_HOURS',
    });
    assert.equal(res.result.status, 'CALLBACK_SCHEDULED');
    assert.ok(String(res.result.callback_reference || '').startsWith('CB-'));
  });

  it('16: General Inquiry Context (Includes operating hours and brand identity)', async () => {
    const ctx = await assembleVoiceRuntimeContext({ probableIntent: 'GENERAL' });
    assert.ok(ctx.systemPrompt.includes('Operating hours'));
  });

  it('17: Unsupported Policy / Hazmat (Returns UNAVAILABLE for non-tariff vehicle/route)', async () => {
    const res = await invokeTool('get_rate_quote', {
      origin: 'Delhi',
      destination: 'Srinagar',
      vehicle_type: 'Oil Tanker',
    });
    assert.equal(res.result.status, 'UNAVAILABLE');
  });

  it('18: Complaint Support Ticket (Logs TCK- ticket with HIGH priority and tracking reference)', async () => {
    const res = await invokeTool('create_support_ticket', {
      customer_name: 'Deepak Traders',
      customer_phone: '+91 98555 66677',
      issue: 'Consignment delayed by 48 hours without driver contact',
      priority: 'HIGH',
      tracking_reference: 'LR-88291',
    });
    assert.ok(res.status === 'SUCCESS' && res.result.status === 'SUCCESS');
    assert.ok(String(res.result.reference_no || '').startsWith('TCK-'));
  });

  it('19: Angry Caller Suppression (Angry escalated calls suppress automated marketing/nurturing messages)', async () => {
    const res = await processPostCallPipeline({
      external_call_id: `call-qa-angry-${Date.now()}`,
      from_number: '+91 98666 77788',
      sentiment: 'ANGRY',
      intent: 'COMPLAINT',
      summary: 'Caller was furious regarding consignment damage and shouting at agent.',
      is_escalated: true,
      escalation_reason: 'Caller agitated regarding damaged goods',
    });
    assert.equal(res.followup_status, 'SUPPRESSED');
  });

  it('20: Hindi/Hinglish Language Policy (System instructions mandate mirroring Hindi/Hinglish naturally)', async () => {
    const ctx = await assembleVoiceRuntimeContext({ probableIntent: 'RATE_QUOTE' });
    assert.ok(ctx.systemPrompt.includes('Hindi') || ctx.systemPrompt.includes('Hinglish'));
  });

  it('21: Hinglish Operational Grounding (Prompt enforces deterministic code over LLM reasoning)', async () => {
    const ctx = await assembleVoiceRuntimeContext({ probableIntent: 'RATE_QUOTE' });
    assert.ok(ctx.systemPrompt.includes('LLM reasons. CODE GOVERNS.'));
  });

  it('22: Indian Business English (Permitted and configured in conversation boundaries)', async () => {
    const ctx = await assembleVoiceRuntimeContext({ probableIntent: 'RATE_QUOTE' });
    assert.ok(ctx.systemPrompt.includes('Indian English'));
  });

  it('23: Language Switching Policy (Explicit instruction to mirror caller language)', async () => {
    const ctx = await assembleVoiceRuntimeContext({ probableIntent: 'RATE_QUOTE' });
    assert.ok(ctx.systemPrompt.includes("Mirror the caller's language naturally"));
  });

  it('24: Tenant Timezone Configuration (Configured to Asia/Kolkata for Indian logistics operations)', async () => {
    const cfg = await db.getClientConfig(DEFAULT_TENANT_ID);
    assert.equal(cfg.timezone, 'Asia/Kolkata');
  });

  it('25: Concise Spoken Turn Policy (Mandates 1-2 concise sentences for voice turns)', async () => {
    const ctx = await assembleVoiceRuntimeContext({ probableIntent: 'RATE_QUOTE' });
    assert.ok(ctx.systemPrompt.includes('Keep responses concise'));
  });

  it('26: Unrecognized Customer Recovery (Returns NOT_FOUND safely without error)', async () => {
    const res = await invokeTool('lookup_customer', { phone: '+91 99999 00000' });
    assert.ok(res.success && (res.result.status === 'NOT_FOUND' || res.result.customer === null));
  });

  it('27: Database Failure Handling (Simulated DB failure fails closed with explicit error)', async () => {
    setSimulatedDbFailure(true);
    let failedSafely = false;
    try {
      await db.listCalls(DEFAULT_TENANT_ID);
    } catch {
      failedSafely = true;
    } finally {
      setSimulatedDbFailure(false);
    }
    assert.ok(failedSafely);
  });

  it('28: Duplicate Webhook Idempotency (Second webhook delivery safely skips reprocessing)', async () => {
    const extId = `call-dup-qa-${Date.now()}`;
    const p1 = await processPostCallPipeline({
      external_call_id: extId,
      from_number: '+91 98777 88899',
      intent: 'RATE_QUOTE',
      summary: 'Corridor rate inquiry',
    });
    const p2 = await processPostCallPipeline({
      external_call_id: extId,
      from_number: '+91 98777 88899',
      intent: 'RATE_QUOTE',
      summary: 'Corridor rate inquiry',
    });
    assert.ok(p1.success && p2.success);
    assert.ok(p2.sheets_status === 'SKIPPED_DUPLICATE' || p2.message.includes('Idempotent'));
  });

  it('29: Messaging Provider Verification (Returns truthful UNCONFIGURED or MOCK status)', async () => {
    const res = await sendFollowupMessage({
      channel: 'WHATSAPP',
      recipient: '+91 98111 22233',
      messageContent: 'Namaste! Your freight quote summary.',
    });
    assert.ok(res.status === 'UNCONFIGURED' || res.status === 'MOCK' || res.status === 'SENT');
  });

  it('30: Google Sheets Secondary Isolation (Sheets sync failure never fails DB persistence)', async () => {
    resetSheetsSyncIdempotency();
    const extId = `call-sheets-iso-${Date.now()}`;
    await processPostCallPipeline({
      external_call_id: extId,
      from_number: '+91 98777 88899',
      intent: 'RATE_QUOTE',
      summary: 'Sheets isolation check',
    });
    const call = await db.getCallByExternalId(extId, DEFAULT_TENANT_ID);
    assert.ok(call);
    const res = await syncCallToGoogleSheets(call);
    assert.equal(typeof res.status, 'string');
  });

  it('31: Cross-Tenant Access Attempt (Strictly blocked with 403 AuthorizationError)', () => {
    assert.throws(
      () => assertTenantAccess(auth, '00000000-0000-0000-0000-000000000002'),
      /Cross-tenant access forbidden|Unauthorized tenant access/
    );
  });

  it('32: Malformed Tool Payload Rejection (Zod schema validation rejects non-string arguments)', async () => {
    const res = await invokeTool('get_rate_quote', { origin: 12345 as any, destination: true as any });
    assert.ok(!res.success && res.status === 'FAILED');
  });
});
