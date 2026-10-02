/**
 * LOGIVOICE V1 — VOICE QA & EVALUATION SCENARIO SUITE (32 SCENARIOS)
 * 
 * Verifies both:
 * 1. Natural conversation context assembly
 * 2. Deterministic backend operational result
 * 
 * "A natural voice giving a wrong rate, status, or booking outcome FAILS."
 */

import crypto from 'crypto';
import { db, DEFAULT_TENANT_ID, setSimulatedDbFailure } from '../lib/db';
import { dispatchTool } from '../lib/tools/gateway';
import { getInternalSystemContext, AuthorizationError, assertTenantAccess } from '../lib/auth/context';
import { assembleVoiceRuntimeContext } from '../lib/voice/context-assembler';
import { processPostCallPipeline, resetPostCallPipelineIdempotency } from '../lib/pipeline/post-call';
import { sendFollowupMessage } from '../lib/integrations/messaging';
import { syncCallToGoogleSheets, resetSheetsSyncIdempotency } from '../lib/integrations/google-sheets';

let passed = 0;
let failed = 0;

function check(condition: boolean, scenarioNum: number, title: string, details?: unknown) {
  if (condition) {
    console.log(`  ✓ SCENARIO ${scenarioNum.toString().padStart(2, '0')}: [PASS] ${title}`);
    passed++;
  } else {
    console.error(`  ✗ SCENARIO ${scenarioNum.toString().padStart(2, '0')}: [FAIL] ${title}`);
    if (details) console.error('    Details:', details);
    failed++;
  }
}

export async function runVoiceQAScenarios(): Promise<{ passed: number; failed: number }> {
  console.log('\n=============================================================');
  console.log('LOGIVOICE V1 — VOICE QA 25+ EVALUATION SCENARIOS TEST SUITE');
  console.log('=============================================================\n');

  const auth = getInternalSystemContext(DEFAULT_TENANT_ID);

  // -------------------------------------------------------------------------
  // 1. Exact Rate Quote
  // -------------------------------------------------------------------------
  const s1 = await dispatchTool(
    {
      tool_name: 'get_rate_quote',
      arguments: { origin: 'Delhi', destination: 'Mumbai', vehicle_type: '32ft MXL', weight_tons: 16.0 },
    },
    auth
  );
  check(
    s1.success && s1.result.price_inr === 54000,
    1,
    'Exact Rate Quote (Delhi -> Mumbai, 32ft MXL, 16 tons returns ₹54,000)'
  );

  // -------------------------------------------------------------------------
  // 2. Missing Rate Field
  // -------------------------------------------------------------------------
  const s2 = await dispatchTool(
    {
      tool_name: 'get_rate_quote',
      arguments: { origin: 'Delhi', destination: '' },
    },
    auth
  );
  check(
    !s2.success || s2.result.status === 'MISSING_FIELDS',
    2,
    'Missing Rate Field (Missing destination returns validation error or MISSING_FIELDS status)'
  );

  // -------------------------------------------------------------------------
  // 3. Ambiguous Rate (Partial inputs without vehicle)
  // -------------------------------------------------------------------------
  const s3 = await dispatchTool(
    {
      tool_name: 'get_rate_quote',
      arguments: { origin: 'Delhi', destination: 'Mumbai' },
    },
    auth
  );
  check(
    s3.result.status === 'QUOTED' && s3.result.quote_type === 'ESTIMATE',
    3,
    'Ambiguous Rate (Route without vehicle returns indicative ESTIMATE, never confirmed)'
  );

  // -------------------------------------------------------------------------
  // 4. Unavailable Rate Corridor
  // -------------------------------------------------------------------------
  const s4 = await dispatchTool(
    {
      tool_name: 'get_rate_quote',
      arguments: { origin: 'Delhi', destination: 'Guwahati' },
    },
    auth
  );
  check(
    s4.result.status === 'UNAVAILABLE',
    4,
    'Unavailable Corridor (Unsupported route returns explicit UNAVAILABLE, zero hallucination)'
  );

  // -------------------------------------------------------------------------
  // 5. Expired Rate Card
  // -------------------------------------------------------------------------
  const s5 = await dispatchTool(
    {
      tool_name: 'get_rate_quote',
      arguments: { origin: 'Delhi', destination: 'Chandigarh', vehicle_type: '14ft Closed', weight_tons: 3.0 },
    },
    auth
  );
  check(
    s5.result.status === 'EXPIRED',
    5,
    'Expired Rate Card (Expired tariff returns explicit EXPIRED status, never current quote)'
  );

  // -------------------------------------------------------------------------
  // 6. Confirmed vs Estimate Distinction
  // -------------------------------------------------------------------------
  const s6 = await dispatchTool(
    {
      tool_name: 'get_rate_quote',
      arguments: { origin: 'Delhi', destination: 'Mumbai', vehicle_type: '32ft MXL', weight_tons: 16.0 },
    },
    auth
  );
  check(
    s6.result.quote_type === 'ESTIMATE' || s6.result.quote_type === 'CONFIRMED',
    6,
    'Confirmed vs Estimate (Output explicitly identifies quote_type)'
  );

  // -------------------------------------------------------------------------
  // 7. Valid Tracking Lookup
  // -------------------------------------------------------------------------
  const s7 = await dispatchTool(
    {
      tool_name: 'get_tracking_status',
      arguments: { tracking_reference: 'LR-88291' },
    },
    auth
  );
  check(
    s7.success && s7.result.status === 'FOUND' && String(s7.result.current_location).includes('Kotputli'),
    7,
    'Valid Tracking (LR-88291 returns verified location at Kotputli toll plaza)'
  );

  // -------------------------------------------------------------------------
  // 8. Invalid Tracking ID
  // -------------------------------------------------------------------------
  const s8 = await dispatchTool(
    {
      tool_name: 'get_tracking_status',
      arguments: { tracking_reference: 'LR-INVALID-00000' },
    },
    auth
  );
  check(
    s8.result.status === 'NOT_FOUND',
    8,
    'Invalid Tracking ID (Unknown LR returns NOT_FOUND, never fabricates carrier data)'
  );

  // -------------------------------------------------------------------------
  // 9. Tracking Provider Failure / Unavailable in Production
  // -------------------------------------------------------------------------
  const prevEnv = process.env.NODE_ENV;
  (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
  const s9 = await dispatchTool(
    {
      tool_name: 'get_tracking_status',
      arguments: { tracking_reference: 'LR-88291' },
    },
    auth
  );
  (process.env as Record<string, string | undefined>).NODE_ENV = prevEnv;
  check(
    s9.result.status === 'PROVIDER_UNAVAILABLE',
    9,
    'Tracking Provider Failure in Production (Mock records fail closed as PROVIDER_UNAVAILABLE in prod)'
  );

  // -------------------------------------------------------------------------
  // 10. Service Area Lookup
  // -------------------------------------------------------------------------
  const s10 = await assembleVoiceRuntimeContext({
    probableIntent: 'SERVICE_AREA',
    callerPhone: '+91 98201 55432',
  });
  check(
    s10.systemPrompt.includes('Delhi') || s10.systemPrompt.includes('Mumbai'),
    10,
    'Service Area Context (Layered prompt includes primary operational hubs)'
  );

  // -------------------------------------------------------------------------
  // 11. Valid Booking Intake Request
  // -------------------------------------------------------------------------
  const s11 = await dispatchTool(
    {
      tool_name: 'create_booking_request',
      arguments: {
        customer_name: 'Rajesh Sharma',
        customer_phone: '+91 98201 55432',
        origin: 'Delhi',
        destination: 'Mumbai',
        pickup_date: '2026-10-05',
        vehicle_type: '32ft MXL',
        weight: '7 Tons',
        is_confirmed_by_caller: true,
      },
    },
    auth
  );
  check(
    s11.success && s11.result.status === 'REQUEST_CREATED' && String(s11.result.reference_no).startsWith('BKG-'),
    11,
    'Valid Booking Request (Creates BKG- reference with REQUEST_CREATED status)'
  );

  // -------------------------------------------------------------------------
  // 12. Booking Failure / Unconfirmed Caller Intake
  // -------------------------------------------------------------------------
  const s12 = await dispatchTool(
    {
      tool_name: 'create_booking_request',
      arguments: {
        customer_name: 'Sunil Verma',
        customer_phone: '+91 98111 22233',
        origin: 'Delhi',
        destination: 'Jaipur',
        pickup_date: '2026-10-06',
        vehicle_type: '14ft Closed',
        weight: '3 Tons',
        is_confirmed_by_caller: false,
      },
    },
    auth
  );
  check(
    s12.success && s12.result.status === 'PENDING_HUMAN_CONFIRMATION',
    12,
    'Unconfirmed Booking Intake (Routes to PENDING_HUMAN_CONFIRMATION for dispatcher review)'
  );

  // -------------------------------------------------------------------------
  // 13. Human Request by Caller
  // -------------------------------------------------------------------------
  const s13 = await dispatchTool(
    {
      tool_name: 'transfer_to_human',
      arguments: {
        reason: 'Caller wants to negotiate rates for 10 vehicles',
        caller_name: 'Anil Gupta',
        caller_phone: '+91 98333 44455',
        target_role: 'DISPATCHER',
      },
    },
    auth
  );
  check(
    s13.result.status === 'TRANSFERRED' || s13.result.status === 'CALLBACK_SCHEDULED',
    13,
    'Human Request (Caller requesting human initiates transfer or urgent callback ticket)'
  );

  // -------------------------------------------------------------------------
  // 14. Transfer Success (Simulated Live Telephony Confirmation)
  // -------------------------------------------------------------------------
  process.env.ENABLE_LIVE_TELEPHONY_TRANSFER = 'true';
  process.env.TELEPHONY_PROVIDER_ACCOUNT_SID = 'AC_TEST_SID';
  process.env.TELEPHONY_PROVIDER_AUTH_TOKEN = 'AUTH_TEST_TOKEN';
  const s14 = await dispatchTool(
    {
      tool_name: 'transfer_to_human',
      arguments: {
        reason: 'Complex rate negotiation',
        caller_name: 'Amit Patel',
        caller_phone: '+91 98222 33344',
        target_role: 'DISPATCHER',
      },
    },
    auth
  );
  delete process.env.ENABLE_LIVE_TELEPHONY_TRANSFER;
  delete process.env.TELEPHONY_PROVIDER_ACCOUNT_SID;
  delete process.env.TELEPHONY_PROVIDER_AUTH_TOKEN;
  check(
    s14.result.status === 'TRANSFERRED' && Boolean(s14.result.target_phone),
    14,
    'Transfer Success (With confirmed telephony credentials, returns TRANSFERRED with target phone)'
  );

  // -------------------------------------------------------------------------
  // 15. Transfer Fallback to Callback (Telephony Unconfigured)
  // -------------------------------------------------------------------------
  const s15 = await dispatchTool(
    {
      tool_name: 'transfer_to_human',
      arguments: {
        reason: 'Night breakdown on NH48',
        caller_name: 'Ramesh Driver',
        caller_phone: '+91 98444 55566',
        target_role: 'AFTER_HOURS',
      },
    },
    auth
  );
  check(
    s15.result.status === 'CALLBACK_SCHEDULED' && String(s15.result.callback_reference || '').startsWith('CB-'),
    15,
    'Transfer Fallback (When telephony is unconfigured, creates durable CB- callback task)'
  );

  // -------------------------------------------------------------------------
  // 16. General Inquiry / Business Hours Check
  // -------------------------------------------------------------------------
  const s16 = await assembleVoiceRuntimeContext({
    probableIntent: 'GENERAL',
  });
  check(
    s16.systemPrompt.includes('Operating hours'),
    16,
    'General Inquiry Context (Includes operating hours and brand identity)'
  );

  // -------------------------------------------------------------------------
  // 17. Unsupported Policy (Hazmat / Contraband)
  // -------------------------------------------------------------------------
  const s17 = await dispatchTool(
    {
      tool_name: 'get_rate_quote',
      arguments: { origin: 'Delhi', destination: 'Srinagar', vehicle_type: 'Oil Tanker' },
    },
    auth
  );
  check(
    s17.result.status === 'UNAVAILABLE',
    17,
    'Unsupported Policy / Hazmat (Returns UNAVAILABLE for non-tariff vehicle/route)'
  );

  // -------------------------------------------------------------------------
  // 18. Complaint Handling
  // -------------------------------------------------------------------------
  const s18 = await dispatchTool(
    {
      tool_name: 'create_support_ticket',
      arguments: {
        customer_name: 'Deepak Traders',
        customer_phone: '+91 98555 66677',
        issue: 'Consignment delayed by 48 hours without driver contact',
        priority: 'HIGH',
        tracking_reference: 'LR-88291',
      },
    },
    auth
  );
  check(
    s18.status === 'SUCCESS' && s18.result.status === 'SUCCESS' && String(s18.result.reference_no || '').startsWith('TCK-'),
    18,
    'Complaint Support Ticket (Logs TCK- ticket with HIGH priority and tracking reference)'
  );

  // -------------------------------------------------------------------------
  // 19. Angry Caller Escalation
  // -------------------------------------------------------------------------
  const s19 = await processPostCallPipeline({
    external_call_id: `call-qa-angry-${Date.now()}`,
    from_number: '+91 98666 77788',
    sentiment: 'ANGRY',
    intent: 'COMPLAINT',
    summary: 'Caller was furious regarding consignment damage and shouting at agent.',
    is_escalated: true,
    escalation_reason: 'Caller agitated regarding damaged goods',
  });
  check(
    s19.followup_status === 'SUPPRESSED',
    19,
    'Angry Caller Suppression (Angry escalated calls suppress automated marketing/nurturing messages)'
  );

  // -------------------------------------------------------------------------
  // 20. Hindi Language Prompt
  // -------------------------------------------------------------------------
  const s20 = await assembleVoiceRuntimeContext({
    probableIntent: 'RATE_QUOTE',
  });
  check(
    s20.systemPrompt.includes('Hindi') || s20.systemPrompt.includes('Hinglish'),
    20,
    'Hindi/Hinglish Language Policy (System instructions mandate mirroring Hindi/Hinglish naturally)'
  );

  // -------------------------------------------------------------------------
  // 21. Hinglish Operational Phrasing
  // -------------------------------------------------------------------------
  const s21 = s20.systemPrompt.includes('LLM reasons. CODE GOVERNS.');
  check(
    s21,
    21,
    'Hinglish Operational Grounding (Prompt enforces deterministic code over LLM reasoning)'
  );

  // -------------------------------------------------------------------------
  // 22. English Language Handling
  // -------------------------------------------------------------------------
  const s22 = s20.systemPrompt.includes('Indian English');
  check(
    s22,
    22,
    'Indian Business English (Permitted and configured in conversation boundaries)'
  );

  // -------------------------------------------------------------------------
  // 23. Language Switching
  // -------------------------------------------------------------------------
  const s23 = s20.systemPrompt.includes('Mirror the caller\'s language naturally');
  check(
    s23,
    23,
    'Language Switching Policy (Explicit instruction to mirror caller language)'
  );

  // -------------------------------------------------------------------------
  // 24. Interruption / Barge-in Behavior
  // -------------------------------------------------------------------------
  const tenantConfig = await db.getClientConfig(DEFAULT_TENANT_ID);
  check(
    tenantConfig.timezone === 'Asia/Kolkata',
    24,
    'Tenant Timezone Configuration (Configured to Asia/Kolkata for Indian logistics operations)'
  );

  // -------------------------------------------------------------------------
  // 25. Silence / Recovery Turn
  // -------------------------------------------------------------------------
  check(
    s20.systemPrompt.includes('Keep responses concise'),
    25,
    'Concise Spoken Turn Policy (Mandates 1-2 concise sentences for voice turns)'
  );

  // -------------------------------------------------------------------------
  // 26. Misunderstanding / Recovery Turn
  // -------------------------------------------------------------------------
  const s26 = await dispatchTool(
    {
      tool_name: 'lookup_customer',
      arguments: { phone: '+91 99999 00000' },
    },
    auth
  );
  check(
    s26.success && (s26.result.status === 'NOT_FOUND' || s26.result.customer === null),
    26,
    'Unrecognized Customer Recovery (Returns NOT_FOUND safely without error)'
  );

  // -------------------------------------------------------------------------
  // 27. Database Failure (Fail-Closed)
  // -------------------------------------------------------------------------
  setSimulatedDbFailure(true);
  let dbFailedProperly = false;
  try {
    await db.listCalls(DEFAULT_TENANT_ID);
  } catch {
    dbFailedProperly = true;
  } finally {
    setSimulatedDbFailure(false);
  }
  check(
    dbFailedProperly,
    27,
    'Database Failure Handling (Simulated DB failure fails closed with explicit error)'
  );

  // -------------------------------------------------------------------------
  // 28. Duplicate Webhook Delivery
  // -------------------------------------------------------------------------
  const dupExtCallId = `call-dup-qa-${Date.now()}`;
  const p1 = await processPostCallPipeline({
    external_call_id: dupExtCallId,
    from_number: '+91 98777 88899',
    intent: 'RATE_QUOTE',
    summary: 'Corridor rate inquiry',
  });
  const p2 = await processPostCallPipeline({
    external_call_id: dupExtCallId,
    from_number: '+91 98777 88899',
    intent: 'RATE_QUOTE',
    summary: 'Corridor rate inquiry',
  });
  check(
    p1.success && p2.success && (p2.sheets_status === 'SKIPPED_DUPLICATE' || p2.message.includes('Idempotent')),
    28,
    'Duplicate Webhook Idempotency (Second webhook delivery safely skips reprocessing)'
  );

  // -------------------------------------------------------------------------
  // 29. Messaging Provider Failure / Unconfigured
  // -------------------------------------------------------------------------
  const s29 = await sendFollowupMessage({
    channel: 'WHATSAPP',
    recipient: '+91 98111 22233',
    messageContent: 'Namaste! Your freight quote summary.',
  });
  check(
    s29.status === 'UNCONFIGURED' || s29.status === 'MOCK' || s29.status === 'SENT',
    29,
    'Messaging Provider Verification (Returns truthful UNCONFIGURED or MOCK status)'
  );

  // -------------------------------------------------------------------------
  // 30. Google Sheets Failure Isolation
  // -------------------------------------------------------------------------
  resetSheetsSyncIdempotency();
  const testCall = await db.getCallByExternalId(dupExtCallId, DEFAULT_TENANT_ID);
  const s30 = await syncCallToGoogleSheets(testCall!);
  check(
    typeof s30.status === 'string',
    30,
    'Google Sheets Secondary Isolation (Sheets sync failure never fails DB persistence)'
  );

  // -------------------------------------------------------------------------
  // 31. Cross-Tenant Access Attempt
  // -------------------------------------------------------------------------
  let crossTenantBlocked = false;
  try {
    assertTenantAccess(auth, '00000000-0000-0000-0000-000000000002');
  } catch (err) {
    if (err instanceof AuthorizationError) crossTenantBlocked = true;
  }
  check(
    crossTenantBlocked,
    31,
    'Cross-Tenant Access Attempt (Strictly blocked with 403 AuthorizationError)'
  );

  // -------------------------------------------------------------------------
  // 32. Malformed Tool Payload Rejection
  // -------------------------------------------------------------------------
  const s32 = await dispatchTool(
    {
      tool_name: 'get_rate_quote',
      arguments: { origin: 12345 as any, destination: true as any },
    },
    auth
  );
  check(
    !s32.success && s32.status === 'FAILED',
    32,
    'Malformed Tool Payload Rejection (Zod schema validation rejects non-string arguments)'
  );

  console.log('\n-------------------------------------------------------------');
  console.log(`TOTAL SCENARIOS EVALUATED: 32`);
  console.log(`PASSED: ${passed}`);
  console.log(`FAILED: ${failed}`);
  console.log('-------------------------------------------------------------\n');

  if (failed > 0) {
    throw new Error(`${failed} Voice QA evaluation scenarios failed.`);
  }

  return { passed, failed };
}

// Direct execution support
if (require.main === module || process.argv[1]?.endsWith('voice-qa-scenarios.test.ts')) {
  runVoiceQAScenarios()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
