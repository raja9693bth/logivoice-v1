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

    // Exactly one must have executed the side effects, while duplicate returns SKIPPED_DUPLICATE
    const skippedRun = run1.sheets_status === 'SKIPPED_DUPLICATE' ? run1 : run2;
    assert.equal(skippedRun.sheets_status, 'SKIPPED_DUPLICATE', 'Duplicate execution must return SKIPPED_DUPLICATE');

    // Verify only 1 Call was created in the database
    const allCalls = await db.listCalls(DEFAULT_TENANT_ID, { search: extCallId });
    const matchingCalls = allCalls.filter((c) => c.external_call_id === extCallId);
    assert.equal(matchingCalls.length, 1, 'Database must contain exactly 1 call record for this external_call_id');
  });
});
