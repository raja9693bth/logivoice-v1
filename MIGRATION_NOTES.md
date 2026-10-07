# LogiVoice V1 — Database Migration & Schema Notes

> **Database Engine**: PostgreSQL 15+ (Hosted on Supabase)  
> **Schema Isolation**: Tenant-scoped partition with multi-tenant foreign keys  
> **Actual Migration Count**: 8 canonical SQL migration files in `supabase/migrations/`

---

## 1. Authoritative Migration Log

| # | Migration File | Description | Forward-Safety & Invariants |
| :- | :--- | :--- | :--- |
| **1** | `20260917000000_init_logivoice_schema.sql` | Base LogiVoice V1 schema defining core entities: `tenants`, `customers`, `calls`, `call_facts`, `transcript_segments`, `leads`, `operations_requests`, `rate_cards`, `knowledge_items`, `followups`, `audit_events`, `client_configs`. | Baseline schema. Initial DDL. |
| **2** | `20260918000000_durable_idempotency_constraints.sql` | Adds explicit `idempotency_key` column and unique index `idx_ops_requests_idempotency` to `operations_requests`. | Forward-safe. Backfills existing requests with deterministic keys. |
| **3** | `20260919000000_drop_obsolete_global_call_unique.sql` | Safely removes legacy global unique constraint `calls_external_call_id_key` on `external_call_id`. Preserves tenant-scoped unique index `idx_calls_tenant_external_id` on `(tenant_id, external_call_id)`. | Forward-safe conditional drop (`DROP CONSTRAINT IF EXISTS`). Prevents cross-tenant call ID collisions. |
| **4** | `20260920000000_integrity_hardening.sql` | 1. Synchronizes `client_configs` schema (`business_type`, `booking_url`, `voice_persona`, `barge_in_enabled`, `allow_language_switching`).<br>2. Implements canonical `phone_normalized` column on `customers` with unique index `(tenant_id, phone_normalized)`.<br>3. Changes `knowledge_items` default approval state to `DRAFT` with audit attribution columns.<br>4. Creates `side_effect_claims` table for atomic outbox side-effect locking.<br>5. Creates `customer_suppressions` table for persistent opt-out enforcement.<br>6. Enables RLS policies for tenant isolation. | Forward-safe idempotent schema updates (`IF NOT EXISTS`). Backfills normalized phones safely without data loss. |
| **5** | `20261003000000_side_effect_claims_and_transcript_alignment.sql` | 1. Hardens `side_effect_claims` schema: unifies TypeScript and SQL models (`call_id`, `lease_expires_at`, `next_retry_at`, `max_attempts`), canonical statuses `('PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'RETRYABLE', 'UNKNOWN')`. Migrates legacy `COMPLETED` and `REJECTED` rows.<br>2. Hardens `transcript_segments`: adds `segment_key TEXT`, backfills existing rows, creates unique constraint `uq_transcript_segments_call_key` on `(call_id, segment_key)` to prevent duplicate segments on webhook replay.<br>3. Updates `audit_events` `actor_type` constraint to permit `('AI_AGENT', 'DISPATCHER', 'OPS_MANAGER', 'ADMIN', 'SYSTEM', 'WEBHOOK', 'USER')`. | Forward-safe idempotent column addition, backfill, and constraint re-enforcement. Tested and verified on real PostgreSQL fresh and upgrade paths. |
| **6** | `20261003010000_atomic_side_effects_and_tool_executions.sql` | Implements atomic Postgres RPC functions `claim_side_effect`, `complete_side_effect`, `fail_side_effect`, and creates `tool_executions` audit table with latency telemetry. | Atomic locking and transaction safety at PostgreSQL kernel level. |
| **7** | `20261003020000_enterprise_integrity_hardening.sql` | Enforces enterprise-grade constraint integrity: customer phone format checks, non-negative amounts, and rate card half-open weight bounds. | Check constraints applied with validate-safe semantics. |
| **8** | `20261005000000_rate_cards_atomic_concurrency.sql` | Adds atomic exclusion constraints and concurrency protection for active rate cards and lane pricing, eliminating race conditions during simultaneous tariff activation. | Forward-safe constraint creation with index support. |

---

## 2. Core Architectural Decisions

### A. Canonical Outbox & Side-Effect Claim Pattern (`side_effect_claims`)
External integrations (Google Sheets sync, WhatsApp messaging, and post-call processing) require durable protection against concurrent worker executions and process crashes.
- **Canonical Statuses**: `PENDING`, `PROCESSING`, `SUCCEEDED`, `FAILED`, `RETRYABLE`, `UNKNOWN`.
- **Atomic Locking**: Workers claim a unique `(tenant_id, claim_key)` lock in state `PROCESSING` before initiating network side-effects.
- **Provider Acceptance vs. Local Failure Guarantee**: When an external provider (Meta WhatsApp or Google Sheets) accepts an operation, provider acceptance metadata (`provider_message_id`, `target_spreadsheet_id`, `target_worksheet_name`, `external_call_id`) is durably recorded. If local DB completion fails, the operation is set to `UNKNOWN / RECONCILIATION_REQUIRED`, NEVER ordinary `RETRYABLE` (preventing duplicate sends).
- **Lease Expiration & Takeover**: Stale claims whose `lease_expires_at` has passed can be reclaimed by active workers.
- **Bounded Retries**: Maximum attempts capped with exponential backoff using `next_retry_at`.

### B. Deterministic Transcript Deduplication (`transcript_segments`)
- **Deterministic Identity**: Added `segment_key TEXT` representing `timestamp:speaker:hash(text)` or turn index.
- **Unique Constraint**: `uq_transcript_segments_call_key` on `(call_id, segment_key)`.
- **Replay Safety**: Webhook replay uses `ON CONFLICT (call_id, segment_key) DO UPDATE SET text = EXCLUDED.text`, ensuring 0 duplicate rows. Primary key `id` remains a genuine `UUID` generated by `gen_random_uuid()` rather than truncated SHA256 hex strings.

### C. Canonical Phone Normalization (`phone_normalized`)
- Added `phone_normalized` as an indexed unique column on `customers` (`tenant_id, phone_normalized`). All writes and lookups pass through a deterministic E.164 phone normalizer.

### D. Knowledge Base Approval Workflow (`DRAFT` Default)
- Default status is `DRAFT` across SQL schema, TypeScript types, and UI authoring. Items require explicit administrative approval (`approved_by`, `approved_at`) before entering voice agent prompt context.

### E. Row-Level Security (RLS) Strategy
- **Architectural Model**: **Model A (Authenticated Server API Proxy)**.
- Direct database access from browser clients is strictly disallowed.
- All client requests hit Next.js authenticated API routes (`/api/calls`, `/api/requests`, `/api/leads`), which verify session cookies, derive `tenant_id` from trusted server context, and execute queries using elevated server credentials (`SUPABASE_SECRET_KEY`).
- Table-level RLS policies are enabled on all tables as defense-in-depth.
