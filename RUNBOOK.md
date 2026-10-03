# LogiVoice V1 — Production Operations Runbook

> **Target Audience**: Site Reliability Engineers, DevOps Engineers, and System Operators

---

## 1. Production Deployment Procedure

### A. Environment Verification
Ensure all required environment variables documented in `ENVIRONMENT.md` are configured in your container runtime or deployment platform (Cloud Run / Vercel).

### B. Database Migrations
Execute any pending migrations against the production PostgreSQL instance before updating the application containers:
```bash
# Apply pending migrations using Supabase CLI or psql
supabase db push
# Or via psql directly:
psql -h <SUPABASE_DB_HOST> -U postgres -d postgres -f supabase/migrations/20260918000000_durable_idempotency_constraints.sql
psql -h <SUPABASE_DB_HOST> -U postgres -d postgres -f supabase/migrations/20260919000000_drop_obsolete_global_call_unique.sql
```

### C. Containerized Standalone Build
LogiVoice V1 is optimized for Docker standalone builds:
```bash
docker build -t logivoice-v1:latest .
docker run -p 3000:3000 --env-file .env.production logivoice-v1:latest
```

---

## 2. Health & Telemetry Verification

### A. Public Liveness Probe
```bash
curl -i https://<DEPLOYED_DOMAIN>/api/health
```
**Expected Response**:
```json
{
  "status": "healthy",
  "database": "connected",
  "environment": "production",
  "timestamp": "2026-10-01T18:30:00.000Z"
}
```

### B. Admin Integration Inspection
Log into the Operations Portal at `/admin/audit` to view live integration probes and verify provider statuses (`VERIFIED`, `UNCONFIGURED`, or `DEGRADED`).

---

## 3. Incident Response & Troubleshooting

### Scenario 1: Retell Voice Agent Returns Webhook Errors (HTTP 401)
- **Symptom**: Retell Dashboard indicates webhook failures with 401 Unauthorized.
- **Root Cause**: `RETELL_API_KEY` mismatch or clock skew affecting HMAC signature.
- **Action**: 
  1. Verify `RETELL_API_KEY` matches the secret configured in Retell webhook settings.
  2. Verify that reverse proxies or CDNs are not stripping the `X-Retell-Signature` header.
  3. Ensure the reverse proxy does not modify the raw JSON request body before forwarding.

### Scenario 2: Google Sheets Synchronization Backlog
- **Symptom**: Inbound calls are processed in Supabase, but rows do not appear in the operational spreadsheet.
- **Root Cause**: Google OAuth token expiration or quota limits.
- **Action**:
  1. Inspect the call detail forensic panel in `/admin/calls/[id]`.
  2. The Google Sheets sync is strictly secondary; call data and leads are securely preserved in PostgreSQL.
  3. Re-authenticate Google service account or refresh token; sync will resume without duplicating existing rows due to the built-in sync ledger.

### Scenario 3: Human Transfer Fallback Triggered
- **Symptom**: Voice calls fail to connect to live agents, returning `CALLBACK_SCHEDULED`.
- **Root Cause**: Indian telephony SIP trunk unconfigured or out-of-hours.
- **Action**:
  1. Check `/admin/requests` for generated `CB-XXXXX` callback tickets.
  2. Dispatchers should review caller phone number and dispatch notes to return the call manually.

---

## 4. Rollback Plan
If a critical defect is encountered post-deployment:
1. Revert container tag to previous stable image hash.
2. In database, all migrations are strictly forward-safe and backward-compatible (non-destructive drops and additive columns).
3. Notify operations desk to rely on Supabase direct portal while container rolls back.

---

## 5. Scheduled Retry Worker & Cron Execution SLA

- **Endpoint**: `/api/cron/retry-worker`
- **Security Requirement**: `Authorization: Bearer ${CRON_SECRET}` (HTTP 401 on mismatch; HTTP 500 fail-closed in production if `CRON_SECRET` is unset).
- **Execution Architecture (Model A)**: Worker selects `RETRYABLE` claims and invokes business executors (`processPostCallPipeline`, `syncCallToGoogleSheets`, `sendControlledFollowup`). Executors acquire and settle their own leases atomically, preventing self-claim deadlocks.
- **SLA & Schedule**:
  - The exponential backoff interval for retries begins at 60 seconds (`initial_backoff_seconds = 60`, doubling up to `max_backoff_seconds = 900`).
  - **Vercel Hobby Plan**: Restricted to daily cron (`0 0 * * *`). Retries under Hobby schedule run once every 24 hours.
  - **Vercel Pro/Enterprise or External Scheduler**: Use 1-minute to 5-minute cron trigger (e.g. `* * * * *` or `*/5 * * * *`) via Cloud Scheduler / GitHub Actions with `Authorization: Bearer ${CRON_SECRET}` to achieve the target 60-second recovery SLA.

