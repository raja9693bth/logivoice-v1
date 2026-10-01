# LogiVoice V1 — Database Migration & Schema Notes

> **Database Engine**: PostgreSQL 15+ (Hosted on Supabase)  
> **Schema Isolation**: Tenant-scoped partition with multi-tenant foreign keys

---

## 1. Migration Log

| Migration File | Description | Impact & Forward Safety |
| :--- | :--- | :--- |
| `20260918000000_durable_idempotency_constraints.sql` | Adds explicit `idempotency_key` column and unique index `idx_ops_requests_idempotency` to `operations_requests`. | Forward-safe. Backfills existing requests with deterministic keys. |
| `20260919000000_drop_obsolete_global_call_unique.sql` | Safely removes legacy global unique constraint `calls_external_call_id_key` on `external_call_id`. Preserves tenant-scoped unique index `idx_calls_tenant_external_id` on `(tenant_id, external_call_id)`. | Forward-safe conditional drop (`DROP CONSTRAINT IF EXISTS`). Prevents cross-tenant call ID collisions. |

---

## 2. Core Architectural Decisions

### A. Idempotency Key Placement
Previously, idempotency keys were stored as nested properties inside JSON metadata columns (`details->>'idempotency_key'`). This resulted in race conditions during concurrent webhook deliveries.
- **Resolution**: Promoted `idempotency_key` to a first-class column in `operations_requests` with a unique database index.
- **Atomic Upsert**: Operations request insertion uses `ON CONFLICT (tenant_id, idempotency_key) DO UPDATE` or returns the existing record atomically.

### B. Normalized Phone Identity
- **Issue**: Ambiguous suffix matching or `ILIKE '%1234567890'` created risk of colliding customer identities across different area codes or countries.
- **Resolution**: Strict E.164 normalization applied prior to all customer lookups and inserts (`+919820155432`). Suffix matching is completely removed.

### C. Row-Level Security (RLS) Strategy
- **Architectural Model**: **Model A (Authenticated Server API Proxy)**.
- Direct database access from browser clients is strictly disallowed.
- All client requests hit Next.js authenticated API routes (`/api/calls`, `/api/requests`, `/api/leads`), which verify session cookies, derive `tenant_id` from trusted server context, and execute queries using elevated server credentials (`SUPABASE_SECRET_KEY`).
- Table-level RLS policies are enabled on all tables as defense-in-depth, preventing unauthorized direct queries even if anon keys are compromised.

### D. Transaction Boundaries & Audit Integrity
- The `logAuditEvent` helper was refactored to ensure successful Supabase inserts return a valid `AuditEvent` model and do not fall through into in-memory mock fallback logic.
- Complex multi-entity operations (Call Outcome + Lead Creation + Support Ticket) are bound together with correlation IDs and durable idempotency keys.
