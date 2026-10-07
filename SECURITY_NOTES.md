# LogiVoice V1 — Security & Credential Hygiene Report

## 1. Executive Security Summary
LogiVoice V1 implements a defense-in-depth security model across its voice agent gateway, web operations portal, Supabase database, and third-party integrations (Retell AI, Google Sheets, WhatsApp, Twilio).

As part of the final client-production certification:
1. Complete static credential scan performed across repository tree, Git history, fixtures, and documentation.
2. Zero unencrypted or plaintext credentials exist in tracked source code.
3. Elevated service-role credentials (`SUPABASE_SECRET_KEY`) are strictly confined to server-side data access and never exposed to browser sessions or cookie verifications.
4. Cryptographic signature verification enforced for Retell voice webhooks (`retell-sdk` HMAC-SHA256 with timestamp replay bounds) and dedicated custom tool secret authentication.
5. Official Meta WhatsApp Cloud API webhook implemented at `/api/webhooks/whatsapp` with challenge verification (`hub.challenge`), HMAC-SHA256 signature verification (`X-Hub-Signature-256`), and monotonic state preservation.
6. Twilio connected-leg transfer callback implemented at `/api/webhooks/twilio/transfer` with official `twilio.validateRequest` signature verification (`X-Twilio-Signature`) and monotonic state transition rules.
7. Google Sheets immutable target metadata stored in durable claims (`target_spreadsheet_id`, `target_worksheet_name`, `external_call_id`) to prevent configuration drift attacks during reconciliation.
8. Spreadsheet formula injection mitigation implemented for Google Sheets integration.
9. Role-based access control (RBAC), customer shipment privacy, and tenant isolation enforced server-side.
10. Production CSP hardened without `unsafe-eval`, connect-src constrained, and `frame-ancestors 'none'`.

---

## 2. Credential Hygiene & Scan Audit Findings

| Category | Scan Finding | Resolution & Hardening |
| :--- | :--- | :--- |
| **Google OAuth Client Secret** | No client secret committed to repository files or Git history. | Protected in `.gitignore` and `.dockerignore` (`client_secret*.json`, `*service-account*.json`). |
| **Supabase Secret Key** | Server-only `process.env.SUPABASE_SECRET_KEY` used in `lib/supabase/server.ts`. | Elevated secret key is server-only. Browser sessions use standard publishable anon key. |
| **Retell API Key & Tool Secret** | Server-only environment variables. Dedicated `RETELL_TOOL_SECRET` used for narrow tool endpoint authority rather than broad account key. | Fail-closed validation in production: missing signature/secret or unmapped agent ID returns HTTP 401/403. |
| **Google Sheets Spreadsheet ID** | Configured via environment variable or database setting. Immutable claim snapshot prevents target hijacking. | Explicitly validated; silent fallback to arbitrary spreadsheets or first tabs is prohibited. |
| **Telephony / Twilio Credentials**| Server-side only (`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`). | Request signature verified via official Twilio SDK (`twilio.validateRequest`). Forged or tampered requests rejected with HTTP 401. |
| **Meta WhatsApp Business API** | Server-side only (`WHATSAPP_API_TOKEN`, `WHATSAPP_APP_SECRET`). | Webhook signature verified via HMAC-SHA256 (`X-Hub-Signature-256`). Forged requests rejected with HTTP 401. |

---

## 3. Required Human Credential Rotations Before Production Go-Live

> [!IMPORTANT]
> If any developer or test machine previously had temporary OAuth client secret JSON files or test tokens shared during project development, the following credentials MUST be rotated by the respective administrator before production DNS cutover:

1. **Google OAuth Client Secret & Refresh Token**:
   - Operator: Google Cloud Console Project Administrator
   - Action: Rotate Client Secret in GCP Console > APIs & Services > Credentials. Generate new Refresh Token for production deployment.
2. **Supabase Database & API Keys**:
   - Operator: Supabase Project Owner
   - Action: Verify that the `service_role` key has never been shared publicly. Rotate JWT secret if required.
3. **Retell AI API Key & Tool Secret**:
   - Operator: Retell AI Account Owner
   - Action: Rotate key in Retell Dashboard if previously used in shared developer environments.

---

## 4. Threat Mitigations Implemented in Code

### A. Spreadsheet Formula Injection (CSV / Sheets Injection)
- **Risk**: A caller providing a malicious name or company like `=cmd|' /C calc'!A0` or `@SUM(...)` could execute arbitrary commands when an operator opens the Google Sheet.
- **Mitigation**: Implemented `sanitizeSheetCell()` in `lib/integrations/google-sheets.ts`. Any string starting with `=, +, -, @, \t, \r` is prepended with a single quote `'` to ensure Google Sheets treats it strictly as plain text.

### B. Retell Webhook Signature & Timing Attacks
- **Risk**: Attacker spoofing webhook payloads to inject fake completed calls or trigger unauthorized post-call messaging.
- **Mitigation**: 
  - Raw HTTP body string preserved before JSON parsing.
  - Verification using official `retell-sdk` (`v=<timestamp>,d=<digest>` with replay attack timeout).
  - Legacy hex HMAC fallback is strictly gated behind `RETELL_ALLOW_LEGACY_SIGNATURE=true` (default `false`).
  - Constant-time comparison using `crypto.timingSafeEqual`.
  - Agent ID validation ensuring the call belongs to the tenant's configured agent.

### C. Meta WhatsApp Webhook Security (`/api/webhooks/whatsapp`)
- **Risk**: Attacker spoofing delivery confirmations to trigger unauthorized state changes or poison claim reconciliations.
- **Mitigation**:
  - GET challenge verification validates `hub.verify_token` against `WHATSAPP_WEBHOOK_VERIFY_TOKEN`.
  - POST delivery events validate `X-Hub-Signature-256` HMAC-SHA256 signature using `WHATSAPP_APP_SECRET`.
  - Monotonic status hierarchy prevents out-of-order `SENT` events from overturning verified `DELIVERED` status.

### D. Twilio Transfer Webhook Security (`/api/webhooks/twilio/transfer`)
- **Risk**: Attacker forging transfer completion to trick the system into reporting successful live human handoffs.
- **Mitigation**:
  - Route validates `X-Twilio-Signature` using official `twilio.validateRequest(authToken, signature, url, params)`.
  - Monotonic transition rules ensure `TRANSFER_CONNECTED` cannot be overturned by late failure callbacks.
  - Only genuine provider evidence marks business outcome as `TRANSFERRED`.

### E. Google Sheets Immutable Target Metadata
- **Risk**: Tenant settings changed after an uncertain append, causing reconciliation to check or write to an attacker-controlled spreadsheet.
- **Mitigation**:
  - `side_effect_claims` records snapshot of `target_spreadsheet_id`, `target_worksheet_name`, and `external_call_id`.
  - Reconciler strictly inspects original target metadata, eliminating configuration drift.

### F. Consignment Tracking Privacy & Customer Ownership
- **Risk**: Callers querying arbitrary LR numbers to inspect competitor or cross-customer shipments.
- **Mitigation**: `get_tracking_status` verifies caller phone ownership against the registered customer on the consignment unless bearer lookup is explicitly enabled in tenant configuration.

### G. Outbox Claim Pattern & Concurrency Protection
- **Risk**: Concurrent webhook replays or cluster worker restarts causing duplicate WhatsApp messages or multiple Google Sheet appends.
- **Mitigation**: Durable Postgres table `side_effect_claims` acquires an atomic row lock in status `PROCESSING` before any external network side effect is dispatched. Subsequent replays are safely skipped.

### H. PII Minimization in Audit Logs
- **Risk**: Storing unmasked phone numbers and authorization tokens in permanent audit tables.
- **Mitigation**: Centralized `sanitizeAuditArguments` masks phone numbers (`+91 98******432`), redacts credentials/tokens, and hashes large message payloads before persistence in `audit_events`.

### I. Server-Side Tenant & Privilege Boundary
- **Risk**: Client sending custom headers (`x-tenant-id`, `x-user-role`) to escalate to `ADMIN` or access another tenant's data.
- **Mitigation**: 
  - `getAuthContext()` strictly ignores client headers for role escalation.
  - Roles must be present in validated Supabase `app_metadata` with explicit allowlist (`DISPATCHER`, `OPS_MANAGER`, `ADMIN`).
  - `SYSTEM` and `VOICE_GATEWAY` roles can never be granted via user metadata.
