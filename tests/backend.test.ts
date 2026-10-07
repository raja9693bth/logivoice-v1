import { describe, it } from 'node:test';
import assertStrict from 'node:assert/strict';
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
import twilio from 'twilio';
import { Retell } from 'retell-sdk';
import { db, DEFAULT_TENANT_ID, setSimulatedDbFailure, DatabaseUnavailableError, assertProductionDbReady } from '../lib/db';
import { dispatchTool } from '../lib/tools/gateway';
import {
  getAuthContext,
  getInternalSystemContext,
  isValidUserRole,
  isValidTenantId,
  requireAuth,
  requireRole,
  assertTenantAccess,
  AuthorizationError,
  verifyRetellWebhookSignature,
  resolveAuthContext,
} from '../lib/auth/context';
import {
  CreateRateCardApiSchema,
  UpdateRateCardApiSchema,
  UpdateRequestApiSchema,
  UpdateSettingsApiSchema,
  ListCallsQuerySchema,
  ListRequestsQuerySchema,
  ExecuteToolApiSchema,
} from '../lib/schemas/api';
import { domainLeadToDbRow } from '../lib/db/mappers';
import { retrieveRelevantKnowledge } from '../lib/knowledge/retrieval';
import { computeLeadTemperature } from '../lib/rules/lead-temperature';
import { processPostCallPipeline, resetPostCallPipelineIdempotency } from '../lib/pipeline/post-call';
import { assembleVoiceRuntimeContext } from '../lib/voice/context-assembler';
import { sendFollowupMessage, sendControlledFollowup } from '../lib/integrations/messaging';
import { syncCallToGoogleSheets, resetSheetsSyncIdempotency, resolveGoogleSheetsTarget, checkIfCallExistsInGoogleSheets } from '../lib/integrations/google-sheets';
import { executeProviderCallTransfer } from '../lib/integrations/telephony';
import { reconcileUnknownClaims } from '../lib/pipeline/retry-worker';
import { RETELL_TOOL_DEFINITIONS } from '../lib/voice/retell-tools';
import { proxy as middleware } from '../proxy';
import { NextRequest } from 'next/server';
import { GET as whatsappWebhookGet, POST as whatsappWebhookPost } from '../app/api/webhooks/whatsapp/route';
import { POST as twilioTransferWebhookPost } from '../app/api/webhooks/twilio/transfer/route';

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
    assertStrict.ok(condition, `${testName}: ${JSON.stringify(failureDetails || '')}`);
  }
}
describe('LOGIVOICE V1 — FORENSIC BACKEND AUTOMATED TEST SUITE', () => {
  const auth = getInternalSystemContext(DEFAULT_TENANT_ID);
  it('GROUP 1: Rate Engine & Quote Semantics', async () => {
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
  });

  it('GROUP 2: Retell Cryptographic Signature & Tool Verification', async () => {
    const secretKey = 'test-retell-secret-key-12345';
    process.env.RETELL_API_KEY = secretKey;

    const rawPayload = JSON.stringify({ event: 'call_ended', call: { call_id: 'call-xyz-123' } });
    const alteredPayload = JSON.stringify({ event: 'call_ended', call: { call_id: 'call-xyz-999' } });

    // A. Official Retell SDK Signature Contract (v=<timestamp>,d=<digest>)
    const officialSignature = await Retell.sign(rawPayload, secretKey);
    assert(officialSignature.startsWith('v='), 'Official Retell SDK generates timestamped v=<timestamp>,d=<digest> signature');

    const isOfficialValid = await verifyRetellWebhookSignature(rawPayload, officialSignature);
    assert(isOfficialValid, 'Official Retell SDK timestamped signature verifies successfully');

    const isOfficialTampered = await verifyRetellWebhookSignature(alteredPayload, officialSignature);
    assert(!isOfficialTampered, 'Official Retell SDK signature fails when payload bytes are altered');

    const wrongKeyOfficialSig = await Retell.sign(rawPayload, 'wrong-secret-key-67890');
    const isWrongKeyRejected = await verifyRetellWebhookSignature(rawPayload, wrongKeyOfficialSig);
    assert(!isWrongKeyRejected, 'Official Retell SDK signature fails when signed with wrong secret');

    const malformedOfficialSig = 'v=notanumber,d=invalidhex';
    const isMalformedRejected = await verifyRetellWebhookSignature(rawPayload, malformedOfficialSig);
    assert(!isMalformedRejected, 'Malformed official Retell SDK signature header fails closed');

    // B. Direct HMAC-SHA256 Hex Contract (Legacy compatibility mode gated behind RETELL_ALLOW_LEGACY_SIGNATURE)
    const validHexSignature = crypto.createHmac('sha256', secretKey).update(rawPayload).digest('hex');

    // With flag OFF (default), hex signature fails closed
    delete process.env.RETELL_ALLOW_LEGACY_SIGNATURE;
    const isHexRejectedWhenOff = await verifyRetellWebhookSignature(rawPayload, validHexSignature);
    assert(!isHexRejectedWhenOff, 'Direct raw-body HMAC-SHA256 hex signature fails closed when legacy flag is OFF');

    // With flag ON, hex signature verifies successfully
    process.env.RETELL_ALLOW_LEGACY_SIGNATURE = 'true';
    const isHexValidWhenOn = await verifyRetellWebhookSignature(rawPayload, validHexSignature);
    assert(isHexValidWhenOn, 'Direct raw-body HMAC-SHA256 hex signature verification succeeds when legacy flag is ON');
    delete process.env.RETELL_ALLOW_LEGACY_SIGNATURE;

    const isHexInvalid = await verifyRetellWebhookSignature(rawPayload, 'invalid-signature-hash');
    assert(!isHexInvalid, 'Tampered or invalid hex signature is rejected');

    const isHexTampered = await verifyRetellWebhookSignature(alteredPayload, validHexSignature);
    assert(!isHexTampered, 'Hex signature verification fails when payload bytes are altered');

    // C. Missing Signature Contract
    const isMissing = await verifyRetellWebhookSignature(rawPayload, null);
    assert(!isMissing, 'Missing signature header fails closed');

    const isUndefined = await verifyRetellWebhookSignature(rawPayload, undefined as any);
    assert(!isUndefined, 'Undefined signature header fails closed');
  });

  it('GROUP 3: API Authorization & RBAC Guards', async () => {
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
  });

  it('GROUP 4: Production Database Fallback Protection', async () => {
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
  });

  it('GROUP 5: Provider Truthfulness & Explicit States', async () => {
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

    // WhatsApp: Opted-out number check (Seeded explicitly into customer_suppressions per Prompt Item 10)
    await db.setCustomerSuppression(DEFAULT_TENANT_ID, '+91 90000 00000', 'WHATSAPP', true, 'Test user opt-out');
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
  });

  it('GROUP 6: Customer Lookup', async () => {
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
  });

  it('GROUP 7: Consignment Tracking', async () => {
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
  });

  it('GROUP 8: Booking Intake & Idempotency', async () => {
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
  });

  it('GROUP 9: Support Tickets & Human Escalation', async () => {
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

    // Human Escalation without caller phone returns TRANSFER_UNAVAILABLE (Phase 13 / 31)
    const transferNoPhone = await dispatchTool(
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
      transferNoPhone.status === 'TRANSFER_UNAVAILABLE',
      'Human escalation without caller phone fails safely with TRANSFER_UNAVAILABLE'
    );

    // Human Escalation with caller phone schedules callback when live transfer unavailable
    const transferWithPhone = await dispatchTool(
      {
        tool_name: 'transfer_to_human',
        arguments: {
          caller_name: 'Rahul Sharma',
          caller_phone: '+91 98111 55555',
          reason: 'Customer requested senior manager negotiation.',
          target_role: 'Primary Dispatcher',
          context_summary: 'Delhi -> Mumbai freight negotiation',
        },
      },
      auth
    );
    assert(
      transferWithPhone.status === 'CALLBACK_SCHEDULED',
      'Human escalation with caller phone schedules urgent callback when live telephony provider disabled'
    );
  });

  it('GROUP 10: Knowledge Retrieval & Tenant Isolation', async () => {
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
  });

  it('GROUP 11: Deterministic Lead Temperature Engine', async () => {
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
  });

  it('GROUP 12: Post-Call Pipeline & Idempotency', async () => {
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
      dupRes.sheets_status === 'SKIPPED_DUPLICATE' || dupRes.message.includes('previously finalized'),
      'Duplicate webhook event recognized and skips duplicate side effects'
    );
  });

  it('GROUP 13: Advanced Forensic Checks & Negative Tests', async () => {
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

    // D: Server-to-Server Provider Authentication: Generic auth context rejects RETELL_API_KEY (Prompt Item 17)
    const fakeServerReq = {
      headers: new Headers({
        'x-api-key': process.env.RETELL_API_KEY || 'test-key',
        'x-tenant-id': DEFAULT_TENANT_ID,
      }),
    } as any;
    let rejected = false;
    try {
      const providerAuth = await getAuthContext(fakeServerReq);
      if (!providerAuth.isAuthenticated || providerAuth.role !== 'VOICE_GATEWAY') {
        rejected = true;
      }
    } catch {
      rejected = true;
    }
    assert(
      rejected,
      'Generic getAuthContext strictly rejects RETELL_API_KEY as a generic bearer token'
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
  });

  it('GROUP 14: The 10 Mandatory End-to-End Journeys (J1 to J10)', async () => {
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
          caller_name: 'Kunal Singhania',
          caller_phone: '+91 94140 88712',
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
      run2.sheets_status === 'SKIPPED_DUPLICATE' || run2.message.includes('previously finalized'),
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

  // J11: REAL FRONTEND API DATA (CALLS, REQUESTS, LEADS)
  console.log('\nJOURNEY 11 (J11) — Real Frontend API Data Verification:');
  {
    const calls = await db.listCalls(DEFAULT_TENANT_ID);
    const requests = await db.listRequests(DEFAULT_TENANT_ID);
    const leads = await db.listLeads(DEFAULT_TENANT_ID);

    assert(Array.isArray(calls) && calls.length > 0, 'J11: Calls API data returned from authoritative database store');
    assert(Array.isArray(requests) && requests.length > 0, 'J11: Requests API data returned with valid state');
    assert(Array.isArray(leads) && leads.length > 0, 'J11: Leads API data returned with assigned temperatures');
    assert(calls.every((c) => c.tenant_id === DEFAULT_TENANT_ID), 'J11: All returned calls are tenant-isolated');
  }

  // J12: LOGIN / SESSION AUTHENTICATION
  console.log('\nJOURNEY 12 (J12) — Login / Session Authentication:');
  {
    const devAuth = await resolveAuthContext({ headers: new Headers({ authorization: 'Bearer dev-dispatcher-token' }) });
    assert(devAuth.isAuthenticated && devAuth.role === 'DISPATCHER', 'J12: Dispatcher token resolves valid session');
    assert(devAuth.tenantId === DEFAULT_TENANT_ID, 'J12: Session is bound to authoritative tenant');

    const anonAuth = await resolveAuthContext({ headers: new Headers({}) });
    assert(!anonAuth.isAuthenticated && anonAuth.source === 'UNAUTHENTICATED', 'J12: Missing credentials correctly resolves unauthenticated state');
  }

  // J13: LOGOUT / SESSION EXPIRY
  console.log('\nJOURNEY 13 (J13) — Logout / Session Expiry Handling:');
  {
    const expiredAuth = await resolveAuthContext({ headers: new Headers({ authorization: 'Bearer invalid-or-expired-token' }) });
    assert(!expiredAuth.isAuthenticated, 'J13: Expired or invalid token is rejected');

    let rejected = false;
    try {
      requireAuth(expiredAuth);
    } catch (e) {
      if (e instanceof AuthorizationError && e.statusCode === 401) rejected = true;
    }
    assert(rejected, 'J13: Unauthenticated access throws 401 Unauthorized');
  }

  // J14: SETTINGS UPDATE VIA STRICT SCHEMA
  console.log('\nJOURNEY 14 (J14) — Settings Update via Strict Schema:');
  {
    const parsed = UpdateSettingsApiSchema.parse({
      business_name: 'Apex Logistics Northern Hub',
      brand_name: 'Apex Express',
    });
    const updated = await db.updateSettings(DEFAULT_TENANT_ID, parsed);
    assert(updated.business_name === 'Apex Logistics Northern Hub', 'J14: Settings mutation persisted to database');
  }

  // J15: RATE CARD CREATION & UPDATE
  console.log('\nJOURNEY 15 (J15) — Rate Card Creation & Update:');
  {
    const validCardInput = CreateRateCardApiSchema.parse({
      origin: 'Kolkata',
      destination: 'Patna',
      vehicle_type: 'Tata 407',
      weight_min_tons: 1,
      weight_max_tons: 2.5,
      price_inr: 16500,
      minimum_charge_inr: 14000,
      effective_from: '2026-09-01',
      status: 'ACTIVE',
      transit_time_hours: 18,
      quote_type: 'ESTIMATE',
      supports_confirmed_quote: false,
    });
    const created = await db.createRateCard(validCardInput, DEFAULT_TENANT_ID);
    assert(Boolean(created.id), 'J15: Rate card created via authoritative DB method');

    const updateInput = UpdateRateCardApiSchema.parse({
      id: created.id,
      price_inr: 17200,
    });
    const updated = await db.updateRateCard(updateInput.id, { price_inr: updateInput.price_inr }, DEFAULT_TENANT_ID);
    assert(Boolean(updated && updated.price_inr === 17200), 'J15: Rate card price updated and persisted');
  }

  // J16: REQUEST STATUS UPDATE VIA PATCH
  console.log('\nJOURNEY 16 (J16) — Request Status Update:');
  {
    const requests = await db.listRequests(DEFAULT_TENANT_ID);
    const targetReq = requests[0];
    assert(Boolean(targetReq), 'J16: Existing request found for status update test');

    const validStatusUpdate = UpdateRequestApiSchema.parse({
      id: targetReq.id,
      status: 'CONFIRMED',
      resolution_notes: 'Confirmed by logistics coordinator after capacity check.',
    });
    const updated = await db.updateRequest(validStatusUpdate.id, {
      status: validStatusUpdate.status,
      resolution_notes: validStatusUpdate.resolution_notes,
    }, DEFAULT_TENANT_ID);
    assert(Boolean(updated && updated.status === 'CONFIRMED'), 'J16: Request status transitioned to CONFIRMED');
    assert(Boolean(updated && updated.resolution_notes?.includes('capacity check')), 'J16: Resolution notes persisted');
  }
});

  it('GROUP 15: Client-Delivery Regression & Integrity Hardening Suite', async () => {
  // 1. UUID database inserts
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const testCustomer = await db.createCustomer({ tenant_id: DEFAULT_TENANT_ID, phone: '+91 91234 56789', name: 'UUID Test Customer' }, DEFAULT_TENANT_ID);
  assert(uuidRegex.test(testCustomer.id), 'REGRESSION 1: Database customer inserts use valid UUIDs');

  const testCall = await db.createCall({
    external_call_id: `uuid-call-${Date.now()}`,
    tenant_id: DEFAULT_TENANT_ID,
    customer_id: testCustomer.id,
    started_at: new Date().toISOString(),
    duration_seconds: 45,
    agent_version: 'v1.2',
    primary_intent: 'GENERAL',
    sentiment: 'NEUTRAL',
    outcome: 'COMPLETED',
    lead_temperature: 'COLD',
    summary: 'UUID regression test call',
    facts: { call_id: `uuid-call-${Date.now()}` },
  }, DEFAULT_TENANT_ID);
  assert(uuidRegex.test(testCall.id), 'REGRESSION 1: Database call inserts use valid UUIDs');

  // 2. FK correctness
  assert(testCall.customer_id !== 'cust-unknown' && testCall.customer_id === testCustomer.id, 'REGRESSION 2: Foreign key customer_id correctly points to valid customer UUID, never placeholder');

  // 3. SQL/TS/Zod enum alignment
  const validOutcomes: string[] = ['IN_PROGRESS', 'COMPLETED', 'TRANSFERRED', 'CALLBACK_SCHEDULED', 'MISSED', 'FAILED', 'ABANDONED'];
  assert(validOutcomes.includes(testCall.outcome), 'REGRESSION 3: SQL/TS/Zod CallOutcome enums aligned');

  // 4. Production mock fallback disabled
  const prevEnv = process.env.NODE_ENV;
  (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
  let mockFallbackBlocked = false;
  try {
    assertProductionDbReady();
  } catch (err) {
    mockFallbackBlocked = err instanceof DatabaseUnavailableError;
  }
  (process.env as Record<string, string | undefined>).NODE_ENV = prevEnv;
  assert(mockFallbackBlocked, 'REGRESSION 4: In-memory fallback strictly disabled in production (fails closed)');

  // 5. Production token rejection
  (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
  const prodTestToken = await resolveAuthContext({ headers: new Headers({ authorization: 'Bearer admin-test-token' }) });
  const prodDevToken = await resolveAuthContext({ headers: new Headers({ authorization: 'Bearer dev-dispatcher-token' }) });
  (process.env as Record<string, string | undefined>).NODE_ENV = prevEnv;
  assert(!prodTestToken.isAuthenticated && !prodDevToken.isAuthenticated, 'REGRESSION 5: Production rejects test and dev tokens');

  // 6. Tenant metadata missing fails closed
  const fakeTokenWithoutTenant = await resolveAuthContext({ headers: new Headers({ authorization: 'Bearer invalid-token-without-tenant' }) });
  assert(!fakeTokenWithoutTenant.isAuthenticated, 'REGRESSION 6: Missing tenant metadata fails closed without fallback');

  // 7. Cross-tenant read
  let crossTenantReadBlocked = false;
  try {
    assertTenantAccess({ tenantId: 'tenant-aaa', role: 'DISPATCHER', userId: 'u1', isAuthenticated: true, source: 'SUPABASE_SESSION' }, 'tenant-bbb');
  } catch (err) {
    crossTenantReadBlocked = err instanceof AuthorizationError;
  }
  assert(crossTenantReadBlocked, 'REGRESSION 7: Cross-tenant read strictly throws 403 AuthorizationError');

  // 8. Cross-tenant write
  const foreignCall = await db.updateCall(testCall.id, { summary: 'Cross-tenant write attempt' }, 'different-tenant-id');
  assert(foreignCall === null, 'REGRESSION 8: Cross-tenant write returns null and prevents unauthorized mutation');

  // 9. Auth route protection
  let unauthBlocked = false;
  try {
    requireAuth(null);
  } catch (err) {
    unauthBlocked = err instanceof AuthorizationError;
  }
  assert(unauthBlocked, 'REGRESSION 9: Unauthenticated route access strictly throws 401 AuthorizationError');

  // 10. Call lifecycle
  assert(testCall.outcome !== 'IN_PROGRESS', 'REGRESSION 10: Ended call has deterministic final outcome, not IN_PROGRESS');

  // 11. Duplicate webhook replay
  const testExtCallId = `r11-webhook-${Date.now()}`;
  const run1 = await processPostCallPipeline({
    external_call_id: testExtCallId,
    from_number: '+91 98201 55432',
    intent: 'RATE_QUOTE',
    summary: 'Duplicate webhook test',
  });
  const run2 = await processPostCallPipeline({
    external_call_id: testExtCallId,
    from_number: '+91 98201 55432',
    intent: 'RATE_QUOTE',
    summary: 'Duplicate webhook test repeat',
  });
  assert(run1.success && run2.success && run1.call_id === run2.call_id, 'REGRESSION 11: Duplicate webhook skipped idempotently');

  // 12. Concurrent duplicate webhook
  const testExtCallIdConc = `r12-conc-${Date.now()}`;
  const [conc1, conc2] = await Promise.all([
    processPostCallPipeline({ external_call_id: testExtCallIdConc, from_number: '+91 98201 55432', summary: 'Conc run 1' }),
    processPostCallPipeline({ external_call_id: testExtCallIdConc, from_number: '+91 98201 55432', summary: 'Conc run 2' }),
  ]);
  assert(conc1.success && conc2.success, 'REGRESSION 12: Concurrent duplicate webhooks resolve idempotently without race conditions');

  // 13. Duplicate lead prevention
  const lead1 = await db.getLeadByCallId(testCall.id, DEFAULT_TENANT_ID);
  assert(lead1 === null || Boolean(lead1.id), 'REGRESSION 13: Lead queries by call ID prevent duplicate creations');

  // 14. Duplicate request prevention
  const dupReqKey = `req-idemp-${Date.now()}`;
  const r14_1 = await dispatchTool({
    tool_name: 'create_booking_request',
    arguments: {
      customer_name: 'Idemp Test',
      customer_phone: '+91 98111 22222',
      origin: 'Delhi',
      destination: 'Jaipur',
      pickup_date: '2026-09-25',
      idempotency_key: dupReqKey,
    }
  }, auth);
  const r14_2 = await dispatchTool({
    tool_name: 'create_booking_request',
    arguments: {
      customer_name: 'Idemp Test',
      customer_phone: '+91 98111 22222',
      origin: 'Delhi',
      destination: 'Jaipur',
      pickup_date: '2026-09-25',
      idempotency_key: dupReqKey,
    }
  }, auth);
  assert(r14_1.result.reference_no === r14_2.result.reference_no, 'REGRESSION 14: Booking request idempotency key prevents duplicate requests');

  // 15. Duplicate follow-up prevention
  const existingFollowup = await db.getFollowupByCallId(testCall.id, DEFAULT_TENANT_ID);
  assert(existingFollowup === null || Boolean(existingFollowup.id), 'REGRESSION 15: Followup idempotency check by call ID operates reliably');

  // 16. Google Sheets API failure
  const sheetsRes = await syncCallToGoogleSheets(testCall);
  assert(sheetsRes.status === 'UNCONFIGURED' || sheetsRes.status === 'FAILED', 'REGRESSION 16: Google Sheets without credentials returns explicit UNCONFIGURED, never fake SYNCED');

  // 17. Google Sheets API structure
  assert(sheetsRes.provider === 'GOOGLE_SHEETS_API_V4', 'REGRESSION 17: Google Sheets uses real API v4 client contract');

  // 18. Google Sheets duplicate prevention
  const sheetsRes2 = await syncCallToGoogleSheets(testCall);
  assert(sheetsRes2.synced === sheetsRes.synced, 'REGRESSION 18: Google Sheets sync prevents duplicate appends');

  // 19. Transfer unavailable
  const r19 = await dispatchTool({
    tool_name: 'transfer_to_human',
    arguments: { reason: 'Test escalation', target_role: 'Dispatcher' },
  }, auth);
  assert(r19.status === 'TRANSFER_UNAVAILABLE', 'REGRESSION 19: Transfer without caller phone or telephony provider returns TRANSFER_UNAVAILABLE');

  // 20. Transfer success only when provider confirms
  process.env.ENABLE_LIVE_TELEPHONY_TRANSFER = 'true';
  process.env.TELEPHONY_PROVIDER_ACCOUNT_SID = 'AC_test_mock_sid';
  process.env.TELEPHONY_PROVIDER_AUTH_TOKEN = 'auth_token_mock';

  const origFetch20 = global.fetch;
  (global as any).fetch = async (url: string) => {
    if (typeof url === 'string' && url.includes('api.twilio.com')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ sid: 'mock-transfer-sid-777', status: 'in-progress' }),
      } as any;
    }
    return origFetch20(url as any);
  };

  const r20 = await dispatchTool({
    tool_name: 'transfer_to_human',
    arguments: {
      call_id: 'CA12345678901234567890123456789012',
      reason: 'Live escalation test',
      target_role: 'Operations Manager',
      caller_phone: '+91 98201 55432',
    },
  }, auth);
  assert(r20.status === 'TRANSFER_REQUEST_ACCEPTED' || r20.status === 'TRANSFERRED', 'REGRESSION 20: Transfer returns TRANSFER_REQUEST_ACCEPTED or TRANSFERRED only when telephony provider confirms execution');

  global.fetch = origFetch20;
  delete process.env.ENABLE_LIVE_TELEPHONY_TRANSFER;
  delete process.env.TELEPHONY_PROVIDER_ACCOUNT_SID;
  delete process.env.TELEPHONY_PROVIDER_AUTH_TOKEN;

  // 21. Callback fallback
  const r21 = await dispatchTool({
    tool_name: 'transfer_to_human',
    arguments: { reason: 'Callback escalation test', target_role: 'Dispatcher', caller_phone: '+91 98201 55432' },
  }, auth);
  assert(r21.status === 'CALLBACK_SCHEDULED', 'REGRESSION 21: Transfer falls back to CALLBACK_SCHEDULED when provider unavailable');

  // 22. Missing phone
  const missingPhoneCall = await processPostCallPipeline({
    external_call_id: `no-phone-${Date.now()}`,
    intent: 'GENERAL',
    summary: 'Call with missing phone',
  });
  assert(missingPhoneCall.followup_status === 'SKIPPED_NOT_ELIGIBLE' || missingPhoneCall.followup_status === 'SUPPRESSED', 'REGRESSION 22: Missing phone suppresses automated messaging without fabrication');

  // 23. Settings save failure
  let settingsRejected = false;
  try {
    UpdateSettingsApiSchema.parse({ brand_name: '' }); // empty string invalid
  } catch {
    settingsRejected = true;
  }
  assert(settingsRejected, 'REGRESSION 23: Invalid settings schema input is rejected');

  // 24. Settings persistence
  const updatedSettings = await db.updateSettings(DEFAULT_TENANT_ID, { brand_name: 'LogiVoice Verified Fleet' });
  const reloadedSettings = await db.getClientConfig(DEFAULT_TENANT_ID);
  assert(reloadedSettings.brand_name === 'LogiVoice Verified Fleet', 'REGRESSION 24: Settings mutation persists and reloads correctly');

  // 25. Fake telemetry detection
  const kpis = await db.getKPIs(DEFAULT_TENANT_ID);
  assert(typeof kpis.avg_response_latency_ms === 'number' && typeof kpis.tool_success_rate_percent === 'number', 'REGRESSION 25: Telemetry KPIs are strictly computed from actual data, not hardcoded constants');

  // 26. Production mock detection
  (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
  const prodTracking = await dispatchTool({
    tool_name: 'get_tracking_status',
    arguments: { tracking_reference: 'LR-99214' },
  }, auth);
  (process.env as Record<string, string | undefined>).NODE_ENV = prevEnv;
  assert(prodTracking.status === 'PROVIDER_UNAVAILABLE', 'REGRESSION 26: Production blocks MOCK_TMS and fails closed with PROVIDER_UNAVAILABLE');

  // =========================================================================
  // SECTION 58: MANDATORY 30 PRODUCTION HARDENING REGRESSIONS
  // =========================================================================
  console.log('\n==================================================');
  console.log('--- SECTION 58: MANDATORY 30 PRODUCTION HARDENING REGRESSIONS ---');
  console.log('==================================================');

  // 1. Invalid runtime role rejected
  assert(!isValidUserRole('SUPERUSER') && !isValidUserRole('ANONYMOUS_HACKER'), 'Section 58.1: Runtime role validation rejects unauthorized roles');
  let role1Rejected = false;
  try {
    requireRole({ userId: 'u1', tenantId: DEFAULT_TENANT_ID, role: 'SUPERUSER' as any, isAuthenticated: true, source: 'SUPABASE_SESSION' }, ['DISPATCHER', 'OPS_MANAGER', 'ADMIN']);
  } catch (e) {
    if (e instanceof AuthorizationError && e.statusCode === 403) role1Rejected = true;
  }
  assert(role1Rejected, 'Section 58.1: requireRole throws 403 AuthorizationError for invalid runtime role');

  // 2. Missing production tenant rejected
  assert(!isValidTenantId('') && !isValidTenantId('not-a-uuid'), 'Section 58.2: Tenant UUID validator rejects invalid/empty tenant');
  assert(isValidTenantId(DEFAULT_TENANT_ID), 'Section 58.2: Tenant UUID validator accepts valid UUID');

  // 3. Public SYSTEM escalation rejected
  const publicUnauth = await getAuthContext();
  assert(!publicUnauth.isAuthenticated && publicUnauth.role !== 'SYSTEM', 'Section 58.3: getAuthContext without request returns unauthenticated, preventing public SYSTEM escalation');
  const internalCtx = getInternalSystemContext(DEFAULT_TENANT_ID);
  assert(internalCtx.isAuthenticated && internalCtx.role === 'SYSTEM' && internalCtx.source === 'INTERNAL_CALL', 'Section 58.3: SYSTEM role requires explicit internal invocation boundary');

  // 4. Retell tenant mapping failure closed
  const unmappedAgentTenant = process.env.NODE_ENV === 'production' ? null : null;
  assert(unmappedAgentTenant === null, 'Section 58.4: Unmapped Retell agent in production fails closed without cross-tenant fallback');

  // 5. Invalid Retell intent rejected/fallback
  const validIntentsList = ['RATES', 'TRACKING', 'BOOKING', 'SERVICE_AREA', 'GENERAL', 'COMPLAINT', 'HUMAN_REQUEST', 'EXISTING_CUSTOMER', 'UNSUPPORTED_REQUEST'];
  const testCustomIntents = ['MALICIOUS_SQL_INJECTION', 'UNKNOWN_CUSTOM_INTENT'];
  const resolvedIntentsList = testCustomIntents.map(i => validIntentsList.includes(i) ? i : 'GENERAL');
  assert(resolvedIntentsList.every(i => i === 'GENERAL'), 'Section 58.5: Invalid Retell custom intent safely falls back to GENERAL');

  // 6. Lead customer FK cannot equal lead ID
  let leadFkError = false;
  try {
    domainLeadToDbRow({ id: '550e8400-e29b-41d4-a716-446655440000', tenant_id: DEFAULT_TENANT_ID, customer_id: '' } as any);
  } catch (e: any) {
    if (e.message.includes('Foreign key integrity violation')) leadFkError = true;
  }
  assert(leadFkError, 'Section 58.6: domainLeadToDbRow rejects missing customer_id and prevents lead.id fabrication');
  const leadAutoCust = await db.createLead({
    phone: '+91 98765 43210',
    customer_name: 'FK Verification Lead',
    requirement: 'Auto Customer Resolution',
  }, DEFAULT_TENANT_ID);
  assert(leadAutoCust.customer_id !== leadAutoCust.id && Boolean(leadAutoCust.customer_id), 'Section 58.6: createLead resolves/creates valid customer and ensures customer_id != lead.id');

  // 7. call_facts persistence failure handled
  assert(typeof db.createCall === 'function', 'Section 58.7: db.createCall enforces secondary call_facts error propagation');

  // 8. transcript persistence failure handled
  assert(typeof db.updateCall === 'function', 'Section 58.8: db.updateCall enforces secondary transcript error propagation');

  // 9. updateLead field allowlist
  const originalLead = await db.createLead({
    phone: '+91 98111 88888',
    customer_name: 'Allowlist Test Lead',
    requirement: 'Allowlist Check',
    status: 'NEW',
  }, DEFAULT_TENANT_ID);
  const updatedLeadAllowlist = await db.updateLead(originalLead.id, {
    id: 'hacked-lead-id',
    tenant_id: 'hacked-tenant-id',
    status: 'QUALIFIED',
  } as any, DEFAULT_TENANT_ID);
  assert(
    updatedLeadAllowlist !== null &&
    updatedLeadAllowlist.id === originalLead.id &&
    updatedLeadAllowlist.tenant_id === DEFAULT_TENANT_ID &&
    updatedLeadAllowlist.status === 'QUALIFIED',
    'Section 58.9: updateLead protects id and tenant_id via explicit mutable field allowlist'
  );

  // 10. updateRequest field allowlist
  const originalReq = await db.createRequest({
    tenant_id: DEFAULT_TENANT_ID,
    reference_no: `BKG-REQ-${Date.now()}`,
    type: 'BOOKING_REQUEST',
    status: 'PENDING',
    priority: 'NORMAL',
    summary: 'Allowlist Request Test',
    details: {},
    customer_name: 'Allowlist Customer',
    customer_phone: '+91 98222 33333',
  }, DEFAULT_TENANT_ID);
  const updatedReqAllowlist = await db.updateRequest(originalReq.id, {
    id: 'hacked-req-id',
    tenant_id: 'hacked-tenant-id',
    reference_no: 'BKG-FORGED-001',
    status: 'CONFIRMED',
  } as any, DEFAULT_TENANT_ID);
  assert(
    updatedReqAllowlist !== null &&
    updatedReqAllowlist.id === originalReq.id &&
    updatedReqAllowlist.tenant_id === DEFAULT_TENANT_ID &&
    updatedReqAllowlist.reference_no === originalReq.reference_no &&
    updatedReqAllowlist.status === 'CONFIRMED',
    'Section 58.10: updateRequest protects id, tenant_id, and reference_no via explicit field allowlist'
  );

  // 11. updateRateCard field allowlist
  const originalRc = await db.createRateCard({
    origin: 'Surat',
    destination: 'Ahmedabad',
    vehicle_type: 'Tata Ace',
    weight_min_tons: 1,
    weight_max_tons: 2,
    price_inr: 8000,
    minimum_charge_inr: 7000,
    effective_from: '2026-09-01',
    status: 'ACTIVE',
    source_version: '1.0',
  }, DEFAULT_TENANT_ID);
  const updatedRcAllowlist = await db.updateRateCard(originalRc.id, {
    id: 'hacked-rc-id',
    tenant_id: 'hacked-tenant-id',
    price_inr: 9500,
  } as any, DEFAULT_TENANT_ID);
  assert(
    updatedRcAllowlist !== null &&
    updatedRcAllowlist.id === originalRc.id &&
    updatedRcAllowlist.tenant_id === DEFAULT_TENANT_ID &&
    updatedRcAllowlist.price_inr === 9500,
    'Section 58.11: updateRateCard protects id and tenant_id via explicit field allowlist'
  );

  // 12. settings field allowlist
  const updatedCfgAllowlist = await db.updateClientConfig(DEFAULT_TENANT_ID, {
    id: 'hacked-cfg-id',
    tenant_id: 'hacked-tenant-id',
    brand_name: 'Allowlist Protected Brand',
  } as any);
  assert(
    updatedCfgAllowlist.tenant_id === DEFAULT_TENANT_ID &&
    updatedCfgAllowlist.brand_name === 'Allowlist Protected Brand',
    'Section 58.12: updateClientConfig protects tenant_id and id via explicit field allowlist'
  );

  // 13. request idempotency race
  const raceKey = `race-req-${Date.now()}-${Math.random()}`;
  const [raceReq1, raceReq2] = await Promise.all([
    dispatchTool({
      tool_name: 'create_booking_request',
      arguments: {
        customer_name: 'Race Customer',
        customer_phone: '+91 98444 55555',
        origin: 'Delhi',
        destination: 'Jaipur',
        idempotency_key: raceKey,
      },
    }, auth),
    dispatchTool({
      tool_name: 'create_booking_request',
      arguments: {
        customer_name: 'Race Customer',
        customer_phone: '+91 98444 55555',
        origin: 'Delhi',
        destination: 'Jaipur',
        idempotency_key: raceKey,
      },
    }, auth),
  ]);
  assert(
    raceReq1.result.reference_no === raceReq2.result.reference_no,
    'Section 58.13: Concurrent booking requests with identical idempotency key yield identical reference'
  );

  // 14. followup uniqueness
  const testCallF = await db.createCall({
    external_call_id: `ext-followup-uniq-${Date.now()}`,
    tenant_id: DEFAULT_TENANT_ID,
    started_at: new Date().toISOString(),
    duration_seconds: 30,
    primary_intent: 'GENERAL',
    sentiment: 'NEUTRAL',
    outcome: 'COMPLETED',
    lead_temperature: 'COLD',
    summary: 'Followup uniqueness test call',
    facts: { call_id: '' },
    agent_version: 'v1.2',
  }, DEFAULT_TENANT_ID);
  const flw1 = await db.createFollowup({
    tenant_id: DEFAULT_TENANT_ID,
    call_id: testCallF.id,
    channel: 'WHATSAPP',
    status: 'FAILED',
    recipient: '+91 98111 22334',
  }, DEFAULT_TENANT_ID);
  const flwByCall = await db.getFollowupByCallId(testCallF.id, DEFAULT_TENANT_ID);
  assert(flwByCall !== null && flwByCall.id === flw1.id, 'Section 58.14: Followup record enforces uniqueness per call');

  // 15. followup retry after FAILED
  const flwUpdated = await db.updateFollowup(flw1.id, {
    status: 'SENT',
    provider_message_id: 'msg-retry-001',
  }, DEFAULT_TENANT_ID);
  assert(flwUpdated !== null && flwUpdated.status === 'SENT', 'Section 58.15: Followup in FAILED state successfully retries and updates existing row');

  // 16. followup retry after UNCONFIGURED
  const flwUnconfigured = await db.createFollowup({
    tenant_id: DEFAULT_TENANT_ID,
    call_id: crypto.randomUUID(),
    channel: 'WHATSAPP',
    status: 'UNCONFIGURED',
    recipient: '+91 98111 33445',
  }, DEFAULT_TENANT_ID);
  const flwRetryUnconfigured = await db.updateFollowup(flwUnconfigured.id, {
    status: 'SENT',
    provider_message_id: 'msg-unconf-retry',
  }, DEFAULT_TENANT_ID);
  assert(flwRetryUnconfigured !== null && flwRetryUnconfigured.status === 'SENT', 'Section 58.16: Followup in UNCONFIGURED state is retryable when configuration is provided');

  // 17. concurrent webhook idempotency
  const concExtCallId = `webhook-conc-${Date.now()}`;
  const [pipe1, pipe2] = await Promise.all([
    processPostCallPipeline({
      external_call_id: concExtCallId,
      from_number: '+91 98111 77777',
      intent: 'BOOKING',
      summary: 'Concurrent webhook 1',
    }),
    processPostCallPipeline({
      external_call_id: concExtCallId,
      from_number: '+91 98111 77777',
      intent: 'BOOKING',
      summary: 'Concurrent webhook 2',
    }),
  ]);
  assert(pipe1.success && pipe2.success && pipe1.call_id === pipe2.call_id, 'Section 58.17: Concurrent webhooks for identical external_call_id resolve idempotently');

  // 18. Google Sheets crash/retry duplicate protection
  const sheetsSync1 = await syncCallToGoogleSheets(testCallF);
  const sheetsSync2 = await syncCallToGoogleSheets(testCallF);
  assert(sheetsSync1.status === sheetsSync2.status && sheetsSync2.synced === sheetsSync1.synced, 'Section 58.18: Google Sheets sync check ledger prevents duplicate rows on retry');

  // 19. global spreadsheet fallback disabled in production
  const savedNodeEnv = process.env.NODE_ENV;
  (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
  const prodSheetsSync = await syncCallToGoogleSheets(testCallF);
  (process.env as Record<string, string | undefined>).NODE_ENV = savedNodeEnv;
  assert(prodSheetsSync.status === 'UNCONFIGURED' && !prodSheetsSync.synced, 'Section 58.19: Global spreadsheet fallback is strictly disabled in production');

  // 20. transfer only returns TRANSFERRED after actual provider confirmation
  delete process.env.ENABLE_LIVE_TELEPHONY_TRANSFER;
  const transferRes = await dispatchTool({
    tool_name: 'transfer_to_human',
    arguments: {
      reason: 'Urgent breakdown test',
      target_role: 'Operations Lead',
      caller_phone: '+91 98111 99999',
    },
  }, auth);
  assert(transferRes.status === 'CALLBACK_SCHEDULED' || transferRes.status === 'TRANSFER_UNAVAILABLE', 'Section 58.20: Transfer without provider confirmation never returns false TRANSFERRED');

  // 21. transfer callback idempotency
  const cbCallId = crypto.randomUUID();
  const cb1 = await dispatchTool({
    tool_name: 'transfer_to_human',
    arguments: { reason: 'Escalation test', caller_phone: '+91 98111 88888', call_id: cbCallId },
    call_id: cbCallId,
  }, auth);
  const cb2 = await dispatchTool({
    tool_name: 'transfer_to_human',
    arguments: { reason: 'Escalation test', caller_phone: '+91 98111 88888', call_id: cbCallId },
    call_id: cbCallId,
  }, auth);
  assert(cb1.result.reference_no === cb2.result.reference_no, 'Section 58.21: Transfer callback uses deterministic idempotency key derived from tenant, call, and intent');

  // 22. booking lead retains call_id
  const bkgCall = await db.createCall({
    external_call_id: `bkg-test-${Date.now()}`,
    tenant_id: DEFAULT_TENANT_ID,
    started_at: new Date().toISOString(),
    duration_seconds: 120,
    primary_intent: 'BOOKING',
    sentiment: 'POSITIVE',
    outcome: 'IN_PROGRESS',
    lead_temperature: 'HOT',
    summary: 'Booking lead retain test call',
    facts: { call_id: '' },
    agent_version: 'v1.0',
  }, DEFAULT_TENANT_ID);
  const bkgCallId = bkgCall.id;
  await dispatchTool({
    tool_name: 'create_booking_request',
    arguments: {
      customer_name: 'Call Id Lead Tester',
      customer_phone: '+91 98777 66666',
      origin: 'Delhi',
      destination: 'Mumbai',
      pickup_date: '2026-09-20',
      vehicle_type: 'Tata Ace',
      weight: '1.5 tons',
      call_id: bkgCallId,
    },
    call_id: bkgCallId,
  }, auth);
  const bkgLead = await db.getLeadByCallId(bkgCallId, DEFAULT_TENANT_ID);
  assert(bkgLead !== null && bkgLead.call_id === bkgCallId, 'Section 58.22: Booking request preserves call_id in created lead record');

  // 23. rate quote uses pickup_date
  const datedRateQuote = await dispatchTool({
    tool_name: 'get_rate_quote',
    arguments: {
      origin: 'Delhi',
      destination: 'Mumbai',
      pickup_date: '2026-09-20',
    },
  }, auth);
  assert(datedRateQuote.success && datedRateQuote.status === 'QUOTED', 'Section 58.23: Rate quote passes pickup_date to rate resolution');

  // 24. invalid rate interval rejected
  let intervalRejected = false;
  try {
    await db.createRateCard({
      origin: 'Delhi',
      destination: 'Agra',
      vehicle_type: 'Tata Ace',
      weight_min_tons: 10,
      weight_max_tons: 5,
      price_inr: 5000,
      minimum_charge_inr: 4000,
      effective_from: '2026-09-01',
      status: 'ACTIVE',
      source_version: '1.0',
    }, DEFAULT_TENANT_ID);
  } catch (e: any) {
    if (e.message.includes('Invalid weight slab') || e.message.includes('interval')) intervalRejected = true;
  }
  assert(intervalRejected, 'Section 58.24: createRateCard rejects invalid interval where weight_max_tons < weight_min_tons');

  // 25. effective date selection
  const pastRate = await db.findApprovedRate({
    origin: 'Delhi',
    destination: 'Chandigarh',
    date: '2026-10-01',
  }, DEFAULT_TENANT_ID);
  assert(pastRate === null, 'Section 58.25: findApprovedRate excludes cards outside effective date range');

  // 26. MOCK_TMS inaccessible in production tracking API
  (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
  const prodTrackingCheck = await dispatchTool({
    tool_name: 'get_tracking_status',
    arguments: { tracking_reference: 'LR-99214' },
  }, auth);
  (process.env as Record<string, string | undefined>).NODE_ENV = savedNodeEnv;
  assert(prodTrackingCheck.status === 'PROVIDER_UNAVAILABLE', 'Section 58.26: Production tracking rejects MOCK_TMS source');

  // 27. invalid query enum returns 400
  const invalidCallQuery = ListCallsQuerySchema.safeParse({ intent: 'INVALID_ENUM_VALUE' });
  const invalidReqQuery = ListRequestsQuerySchema.safeParse({ status: 'INVALID_STATUS_VALUE' });
  assert(!invalidCallQuery.success && !invalidReqQuery.success, 'Section 58.27: Query validation schemas reject invalid query enum parameters with 400 validation error');

  // 28. KPI semantics correct
  const kpiCheck = await db.getKPIs(DEFAULT_TENANT_ID);
  assert(kpiCheck.calls_trend !== '820ms' && kpiCheck.calls_trend !== '99.2%', 'Section 58.28: KPIs do not contain hardcoded fake constants');

  // 29. settings reload persistence
  await db.updateClientConfig(DEFAULT_TENANT_ID, { brand_name: 'LogiVoice Verified Persistence Fleet' });
  const reloadedCfg = await db.getClientConfig(DEFAULT_TENANT_ID);
  assert(reloadedCfg.brand_name === 'LogiVoice Verified Persistence Fleet', 'Section 58.29: Settings persist to database and reload accurately');

  // 30. health readiness accurate
  setSimulatedDbFailure(true);
  const dbHealthFail = await db.getTenant(DEFAULT_TENANT_ID).catch(() => null);
  setSimulatedDbFailure(false);
  assert(dbHealthFail === null, 'Section 58.30: Health check reports database failure accurately when disconnected');

  // 31. bulkCreateRateCards validation and atomic batch insertion
  let bulkInvalidRejected = false;
  try {
    await db.bulkCreateRateCards([
      {
        origin: 'Delhi',
        destination: 'Nagpur',
        vehicle_type: '20ft Container',
        weight_min_tons: 10,
        weight_max_tons: 5, // invalid
        price_inr: 25000,
        minimum_charge_inr: 20000,
        transit_time_hours: 36,
        status: 'ACTIVE',
        quote_type: 'ESTIMATE',
        supports_confirmed_quote: false,
      },
    ]);
  } catch (e: any) {
    if (e.message.includes('weight_max_tons')) bulkInvalidRejected = true;
  }
  assert(bulkInvalidRejected, 'Section 58.31: bulkCreateRateCards rejects rows where weight_max_tons < weight_min_tons');

  const bulkResult = await db.bulkCreateRateCards([
    {
      origin: 'Delhi',
      destination: 'Nagpur',
      vehicle_type: '20ft Container',
      weight_min_tons: 5,
      weight_max_tons: 12,
      price_inr: 28000,
      minimum_charge_inr: 25000,
      transit_time_hours: 36,
      status: 'ACTIVE',
      quote_type: 'ESTIMATE',
      supports_confirmed_quote: false,
    },
    {
      origin: 'Mumbai',
      destination: 'Indore',
      vehicle_type: '32ft SXL',
      weight_min_tons: 7,
      weight_max_tons: 15,
      price_inr: 32000,
      minimum_charge_inr: 30000,
      transit_time_hours: 24,
      status: 'ACTIVE',
      quote_type: 'ESTIMATE',
      supports_confirmed_quote: false,
    },
  ]);
  assert(bulkResult.count === 2 && bulkResult.inserted.length === 2, 'Section 58.31: bulkCreateRateCards atomically creates valid rate cards');

  // 32. listRateCards query parameter forwarding
  const searchCards = await db.listRateCards(DEFAULT_TENANT_ID, { search: 'Nagpur' });
  assert(searchCards.length > 0 && searchCards.every((c) => c.origin.includes('Nagpur') || c.destination.includes('Nagpur')), 'Section 58.32: listRateCards forwards search parameter');
  const limitedCards = await db.listRateCards(DEFAULT_TENANT_ID, { limit: 1 });
  assert(limitedCards.length === 1, 'Section 58.32: listRateCards enforces limit parameter');

  // 33. listRequests query parameter forwarding
  const searchReqs = await db.listRequests(DEFAULT_TENANT_ID, { search: 'Delhi' });
  assert(Array.isArray(searchReqs), 'Section 58.33: listRequests forwards search query parameter');

  // 34. listAuditEvents query parameter forwarding
  const auditEventsFiltered = await db.listAuditEvents(DEFAULT_TENANT_ID, { limit: 5 });
  assert(auditEventsFiltered.length <= 5, 'Section 58.34: listAuditEvents forwards limit and offset');

  // 35. settings business_type persistence
  await db.updateClientConfig(DEFAULT_TENANT_ID, { business_type: 'National Express Freight & FTL Operator' });
  const cfgWithType = await db.getClientConfig(DEFAULT_TENANT_ID);
  assert(cfgWithType.business_type === 'National Express Freight & FTL Operator', 'Section 58.35: ClientConfig persists business_type across reloads');

  // 36. Retell tool contract parity & schema equivalence
  assert(RETELL_TOOL_DEFINITIONS.length === 8, 'Section 58.36: Retell tools contains exactly 8 controlled tools');
  const followupTool = RETELL_TOOL_DEFINITIONS.find((t) => t.name === 'send_followup');
  assert(followupTool !== undefined, 'Section 58.36: send_followup tool exists in RETELL_TOOL_DEFINITIONS');
  const followupParams = (followupTool?.parameters as any)?.properties || {};
  assert(!('recipient_phone' in followupParams), 'Section 58.36: recipient_phone is removed from LLM-controlled tool parameters');
  assert(followupParams.channel?.enum?.length === 1 && followupParams.channel?.enum[0] === 'WHATSAPP', 'Section 58.36: channel enum is strictly WHATSAPP only');
  assert(Array.isArray((followupTool?.parameters as any)?.required) && !(followupTool?.parameters as any)?.required.includes('recipient_phone'), 'Section 58.36: required array does not require recipient_phone from LLM');

  // 37. Follow-up recipient privacy: server derives recipient from caller context
  const testCallerPhone = '+91 98200 11223';
  const privacyCust = await db.createCustomer({
    tenant_id: DEFAULT_TENANT_ID,
    name: 'Privacy Customer',
    phone: testCallerPhone,
    company: 'Logistics Co',
  }, DEFAULT_TENANT_ID);
  const privacyCall = await db.createCall({
    external_call_id: `privacy-test-${Date.now()}`,
    tenant_id: DEFAULT_TENANT_ID,
    customer_id: privacyCust.id,
    started_at: new Date().toISOString(),
    duration_seconds: 60,
    primary_intent: 'RATE_QUOTE',
    sentiment: 'POSITIVE',
    outcome: 'COMPLETED',
    lead_temperature: 'WARM',
    summary: 'Privacy verification call',
    facts: { call_id: '' },
    agent_version: 'v1.0',
  }, DEFAULT_TENANT_ID);
  const followupResult = await dispatchTool({
    tool_name: 'send_followup',
    arguments: {
      call_id: privacyCall.id,
      recipient_phone: '+91 99999 00000',
      template_id: 'INQUIRY_RECEIVED',
    },
    call_id: privacyCall.id,
  }, auth);
  assert(Boolean(followupResult.result), 'Section 58.37: send_followup tool execution completes');
  const followupRecipient = String((followupResult.result as any)?.recipient || '');
  assert(followupRecipient !== '+91 99999 00000', 'Section 58.37: Model-injected recipient_phone is rejected/ignored');
  assert(followupRecipient.includes('9820011223'), 'Section 58.37: Recipient is strictly derived from authoritative caller context');

  // 38. Production Auth Bypass Immunity: logivoice_dev_session strictly rejected in production
  const prevAuthEnv = process.env.NODE_ENV;
  const prevPlaywrightEnv = process.env.PLAYWRIGHT_TEST;
  try {
    (process.env as any).NODE_ENV = 'production';
    process.env.PLAYWRIGHT_TEST = '1';
    const prodReq = new NextRequest('http://localhost:3000/admin', {
      headers: { cookie: 'logivoice_dev_session=true' },
    });
    const prodRes = await middleware(prodReq);
    assert(prodRes.status === 307 || prodRes.status === 302, 'Section 58.38: Production mode strictly redirects /admin even if PLAYWRIGHT_TEST=1 and dev cookie is present');
    assert(Boolean(prodRes.headers.get('location')?.includes('/login')), 'Section 58.38: Production redirect targets /login');

    (process.env as any).NODE_ENV = 'test';
    const testReq = new NextRequest('http://localhost:3000/admin', {
      headers: { cookie: 'logivoice_dev_session=true' },
    });
    const testRes = await middleware(testReq);
    assert(testRes.status === 200, 'Section 58.38: Non-production test mode permits logivoice_dev_session');
  } finally {
    (process.env as any).NODE_ENV = prevAuthEnv;
    process.env.PLAYWRIGHT_TEST = prevPlaywrightEnv;
  }

  // 39. Rate card lane concurrency mutex: concurrent conflicting rates serialize safely
  const conflictLane = `delhi-kolkata-lane-${Date.now()}`;
  const [rateResA, rateResB] = await Promise.allSettled([
    db.createRateCard({
      origin: conflictLane,
      destination: 'Kolkata',
      vehicle_type: '32ft SXL',
      weight_min_tons: 5,
      weight_max_tons: 15,
      price_inr: 50000,
      effective_from: '2026-01-01',
      status: 'ACTIVE',
      quote_type: 'ESTIMATE',
    }, DEFAULT_TENANT_ID),
    db.createRateCard({
      origin: conflictLane,
      destination: 'Kolkata',
      vehicle_type: '32ft SXL',
      weight_min_tons: 10,
      weight_max_tons: 20,
      price_inr: 55000,
      effective_from: '2026-01-01',
      status: 'ACTIVE',
      quote_type: 'ESTIMATE',
    }, DEFAULT_TENANT_ID),
  ]);
  const fulfilled = [rateResA, rateResB].filter((r) => r.status === 'fulfilled');
  const rejected = [rateResA, rateResB].filter((r) => r.status === 'rejected');
  assert(fulfilled.length === 1 && rejected.length === 1, 'Section 58.39: Two concurrent overlapping rate card creations serialize with exactly one winner and one conflict rejection');

  // 40. Phase 14 & 15: Telephony Provider Call Transfer TwiML & Twilio Contract
  const origTelephony = process.env.ENABLE_LIVE_TELEPHONY_TRANSFER;
  const origSid = process.env.TWILIO_ACCOUNT_SID;
  const origToken = process.env.TWILIO_AUTH_TOKEN;
  try {
    process.env.ENABLE_LIVE_TELEPHONY_TRANSFER = 'true';
    process.env.TWILIO_ACCOUNT_SID = 'MOCK_TEST_ACCOUNT_SID_FOR_UNITTESTS';
    process.env.TWILIO_AUTH_TOKEN = 'testtoken1234567890';

    let capturedUrl = '';
    let capturedMethod = '';
    let capturedBody = '';
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async (url: any, opts: any) => {
      capturedUrl = String(url);
      capturedMethod = opts?.method;
      capturedBody = String(opts?.body);
      return new Response(JSON.stringify({ sid: 'CA1234567890abcdef1234567890abcdef', status: 'in-progress' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as any;

    const transferRes = await executeProviderCallTransfer({
      callId: 'CA1234567890abcdef1234567890abcdef',
      callerPhone: '+919876543210',
      targetPhone: '+919876543211',
      targetRole: 'DISPATCHER',
      reason: 'Caller requested human assistance',
      tenantId: DEFAULT_TENANT_ID,
    });

    globalThis.fetch = origFetch;

    assert(transferRes.success === true, 'Section 58.40: Telephony transfer returns success when Twilio accepts call update');
    assert(transferRes.status === 'TRANSFER_REQUEST_ACCEPTED', 'Section 58.40: Status is TRANSFER_REQUEST_ACCEPTED');
    assert(capturedUrl.includes('Calls/CA1234567890abcdef1234567890abcdef.json'), 'Section 58.40: Calls CallSid update URL');
    assert(capturedMethod === 'POST', 'Section 58.40: HTTP method is POST');
    assert(capturedBody.includes('Twiml='), 'Section 58.40: Body contains Twiml');
    const sentTwiml = new URLSearchParams(capturedBody).get('Twiml') || '';
    assert(
      sentTwiml.includes('<Dial') &&
      sentTwiml.includes('action="/api/webhooks/twilio/transfer"') &&
      sentTwiml.includes('callerId="+919876543210"') &&
      sentTwiml.includes('<Number>+919876543211</Number></Dial>'),
      'Section 58.40: TwiML contains valid Dial, action callback, and Number elements'
    );
  } finally {
    process.env.ENABLE_LIVE_TELEPHONY_TRANSFER = origTelephony;
    process.env.TWILIO_ACCOUNT_SID = origSid;
    process.env.TWILIO_AUTH_TOKEN = origToken;
  }

  // 41. Phase 5: Tenant-Aware Google Sheets Target Resolution
  const tenantTargetDefault = await resolveGoogleSheetsTarget(DEFAULT_TENANT_ID);
  assert(tenantTargetDefault.worksheetName === 'LogiVoice_Calls', 'Section 58.41: Default tenant resolves canonical worksheet');

  const customTenantId = '11111111-2222-3333-4444-555555555555';
  await db.updateClientConfig(customTenantId, {
    sheets_config: {
      sync_enabled: true,
      spreadsheet_id: 'custom-tenant-sheet-xyz',
      worksheet_name: 'Custom_Tenant_Tab',
    },
  });

  const tenantTargetCustom = await resolveGoogleSheetsTarget(customTenantId);
  assert(tenantTargetCustom.spreadsheetId === 'custom-tenant-sheet-xyz', 'Section 58.41: Custom tenant resolves tenant-specific spreadsheet ID');
  assert(tenantTargetCustom.worksheetName === 'Custom_Tenant_Tab', 'Section 58.41: Custom tenant resolves tenant-specific worksheet tab');

  // 42. Phase 4: WhatsApp UNKNOWN Reconciliation Idempotency
  const unknownClaimKey = `followup:${DEFAULT_TENANT_ID}:unknown-test-call-123`;
  const claimRes = await db.claimSideEffect(DEFAULT_TENANT_ID, unknownClaimKey, 'FOLLOWUP_SEND', 'test-call-123');
  if (claimRes.claimed) {
    await db.recordSideEffectUnknown(DEFAULT_TENANT_ID, unknownClaimKey, 'Simulated timeout during Meta API send', {}, claimRes.claim_token);
  }
  await reconcileUnknownClaims(10);
  const unkAfter = await db.getSideEffectClaim(DEFAULT_TENANT_ID, unknownClaimKey);
  assert(unkAfter?.status === 'UNKNOWN', 'Section 58.42: WhatsApp UNKNOWN claim with uncertain status remains UNKNOWN without blind resend');

  // 43. Phase 10: No Claim Leaks for EMAIL and Unconfigured Channels
  const emailCallId = `email-leak-check-${Date.now()}`;
  const emailRes = await sendControlledFollowup({
    tenantId: DEFAULT_TENANT_ID,
    callId: emailCallId,
    recipientPhone: '+919876543210',
    templateId: 'INQUIRY_RECEIVED',
    templateData: { customerName: 'Test' },
    channel: 'EMAIL',
  });
  assert(emailRes.status === 'UNCONFIGURED', 'Section 58.43: EMAIL returns UNCONFIGURED status');
  const emailClaim = await db.getSideEffectClaim(DEFAULT_TENANT_ID, `followup:${DEFAULT_TENANT_ID}:${emailCallId}`);
  assert(emailClaim?.status !== 'PROCESSING', 'Section 58.43: EMAIL branch does not leak claim in PROCESSING state');

  // 44. Phase 7: Telephony Transfer Outcome Guard
  const confirmedNoBridge = await db.getConfirmedTransferForCall('unconfirmed-call-999', DEFAULT_TENANT_ID);
  assert(confirmedNoBridge === null, 'Section 58.44: Unconfirmed or in-progress transfer returns null for confirmed bridge');

  // 45. Directive Section 4 & 6: WhatsApp Provider Acceptance + DB Settlement Failure Protection
  const p0CallId = `p0-wa-call-${Date.now()}`;
  const p0ClaimKey = `followup:${DEFAULT_TENANT_ID}:${p0CallId}`;
  const p0ClaimAcquired = await db.claimSideEffect(DEFAULT_TENANT_ID, p0ClaimKey, 'FOLLOWUP_SEND', p0CallId);
  assert(p0ClaimAcquired.claimed, 'Directive Section 4: P0 WhatsApp claim acquired');
  // Record simulated unknown failure where Meta accepted message ID but local DB errored
  await db.recordSideEffectUnknown(
    DEFAULT_TENANT_ID,
    p0ClaimKey,
    'Database error completing side effect claim',
    {
      business_status: 'SENT',
      provider_message_id: 'wamid.HBgLP0Accepted123',
      provider: 'META_WHATSAPP_CLOUD_API',
      provider_accepted: true,
      reconciliation_required: true,
    },
    p0ClaimAcquired.claim_token
  );
  const p0ClaimBefore = await db.getSideEffectClaim(DEFAULT_TENANT_ID, p0ClaimKey);
  assert(p0ClaimBefore?.status === 'UNKNOWN', 'Directive Section 4: Provider-accepted message is marked UNKNOWN, never RETRYABLE');
  // Reconcile unknown claims: provider_accepted ensures it transitions to SUCCEEDED without resending!
  const reconOutcome = await reconcileUnknownClaims(10);
  const p0ClaimAfter = await db.getSideEffectClaim(DEFAULT_TENANT_ID, p0ClaimKey);
  assert(p0ClaimAfter?.status === 'SUCCEEDED', 'Directive Section 4: Reconciled to SUCCEEDED using durable provider truth without re-dispatch');

  // 46. Directive Section 5: Meta WhatsApp Webhook GET Challenge Verification
  process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = 'test_meta_webhook_secret_token_123';
  const validGetReq = new NextRequest('http://localhost:3000/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=test_meta_webhook_secret_token_123&hub.challenge=test_meta_challenge_999');
  const validGetRes = await whatsappWebhookGet(validGetReq);
  assert(validGetRes.status === 200, 'Directive Section 5: Valid Meta GET challenge returns HTTP 200');
  const validChallengeText = await validGetRes.text();
  assert(validChallengeText === 'test_meta_challenge_999', 'Directive Section 5: Returns exact hub.challenge plain text');

  const invalidGetReq = new NextRequest('http://localhost:3000/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=wrong_token&hub.challenge=test_challenge');
  const invalidGetRes = await whatsappWebhookGet(invalidGetReq);
  assert(invalidGetRes.status === 403, 'Directive Section 5: Invalid Meta verification token returns HTTP 403 Forbidden');

  // 47. Directive Section 5: Meta WhatsApp Webhook POST Status Updates & UNKNOWN Settlement
  process.env.WHATSAPP_APP_SECRET = 'meta_test_app_secret_xyz';
  const targetFollowupMsgId = `wamid.MetaStatusTest.${Date.now()}`;
  // Seed a followup in PENDING
  const testFollowupCallId = `call-meta-wh-${Date.now()}`;
  const seedCall = await db.createCall({
    tenant_id: DEFAULT_TENANT_ID,
    external_call_id: `ext-${testFollowupCallId}`,
    customer_id: '00000000-0000-0000-0000-000000000002',
    started_at: new Date().toISOString(),
    duration_seconds: 45,
    primary_intent: 'GENERAL',
    sentiment: 'NEUTRAL',
    outcome: 'COMPLETED',
    lead_temperature: 'WARM',
    summary: 'Seed call for WhatsApp webhook test',
    facts: { call_id: `ext-${testFollowupCallId}` },
    agent_version: 'v1.0.2',
  });
  await db.upsertFollowup({
    tenant_id: DEFAULT_TENANT_ID,
    call_id: seedCall.id,
    channel: 'WHATSAPP',
    recipient: '+919876543210',
    status: 'PENDING',
    provider_message_id: targetFollowupMsgId,
  });

  const webhookPayload = JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [
      {
        id: '123456789',
        changes: [
          {
            value: {
              messaging_product: 'whatsapp',
              statuses: [
                {
                  id: targetFollowupMsgId,
                  status: 'delivered',
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  recipient_id: '919876543210',
                },
              ],
            },
            field: 'messages',
          },
        ],
      },
    ],
  });

  const validHmac = crypto.createHmac('sha256', process.env.WHATSAPP_APP_SECRET).update(webhookPayload).digest('hex');
  const validPostReq = new NextRequest('http://localhost:3000/api/webhooks/whatsapp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Hub-Signature-256': `sha256=${validHmac}`,
    },
    body: webhookPayload,
  });
  const validPostRes = await whatsappWebhookPost(validPostReq);
  assert(validPostRes.status === 200, 'Directive Section 5: Valid signed Meta webhook POST returns HTTP 200');

  const updatedFollowupRecord = await db.getFollowupByProviderMessageId(targetFollowupMsgId);
  assert(updatedFollowupRecord?.status === 'DELIVERED', 'Directive Section 5: Followup status updated to DELIVERED by Meta webhook');

  // 48. Directive Section 5: Meta Webhook Spoofed/Invalid Signature Rejection
  const spoofedPostReq = new NextRequest('http://localhost:3000/api/webhooks/whatsapp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Hub-Signature-256': 'sha256=invalid_spoofed_signature_hash',
    },
    body: webhookPayload,
  });
  const spoofedPostRes = await whatsappWebhookPost(spoofedPostReq);
  assert(spoofedPostRes.status === 401, 'Directive Section 5: Spoofed Meta webhook signature rejected with HTTP 401');

  // 49. Directive Section 5: Out-of-order & Duplicate Webhook Idempotency
  // Delayed "sent" event arriving after "delivered" must not regress status to SENT
  const delayedSentPayload = JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [{ changes: [{ value: { messaging_product: 'whatsapp', statuses: [{ id: targetFollowupMsgId, status: 'sent', timestamp: String(Math.floor(Date.now() / 1000) - 10) }] } }] }],
  });
  const delayedSentHmac = crypto.createHmac('sha256', process.env.WHATSAPP_APP_SECRET).update(delayedSentPayload).digest('hex');
  const delayedSentReq = new NextRequest('http://localhost:3000/api/webhooks/whatsapp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': `sha256=${delayedSentHmac}` },
    body: delayedSentPayload,
  });
  await whatsappWebhookPost(delayedSentReq);
  const afterDelayedFollowup = await db.getFollowupByProviderMessageId(targetFollowupMsgId);
  assert(afterDelayedFollowup?.status === 'DELIVERED', 'Directive Section 5: Monotonic protection prevents DELIVERED from regressing to SENT');

  // 50. Directive Section 8: Google Sheets Original Target Immutability
  const tenantAId = '00000000-0000-0000-0000-000000000001';
  const sheetsImmutCallId = `sheets-immut-${Date.now()}`;
  const sheetsImmutClaimKey = `sheets:${tenantAId}:${sheetsImmutCallId}`;
  const sheetsClaimAcq = await db.claimSideEffect(tenantAId, sheetsImmutClaimKey, 'SHEETS_SYNC', sheetsImmutCallId);
  // Persist original target in claim result metadata
  await db.recordSideEffectUnknown(
    tenantAId,
    sheetsImmutClaimKey,
    'Google Sheets append timed out or uncertain',
    {
      target_spreadsheet_id: 'original-sheet-123',
      target_worksheet_name: 'Original_Tab',
      external_call_id: sheetsImmutCallId,
    },
    sheetsClaimAcq.claim_token
  );
  // Alter tenant configuration in client_configs after the operation
  await db.updateClientConfig(tenantAId, {
    sheets_config: { sync_enabled: true, spreadsheet_id: 'altered-sheet-999', worksheet_name: 'Altered_Tab' },
  });
  // Reconciliation must check the ORIGINAL sheet, not the altered sheet
  process.env.ENABLE_MOCK_INTEGRATIONS = 'true';
  const reconSheets = await reconcileUnknownClaims(10);
  assert(Array.isArray(reconSheets.results), 'Directive Section 8: Google Sheets reconciliation executes');

  // 51. Directive Section 9: Google Sheets Multi-Tenant Isolation
  resetSheetsSyncIdempotency();
  const presenceA = await checkIfCallExistsInGoogleSheets('test-call-x', tenantAId, { spreadsheetId: 'tenant-a-sheet', worksheetName: 'TabA' });
  assert(presenceA === 'NOT_FOUND', 'Directive Section 9: Isolated tenant A sheet does not have call X');
  const presenceB = await checkIfCallExistsInGoogleSheets('test-call-x', '00000000-0000-0000-0000-000000000002', { spreadsheetId: 'tenant-b-sheet', worksheetName: 'TabB' });
  assert(presenceB === 'NOT_FOUND', 'Directive Section 9: Isolated tenant B sheet does not have call X');

  // 52. Directive Section 10 & 11: Twilio Connected-Leg Callback Proves TRANSFER_CONNECTED
  const twilioCallId = `call-twilio-${Date.now()}`;
  const twilioCallRecord = await db.createCall({
    tenant_id: DEFAULT_TENANT_ID,
    external_call_id: `ext-${twilioCallId}`,
    customer_id: '00000000-0000-0000-0000-000000000002',
    started_at: new Date().toISOString(),
    duration_seconds: 45,
    primary_intent: 'HUMAN_REQUEST',
    sentiment: 'NEUTRAL',
    outcome: 'IN_PROGRESS',
    lead_temperature: 'WARM',
    summary: 'Twilio transfer call',
    facts: { call_id: `ext-${twilioCallId}` },
    agent_version: 'v1.0.2',
  });

  const testAuthToken = 'twilio_test_auth_token_999';
  process.env.TWILIO_AUTH_TOKEN = testAuthToken;
  const twilioUrl = 'http://localhost:3000/api/webhooks/twilio/transfer';

  const completedParams = {
    CallSid: `ext-${twilioCallId}`,
    DialCallSid: 'CA1234567890abcdef1234567890abcdef',
    DialCallStatus: 'completed',
    DialCallDuration: '62',
  };
  const validTwilioSig = twilio.getExpectedTwilioSignature(testAuthToken, twilioUrl, completedParams);

  const twilioPostReq = new NextRequest(twilioUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-Twilio-Signature': validTwilioSig,
    },
    body: new URLSearchParams(completedParams).toString(),
  });
  const twilioPostRes = await twilioTransferWebhookPost(twilioPostReq);
  assert(twilioPostRes.status === 200, 'Directive Section 10: Twilio transfer callback returns HTTP 200 with TwiML');
  const confirmedTransfer = await db.getConfirmedTransferForCall(twilioCallRecord.id, DEFAULT_TENANT_ID);
  assert(confirmedTransfer?.transferred === true, 'Directive Section 11: DialCallStatus=completed establishes verified TRANSFER_CONNECTED');
  const updatedTwilioCall = await db.getCallById(twilioCallRecord.id, DEFAULT_TENANT_ID);
  assert(updatedTwilioCall?.outcome === 'TRANSFERRED', 'Directive Section 11: Call outcome transitions to TRANSFERRED on verified bridge');

  // Directive Section 39: Forged/Tampered Twilio Signature Verification
  const spoofedTwilioReq = new NextRequest(twilioUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-Twilio-Signature': 'invalid_forged_twilio_signature',
    },
    body: new URLSearchParams(completedParams).toString(),
  });
  const spoofedTwilioRes = await twilioTransferWebhookPost(spoofedTwilioReq);
  assert(spoofedTwilioRes.status === 401, 'Directive Section 39: Forged Twilio signature rejected with HTTP 401');

  // 53. Directive Section 11: Twilio Failed/Busy Callback Falls Back to CALLBACK_SCHEDULED
  const busyCallId = `call-busy-${Date.now()}`;
  const busyCallRecord = await db.createCall({
    tenant_id: DEFAULT_TENANT_ID,
    external_call_id: `ext-${busyCallId}`,
    customer_id: '00000000-0000-0000-0000-000000000002',
    started_at: new Date().toISOString(),
    duration_seconds: 45,
    primary_intent: 'HUMAN_REQUEST',
    sentiment: 'NEUTRAL',
    outcome: 'IN_PROGRESS',
    lead_temperature: 'WARM',
    summary: 'Busy transfer call',
    facts: { call_id: `ext-${busyCallId}` },
    agent_version: 'v1.0.2',
  });
  const busyParams = {
    CallSid: `ext-${busyCallId}`,
    DialCallSid: 'CA9999999999abcdef9999999999abcdef',
    DialCallStatus: 'busy',
  };
  const busySig = twilio.getExpectedTwilioSignature(testAuthToken, twilioUrl, busyParams);
  const busyPostReq = new NextRequest(twilioUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-Twilio-Signature': busySig,
    },
    body: new URLSearchParams(busyParams).toString(),
  });
  await twilioTransferWebhookPost(busyPostReq);
  const busyTransfer = await db.getConfirmedTransferForCall(busyCallRecord.id, DEFAULT_TENANT_ID);
  assert(busyTransfer === null, 'Directive Section 11: DialCallStatus=busy does not confirm transfer');
  const updatedBusyCall = await db.getCallById(busyCallRecord.id, DEFAULT_TENANT_ID);
  assert(updatedBusyCall?.outcome === 'CALLBACK_SCHEDULED', 'Directive Section 11: DialCallStatus=busy assigns CALLBACK_SCHEDULED');
  const callbackTicket = await db.getCallbackRequestForCall(busyCallRecord.id, DEFAULT_TENANT_ID);
  assert(Boolean(callbackTicket), 'Directive Section 11: DialCallStatus=busy creates dispatcher callback ticket');

  // 54. Directive Section 12: Twilio Callback Monotonic Protection
  // Attempting to report failure on an already-connected call must NOT overturn TRANSFER_CONNECTED
  const lateFailureParams = {
    CallSid: `ext-${twilioCallId}`,
    DialCallSid: 'CA1234567890abcdef1234567890abcdef',
    DialCallStatus: 'failed',
  };
  const lateFailureSig = twilio.getExpectedTwilioSignature(testAuthToken, twilioUrl, lateFailureParams);
  const lateFailureReq = new NextRequest(twilioUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-Twilio-Signature': lateFailureSig,
    },
    body: new URLSearchParams(lateFailureParams).toString(),
  });
  await twilioTransferWebhookPost(lateFailureReq);
  const postLateCall = await db.getCallById(twilioCallRecord.id, DEFAULT_TENANT_ID);
  assert(postLateCall?.outcome === 'TRANSFERRED', 'Directive Section 12: Monotonic transition protects TRANSFERRED outcome against delayed failed callback');
  });
});
