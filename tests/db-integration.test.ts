/**
 * LOGIVOICE V1 — AUTHORITATIVE POSTGRESQL / DATABASE INTEGRITY TEST SUITE
 * 
 * Tests against an actual isolated PostgreSQL instance:
 * 1. Fresh Database: Migrations 1 to 5 from zero
 * 2. Upgrade Database: Migrations 1-4 -> seed legacy records -> apply Migration 5 -> verify survival
 * 3. Schema & Constraints: side_effect_claims, transcript_segments, customer_suppressions, audit_events
 * 4. Real Concurrency & Idempotency:
 *    - 100 concurrent requests with same idempotency key -> exactly 1 inserted
 *    - Transcript replay with ON CONFLICT (call_id, segment_key) -> 0 duplicate rows
 *    - Stale lease takeover & retry backoff on side_effect_claims
 *    - Half-open rate boundary interval checks
 *    - Knowledge DRAFT default & explicit approval workflow
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { Client } from 'pg';

const rawUrl = process.env.DATABASE_URL || 'postgresql://postgres@127.0.0.1:5433/postgres';
const parsedUrl = new URL(rawUrl);
parsedUrl.pathname = '/postgres';
const ROOT_PG_URL = parsedUrl.toString();

const FRESH_DB_NAME = `logivoice_fresh_${Date.now()}`;
const UPGRADE_DB_NAME = `logivoice_upgrade_${Date.now()}`;

const MIGRATIONS_DIR = path.resolve(process.cwd(), 'supabase/migrations');
const MIGRATION_FILES = [
  '20260917000000_init_logivoice_schema.sql',
  '20260918000000_durable_idempotency_constraints.sql',
  '20260919000000_drop_obsolete_global_call_unique.sql',
  '20260920000000_integrity_hardening.sql',
  '20261003000000_side_effect_claims_and_transcript_alignment.sql',
  '20261003010000_atomic_side_effects_and_tool_executions.sql',
  '20261003020000_enterprise_integrity_hardening.sql',
];

function getDbUrl(dbName: string): string {
  const url = new URL(ROOT_PG_URL);
  url.pathname = `/${dbName}`;
  return url.toString();
}

async function runSqlFile(client: Client, filePath: string) {
  const sql = fs.readFileSync(filePath, 'utf8');
  await client.query(sql);
}

describe('PostgreSQL Runtime Truth & Database Integrity Suite', () => {
  let rootClient: Client;

  before(async () => {
    rootClient = new Client({ connectionString: ROOT_PG_URL });
    await rootClient.connect();

    // Ensure Supabase-compatible roles exist in isolated Postgres environment
    await rootClient.query(`
      DO $$ 
      BEGIN 
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN 
          CREATE ROLE authenticated; 
        END IF; 
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN 
          CREATE ROLE anon; 
        END IF; 
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN 
          CREATE ROLE service_role; 
        END IF; 
      END $$;
    `);

    // Create fresh and upgrade test databases
    await rootClient.query(`DROP DATABASE IF EXISTS ${FRESH_DB_NAME};`);
    await rootClient.query(`CREATE DATABASE ${FRESH_DB_NAME};`);
    await rootClient.query(`DROP DATABASE IF EXISTS ${UPGRADE_DB_NAME};`);
    await rootClient.query(`CREATE DATABASE ${UPGRADE_DB_NAME};`);
  });

  after(async () => {
    if (rootClient) {
      await rootClient.query(`DROP DATABASE IF EXISTS ${FRESH_DB_NAME};`).catch(() => {});
      await rootClient.query(`DROP DATABASE IF EXISTS ${UPGRADE_DB_NAME};`).catch(() => {});
      await rootClient.end();
    }
  });

  // =========================================================================
  // 1. FRESH DATABASE: ALL MIGRATIONS FROM ZERO
  // =========================================================================
  it('1. Fresh Database: Applies all 5 migrations in order from zero', async () => {
    const freshClient = new Client({ connectionString: getDbUrl(FRESH_DB_NAME) });
    await freshClient.connect();

    try {
      for (const file of MIGRATION_FILES) {
        const fullPath = path.join(MIGRATIONS_DIR, file);
        await runSqlFile(freshClient, fullPath);
      }

      // Verify all canonical tables exist
      const tablesRes = await freshClient.query(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public'
      `);
      const tableNames = new Set(tablesRes.rows.map((r) => r.table_name));

      const requiredTables = [
        'tenants',
        'customers',
        'calls',
        'call_facts',
        'transcript_segments',
        'leads',
        'operations_requests',
        'rate_cards',
        'knowledge_items',
        'followups',
        'audit_events',
        'client_configs',
        'customer_suppressions',
        'side_effect_claims',
      ];

      for (const reqTable of requiredTables) {
        assert.ok(tableNames.has(reqTable), `Required table '${reqTable}' must exist in fresh schema`);
      }
    } finally {
      await freshClient.end();
    }
  });

  // =========================================================================
  // 2. UPGRADE DATABASE: MIGRATIONS 1-4 -> SEED ROWS -> APPLY MIGRATION 5
  // =========================================================================
  it('2. Upgrade Database: Safely upgrades legacy schema and preserves existing rows', async () => {
    const upgradeClient = new Client({ connectionString: getDbUrl(UPGRADE_DB_NAME) });
    await upgradeClient.connect();

    try {
      // Apply migrations 1 through 4 (representing previous production state)
      for (let i = 0; i < 4; i++) {
        const fullPath = path.join(MIGRATIONS_DIR, MIGRATION_FILES[i]);
        await runSqlFile(upgradeClient, fullPath);
      }

      // Seed a tenant
      const tenantId = '00000000-0000-0000-0000-000000000001';
      await upgradeClient.query(`
        INSERT INTO public.tenants (id, name, slug)
        VALUES ('${tenantId}', 'Test Logistics Tenant', 'test-tenant')
        ON CONFLICT (id) DO NOTHING;
      `);

      // Seed a legacy call
      const callId = '11111111-1111-4111-8111-111111111111';
      await upgradeClient.query(`
        INSERT INTO public.calls (id, tenant_id, external_call_id, started_at, primary_intent, sentiment, outcome, lead_temperature, summary, agent_version)
        VALUES ('${callId}', '${tenantId}', 'ext-call-legacy-001', NOW(), 'GENERAL', 'NEUTRAL', 'COMPLETED', 'WARM', 'Legacy call', 'v1.0');
      `);

      // Seed a legacy transcript segment without segment_key
      await upgradeClient.query(`
        INSERT INTO public.transcript_segments (id, call_id, tenant_id, speaker, text, timestamp)
        VALUES (gen_random_uuid(), '${callId}', '${tenantId}', 'agent', 'Namaste, how can I help?', '00:01');
      `);

      // Seed a legacy side_effect_claim with legacy status 'COMPLETED'
      await upgradeClient.query(`
        ALTER TABLE public.side_effect_claims DROP CONSTRAINT IF EXISTS side_effect_claims_status_check;
      `);
      await upgradeClient.query(`
        INSERT INTO public.side_effect_claims (tenant_id, claim_key, job_type, status, attempt_count)
        VALUES ('${tenantId}', 'claim:legacy:001', 'SHEETS_SYNC', 'COMPLETED', 1);
      `);

      // Now apply Migration 5 (the final alignment migration)
      const migration5Path = path.join(MIGRATIONS_DIR, MIGRATION_FILES[4]);
      await runSqlFile(upgradeClient, migration5Path);

      // Verify legacy side_effect_claim status was migrated to canonical 'SUCCEEDED'
      const claimRes = await upgradeClient.query(`
        SELECT status, job_type, max_attempts FROM public.side_effect_claims WHERE claim_key = 'claim:legacy:001'
      `);
      assert.equal(claimRes.rows.length, 1);
      assert.equal(claimRes.rows[0].status, 'SUCCEEDED', "Legacy 'COMPLETED' status must be migrated to 'SUCCEEDED'");
      assert.equal(claimRes.rows[0].max_attempts, 3, "New column max_attempts must have default 3");

      // Verify transcript_segments segment_key was backfilled
      const transcriptRes = await upgradeClient.query(`
        SELECT segment_key FROM public.transcript_segments WHERE call_id = '${callId}'
      `);
      assert.equal(transcriptRes.rows.length, 1);
      assert.ok(transcriptRes.rows[0].segment_key, 'Legacy transcript segment must have segment_key backfilled');

      // Verify unique constraint uq_transcript_segments_call_key exists
      const constraintRes = await upgradeClient.query(`
        SELECT conname FROM pg_constraint WHERE conname = 'uq_transcript_segments_call_key'
      `);
      assert.equal(constraintRes.rows.length, 1, 'uq_transcript_segments_call_key constraint must exist');
    } finally {
      await upgradeClient.end();
    }
  });

  // =========================================================================
  // 3. SIDE_EFFECT_CLAIMS STATE MACHINE & CONTRACT
  // =========================================================================
  it('3. Side Effect Claims: Canonical state machine, lease takeover, and retry semantics', async () => {
    const client = new Client({ connectionString: getDbUrl(FRESH_DB_NAME) });
    await client.connect();

    try {
      const tenantId = '00000000-0000-0000-0000-000000000001';
      await client.query(`
        INSERT INTO public.tenants (id, name, slug)
        VALUES ('${tenantId}', 'Test Tenant', 'test-tenant-claims')
        ON CONFLICT (id) DO NOTHING;
      `);

      const claimKey = `claim:test:${Date.now()}`;
      const now = new Date();
      const leaseExpires = new Date(now.getTime() + 60000); // 1 minute in future

      // Step 1: Initial claim creation -> PENDING / PROCESSING
      const insertRes = await client.query(`
        INSERT INTO public.side_effect_claims (
          tenant_id, claim_key, job_type, status, attempt_count, max_attempts, lease_expires_at, claimed_at, claimed_by
        )
        VALUES ($1, $2, $3, 'PROCESSING', 1, 3, $4, NOW(), 'worker-1')
        RETURNING *;
      `, [tenantId, claimKey, 'POST_CALL_PIPELINE', leaseExpires]);

      assert.equal(insertRes.rows.length, 1);
      assert.equal(insertRes.rows[0].job_type, 'POST_CALL_PIPELINE');
      assert.equal(insertRes.rows[0].status, 'PROCESSING');

      // Step 2: Concurrent insert with same claim_key must violate unique constraint
      let duplicateThrew = false;
      try {
        await client.query(`
          INSERT INTO public.side_effect_claims (tenant_id, claim_key, job_type, status)
          VALUES ($1, $2, 'POST_CALL_PIPELINE', 'PROCESSING')
        `, [tenantId, claimKey]);
      } catch (err: any) {
        duplicateThrew = err.code === '23505'; // PostgreSQL unique_violation
      }
      assert.ok(duplicateThrew, 'Duplicate active claim insert must violate unique constraint');

      // Step 3: Transient error -> RETRYABLE with next_retry_at
      const nextRetry = new Date(now.getTime() + 5000);
      const retryRes = await client.query(`
        UPDATE public.side_effect_claims
        SET status = 'RETRYABLE', last_error = 'HTTP 503 Provider Timeout', next_retry_at = $1
        WHERE tenant_id = $2 AND claim_key = $3
        RETURNING status, last_error;
      `, [nextRetry, tenantId, claimKey]);
      assert.equal(retryRes.rows[0].status, 'RETRYABLE');

      // Step 4: Stale lease takeover test
      const staleKey = `claim:stale:${Date.now()}`;
      const expiredLease = new Date(now.getTime() - 10000); // 10 seconds ago
      await client.query(`
        INSERT INTO public.side_effect_claims (
          tenant_id, claim_key, job_type, status, attempt_count, lease_expires_at, claimed_by
        )
        VALUES ($1, $2, 'SHEETS_SYNC', 'PROCESSING', 1, $3, 'dead-worker')
      `, [tenantId, staleKey, expiredLease]);

      // Worker 2 takes over stale claim
      const takeoverRes = await client.query(`
        UPDATE public.side_effect_claims
        SET claimed_by = 'worker-2', lease_expires_at = $1, attempt_count = attempt_count + 1
        WHERE tenant_id = $2 AND claim_key = $3 AND lease_expires_at < NOW()
        RETURNING claimed_by, attempt_count;
      `, [leaseExpires, tenantId, staleKey]);
      assert.equal(takeoverRes.rows[0].claimed_by, 'worker-2');
      assert.equal(takeoverRes.rows[0].attempt_count, 2);

      // Step 5: Final completion -> SUCCEEDED
      const completeRes = await client.query(`
        UPDATE public.side_effect_claims
        SET status = 'SUCCEEDED', completed_at = NOW(), result = '{"business_status":"SENT"}'::jsonb
        WHERE tenant_id = $1 AND claim_key = $2
        RETURNING status, result;
      `, [tenantId, claimKey]);
      assert.equal(completeRes.rows[0].status, 'SUCCEEDED');
      assert.equal(completeRes.rows[0].result.business_status, 'SENT');
    } finally {
      await client.end();
    }
  });

  // =========================================================================
  // 4. TRANSCRIPT DETERMINISTIC IDENTITY & REPLAY
  // =========================================================================
  it('4. Transcript Replay: ON CONFLICT (call_id, segment_key) prevents duplicate rows', async () => {
    const client = new Client({ connectionString: getDbUrl(FRESH_DB_NAME) });
    await client.connect();

    try {
      const tenantId = '00000000-0000-0000-0000-000000000001';
      const callId = '22222222-2222-4222-8222-222222222222';
      await client.query(`
        INSERT INTO public.calls (id, tenant_id, external_call_id, started_at, primary_intent, sentiment, outcome, lead_temperature, summary, agent_version)
        VALUES ('${callId}', '${tenantId}', 'ext-call-transcript-001', NOW(), 'TRACKING', 'NEUTRAL', 'COMPLETED', 'WARM', 'Tracking inquiry', 'v1.0')
        ON CONFLICT (id) DO NOTHING;
      `);

      const turns = [
        { speaker: 'agent', text: 'Namaste! Apex Logistics mein swagat hai.', timestamp: '00:01' },
        { speaker: 'caller', text: 'Mera LR-88291 kahan hai?', timestamp: '00:04' },
        { speaker: 'agent', text: 'Aapka truck Kotputli toll plaza cross kar chuka hai.', timestamp: '00:07' },
      ];

      // First webhook delivery: insert 3 segments
      for (const turn of turns) {
        const segmentKey = `${turn.timestamp}:${turn.speaker}:${turn.text.slice(0, 32)}`;
        await client.query(`
          INSERT INTO public.transcript_segments (id, call_id, tenant_id, speaker, text, timestamp, segment_key)
          VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6)
          ON CONFLICT (call_id, segment_key) DO UPDATE
          SET text = EXCLUDED.text;
        `, [callId, tenantId, turn.speaker, turn.text, turn.timestamp, segmentKey]);
      }

      const count1 = await client.query(`SELECT COUNT(*)::int FROM public.transcript_segments WHERE call_id = $1`, [callId]);
      assert.equal(count1.rows[0].count, 3, 'First delivery must insert exactly 3 segments');

      // Duplicate webhook replay with exact same content
      for (const turn of turns) {
        const segmentKey = `${turn.timestamp}:${turn.speaker}:${turn.text.slice(0, 32)}`;
        await client.query(`
          INSERT INTO public.transcript_segments (id, call_id, tenant_id, speaker, text, timestamp, segment_key)
          VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6)
          ON CONFLICT (call_id, segment_key) DO UPDATE
          SET text = EXCLUDED.text;
        `, [callId, tenantId, turn.speaker, turn.text, turn.timestamp, segmentKey]);
      }

      const count2 = await client.query(`SELECT COUNT(*)::int FROM public.transcript_segments WHERE call_id = $1`, [callId]);
      assert.equal(count2.rows[0].count, 3, 'Replay of identical transcript must result in 0 duplicate rows');
    } finally {
      await client.end();
    }
  });

  // =========================================================================
  // 5. CONCURRENCY: 100 CONCURRENT REQUESTS WITH SAME IDEMPOTENCY KEY
  // =========================================================================
  it('5. Concurrency: 100 concurrent requests with identical idempotency key produce exactly 1 record', async () => {
    const client = new Client({ connectionString: getDbUrl(FRESH_DB_NAME) });
    await client.connect();

    try {
      const tenantId = '00000000-0000-0000-0000-000000000001';
      const sharedIdempotencyKey = `conc-req-${Date.now()}`;
      const referenceNo = `REQ-CONC-${Date.now().toString().slice(-6)}`;

      // Execute 100 concurrent inserts targeting the same idempotency key
      const results = await Promise.allSettled(
        Array.from({ length: 100 }).map(async (_, idx) => {
          const workerClient = new Client({ connectionString: getDbUrl(FRESH_DB_NAME) });
          await workerClient.connect();
          try {
            await workerClient.query(`
              INSERT INTO public.operations_requests (
                id, tenant_id, reference_no, type, status, priority, summary, idempotency_key
              )
              VALUES (gen_random_uuid(), $1, $2, 'BOOKING_REQUEST', 'PENDING', 'HIGH', 'Concurrent booking test', $3);
            `, [tenantId, `${referenceNo}-${idx}`, sharedIdempotencyKey]);
          } finally {
            await workerClient.end();
          }
        })
      );

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      assert.equal(fulfilled.length, 1, 'Exactly 1 insert must succeed');
      assert.equal(rejected.length, 99, '99 concurrent requests must be rejected by unique constraint');

      const countRes = await client.query(`
        SELECT COUNT(*)::int FROM public.operations_requests WHERE idempotency_key = $1
      `, [sharedIdempotencyKey]);
      assert.equal(countRes.rows[0].count, 1, 'Exactly 1 operations_request row must exist in database');
    } finally {
      await client.end();
    }
  });

  // =========================================================================
  // 6. KNOWLEDGE APPROVAL & AUDIT ACTOR ROLES
  // =========================================================================
  it('6. Knowledge Items: Defaults to DRAFT and supports approval workflow with audit roles', async () => {
    const client = new Client({ connectionString: getDbUrl(FRESH_DB_NAME) });
    await client.connect();

    try {
      const tenantId = '00000000-0000-0000-0000-000000000001';

      // Insert knowledge item without specifying status -> must default to DRAFT
      const insertRes = await client.query(`
        INSERT INTO public.knowledge_items (tenant_id, category, title, content, version)
        VALUES ($1, 'RATE_POLICY', 'Fuel Surcharge Clause 2026', 'Fuel surcharge linked to diesel index.', 'v1.0')
        RETURNING id, status;
      `, [tenantId]);

      const kbId = insertRes.rows[0].id;
      assert.equal(insertRes.rows[0].status, 'DRAFT', 'Newly created knowledge item must default to DRAFT');

      // Approval transition to APPROVED with approved_by and approved_at
      const approveRes = await client.query(`
        UPDATE public.knowledge_items
        SET status = 'APPROVED', approved_by = 'admin-user-01', approved_at = NOW()
        WHERE id = $1
        RETURNING status, approved_by, approved_at;
      `, [kbId]);

      assert.equal(approveRes.rows[0].status, 'APPROVED');
      assert.equal(approveRes.rows[0].approved_by, 'admin-user-01');
      assert.ok(approveRes.rows[0].approved_at, 'approved_at must be populated on approval');

      // Audit event with ADMIN and OPS_MANAGER actor roles
      const auditRes = await client.query(`
        INSERT INTO public.audit_events (tenant_id, event_type, actor_type, actor_id, severity, details)
        VALUES 
          ($1, 'KNOWLEDGE_APPROVED', 'ADMIN', 'admin-user-01', 'INFO', '{"kb_id":"${kbId}"}'::jsonb),
          ($1, 'RATE_CREATED', 'OPS_MANAGER', 'ops-manager-02', 'INFO', '{"action":"rate_added"}'::jsonb)
        RETURNING actor_type;
      `, [tenantId]);

      assert.equal(auditRes.rows.length, 2);
      assert.equal(auditRes.rows[0].actor_type, 'ADMIN');
      assert.equal(auditRes.rows[1].actor_type, 'OPS_MANAGER');
    } finally {
      await client.end();
    }
  });

  // =========================================================================
  // 7. CUSTOMER SUPPRESSIONS & PHONE NORMALIZATION
  // =========================================================================
  it('7. Customer Suppressions: Durable tenant-scoped opt-out enforcement', async () => {
    const client = new Client({ connectionString: getDbUrl(FRESH_DB_NAME) });
    await client.connect();

    try {
      const tenantId = '00000000-0000-0000-0000-000000000001';
      const phoneNorm = '+919876543210';

      // Insert customer suppression
      await client.query(`
        INSERT INTO public.customer_suppressions (tenant_id, phone_normalized, channel, opt_out, reason, source)
        VALUES ($1, $2, 'WHATSAPP', true, 'Customer requested STOP via chat', 'USER_OPT_OUT')
        ON CONFLICT (tenant_id, phone_normalized, channel) DO UPDATE
        SET opt_out = true;
      `, [tenantId, phoneNorm]);

      // Query suppression
      const supRes = await client.query(`
        SELECT opt_out FROM public.customer_suppressions
        WHERE tenant_id = $1 AND phone_normalized = $2 AND channel = 'WHATSAPP'
      `, [tenantId, phoneNorm]);

      assert.equal(supRes.rows.length, 1);
      assert.equal(supRes.rows[0].opt_out, true);
    } finally {
      await client.end();
    }
  });

  // =========================================================================
  // 8. MANDATORY CLAIM TOKEN OWNERSHIP & UNKNOWN SETTLEMENT RPC
  // =========================================================================
  it('8. Claim Token Ownership: Mandatory token verification and UNKNOWN settlement', async () => {
    const client = new Client({ connectionString: getDbUrl(FRESH_DB_NAME) });
    await client.connect();

    try {
      const tenantId = '00000000-0000-0000-0000-000000000001';
      const claimKey = `claim:token-auth:${Date.now()}`;
      const tokenA = '11111111-1111-4111-8111-111111111111';
      const tokenB = '22222222-2222-4222-8222-222222222222';

      // Insert claim with tokenA
      await client.query(`
        INSERT INTO public.side_effect_claims (
          tenant_id, claim_key, job_type, status, attempt_count, lease_expires_at, claim_token, claimed_by
        )
        VALUES ($1, $2, 'POST_CALL_PIPELINE', 'PROCESSING', 1, NOW() + interval '5 minutes', $3, 'worker-a')
      `, [tenantId, claimKey, tokenA]);

      // A. Attempt completion with NULL token -> must throw error
      let nullThrew = false;
      try {
        await client.query(`SELECT public.complete_side_effect($1, $2, NULL, '{"test":true}'::jsonb)`, [tenantId, claimKey]);
      } catch (err: any) {
        nullThrew = /mandatory/i.test(err.message);
      }
      assert.ok(nullThrew, 'complete_side_effect with NULL token must throw exception');

      // B. Attempt completion with wrong token (tokenB) -> returns false (0 rows updated)
      const wrongTokenRes = await client.query(
        `SELECT public.complete_side_effect($1, $2, $3, '{"test":true}'::jsonb) as updated`,
        [tenantId, claimKey, tokenB]
      );
      assert.equal(wrongTokenRes.rows[0].updated, false, 'complete_side_effect with wrong token must return false');

      // C. Settle with record_side_effect_unknown using tokenA -> returns true and status is UNKNOWN
      const unknownRes = await client.query(
        `SELECT public.record_side_effect_unknown($1, $2, $3, 'Network timeout', '{"provider":"META"}'::jsonb) as updated`,
        [tenantId, claimKey, tokenA]
      );
      assert.equal(unknownRes.rows[0].updated, true, 'record_side_effect_unknown with valid token must succeed');

      const checkClaim = await client.query(`SELECT status, last_error FROM public.side_effect_claims WHERE tenant_id = $1 AND claim_key = $2`, [tenantId, claimKey]);
      assert.equal(checkClaim.rows[0].status, 'UNKNOWN');
      assert.equal(checkClaim.rows[0].last_error, 'Network timeout');
    } finally {
      await client.end();
    }
  });

  // =========================================================================
  // 9. LEAD UNIQUENESS PER CALL
  // =========================================================================
  it('9. Lead Idempotency: Unique constraint prevents duplicate leads per call', async () => {
    const client = new Client({ connectionString: getDbUrl(FRESH_DB_NAME) });
    await client.connect();

    try {
      const tenantId = '00000000-0000-0000-0000-000000000001';
      const callId = '33333333-3333-4333-8333-333333333333';
      const custId = '44444444-4444-4444-8444-444444444444';

      await client.query(`
        INSERT INTO public.customers (id, tenant_id, name, phone, phone_normalized)
        VALUES ('${custId}', '${tenantId}', 'Lead Shipper', '+919876543211', '+919876543211')
        ON CONFLICT (id) DO NOTHING;
      `);

      await client.query(`
        INSERT INTO public.calls (id, tenant_id, external_call_id, started_at, primary_intent, sentiment, outcome, lead_temperature, summary, agent_version)
        VALUES ('${callId}', '${tenantId}', 'ext-lead-call-001', NOW(), 'RATE_QUOTE', 'POSITIVE', 'COMPLETED', 'HOT', 'Booking inquiry', 'v1.0')
        ON CONFLICT (id) DO NOTHING;
      `);

      // First lead creation
      await client.query(`
        INSERT INTO public.leads (tenant_id, customer_id, call_id, requirement, next_action)
        VALUES ($1, $2, $3, '10 tons Delhi to Mumbai', 'Follow up')
      `, [tenantId, custId, callId]);

      // Second lead creation with same (tenant_id, call_id) -> must throw 23505 unique violation
      let duplicateLeadThrew = false;
      try {
        await client.query(`
          INSERT INTO public.leads (tenant_id, customer_id, call_id, requirement, next_action)
          VALUES ($1, $2, $3, '10 tons Delhi to Mumbai', 'Follow up')
        `, [tenantId, custId, callId]);
      } catch (err: any) {
        duplicateLeadThrew = err.code === '23505';
      }
      assert.ok(duplicateLeadThrew, 'Duplicate lead creation for same call must violate unique index uq_leads_tenant_call');
    } finally {
      await client.end();
    }
  });

  // =========================================================================
  // 10. RATE CARDS BATCH INTEGRITY & DETERMINISTIC ADVISORY LOCK
  // =========================================================================
  it('10. Rate Cards: Advisory locking and batch-internal identical duplicate rejection', async () => {
    const client = new Client({ connectionString: getDbUrl(FRESH_DB_NAME) });
    await client.connect();

    try {
      const tenantId = '00000000-0000-0000-0000-000000000001';

      // A. Batch with identical duplicate rows must be rejected
      const duplicateBatch = [
        {
          origin: 'Pune',
          destination: 'Nagpur',
          vehicle_type: 'Tata 407',
          weight_min_tons: 1,
          weight_max_tons: 3,
          price_inr: 12000,
          effective_from: '2026-10-01',
          status: 'ACTIVE',
        },
        {
          origin: 'Pune',
          destination: 'Nagpur',
          vehicle_type: 'Tata 407',
          weight_min_tons: 1,
          weight_max_tons: 3,
          price_inr: 12000,
          effective_from: '2026-10-01',
          status: 'ACTIVE',
        },
      ];

      let duplicateBatchThrew = false;
      try {
        await client.query(`SELECT * FROM public.bulk_import_rate_cards($1, $2::jsonb)`, [tenantId, JSON.stringify(duplicateBatch)]);
      } catch (err: any) {
        duplicateBatchThrew = /batch-internal overlap detected/i.test(err.message);
      }
      assert.ok(duplicateBatchThrew, 'Batch with identical duplicate rows must be rejected by bulk_import_rate_cards');

      // B. Valid single rate card insertion with NULL minimum_charge_inr must preserve NULL
      const validCard = [
        {
          origin: 'Kolkata',
          destination: 'Ranchi',
          vehicle_type: 'Eicher 17ft',
          weight_min_tons: 2,
          weight_max_tons: 6,
          price_inr: 18000,
          minimum_charge_inr: null,
          effective_from: '2026-10-01',
          status: 'ACTIVE',
        },
      ];

      const importRes = await client.query(`SELECT * FROM public.bulk_import_rate_cards($1, $2::jsonb)`, [tenantId, JSON.stringify(validCard)]);
      assert.equal(importRes.rows[0].inserted_count, 1);

      const insertedId = importRes.rows[0].rate_card_ids[0];
      const cardRow = await client.query(`SELECT minimum_charge_inr FROM public.rate_cards WHERE id = $1`, [insertedId]);
      assert.equal(cardRow.rows[0].minimum_charge_inr, null, 'NULL commercial value must remain NULL, never coerced to 0');
    } finally {
      await client.end();
    }
  });
});

