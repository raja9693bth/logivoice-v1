/**
 * LOGIVOICE V1 — COMPREHENSIVE FORENSIC AUTOMATED TEST SUITE
 * 
 * Covers:
 * 1. Rate Engine: Standard (ESTIMATE), Pre-Authorized (CONFIRMED), Expired, Unsupported
 * 2. Retell Verification: HMAC-SHA256 Raw-Body Signature, Invalid/Missing, Tool Allowlist
 * 3. API Authorization & RBAC: 401 Unauthenticated, 403 Role, 403 Tenant
 * 4. Production Database Fallback: Explicit DatabaseUnavailableError, No Mock Downgrade
 * 5. Provider Truthfulness: Google Sheets (UNCONFIGURED/MOCK), WhatsApp (UNCONFIGURED/OPTED_OUT/MOCK)
 * 6. Consignment Tracking: Verified LR, Unverified LR, Delayed LR
 * 7. Booking & Idempotency: Standard Intake, Unconfirmed Intake, Duplicate Replay
 * 8. Human Escalation: Configured Contact, Unreachable Fallback
 * 9. Knowledge Retrieval: Tenant Scoping, Intent Scoping, Compact Context Assembly
 * 10. Lead Temperature Engine: Deterministic Rules (HOT, WARM, COLD, REVIEW)
 * 11. Post-Call Pipeline: End-to-end Processing, Duplicate Prevention, Independent Failure Recovery
 * 12. The 10 Mandatory End-to-End Journeys (J1 to J10)
 */

import crypto from 'crypto';
import { db, DEFAULT_TENANT_ID, setSimulatedDbFailure, DatabaseUnavailableError } from '../lib/db';
import { dispatchTool } from '../lib/tools/gateway';
import {
  getAuthContext,
  requireAuth,
  requireRole,
  assertTenantAccess,
  AuthorizationError,
  verifyRetellWebhookSignature,
} from '../lib/auth/context';
import { retrieveRelevantKnowledge } from '../lib/knowledge/retrieval';
import { computeLeadTemperature } from '../lib/rules/lead-temperature';
import { processPostCallPipeline, resetPostCallPipelineIdempotency } from '../lib/pipeline/post-call';
import { assembleVoiceRuntimeContext } from '../lib/voice/context-assembler';
import { sendFollowupMessage } from '../lib/integrations/messaging';
import { syncCallToGoogleSheets, resetSheetsSyncIdempotency } from '../lib/integrations/google-sheets';

let passedTests = 0;
let failedTests = 0;

function assert(condition: boolean, testName: string, failureDetails?: unknown) {
  if (condition) {
    console.log(`  ✓ PASS: ${testName}`);
    passedTests++;
  } else {
    console.error(`  ✗ FAIL: ${testName}`);
    if (failureDetails) console.error('    Details:', failureDetails);
    failedTests++;
  }
}

async function runAllTests() {
  console.log('\n==================================================');
  console.log('LOGIVOICE V1 — FORENSIC BACKEND AUTOMATED TEST SUITE');
  console.log('==================================================\n');

  const auth = await getAuthContext();

  // =========================================================================
  // 1. RATE ENGINE & QUOTE SEMANTICS (CRITICAL FIX A)
  // =========================================================================
  console.log('\n--- GROUP 1: Rate Engine & Quote Semantics ---');
  {
    // A: Standard Tariff Matrix Quote -> ESTIMATE (Even with full inputs)
    const standardQuote = await dispatchTool(
      {
        tool_name: 'get_rate_quote',
        arguments: { origin: 'Delhi', destination: 'Mumbai', vehicle_type: '32ft MXL', weight_tons: 16 },
      },
      auth
    );
    assert(standardQuote.success && standardQuote.status === 'QUOTED', 'Standard quote retrieves active tariff');
    assert(standardQuote.result.price_inr === 54000, 'Tariff matches approved matrix price (₹54,000)');
    assert(
      standardQuote.result.quote_type === 'ESTIMATE',
      'CRITICAL: Standard rate card defaults to ESTIMATE even with full vehicle & weight inputs'
    );

    // B: Explicit Pre-Authorized Card -> CONFIRMED (rc-06: Mumbai -> Pune)
    const confirmedQuote = await dispatchTool(
      {
        tool_name: 'get_rate_quote',
        arguments: { origin: 'Mumbai', destination: 'Pune', vehicle_type: 'Tata Ace', weight_tons: 1.0 },
      },
      auth
    );
    assert(confirmedQuote.success && confirmedQuote.status === 'QUOTED', 'Confirmable rate card retrieves tariff');
    assert(
      confirmedQuote.result.quote_type === 'CONFIRMED',
      'CRITICAL: Pre-authorized confirmable rate card returns CONFIRMED quote'
    );

    // C: Partial inputs without vehicle -> ESTIMATE
    const estimatePartial = await dispatchTool(
      { tool_name: 'get_rate_quote', arguments: { origin: 'Delhi', destination: 'Mumbai' } },
      auth
    );
    assert(estimatePartial.result.quote_type === 'ESTIMATE', 'Quote without specific vehicle is an ESTIMATE');

    // D: Unsupported Corridor -> UNAVAILABLE (Zero hallucination)
    const unavail = await dispatchTool(
      { tool_name: 'get_rate_quote', arguments: { origin: 'Delhi', destination: 'Guwahati' } },
      auth
    );
    assert(
      unavail.status === 'UNAVAILABLE',
      'Unsupported route fails closed with UNAVAILABLE (never invents tariffs)'
    );

    // E: Expired Rate Card -> EXPIRED (rc-07: Delhi -> Chandigarh)
    const expiredQuote = await dispatchTool(
      {
        tool_name: 'get_rate_quote',
        arguments: { origin: 'Delhi', destination: 'Chandigarh', vehicle_type: '14ft Closed', weight_tons: 3.0 },
      },
      auth
    );
    assert(
      expiredQuote.status === 'EXPIRED',
      'Expired rate card is identified and rejected with EXPIRED status'
    );

    // F: Missing Required Fields -> Rejected
    const missingFields = await dispatchTool(
      { tool_name: 'get_rate_quote', arguments: { origin: 'Delhi', destination: '' } },
      auth
    );
    assert(!missingFields.success, 'Rate engine schema rejects missing destination');
  }

  // =========================================================================
  // 2. RETELL WEBHOOK & TOOL SECURITY (CRITICAL FIX B)
  // =========================================================================
  console.log('\n--- GROUP 2: Retell Cryptographic Signature & Tool Verification ---');
  {
    const secretKey = 'test-retell-secret-key-12345';
    process.env.RETELL_API_KEY = secretKey;

    const rawPayload = JSON.stringify({ event: 'call_ended', call: { call_id: 'call-xyz-123' } });
    const validSignature = crypto.createHmac('sha256', secretKey).update(rawPayload).digest('hex');

    // Valid Signature
    const isValid = verifyRetellWebhookSignature(rawPayload, validSignature);
    assert(isValid, 'Cryptographic raw-body HMAC-SHA256 signature verification succeeds');

    // Invalid Signature
    const isInvalid = verifyRetellWebhookSignature(rawPayload, 'invalid-signature-hash');
    assert(!isInvalid, 'Tampered or invalid signature is rejected');

    // Missing Signature
    const isMissing = verifyRetellWebhookSignature(rawPayload, null);
    assert(!isMissing, 'Missing signature header is rejected');

    // Altered Raw Body (Anti-Tampering)
    const alteredPayload = JSON.stringify({ event: 'call_ended', call: { call_id: 'call-xyz-999' } });
    const isTampered = verifyRetellWebhookSignature(alteredPayload, validSignature);
    assert(!isTampered, 'Signature verification fails when payload bytes are altered');
  }

  // =========================================================================
  // 3. API AUTHORIZATION & RBAC (CRITICAL FIX C)
  // =========================================================================
  console.log('\n--- GROUP 3: API Authorization & RBAC Guards ---');
  {
    // Unauthenticated context throws 401
    const unauthContext = {
      userId: 'anonymous',
      tenantId: '',
      role: 'DISPATCHER' as const,
      isAuthenticated: false,
      source: 'UNAUTHENTICATED' as const,
    };
    let unauthBlocked = false;
    try {
      requireAuth(unauthContext);
    } catch (err) {
      if (err instanceof AuthorizationError && err.statusCode === 401) {
        unauthBlocked = true;
      }
    }
    assert(unauthBlocked, 'Unauthenticated API context is rejected with HTTP 401 AuthorizationError');

    // Wrong Role throws 403
    const dispatcherContext = {
      userId: 'disp-01',
      tenantId: DEFAULT_TENANT_ID,
      role: 'DISPATCHER' as const,
      isAuthenticated: true,
      source: 'DEV_SESSION' as const,
    };
    let roleBlocked = false;
    try {
      requireRole(dispatcherContext, ['ADMIN', 'OPS_MANAGER']);
    } catch (err) {
      if (err instanceof AuthorizationError && err.statusCode === 403) {
        roleBlocked = true;
      }
    }
    assert(roleBlocked, 'Insufficient role permissions rejected with HTTP 403 AuthorizationError');

    // Cross-tenant access throws 403
    let crossTenantBlocked = false;
    try {
      assertTenantAccess(dispatcherContext, 'tenant-foreign-999');
    } catch (err) {
      if (err instanceof AuthorizationError && err.statusCode === 403) {
        crossTenantBlocked = true;
      }
    }
    assert(crossTenantBlocked, 'Cross-tenant resource access rejected with HTTP 403');
  }

  // =========================================================================
  // 4. PRODUCTION DATABASE FALLBACK PROTECTION (CRITICAL FIX D)
  // =========================================================================
  console.log('\n--- GROUP 4: Production Database Fallback Protection ---');
  {
    // Development/Test query succeeds
    const devCalls = await db.listCalls(DEFAULT_TENANT_ID);
    assert(devCalls.length > 0, 'Database access in development/test returns valid dataset');

    // Simulated Production Database Outage
    setSimulatedDbFailure(true);
    let dbErrorCaught = false;
    try {
      await db.listCalls(DEFAULT_TENANT_ID);
    } catch (err) {
      if (err instanceof DatabaseUnavailableError) {
        dbErrorCaught = true;
      }
    }
    setSimulatedDbFailure(false); // Reset failure simulation

    assert(
      dbErrorCaught,
      'CRITICAL: Production DB failure throws explicit DatabaseUnavailableError (never silently falls back to mock)'
    );
  }

  // =========================================================================
  // 5. PROVIDER TRUTHFULNESS & EXPLICIT STATES (CRITICAL FIX E)
  // =========================================================================
  console.log('\n--- GROUP 5: Provider Truthfulness & Explicit States ---');
  {
    const sampleCall = (await db.listCalls(DEFAULT_TENANT_ID))[0];

    // Google Sheets: Unconfigured mode returns UNCONFIGURED (not false SYNCED)
    const prevNodeEnv = process.env.NODE_ENV;
    const prevMock = process.env.ENABLE_MOCK_INTEGRATIONS;

    delete process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_REFRESH_TOKEN;
    process.env.ENABLE_MOCK_INTEGRATIONS = 'false';
    resetSheetsSyncIdempotency();

    const sheetsUnconfig = await syncCallToGoogleSheets(sampleCall);
    assert(
      !sheetsUnconfig.synced && sheetsUnconfig.status === 'UNCONFIGURED',
      'Unconfigured Google Sheets returns truthful UNCONFIGURED state (never false SYNCED)'
    );

    // WhatsApp: Opted-out number check
    const optedOut = await sendFollowupMessage({
      channel: 'WHATSAPP',
      recipient: '+91 90000 00000',
      messageContent: 'Test opt-out message',
    });
    assert(
      !optedOut.success && optedOut.status === 'OPTED_OUT',
      'Opted-out recipient returns OPTED_OUT status and suppresses message'
    );

    // WhatsApp: Unconfigured mode returns UNCONFIGURED (not false SENT)
    delete process.env.WHATSAPP_API_KEY;
    delete process.env.WHATSAPP_PHONE_NUMBER_ID;

    const msgUnconfig = await sendFollowupMessage({
      channel: 'WHATSAPP',
      recipient: '+91 98201 55432',
      messageContent: 'Test unconfigured message',
    });
    assert(
      !msgUnconfig.success && msgUnconfig.status === 'UNCONFIGURED',
      'Unconfigured WhatsApp returns truthful UNCONFIGURED state (never false SENT)'
    );

    // Explicit Mock Mode verification
    process.env.ENABLE_MOCK_INTEGRATIONS = 'true';
    const msgMock = await sendFollowupMessage({
      channel: 'WHATSAPP',
      recipient: '+91 98201 55432',
      messageContent: 'Test mock message',
    });
    assert(
      msgMock.status === 'MOCK',
      'Gated development integration returns explicit MOCK status'
    );

    // Restore environment
    (process.env as Record<string, string | undefined>).NODE_ENV = prevNodeEnv;
    process.env.ENABLE_MOCK_INTEGRATIONS = prevMock;
  }

  // =========================================================================
  // 6. CUSTOMER LOOKUP
  // =========================================================================
  console.log('\n--- GROUP 6: Customer Lookup ---');
  {
    const found = await dispatchTool(
      { tool_name: 'lookup_customer', arguments: { phone: '+91 98201 55432' } },
      auth
    );
    assert(found.success && found.status === 'FOUND', 'lookup_customer finds existing customer by phone');
    assert((found.result.customer as any)?.name === 'Vikram Mehta', 'Customer name matches record');

    const notFound = await dispatchTool(
      { tool_name: 'lookup_customer', arguments: { phone: '+91 99999 88888' } },
      auth
    );
    assert(notFound.status === 'NOT_FOUND', 'Unknown phone returns NOT_FOUND without hallucination');
  }

  // =========================================================================
  // 7. CONSIGNMENT TRACKING
  // =========================================================================
  console.log('\n--- GROUP 7: Consignment Tracking ---');
  {
    const tracking = await dispatchTool(
      { tool_name: 'get_tracking_status', arguments: { tracking_reference: 'LR-99214' } },
      auth
    );
    assert(tracking.status === 'FOUND', 'get_tracking_status resolves active consignment LR');
    assert(tracking.result.current_status === 'IN_TRANSIT', 'Shipment status verified as IN_TRANSIT');
    assert(Boolean(tracking.result.current_location), 'Shipment location verified');

    const unknownLR = await dispatchTool(
      { tool_name: 'get_tracking_status', arguments: { tracking_reference: 'LR-00000' } },
      auth
    );
    assert(unknownLR.status === 'NOT_FOUND', 'Unverified LR returns NOT_FOUND (never invents location/ETA)');

    const delayedLR = await dispatchTool(
      { tool_name: 'get_tracking_status', arguments: { tracking_reference: 'LR-66501' } },
      auth
    );
    assert(delayedLR.result.current_status === 'DELAYED', 'Delayed consignment reflects DELAYED status');
  }

  // =========================================================================
  // 8. BOOKING INTAKE & IDEMPOTENCY
  // =========================================================================
  console.log('\n--- GROUP 8: Booking Intake & Idempotency ---');
  {
    const bkgKey = `bkg-test-${Date.now()}`;
    const bkgConfirmed = await dispatchTool(
      {
        tool_name: 'create_booking_request',
        arguments: {
          customer_name: 'Rahul Sharma',
          customer_phone: '+91 98111 55555',
          origin: 'Delhi',
          destination: 'Ahmedabad',
          pickup_date: '2026-09-20',
          vehicle_type: '19ft Open',
          weight: '7 tons',
          material_type: 'Auto Parts',
          is_confirmed_by_caller: true,
          idempotency_key: bkgKey,
        },
      },
      auth
    );
    assert(bkgConfirmed.status === 'REQUEST_CREATED', 'Confirmed booking intake creates REQUEST_CREATED');
    assert(Boolean(bkgConfirmed.result.reference_no), 'Booking produces valid reference number');

    // Duplicate booking replay
    const bkgReplay = await dispatchTool(
      {
        tool_name: 'create_booking_request',
        arguments: {
          customer_name: 'Rahul Sharma',
          customer_phone: '+91 98111 55555',
          origin: 'Delhi',
          destination: 'Ahmedabad',
          pickup_date: '2026-09-20',
          vehicle_type: '19ft Open',
          weight: '7 tons',
          idempotency_key: bkgKey,
        },
      },
      auth
    );
    assert(
      bkgReplay.result.reference_no === bkgConfirmed.result.reference_no,
      'Duplicate booking replay returns existing reference without creating duplicate records'
    );

    // Unconfirmed caller booking request
    const bkgUnconfirmed = await dispatchTool(
      {
        tool_name: 'create_booking_request',
        arguments: {
          customer_name: 'Arun Varma',
          customer_phone: '+91 98222 33333',
          origin: 'Mumbai',
          destination: 'Bengaluru',
          pickup_date: '2026-09-21',
          vehicle_type: '24ft Container',
          weight: '10 tons',
          is_confirmed_by_caller: false,
        },
      },
      auth
    );
    assert(
      bkgUnconfirmed.status === 'PENDING_HUMAN_CONFIRMATION',
      'Unconfirmed booking intake marked PENDING_HUMAN_CONFIRMATION'
    );
  }

  // =========================================================================
  // 9. SUPPORT TICKETS & HUMAN ESCALATION
  // =========================================================================
  console.log('\n--- GROUP 9: Support Tickets & Human Escalation ---');
  {
    const ticket = await dispatchTool(
      {
        tool_name: 'create_support_ticket',
        arguments: {
          customer_name: 'Sunil Rao',
          customer_phone: '+91 98765 43210',
          issue: 'Consignment delivery delayed by over 24 hours at Bhiwandi checkpoint.',
          priority: 'URGENT',
          tracking_reference: 'LR-77409',
        },
      },
      auth
    );
    assert(ticket.success && ticket.status === 'SUCCESS', 'create_support_ticket creates ticket');
    assert(ticket.result.priority === 'URGENT', 'Ticket priority persisted as URGENT');

    // Human Escalation with available contact
    const transfer = await dispatchTool(
      {
        tool_name: 'transfer_to_human',
        arguments: {
          reason: 'Customer requested senior manager negotiation.',
          target_role: 'Primary Dispatcher',
          context_summary: 'Delhi -> Mumbai freight negotiation',
        },
      },
      auth
    );
    assert(
      transfer.status === 'TRANSFERRED' || transfer.status === 'CALLBACK_SCHEDULED',
      'Human escalation dispatches to live dispatcher or schedules urgent callback'
    );
  }

  // =========================================================================
  // 10. KNOWLEDGE RETRIEVAL & CONTEXT ASSEMBLY
  // =========================================================================
  console.log('\n--- GROUP 10: Knowledge Retrieval & Tenant Isolation ---');
  {
    const rateKb = await retrieveRelevantKnowledge('RATE_QUOTE', DEFAULT_TENANT_ID);
    assert(rateKb.some((k) => k.category === 'RATE_POLICY'), 'RATE_QUOTE retrieves RATE_POLICY');
    assert(!rateKb.some((k) => k.category === 'BOOKING_RULES'), 'RATE_QUOTE excludes BOOKING_RULES (scoped prompt)');

    // Cross-tenant knowledge isolation
    const foreignTenantKb = await retrieveRelevantKnowledge('RATE_QUOTE', 'tenant-isolated-xyz');
    assert(
      foreignTenantKb.length === 0,
      'Foreign tenant receives zero knowledge items from another tenant'
    );

    // Compact Context Assembler (<4000 characters)
    const assembled = await assembleVoiceRuntimeContext({
      callerPhone: '+91 98201 55432',
      probableIntent: 'RATE_QUOTE',
    });
    assert(assembled.systemPrompt.length < 4000, 'Voice context assembler maintains compact system prompt (<4000 chars)');
  }

  // =========================================================================
  // 11. DETERMINISTIC LEAD TEMPERATURE ENGINE
  // =========================================================================
  console.log('\n--- GROUP 11: Deterministic Lead Temperature Engine ---');
  {
    const hot1 = computeLeadTemperature({
      intent: 'BOOKING',
      facts: { route_from: 'Delhi', route_to: 'Mumbai', vehicle_type: '32ft MXL', weight: '16 tons' },
    });
    assert(hot1 === 'HOT', 'Explicit booking intent classified as HOT');

    const hot2 = computeLeadTemperature({
      intent: 'RATE_QUOTE',
      facts: { route_from: 'Delhi', route_to: 'Mumbai', vehicle_type: '32ft MXL', quoted_amount: 54000 },
    });
    assert(hot2 === 'HOT', 'Complete rate quote with vehicle + price classified as HOT');

    const warm1 = computeLeadTemperature({
      intent: 'RATE_QUOTE',
      facts: { route_from: 'Delhi', route_to: 'Mumbai' },
    });
    assert(warm1 === 'WARM', 'Rate inquiry without finalized specs classified as WARM');

    const cold1 = computeLeadTemperature({ intent: 'GENERAL' });
    assert(cold1 === 'COLD', 'General inquiry classified as COLD');

    const review1 = computeLeadTemperature({ intent: 'COMPLAINT', sentiment: 'ANGRY' });
    assert(review1 === 'REVIEW', 'Angry complaint classified as REVIEW');
  }

  // =========================================================================
  // 12. POST-CALL PIPELINE & IDEMPOTENCY
  // =========================================================================
  console.log('\n--- GROUP 12: Post-Call Pipeline & Idempotency ---');
  {
    const callExtId = `post-call-test-${Date.now()}`;
    const pipelineRes = await processPostCallPipeline({
      external_call_id: callExtId,
      from_number: '+91 98201 55432',
      started_at: new Date(Date.now() - 180000).toISOString(),
      ended_at: new Date().toISOString(),
      duration_seconds: 180,
      intent: 'RATE_QUOTE',
      sentiment: 'POSITIVE',
      summary: 'Caller requested rate for Delhi to Jaipur 14ft Closed truck. Quoted ₹11,500.',
      facts: {
        route_from: 'Delhi',
        route_to: 'Jaipur',
        vehicle_type: '14ft Closed',
        quoted_amount: 11500,
        quote_type: 'ESTIMATE',
      },
    });

    assert(pipelineRes.success, 'Post-call pipeline executes cleanly');
    assert(pipelineRes.lead_temperature === 'HOT', 'Pipeline calculates deterministic HOT lead temperature');

    // Duplicate webhook delivery check
    const dupRes = await processPostCallPipeline({ external_call_id: callExtId });
    assert(
      dupRes.sheets_status === 'SKIPPED_DUPLICATE',
      'Duplicate webhook event recognized and skips duplicate side effects'
    );
  }

  // =========================================================================
  // 13. ADVANCED FORENSIC CHECKS & NEGATIVE TESTS
  // =========================================================================
  console.log('\n--- GROUP 13: Advanced Forensic Checks & Negative Tests ---');
  {
    // A: Rate Precedence & Weight Boundary Selection
    const exactRate = await db.findApprovedRate(
      { origin: 'Delhi', destination: 'Mumbai', vehicleType: '32ft MXL', weightTons: 16 },
      DEFAULT_TENANT_ID
    );
    assert(exactRate?.id === 'rc-01', 'Rate precedence: exact vehicle & weight boundary selects rc-01');

    // B: Booking Schema Negative Test
    const badBooking = await dispatchTool(
      {
        tool_name: 'create_booking_request',
        arguments: {
          customer_name: 'Test',
          // missing phone, origin, destination, vehicle_type, weight
        },
      },
      auth
    );
    assert(!badBooking.success && badBooking.status === 'FAILED', 'Negative test: Malformed booking payload rejected by schema');

    // C: Unauthorized Tool Name in Gateway
    const unauthorizedTool = await dispatchTool(
      { tool_name: 'unauthorized_shell_exec', arguments: {} },
      auth
    );
    assert(
      !unauthorizedTool.success && Boolean(unauthorizedTool.error?.includes('Unrecognized or unauthorized tool')),
      'Tool gateway strictly blocks unapproved tool names'
    );

    // D: Server-to-Server Provider Authentication Token Verification
    const fakeServerReq = {
      headers: new Headers({
        'x-api-key': process.env.RETELL_API_KEY || 'test-key',
        'x-tenant-id': DEFAULT_TENANT_ID,
      }),
    } as any;
    const providerAuth = await getAuthContext(fakeServerReq);
    assert(
      providerAuth.isAuthenticated && providerAuth.role === 'VOICE_GATEWAY',
      'Server-to-server Retell API token resolves to authenticated VOICE_GATEWAY role'
    );

    // E: Fault Tolerance: Downstream failure preserves primary record
    const faultCallId = `fault-tolerance-test-${Date.now()}`;
    const faultPipeline = await processPostCallPipeline({
      external_call_id: faultCallId,
      from_number: '+91 98201 55432',
      intent: 'RATE_QUOTE',
      sentiment: 'NEUTRAL',
      summary: 'Fault tolerance call test',
      facts: { route_from: 'Delhi', route_to: 'Mumbai', quoted_amount: 54000 },
    });
    assert(faultPipeline.success, 'Post-call pipeline persists call record even when secondary sheets integration is unconfigured');
    const persistedCall = await db.getCallByExternalId(faultCallId, DEFAULT_TENANT_ID);
    assert(Boolean(persistedCall), 'Authoritative call record verified in primary store despite unconfigured downstream integrations');
  }

  // =========================================================================
  // 14. THE 10 MANDATORY END-TO-END JOURNEYS (J1 TO J10)
  // =========================================================================
  console.log('\n==================================================');
  console.log('--- EXECUTING THE 10 MANDATORY END-TO-END JOURNEYS ---');
  console.log('==================================================');

  // J1: RATE INQUIRY
  console.log('\nJOURNEY 1 (J1) — Rate Inquiry (Delhi -> Mumbai):');
  {
    const quote = await dispatchTool(
      {
        tool_name: 'get_rate_quote',
        arguments: { origin: 'Delhi', destination: 'Mumbai', vehicle_type: '32ft MXL', weight_tons: 16 },
      },
      auth
    );
    assert(quote.status === 'QUOTED', 'J1: Rate quote retrieved');
    assert(quote.result.quote_type === 'ESTIMATE', 'J1: Tariff returned as standard ESTIMATE');
    assert(quote.result.price_inr === 54000, 'J1: Exact tariff ₹54,000 returned');
  }

  // J2: CONSIGNMENT TRACKING
  console.log('\nJOURNEY 2 (J2) — Consignment Tracking (LR-99214):');
  {
    const trk = await dispatchTool(
      { tool_name: 'get_tracking_status', arguments: { tracking_reference: 'LR-99214' } },
      auth
    );
    assert(trk.status === 'FOUND', 'J2: Consignment tracking record found');
    assert(trk.result.current_status === 'IN_TRANSIT', 'J2: Status verified as IN_TRANSIT');
    assert(Boolean(trk.result.current_location), 'J2: Current location verified');
  }

  // J3: BOOKING REQUEST INTAKE
  console.log('\nJOURNEY 3 (J3) — Booking Request Intake:');
  {
    const bkg = await dispatchTool(
      {
        tool_name: 'create_booking_request',
        arguments: {
          customer_name: 'Vikram Mehta',
          customer_phone: '+91 98201 55432',
          origin: 'Delhi',
          destination: 'Mumbai',
          pickup_date: '2026-09-22',
          vehicle_type: '32ft MXL',
          weight: '16 tons',
          is_confirmed_by_caller: true,
        },
      },
      auth
    );
    assert(bkg.status === 'REQUEST_CREATED', 'J3: Booking request created with status REQUEST_CREATED');
    assert(Boolean(bkg.result.reference_no), 'J3: Unique booking reference generated');
  }

  // J4: HUMAN ESCALATION
  console.log('\nJOURNEY 4 (J4) — Human Escalation & Fallback:');
  {
    const handoff = await dispatchTool(
      {
        tool_name: 'transfer_to_human',
        arguments: {
          reason: 'Customer requested human fleet manager negotiation.',
          target_role: 'Primary Dispatcher',
          context_summary: 'Delhi -> Mumbai freight rate negotiation',
        },
      },
      auth
    );
    assert(
      handoff.status === 'TRANSFERRED' || handoff.status === 'CALLBACK_SCHEDULED',
      'J4: Escalation transfers to dispatcher or schedules callback'
    );
  }

  // J5: SUPPORT TICKET INTAKE
  console.log('\nJOURNEY 5 (J5) — Operations Support Ticket:');
  {
    const ticket = await dispatchTool(
      {
        tool_name: 'create_support_ticket',
        arguments: {
          customer_name: 'Kunal Singhania',
          customer_phone: '+91 94140 88712',
          issue: 'Consignment delayed at Bhiwandi bypass checkpoint.',
          priority: 'HIGH',
          tracking_reference: 'LR-77409',
        },
      },
      auth
    );
    assert(ticket.status === 'SUCCESS', 'J5: Support ticket created successfully');
    assert(Boolean(ticket.result.reference_no), 'J5: Ticket reference number generated');
  }

  // J6: POST-CALL NURTURING PIPELINE
  console.log('\nJOURNEY 6 (J6) — Post-Call Pipeline & Nurturing:');
  {
    const j6CallId = `j6-pipeline-${Date.now()}`;
    const result = await processPostCallPipeline({
      external_call_id: j6CallId,
      from_number: '+91 98201 55432',
      intent: 'RATE_QUOTE',
      sentiment: 'POSITIVE',
      summary: 'Delhi to Mumbai rate inquiry followed by booking interest.',
      facts: { route_from: 'Delhi', route_to: 'Mumbai', quoted_amount: 54000, vehicle_type: '32ft MXL' },
    });
    assert(result.success, 'J6: Post-call pipeline executes');
    assert(result.lead_temperature === 'HOT', 'J6: Lead categorized as HOT for commercial follow-up');
  }

  // J7: PROVIDER FAILURE / CLOSED-CIRCUIT DEGRADATION
  console.log('\nJOURNEY 7 (J7) — Provider Failure / Safe Degradation:');
  {
    const unserved = await dispatchTool(
      { tool_name: 'get_rate_quote', arguments: { origin: 'Srinagar', destination: 'Kanyakumari' } },
      auth
    );
    assert(
      unserved.status === 'UNAVAILABLE',
      'J7: Unserved corridor fails safely with UNAVAILABLE (zero false success)'
    );
  }

  // J8: DUPLICATE WEBHOOK IDEMPOTENCY
  console.log('\nJOURNEY 8 (J8) — Duplicate Webhook Idempotency:');
  {
    const j8CallId = `j8-idemp-${Date.now()}`;
    const run1 = await processPostCallPipeline({
      external_call_id: j8CallId,
      from_number: '+91 98201 55432',
      intent: 'RATE_QUOTE',
      summary: 'Idempotency test run 1',
    });
    assert(run1.success, 'J8: First webhook delivery processed');

    const run2 = await processPostCallPipeline({
      external_call_id: j8CallId,
      from_number: '+91 98201 55432',
      intent: 'RATE_QUOTE',
      summary: 'Idempotency test run 2',
    });
    assert(
      run2.sheets_status === 'SKIPPED_DUPLICATE',
      'J8: Second webhook replay recognized and duplicate execution prevented'
    );
  }

  // J9: PRODUCTION DATABASE FAILURE PROTECTION
  console.log('\nJOURNEY 9 (J9) — Production Database Failure Protection:');
  {
    setSimulatedDbFailure(true);
    let thrownError: Error | null = null;
    try {
      await db.getCallById('call-001', DEFAULT_TENANT_ID);
    } catch (err) {
      thrownError = err as Error;
    }
    setSimulatedDbFailure(false);

    assert(
      thrownError instanceof DatabaseUnavailableError,
      'J9: Database failure triggers explicit DatabaseUnavailableError (never fakes success)'
    );
  }

  // J10: CROSS-TENANT SECURITY BOUNDARY
  console.log('\nJOURNEY 10 (J10) — Cross-Tenant Security Boundary:');
  {
    let blocked = false;
    try {
      assertTenantAccess(
        { userId: 'intruder', tenantId: 'tenant-a', role: 'DISPATCHER', isAuthenticated: true, source: 'API_TOKEN' },
        'tenant-b'
      );
    } catch (e) {
      if (e instanceof AuthorizationError && e.statusCode === 403) blocked = true;
    }
    assert(blocked, 'J10: Cross-tenant access strictly prevented with 403');
  }

  console.log('\n==================================================');
  console.log(`TEST RUN COMPLETE: ${passedTests} PASSED, ${failedTests} FAILED`);
  console.log('==================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  }
}

runAllTests().catch((err) => {
  console.error('Test run failed with fatal error:', err);
  process.exit(1);
});
