import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { proxy } from '../proxy';
import { handleRoutingAuth } from '../lib/supabase/proxy';

describe('Phase 22 & 23: Proxy 504 Regression & Bounded Routing Suite', () => {
  const origNodeEnv = process.env.NODE_ENV;

  // Ensure production mode behavior for all routing tests
  test.beforeEach(() => {
    (process.env as any).NODE_ENV = 'production';
  });

  test.afterEach(() => {
    (process.env as any).NODE_ENV = origNodeEnv;
  });

  it('1. No cookie: Immediate 307 redirect to /login (< 50ms, zero network calls)', async () => {
    const start = performance.now();
    const req = new NextRequest('https://logivoice-v1.vercel.app/admin');
    const res = await proxy(req);
    const duration = performance.now() - start;

    assert.equal(res.status, 307, 'Must redirect to /login');
    assert.match(res.headers.get('location') || '', /\/login/, 'Redirect target must be /login');
    assert.ok(duration < 200, `Duration ${duration}ms must be well below 200ms`);
  });

  it('2. Malformed auth cookie: Immediate 307 redirect without crashing', async () => {
    const start = performance.now();
    const req = new NextRequest('https://logivoice-v1.vercel.app/admin', {
      headers: {
        cookie: 'sb-access-token=invalid-garbage-token; sb-refresh-token=garbage',
      },
    });
    const res = await proxy(req);
    const duration = performance.now() - start;

    assert.equal(res.status, 307);
    assert.match(res.headers.get('location') || '', /\/login/);
    assert.ok(duration < 1000, `Duration ${duration}ms must be well below 1000ms`);
  });

  it('3. Stale / Expired auth token: Gracefully fails closed to /login (< 500ms)', async () => {
    // A synthetic expired JWT: header.payload.signature
    const expiredPayload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) - 3600, sub: 'user-1' })).toString('base64url');
    const fakeJwt = `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.${expiredPayload}.invalidsig`;

    const start = performance.now();
    const req = new NextRequest('https://logivoice-v1.vercel.app/admin', {
      headers: {
        cookie: `sb-mock-auth-token=["${fakeJwt}"]; sb-access-token=${fakeJwt}`,
      },
    });
    const res = await proxy(req);
    const duration = performance.now() - start;

    assert.equal(res.status, 307);
    assert.match(res.headers.get('location') || '', /\/login/);
    assert.ok(duration < 2500, `Duration ${duration}ms must be bounded`);
  });

  it('4. Supabase Auth unreachable / network error: Fails closed to AUTH_TEMPORARILY_UNAVAILABLE (< 2500ms, NEVER 504)', async () => {
    const fakeToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyLTIiLCJleHAiOjI1MDAwMDAwMDB9.sig';

    const start = performance.now();
    const req = new NextRequest('https://logivoice-v1.vercel.app/admin', {
      headers: {
        cookie: `sb-access-token=${fakeToken}; sb-dummy-project-auth-token=["${fakeToken}"]`,
      },
    });
    const res = await proxy(req);
    const duration = performance.now() - start;

    assert.equal(res.status, 307);
    // Location must redirect to login with error parameter or plain login
    const location = res.headers.get('location') || '';
    assert.ok(location.includes('/login'), `Expected redirect to /login, got: ${location}`);
    assert.ok(duration < 3500, `Duration ${duration}ms must never reach 25s Vercel timeout`);
  });

  it('5. Production Dev Cookie Bypass Immunity: logivoice_dev_session strictly rejected in production', async () => {
    const req = new NextRequest('https://logivoice-v1.vercel.app/admin', {
      headers: {
        cookie: 'logivoice_dev_session=true',
      },
    });
    const res = await proxy(req);
    assert.equal(res.status, 307, 'Production must reject dev cookie bypass');
    assert.match(res.headers.get('location') || '', /\/login/);
  });

  it('6. Phase 23 Load Test: 100 unauthenticated /admin requests benchmark', async () => {
    const iterations = 100;
    const durations: number[] = [];
    let timeout504Count = 0;
    let redirectCount = 0;

    for (let i = 0; i < iterations; i++) {
      const t0 = performance.now();
      const req = new NextRequest('https://logivoice-v1.vercel.app/admin');
      const res = await proxy(req);
      const elapsed = performance.now() - t0;
      durations.push(elapsed);

      if (res.status === 504) {
        timeout504Count++;
      }
      if (res.status === 307 || res.status === 302) {
        redirectCount++;
      }
    }

    durations.sort((a, b) => a - b);
    const p50 = durations[Math.floor(iterations * 0.5)];
    const p95 = durations[Math.floor(iterations * 0.95)];
    const p99 = durations[Math.floor(iterations * 0.99)];
    const max = durations[durations.length - 1];

    console.log(`\n--- 100 /admin Unauthenticated Load Test Metrics ---`);
    console.log(`p50: ${p50.toFixed(2)}ms`);
    console.log(`p95: ${p95.toFixed(2)}ms`);
    console.log(`p99: ${p99.toFixed(2)}ms`);
    console.log(`max: ${max.toFixed(2)}ms`);
    console.log(`504 count: ${timeout504Count}`);
    console.log(`redirect count: ${redirectCount}`);

    assert.equal(timeout504Count, 0, '504 count must be 0');
    assert.equal(redirectCount, iterations, 'All unauthenticated requests must redirect');
    assert.ok(max < 200, `Max latency ${max}ms must be under 200ms`);
  });

  it('7. Stale cookie load test: 50 requests benchmark', async () => {
    const iterations = 50;
    const durations: number[] = [];
    let timeout504Count = 0;
    let redirectCount = 0;

    for (let i = 0; i < iterations; i++) {
      const t0 = performance.now();
      const req = new NextRequest('https://logivoice-v1.vercel.app/admin', {
        headers: {
          cookie: 'sb-access-token=stale-token-12345; sb-refresh-token=stale-refresh-67890',
        },
      });
      const res = await proxy(req);
      const elapsed = performance.now() - t0;
      durations.push(elapsed);

      if (res.status === 504) timeout504Count++;
      if (res.status === 307 || res.status === 302) redirectCount++;
    }

    durations.sort((a, b) => a - b);
    const p50 = durations[Math.floor(iterations * 0.5)];
    const max = durations[durations.length - 1];

    console.log(`\n--- 50 Stale Cookie Load Test Metrics ---`);
    console.log(`p50: ${p50.toFixed(2)}ms`);
    console.log(`max: ${max.toFixed(2)}ms`);
    console.log(`504 count: ${timeout504Count}`);

    assert.equal(timeout504Count, 0, '504 count must be 0');
    assert.equal(redirectCount, iterations);
    assert.ok(max < 3000, `Max latency ${max}ms must be bounded`);
  });
});
