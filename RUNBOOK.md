# LogiVoice V1 — Production Operations Runbook

> **Target Audience**: Site Reliability Engineers, DevOps Engineers, and System Operators  
> **Target Version**: V1.0.2  
> **Status**: Production Certified (Phone Number Procurement Pending)

---

## 1. Production Deployment Procedure

### A. Environment Verification
Ensure all required environment variables documented in `ENVIRONMENT.md` are configured in your container runtime or deployment platform (Vercel / Cloud Run).

### B. Database Migrations
Execute any pending migrations against the production PostgreSQL instance before updating the application containers:
```bash
# Verify actual migration files (all 8 migrations):
ls -la supabase/migrations/

# Apply pending migrations using Supabase CLI or psql:
# 1. 20260917000000_init_logivoice_schema.sql
# 2. 20260918000000_durable_idempotency_constraints.sql
# 3. 20260919000000_drop_obsolete_global_call_unique.sql
# 4. 20260920000000_integrity_hardening.sql
# 5. 20261003000000_side_effect_claims_and_transcript_alignment.sql
# 6. 20261003010000_atomic_side_effects_and_tool_executions.sql
# 7. 20261003020000_enterprise_integrity_hardening.sql
# 8. 20261005000000_rate_cards_atomic_concurrency.sql
supabase db push
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
curl -i https://<DEPLOYED_DOMAIN>/api/health?check=liveness
```
**Expected Response**:
```json
{
  "status": "UP",
  "version": "1.0.2",
  "timestamp": "2026-10-07T18:30:00.000Z"
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
  3. Ensure reverse proxies preserve the raw request body without modification before forwarding.

### Scenario 2: Google Sheets Synchronization Backlog / Reconciliation
- **Symptom**: Inbound calls are processed in Supabase, but rows do not appear in the operational spreadsheet.
- **Root Cause**: Google OAuth token expiration, quota limit, or transient network error.
- **Action**:
  1. Inspect `/admin/calls/[id]` forensic timeline and `side_effect_claims` table.
  2. Google Sheets synchronization is strictly secondary; call data, quotes, and leads are safely preserved in PostgreSQL.
  3. The retry worker invokes `reconcileUnknownClaims()`. The reconciler extracts the **immutable original target metadata** (`target_spreadsheet_id`, `target_worksheet_name`, `external_call_id`) and queries the authoritative tab. If the deterministic call ID row already exists, the claim transitions to `SUCCEEDED` without creating duplicate rows.

### Scenario 3: Human Transfer Fallback Triggered (`CALLBACK_SCHEDULED`)
- **Symptom**: Voice calls fail to connect to live agents, returning `CALLBACK_SCHEDULED`.
- **Root Cause**: Indian telephony DID unconfigured, carrier busy, or line unanswered.
- **Action**:
  1. Check `/admin/requests` for generated `CB-XXXXX` callback tickets (priority: `HIGH`).
  2. Dispatchers should review caller phone number and dispatch notes to return the call manually.

### Scenario 4: Meta WhatsApp Delivery Reconciliation (`/api/webhooks/whatsapp`)
- **Symptom**: WhatsApp follow-up state shows `UNKNOWN` or `PENDING`.
- **Root Cause**: Message accepted by Meta Cloud API (`provider_message_id` issued), but local database transaction encountered transient failure.
- **Action**:
  1. Do **NOT** manually trigger re-send (prevents duplicate messaging).
  2. Meta delivery status webhooks arrive at `/api/webhooks/whatsapp` (`sent`, `delivered`, `read`).
  3. The route verifies `X-Hub-Signature-256`, idempotently updates the follow-up record to `DELIVERED`, and reconciles the associated `side_effect_claims` to `SUCCEEDED`.

### Scenario 5: Twilio Live Transfer Callbacks (`/api/webhooks/twilio/transfer`)
- **Symptom**: Agent initiates live transfer, but outcome in calls dashboard shows `IN_PROGRESS` or `CALLBACK_SCHEDULED`.
- **Root Cause**: Twilio webhook delay or human recipient did not answer.
- **Action**:
  1. Verify Twilio sends `X-Twilio-Signature` to `https://<DOMAIN>/api/webhooks/twilio/transfer`.
  2. Monotonic transition rules ensure `DialCallStatus === 'completed'` / `'answered'` sets outcome to `TRANSFERRED`.
  3. Failure statuses (`busy`, `no-answer`, `failed`, `canceled`) set outcome to `CALLBACK_SCHEDULED` and create dispatcher ticket `CB-XXXXX`.

---

## 4. Scheduled Retry Worker & Cron Execution SLA

- **Endpoint**: `/api/cron/retry-worker`
- **Security Requirement**: `Authorization: Bearer ${CRON_SECRET}` (HTTP 401 on mismatch; HTTP 503 fail-closed in production if `CRON_SECRET` is unset).
- **Worker Functions**:
  1. `reconcileUnknownClaims(limit)`: Reconciles ambiguous provider operations (Sheets and WhatsApp) against provider truth.
  2. `runRetryWorker(limit)`: Safely reclaims retryable claims and executes post-call processing, Sheets sync, and messaging with bounded exponential backoff.
- **SLA & Schedule**:
  - Initial backoff: 60s, doubling up to 900s.
  - In production, trigger via Vercel Cron or Cloud Scheduler every 1 to 5 minutes with `Authorization: Bearer ${CRON_SECRET}`.

---

## 5. Live Production Phone Number / DID Activation Procedure

Once the client/owner purchases the live production phone number, execute this exact operator activation procedure. **Zero application code changes or rebuilds are necessary:**

1. **Procure Telephony Number**:
   - Purchase national or local Indian DID (E.164 format, e.g. `+91XXXXXXXXXX`) from Airtel, Tata Tele, Jio, or Twilio.
2. **Bind Inbound Number in Retell AI**:
   - Go to Retell AI Dashboard > Phone Numbers.
   - Click "Register Number" (or configure SIP trunk credentials).
   - Assign the number to the production Retell Agent (`RETELL_AGENT_ID`).
3. **Configure Upstream Webhook URLs**:
   - Retell Webhook URL: `https://<PRODUCTION_DOMAIN>/api/retell/webhook`
   - Twilio Voice Webhook URL: `https://<PRODUCTION_DOMAIN>/api/retell/webhook`
   - Twilio Transfer Status Callback: `https://<PRODUCTION_DOMAIN>/api/webhooks/twilio/transfer`
   - Meta WhatsApp Webhook URL: `https://<PRODUCTION_DOMAIN>/api/webhooks/whatsapp`
4. **Configure Environment Variables in Deployment Platform**:
   - Set `TELEPHONY_PROVIDER_PHONE_NUMBER=<E.164_PHONE_NUMBER>` (or `TWILIO_PHONE_NUMBER`).
   - Set `ENABLE_LIVE_TELEPHONY_TRANSFER=true`.
5. **Execute Connectivity Smoke Call**:
   - Call the number from an Indian mobile phone.
   - Verify agent answers promptly with AI identity disclosure.
   - Test human escalation and verify transfer callback execution.
6. **Go Live**:
   - Route public customer calls to the new inbound number.
