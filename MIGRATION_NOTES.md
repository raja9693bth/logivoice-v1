# LogiVoice V1 — Database Migration & Schema Notes

> **Database Engine**: PostgreSQL 15+ (Hosted on Supabase)  
> **Schema Isolation**: Tenant-scoped partition with multi-tenant foreign keys

---

## 1. Migration Log

| Migration File | Description | Impact & Forward Safety |
| :--- | :--- | :--- |
| `20260918000000_durable_idempotency_constraints.sql` | Adds explicit `idempotency_key` column and unique index `idx_ops_requests_idempotency` to `operations_requests`. | Forward-safe. Backfills existing requests with deterministic keys. |
| `20260919000000_drop_obsolete_global_call_unique.sql` | Safely removes legacy global unique constraint `calls_external_call_id_key` on `external_call_id`. Preserves tenant-scoped unique index `idx_calls_tenant_external_id` on `(tenant_id, external_call_id)`. | Forward-safe conditional drop (`DROP CONSTRAINT IF EXISTS`). Prevents cross-tenant call ID collisions. |
| `20260920000000_integrity_hardening.sql` | 1. Synchronizes `client_configs` schema (`business_type`, `booking_url`, `voice_persona`, `barge_in_enabled`, `allow_language_switching`).<br>2. Implements canonical `phone_normalized` column on `customers` with unique index `(tenant_id, phone_normalized)`.<br>3. Changes `knowledge_items` default approval state to `DRAFT` with audit attribution columns.<br>4. Creates `side_effect_claims` table for atomic outbox side-effect locking.<br>5. Creates `customer_suppressions` table for persistent opt-out enforcement.<br>6. Enables RLS policies for tenant isolation. | Forward-safe idempotent schema updates (`IF NOT EXISTS`). Backfills normalized phones safely without data loss. |

---

## 2. Core Architectural Decisions

### A. Outbox & Side-Effect Claim Pattern (`side_effect_claims`)
External integrations (Google Sheets, WhatsApp messaging, and post-call processing) require durable protection against concurrent worker executions and process crashes.
- **Resolution**: Implemented a durable Postgres outbox claim table `side_effect_claims`.
- **Atomic Locking**: Workers claim a unique `(tenant_id, claim_key)` lock in state `PROCESSING` before initiating network side-effects.
- **Status Transitions**: Transitioned to `SUCCEEDED` upon completion or `FAILED`/`RETRYABLE` on errors, ensuring no duplicate external dispatches occur on webhook replays.

### B. Canonical Phone Normalization (`phone_normalized`)
- **Issue**: Suffix matching or raw phone formatting differences created risk of duplicate customer records.
- **Resolution**: Added `phone_normalized` as an indexed unique column on `customers` (`tenant_id, phone_normalized`). All writes and lookups pass through a deterministic E.164 phone normalizer.

### C. Safe Knowledge Base Draft Default
- **Issue**: Historical default of `APPROVED` allowed unreviewed knowledge items to immediately alter voice runtime responses.
- **Resolution**: Default status changed to `DRAFT` in both SQL schema and TypeScript models. Items require explicit administrative approval before inclusion in voice agent prompt context.

### D. Idempotency Key Placement
- `idempotency_key` is a first-class column in `operations_requests` with a unique database index.
- Operations request insertion handles conflicts atomically and returns the existing authoritative record.

### E. Row-Level Security (RLS) Strategy
- **Architectural Model**: **Model A (Authenticated Server API Proxy)**.
- Direct database access from browser clients is strictly disallowed.
- All client requests hit Next.js authenticated API routes (`/api/calls`, `/api/requests`, `/api/leads`), which verify session cookies, derive `tenant_id` from trusted server context, and execute queries using elevated server credentials (`SUPABASE_SECRET_KEY`).
- Table-level RLS policies are enabled on all tables as defense-in-depth.
