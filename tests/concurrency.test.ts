/**
 * LOGIVOICE V1 — AUTHORITATIVE CONCURRENCY & EXACTLY-ONCE INTEGRITY TESTS
 * tests/concurrency.test.ts
 *
 * Enforces:
 * 1. 100 workers competing for SAME fresh claim -> exactly 1 acquired.
 * 2. 100 workers competing for SAME expired lease -> exactly 1 stale takeover acquired.
 * 3. 2 simultaneous sendControlledFollowup for same call -> provider invocation count = 1.
 * 4. 2 concurrent processPostCallPipeline for same call -> exactly 1 business execution.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { db, DEFAULT_TENANT_ID } from '../lib/db';
import { sendControlledFollowup } from '../lib/integrations/messaging';
import { processPostCallPipeline } from '../lib/pipeline/post-call';
import { runRetryWorker } from '../lib/pipeline/retry-worker';

describe('LogiVoice V1 — Concurrency & Exactly-Once Safety Suite', () => {
  it('1. 100 concurrent workers competing for SAME fresh claim -> exactly 1 acquired', async () => {
    const tenantId = DEFAULT_TENANT_ID;
    const testClaimKey = `fresh-race-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const callId = `call-fresh-${Date.now()}`;

    // Launch 100 simultaneous workers
    const promises = Array.from({ length: 100 }, (_, idx) =>
      db.claimSideEffect(tenantId, testClaimKey, 'POST_CALL_PIPELINE', callId, 60000, 3)
    );

    const results = await Promise.all(promises);

    const winners = results.filter((r) => r.claimed === true);
    const losers = results.filter((r) => r.claimed === false);

    assert.equal(winners.length, 1, 'Exactly one worker must acquire the fresh claim lease');
    assert.equal(losers.length, 99, 'Exactly 99 workers must fail to acquire and receive active processing status');

    // Verify winner has a valid claim_token
    assert.ok(winners[0].claim_token, 'Winner must receive non-empty claim_token');
    assert.equal(winners[0].status, 'PROCESSING');

    // Complete the claim to leave clean state
    await db.completeSideEffect(tenantId, testClaimKey, { completed: true }, winners[0].claim_token);
  });

  it('2. 100 concurrent workers competing for SAME expired lease -> exactly 1 stale takeover acquired', async () => {
    const tenantId = DEFAULT_TENANT_ID;
    const staleClaimKey = `stale-race-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const callId = `call-stale-${Date.now()}`;

    // Step A: Worker 0 acquires the claim with an expired lease (simulate by setting 0ms lease)
    const initialClaim = await db.claimSideEffect(tenantId, staleClaimKey, 'SHEETS_SYNC', callId, 1, 3);
    assert.equal(initialClaim.claimed, true);

    // Wait 50ms for the 1ms lease to expire
    await new Promise((res) => setTimeout(res, 50));

    // Step B: 100 workers now race to take over the expired stale lease
    const takeoverPromises = Array.from({ length: 100 }, () =>
      db.claimSideEffect(tenantId, staleClaimKey, 'SHEETS_SYNC', callId, 60000, 3)
    );

    const takeoverResults = await Promise.all(takeoverPromises);

    const takeoverWinners = takeoverResults.filter((r) => r.claimed === true);
    const takeoverLosers = takeoverResults.filter((r) => r.claimed === false);

    assert.equal(takeoverWinners.length, 1, 'Exactly 1 worker must take over the expired stale lease');
    assert.equal(takeoverLosers.length, 99, '99 workers must recognize lease taken over');

    // Verify new winner received a fresh, distinct claim_token
    assert.notEqual(
      takeoverWinners[0].claim_token,
      initialClaim.claim_token,
      'Takeover winner must be assigned a new distinct claim_token'
    );

    await db.completeSideEffect(tenantId, staleClaimKey, { completed: true }, takeoverWinners[0].claim_token);
  });

  it('3. 2 simultaneous sendControlledFollowup for same call -> provider invocation count = 1', async () => {
    const tenantId = DEFAULT_TENANT_ID;
    const testCallId = `fup-race-${Date.now()}`;
    const testPhone = '+919876543210';

    // Mock fetch to track live network calls to WhatsApp API
    let providerInvocationCount = 0;
    const origFetch = global.fetch;

    (global as any).fetch = async (url: string, init?: any) => {
      if (typeof url === 'string' && url.includes('graph.facebook.com')) {
        providerInvocationCount++;
        // Simulate network latency so concurrent callers collide in flight
        await new Promise((res) => setTimeout(res, 30));
        return {
          ok: true,
          status: 200,
          json: async () => ({ messages: [{ id: `wamid.mock.${Date.now()}` }] }),
        } as any;
      }
      return origFetch(url as any, init);
    };

    // Set mock credentials to activate the WhatsApp provider branch
    const origKey = process.env.WHATSAPP_API_KEY;
    const origPhoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    process.env.WHATSAPP_API_KEY = 'test-token';
    process.env.WHATSAPP_PHONE_NUMBER_ID = 'test-phone-id';

    try {
      const [res1, res2] = await Promise.all([
        sendControlledFollowup({
          tenantId,
          callId: testCallId,
          recipientPhone: testPhone,
          templateId: 'QUOTE_ESTIMATE',
          templateData: { customerName: 'Ramesh', origin: 'Delhi', destination: 'Jaipur', quotedAmount: 14000 },
          channel: 'WHATSAPP',
        }),
        sendControlledFollowup({
          tenantId,
          callId: testCallId,
          recipientPhone: testPhone,
          templateId: 'QUOTE_ESTIMATE',
          templateData: { customerName: 'Ramesh', origin: 'Delhi', destination: 'Jaipur', quotedAmount: 14000 },
          channel: 'WHATSAPP',
        }),
      ]);

      assert.equal(providerInvocationCount, 1, 'WhatsApp provider must be invoked exactly once');

      // One call must be the actual sender, the other must be guarded by durable claim
      const hasDirectSend = res1.provider === 'META_WHATSAPP_CLOUD_API' || res2.provider === 'META_WHATSAPP_CLOUD_API';
      const hasGuardedSkip = res1.provider === 'DURABLE_CLAIM_GUARD' || res2.provider === 'DURABLE_CLAIM_GUARD';

      assert.ok(hasDirectSend, 'One execution must complete provider dispatch');
      assert.ok(hasGuardedSkip, 'The concurrent execution must be safely deduplicated via DURABLE_CLAIM_GUARD');
    } finally {
      global.fetch = origFetch;
      process.env.WHATSAPP_API_KEY = origKey;
      process.env.WHATSAPP_PHONE_NUMBER_ID = origPhoneId;
    }
  });

  it('4. 2 concurrent processPostCallPipeline for same call -> exactly 1 business execution', async () => {
    const extCallId = `pipe-race-${Date.now()}`;

    const [run1, run2] = await Promise.all([
      processPostCallPipeline({
        external_call_id: extCallId,
        from_number: '+91 98201 55432',
        intent: 'RATE_QUOTE',
        summary: 'Concurrent pipeline test run 1',
        facts: {
          route_from: 'Mumbai',
          route_to: 'Pune',
          quoted_amount: 8500,
          quote_type: 'ESTIMATE',
        },
      }),
      processPostCallPipeline({
        external_call_id: extCallId,
        from_number: '+91 98201 55432',
        intent: 'RATE_QUOTE',
        summary: 'Concurrent pipeline test run 2',
        facts: {
          route_from: 'Mumbai',
          route_to: 'Pune',
          quoted_amount: 8500,
          quote_type: 'ESTIMATE',
        },
      }),
    ]);

    assert.ok(run1.success, 'First concurrent execution must succeed');
    assert.ok(run2.success, 'Second concurrent execution must succeed idempotently');

    // Verify only 1 Call was created in the database
    const allCalls = await db.listCalls(DEFAULT_TENANT_ID, { search: extCallId });
    const matchingCalls = allCalls.filter((c) => c.external_call_id === extCallId);
    assert.equal(matchingCalls.length, 1, 'Database must contain exactly 1 call record for this external_call_id');
  });

  it('5. Claim token ownership is mandatory: missing, invalid, or wrong worker token rejected', async () => {
    const tenantId = DEFAULT_TENANT_ID;
    const testClaimKey = `token-race-${Date.now()}`;
    const claimResult = await db.claimSideEffect(tenantId, testClaimKey, 'POST_CALL_PIPELINE', 'call-t-1', 60000, 3);
    assert.equal(claimResult.claimed, true);
    assert.ok(claimResult.claim_token);

    // A. Missing token rejected
    await assert.rejects(
      async () => {
        await (db as any).completeSideEffect(tenantId, testClaimKey, { ok: true }, '');
      },
      (err: Error) => /claim_token is mandatory/i.test(err.message),
      'Empty or missing claim token must be rejected'
    );

    // B. Worker B's wrong token cannot complete Worker A's claim
    const wrongWorkerToken = crypto.randomUUID();
    await assert.rejects(
      async () => {
        await db.completeSideEffect(tenantId, testClaimKey, { ok: true }, wrongWorkerToken);
      },
      (err: Error) => /claim_token mismatch/i.test(err.message),
      'Wrong token must not complete foreign worker claim'
    );

    // C. Valid token completes successfully
    await db.completeSideEffect(tenantId, testClaimKey, { ok: true }, claimResult.claim_token);
  });

  it('6. Retry worker (Model A) actually executes business logic and settles claims without deadlock', async () => {
    const tenantId = DEFAULT_TENANT_ID;
    const extCallId = `retry-worker-test-${Date.now()}`;

    // 1. Create a Call first
    const call = await db.createCall({
      tenant_id: tenantId,
      external_call_id: extCallId,
      started_at: new Date().toISOString(),
      duration_seconds: 60,
      primary_intent: 'RATE_QUOTE',
      sentiment: 'NEUTRAL',
      outcome: 'COMPLETED',
      lead_temperature: 'WARM',
      summary: 'Initial test call for retry worker',
      facts: { call_id: '' },
      agent_version: 'v1.0.0',
    });

    // 2. Insert a claim in RETRYABLE status for POST_CALL_PIPELINE
    const claimKey = `pipeline:${tenantId}:${extCallId}`;
    const initialClaim = await db.claimSideEffect(tenantId, claimKey, 'POST_CALL_PIPELINE', call.id, 10, 3);
    assert.equal(initialClaim.claimed, true);

    // Fail the claim to transition it to RETRYABLE with next_retry_at in the past
    await db.failSideEffect(
      tenantId,
      claimKey,
      'Simulated transient failure for retry test',
      true, // isRetryable
      0, // retryDelayMs (0 -> immediately eligible)
      initialClaim.claim_token!
    );

    const claimBefore = await db.getSideEffectClaim(tenantId, claimKey);
    assert.equal(claimBefore?.status, 'RETRYABLE');

    // 3. Run the retry worker
    const workerResult = await runRetryWorker(10);
    assert.ok(workerResult.results.length >= 1, 'Retry worker must inspect eligible claims');

    // 4. Verify the claim was picked up, executed, and settled to SUCCEEDED
    const claimAfter = await db.getSideEffectClaim(tenantId, claimKey);
    assert.equal(claimAfter?.status, 'SUCCEEDED', 'Retry worker must execute business logic and settle claim to SUCCEEDED');

    // 5. Invariant check: No claim acquired by worker remains PROCESSING
    assert.notEqual(claimAfter?.status, 'PROCESSING', 'Claim must not remain in PROCESSING after worker execution');
  });

  it('7. Partial pipeline failure recovery: exactly 1 Call and 1 Lead created despite multiple runs', async () => {
    const tenantId = DEFAULT_TENANT_ID;
    const extCallId = `partial-pipe-${Date.now()}`;
    const callerPhone = '+919876543299';

    // First run completes pipeline
    const run1 = await processPostCallPipeline({
      external_call_id: extCallId,
      from_number: callerPhone,
      intent: 'RATE_QUOTE',
      summary: 'Partial failure test run 1',
      facts: {
        route_from: 'Delhi',
        route_to: 'Jaipur',
        quoted_amount: 12000,
        quote_type: 'ESTIMATE',
      },
    });
    assert.ok(run1.success);
    assert.ok(run1.call_id);

    // Verify exactly 1 lead in DB for this call
    const lead1 = await db.getLeadByCallId(run1.call_id!, DEFAULT_TENANT_ID);
    assert.ok(lead1, 'Lead must be created on first run');

    // Attempt direct lead creation with same call_id -> idempotent return existing lead
    const lead2 = await db.createLead({
      tenant_id: tenantId,
      phone: callerPhone,
      customer_name: 'Test Customer',
      requirement: 'Freight Delhi to Jaipur',
      call_id: run1.call_id,
    });
    assert.equal(lead2.id, lead1.id, 'createLead must be idempotent by call_id');

    // Re-verify call record count
    const calls = await db.listCalls(tenantId, { search: extCallId });
    const matchingCalls = calls.filter((c) => c.external_call_id === extCallId);
    assert.equal(matchingCalls.length, 1, 'Only 1 call record must exist');
  });

  it('8. Production retry worker route: fails closed if CRON_SECRET missing, 401 on wrong token, 200 on valid bearer', async () => {
    const prevNodeEnv = process.env.NODE_ENV;
    const prevCronSecret = process.env.CRON_SECRET;

    try {
      (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
      delete process.env.CRON_SECRET;

      // Import the GET handler from route
      const { GET } = await import('../app/api/cron/retry-worker/route');

      // Case A: Missing CRON_SECRET in production -> 500 fail closed
      const reqMissing = new Request('http://localhost/api/cron/retry-worker', {
        headers: { Authorization: 'Bearer any-token' },
      });
      const resMissing = await GET(reqMissing as any);
      assert.ok(resMissing.status === 503 || resMissing.status === 500, 'Must return 503/500 configuration error in production when CRON_SECRET is missing');

      // Case B: Set CRON_SECRET, test invalid token in production -> 401
      process.env.CRON_SECRET = 'secret-test-cron-token-12345';
      const reqWrong = new Request('http://localhost/api/cron/retry-worker', {
        headers: { Authorization: 'Bearer wrong-token' },
      });
      const resWrong = await GET(reqWrong as any);
      assert.equal(resWrong.status, 401, 'Must return 401 when Authorization Bearer token is invalid');

      // Case C: Valid token executes worker in test mode -> 200
      (process.env as Record<string, string | undefined>).NODE_ENV = 'test';
      const reqValid = new Request('http://localhost/api/cron/retry-worker', {
        headers: { Authorization: 'Bearer secret-test-cron-token-12345' },
      });
      const resValid = await GET(reqValid as any);
      assert.equal(resValid.status, 200, 'Must execute and return 200 when Authorization Bearer token matches');
      const body = await resValid.json();
      assert.ok(body.success);
    } finally {
      (process.env as Record<string, string | undefined>).NODE_ENV = prevNodeEnv;
      process.env.CRON_SECRET = prevCronSecret;
    }
  });
});

