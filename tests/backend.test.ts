/**
 * LOGIVOICE V1 — COMPREHENSIVE BACKEND AUTOMATED TEST SUITE
 * Covers:
 * - Database & Tenant Isolation
 * - 8 Core Controlled Tools & Gateway
 * - Rate Engine (Estimate vs Confirmed, Unavailable Corridor)
 * - Tracking Adapter
 * - Booking Intake & Idempotency
 * - Support Tickets & Human Escalation
 * - Layer 02 Dynamic Knowledge Retrieval (Layer 05 Test Cases)
 * - Deterministic Lead Temperature Calculation
 * - Post-Call Processing Pipeline & Webhook Idempotency
 * - Follow-up Suppression & Opt-Out Enforcement
 * - The 6 Final End-to-End User Journeys (SSOT Section 51)
 */

import { db, DEFAULT_TENANT_ID } from '../lib/db';
import { dispatchTool } from '../lib/tools/gateway';
import { getAuthContext, assertTenantAccess, AuthorizationError } from '../lib/auth/context';
import { retrieveRelevantKnowledge } from '../lib/knowledge/retrieval';
import { computeLeadTemperature } from '../lib/rules/lead-temperature';
import { processPostCallPipeline } from '../lib/pipeline/post-call';
import { assembleVoiceRuntimeContext } from '../lib/voice/context-assembler';
import { sendFollowupMessage } from '../lib/integrations/messaging';
import { syncCallToGoogleSheets } from '../lib/integrations/google-sheets';

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
  console.log('LOGIVOICE V1 — BACKEND AUTOMATED TEST EXECUTION');
  console.log('==================================================\n');

  const auth = await getAuthContext();

  // =========================================================================
  // 1. TOOL 1: lookup_customer
  // =========================================================================
  console.log('\n--- GROUP 1: Customer Lookup ---');
  {
    const found = await dispatchTool(
      { tool_name: 'lookup_customer', arguments: { phone: '+91 98201 55432' } },
      auth
    );
    assert(found.success && found.status === 'FOUND', 'lookup_customer finds existing customer by phone');
    assert(
      (found.result.customer as any)?.name === 'Vikram Mehta',
      'lookup_customer returns correct customer details'
    );

    const notFound = await dispatchTool(
      { tool_name: 'lookup_customer', arguments: { phone: '+91 99999 88888' } },
      auth
    );
    assert(notFound.status === 'NOT_FOUND', 'lookup_customer handles unknown phone cleanly without inventing data');

    const invalid = await dispatchTool(
      { tool_name: 'lookup_customer', arguments: { phone: '12' } },
      auth
    );
    assert(!invalid.success && invalid.status === 'FAILED', 'lookup_customer rejects invalid phone input schema');
  }

  // =========================================================================
  // 2. TOOL 2: get_rate_quote
  // =========================================================================
  console.log('\n--- GROUP 2: Rate Engine & Quote Classification ---');
  {
    const rateQuote = await dispatchTool(
      {
        tool_name: 'get_rate_quote',
        arguments: { origin: 'Delhi', destination: 'Mumbai', vehicle_type: '32ft MXL', weight_tons: 16 },
      },
      auth
    );
    assert(rateQuote.success && rateQuote.status === 'QUOTED', 'get_rate_quote finds approved active rate');
    assert(rateQuote.result.price_inr === 54000, 'get_rate_quote returns exact tariff (₹54,000)');
    assert(rateQuote.result.quote_type === 'CONFIRMED', 'Quote with full vehicle & weight classified as CONFIRMED');

    const estimateQuote = await dispatchTool(
      { tool_name: 'get_rate_quote', arguments: { origin: 'Delhi', destination: 'Mumbai' } },
      auth
    );
    assert(estimateQuote.result.quote_type === 'ESTIMATE', 'Quote without specific vehicle/weight classified as ESTIMATE');

    const unavail = await dispatchTool(
      { tool_name: 'get_rate_quote', arguments: { origin: 'Delhi', destination: 'Guwahati' } },
      auth
    );
    assert(
      unavail.status === 'UNAVAILABLE',
      'get_rate_quote returns UNAVAILABLE when route not in approved cards (never hallucinates rate)'
    );

    const missing = await dispatchTool(
      { tool_name: 'get_rate_quote', arguments: { origin: 'Delhi', destination: '' } },
      auth
    );
    assert(!missing.success, 'get_rate_quote rejects missing required destination');
  }

  // =========================================================================
  // 3. TOOL 3: get_tracking_status
  // =========================================================================
  console.log('\n--- GROUP 3: Tracking Adapter ---');
  {
    const tracking = await dispatchTool(
      { tool_name: 'get_tracking_status', arguments: { tracking_reference: 'LR-99214' } },
      auth
    );
    assert(tracking.success && tracking.status === 'FOUND', 'get_tracking_status resolves valid consignment LR');
    assert(
      tracking.result.current_status === 'IN_TRANSIT',
      'get_tracking_status returns verified status IN_TRANSIT'
    );
    assert(Boolean(tracking.result.current_location), 'get_tracking_status returns verified location');

    const unknownLR = await dispatchTool(
      { tool_name: 'get_tracking_status', arguments: { tracking_reference: 'LR-00000' } },
      auth
    );
    assert(
      unknownLR.status === 'NOT_FOUND',
      'get_tracking_status returns NOT_FOUND for unverified LR (never invents location or ETA)'
    );
  }

  // =========================================================================
  // 4. TOOL 4: create_booking_request & Idempotency
  // =========================================================================
  console.log('\n--- GROUP 4: Booking Intake & Idempotency ---');
  {
    const bkgKey = `idemp-${Date.now()}`;
    const booking1 = await dispatchTool(
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
    assert(
      booking1.success && booking1.status === 'REQUEST_CREATED',
      'create_booking_request creates request when confirmed by caller'
    );
    assert(Boolean(booking1.result.reference_no), 'Booking generates unique reference number');

    // Duplicate replay check
    const bookingReplay = await dispatchTool(
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
      bookingReplay.result.reference_no === booking1.result.reference_no,
      'Duplicate booking replay returns identical reference without creating duplicate records'
    );
  }

  // =========================================================================
  // 5. TOOL 5: create_support_ticket
  // =========================================================================
  console.log('\n--- GROUP 5: Support Ticket Intake ---');
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
    assert(ticket.result.priority === 'URGENT', 'Priority is properly persisted as URGENT');
  }

  // =========================================================================
  // 6. TOOL 6: transfer_to_human
  // =========================================================================
  console.log('\n--- GROUP 6: Human Escalation & Fallback ---');
  {
    const transfer = await dispatchTool(
      {
        tool_name: 'transfer_to_human',
        arguments: {
          reason: 'Customer explicitly demanded senior fleet manager negotiation.',
          target_role: 'Primary Dispatcher',
          context_summary: 'Delhi -> Mumbai 32ft MXL freight negotiation',
        },
      },
      auth
    );
    assert(
      transfer.success && (transfer.status === 'TRANSFERRED' || transfer.status === 'CALLBACK_SCHEDULED'),
      'transfer_to_human successfully initiates transfer or schedules callback'
    );
    assert(Boolean(transfer.result.target_phone), 'Target dispatcher phone is preserved in transfer result');
  }

  // =========================================================================
  // 7. LAYER 02 KNOWLEDGE RETRIEVAL & CONTEXT ASSEMBLY
  // =========================================================================
  console.log('\n--- GROUP 7: Layer 02 Dynamic Knowledge Retrieval ---');
  {
    const rateKb = await retrieveRelevantKnowledge('RATE_QUOTE', DEFAULT_TENANT_ID);
    assert(
      rateKb.some((k) => k.category === 'RATE_POLICY'),
      'RATE_QUOTE intent retrieves RATE_POLICY knowledge'
    );
    assert(
      !rateKb.some((k) => k.category === 'BOOKING_RULES'),
      'RATE_QUOTE intent does NOT inject irrelevant BOOKING_RULES (monolithic prompt prevented)'
    );

    const trackingKb = await retrieveRelevantKnowledge('TRACKING', DEFAULT_TENANT_ID);
    assert(
      trackingKb.some((k) => k.category === 'TRACKING_POLICY' || k.category === 'OPERATIONAL_FAQ'),
      'TRACKING intent retrieves TRACKING_POLICY or FAQ'
    );

    // Runtime Context Assembler
    const assembled = await assembleVoiceRuntimeContext({
      callerPhone: '+91 98201 55432',
      probableIntent: 'RATE_QUOTE',
    });
    assert(Boolean(assembled.customer), 'Context assembler identifies caller from phone number');
    assert(assembled.systemPrompt.includes('Apex Logistics'), 'Context assembler includes tenant brand name');
    assert(
      assembled.systemPrompt.length < 4000,
      'Context assembler maintains compact system prompt (<4000 chars) instead of monolithic KB dump'
    );
  }

  // =========================================================================
  // 8. DETERMINISTIC LEAD TEMPERATURE ENGINE
  // =========================================================================
  console.log('\n--- GROUP 8: Deterministic Lead Temperature ---');
  {
    const hot1 = computeLeadTemperature({
      intent: 'BOOKING',
      facts: { route_from: 'Delhi', route_to: 'Mumbai', vehicle_type: '32ft MXL', weight: '16 tons' },
    });
    assert(hot1 === 'HOT', 'Explicit booking intent yields HOT temperature');

    const hot2 = computeLeadTemperature({
      intent: 'RATE_QUOTE',
      facts: { route_from: 'Delhi', route_to: 'Mumbai', vehicle_type: '32ft MXL', quoted_amount: 54000 },
    });
    assert(hot2 === 'HOT', 'Rate quote with route + vehicle + quote yields HOT temperature');

    const warm1 = computeLeadTemperature({
      intent: 'RATE_QUOTE',
      facts: { route_from: 'Delhi', route_to: 'Mumbai' },
    });
    assert(warm1 === 'WARM', 'Rate inquiry without finalized cargo specs yields WARM temperature');

    const cold1 = computeLeadTemperature({ intent: 'GENERAL' });
    assert(cold1 === 'COLD', 'General inquiry yields COLD temperature');

    const review1 = computeLeadTemperature({ intent: 'COMPLAINT', sentiment: 'ANGRY' });
    assert(review1 === 'REVIEW', 'Angry complaint yields REVIEW temperature');
  }

  // =========================================================================
  // 9. FOLLOW-UP AUTOMATION & SUPPRESSION RULES
  // =========================================================================
  console.log('\n--- GROUP 9: Follow-up Automation & Opt-Out Suppression ---');
  {
    // Opt-out number check
    const suppressed = await sendFollowupMessage({
      channel: 'WHATSAPP',
      recipient: '+91 90000 00000',
      messageContent: 'Test follow-up message',
    });
    assert(
      suppressed.status === 'OPTED_OUT' && !suppressed.success,
      'Suppression engine blocks messages to opted-out phone numbers'
    );

    // Valid number check (mock adapter)
    const validSend = await sendFollowupMessage({
      channel: 'WHATSAPP',
      recipient: '+91 98201 55432',
      messageContent: 'Quoted ₹54,000 for Delhi -> Mumbai 32ft MXL.',
    });
    assert(
      validSend.success && validSend.status === 'SENT' && Boolean(validSend.providerMessageId),
      'Follow-up dispatches successfully with traceable message ID'
    );
  }

  // =========================================================================
  // 10. GOOGLE SHEETS OPERATIONAL SYNC (IDEMPOTENT)
  // =========================================================================
  console.log('\n--- GROUP 10: Google Sheets Sync ---');
  {
    const sampleCall = (await db.listCalls(DEFAULT_TENANT_ID))[0];
    const sync1 = await syncCallToGoogleSheets(sampleCall);
    assert(sync1.synced, 'Call syncs to Google Sheets operational view');

    const syncReplay = await syncCallToGoogleSheets(sampleCall);
    assert(
      syncReplay.status === 'SKIPPED',
      'Google Sheets sync is idempotent and skips already-synced calls'
    );
  }

  // =========================================================================
  // 11. POST-CALL PROCESSING PIPELINE
  // =========================================================================
  console.log('\n--- GROUP 11: Post-Call Processing Pipeline ---');
  {
    const callExtId = `retell-test-${Date.now()}`;
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
    assert(pipelineRes.lead_temperature === 'HOT', 'Pipeline calculates HOT lead temperature');
    assert(pipelineRes.followup_status === 'SENT', 'Pipeline automatically dispatches eligible follow-up');

    // Webhook duplicate delivery test
    const dupRes = await processPostCallPipeline({
      external_call_id: callExtId,
    });
    assert(
      dupRes.sheets_status === 'SKIPPED_DUPLICATE',
      'Duplicate webhook delivery recognized and skips duplicate side effects'
    );
  }

  // =========================================================================
  // 12. SECURITY & TENANT ISOLATION
  // =========================================================================
  console.log('\n--- GROUP 12: Security & Tenant Isolation ---');
  {
    let crossTenantBlocked = false;
    try {
      assertTenantAccess(auth, '11111111-1111-1111-1111-111111111111');
    } catch (err) {
      if (err instanceof AuthorizationError) crossTenantBlocked = true;
    }
    assert(crossTenantBlocked, 'Cross-tenant resource access is strictly forbidden with 403 AuthorizationError');

    // Verify tool gateway denies arbitrary unapproved tools
    const illegalTool = await dispatchTool(
      { tool_name: 'execute_sql_query', arguments: { sql: 'SELECT * FROM customers' } },
      auth
    );
    assert(
      !illegalTool.success && illegalTool.status === 'FAILED',
      'Tool gateway strictly blocks arbitrary SQL or unapproved tool execution'
    );
  }

  // =========================================================================
  // 13. THE 6 FINAL END-TO-END JOURNEYS (SECTION 51)
  // =========================================================================
  console.log('\n==================================================');
  console.log('--- EXECUTING THE 6 MANDATORY FINAL JOURNEYS ---');
  console.log('==================================================');

  // JOURNEY 1 — RATE
  console.log('\nJOURNEY 1 — Rate Inquiry:');
  {
    const j1CallId = `j1-call-${Date.now()}`;
    // 1. Identify intent & collect route
    const quote = await dispatchTool(
      {
        tool_name: 'get_rate_quote',
        arguments: { origin: 'Delhi', destination: 'Mumbai', vehicle_type: '32ft MXL', weight_tons: 16 },
      },
      auth
    );
    assert(quote.status === 'QUOTED' && quote.result.price_inr === 54000, 'J1: Rate quote obtained (₹54,000)');

    // 2. Booking creation
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
    assert(bkg.status === 'REQUEST_CREATED', 'J1: Booking request created');

    // 3. Post-call outcome
    const outcome = await dispatchTool(
      {
        tool_name: 'save_call_outcome',
        arguments: {
          external_call_id: j1CallId,
          customer_name: 'Vikram Mehta',
          customer_phone: '+91 98201 55432',
          primary_intent: 'RATE_QUOTE',
          outcome: 'COMPLETED',
          sentiment: 'POSITIVE',
          summary: 'Delhi to Mumbai freight quote provided and booking request logged.',
          facts: {
            route_from: 'Delhi',
            route_to: 'Mumbai',
            vehicle_type: '32ft MXL',
            weight: '16 tons',
            quoted_amount: 54000,
            booking_reference: bkg.result.reference_no as string,
          },
        },
      },
      auth
    );
    assert(outcome.result.computed_temperature === 'HOT', 'J1: Lead temperature computed as HOT');

    // 4. Follow-up
    const flw = await dispatchTool(
      {
        tool_name: 'send_followup',
        arguments: {
          call_id: outcome.result.call_id as string,
          recipient_phone: '+91 98201 55432',
          message_content: 'Quoted ₹54,000 for Delhi -> Mumbai. Booking logged.',
        },
      },
      auth
    );
    assert(flw.status === 'SENT', 'J1: Post-call WhatsApp follow-up dispatched', flw);
  }

  // JOURNEY 2 — TRACKING
  console.log('\nJOURNEY 2 — Consignment Tracking:');
  {
    const j2CallId = `j2-call-${Date.now()}`;
    const trk = await dispatchTool(
      { tool_name: 'get_tracking_status', arguments: { tracking_reference: 'LR-99214' } },
      auth
    );
    assert(trk.result.current_status === 'IN_TRANSIT', 'J2: Tracking status verified as IN_TRANSIT');

    const outcome = await dispatchTool(
      {
        tool_name: 'save_call_outcome',
        arguments: {
          external_call_id: j2CallId,
          customer_phone: '+91 94140 88712',
          primary_intent: 'TRACKING',
          outcome: 'COMPLETED',
          summary: 'Consignment tracking request for LR-99214. Status verified.',
          facts: { tracking_id: 'LR-99214' },
        },
      },
      auth
    );
    assert(outcome.status === 'SAVED', 'J2: Outcome persisted cleanly');
  }

  // JOURNEY 3 — HUMAN ESCALATION
  console.log('\nJOURNEY 3 — Human Escalation:');
  {
    const j3CallId = `j3-call-${Date.now()}`;
    const handoff = await dispatchTool(
      {
        tool_name: 'transfer_to_human',
        arguments: {
          call_id: j3CallId,
          reason: 'Severe delay and cargo damage reported.',
          target_role: 'Operations Manager',
          context_summary: 'Bhiwandi transit delay complaint',
        },
      },
      auth
    );
    assert(
      handoff.status === 'TRANSFERRED' || handoff.status === 'CALLBACK_SCHEDULED',
      'J3: Human escalation initiated with target contact'
    );
  }

  // JOURNEY 4 — PROVIDER FAILURE / GRACEFUL DEGRADATION
  console.log('\nJOURNEY 4 — Provider Failure / Safe Fallback:');
  {
    // Try to get quote for unserved corridor
    const unserved = await dispatchTool(
      { tool_name: 'get_rate_quote', arguments: { origin: 'Srinagar', destination: 'Kanyakumari' } },
      auth
    );
    assert(
      unserved.status === 'UNAVAILABLE',
      'J4: Provider failure / unserved corridor fails closed with UNAVAILABLE (no false success)'
    );
  }

  // JOURNEY 5 — DUPLICATE WEBHOOK DELIVERY
  console.log('\nJOURNEY 5 — Duplicate Webhook Replay:');
  {
    const j5CallId = `j5-call-${Date.now()}`;
    const run1 = await processPostCallPipeline({
      external_call_id: j5CallId,
      from_number: '+91 98201 55432',
      intent: 'RATE_QUOTE',
      summary: 'Idempotency test call',
      facts: { route_from: 'Delhi', route_to: 'Mumbai', quoted_amount: 54000 },
    });
    assert(run1.success, 'J5: First webhook delivery processed');

    const run2 = await processPostCallPipeline({
      external_call_id: j5CallId,
      from_number: '+91 98201 55432',
      intent: 'RATE_QUOTE',
      summary: 'Idempotency test call',
    });
    assert(
      run2.sheets_status === 'SKIPPED_DUPLICATE',
      'J5: Second webhook delivery recognized duplicate and skipped side effects'
    );
  }

  // JOURNEY 6 — SECURITY & CROSS-TENANT ISOLATION
  console.log('\nJOURNEY 6 — Cross-Tenant Security Boundary:');
  {
    let unauthorizedDenied = false;
    try {
      assertTenantAccess(
        { userId: 'intruder', tenantId: 'tenant-aaa', role: 'DISPATCHER', isAuthenticated: true, source: 'API_TOKEN' },
        'tenant-bbb'
      );
    } catch (e) {
      if (e instanceof AuthorizationError) unauthorizedDenied = true;
    }
    assert(unauthorizedDenied, 'J6: Cross-tenant access denied without data leakage');
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
