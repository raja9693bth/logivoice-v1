# LogiVoice V1 — Security & Credential Hygiene Report

## 1. Executive Security Summary
LogiVoice V1 implements a defense-in-depth security model across its voice agent gateway, web operations portal, Supabase database, and third-party integrations (Retell AI, Google Sheets, WhatsApp).

As part of the final integrity remediation and hardening:
1. Complete static credential scan performed across repository tree, Git history, fixtures, and documentation.
2. Zero unencrypted or plaintext credentials exist in tracked source code.
3. Elevated service-role credentials (`SUPABASE_SECRET_KEY`) are strictly confined to server-side data access and never exposed to browser sessions or cookie verifications.
4. Cryptographic signature verification enforced for Retell voice webhooks and dedicated custom tool secret authentication for function execution.
5. Spreadsheet formula injection mitigation implemented for Google Sheets integration.
6. Role-based access control (RBAC), customer shipment privacy, and tenant isolation enforced server-side.
7. Production CSP hardened without `unsafe-eval`, connect-src constrained, and `frame-ancestors 'none'`.

---

## 2. Credential Hygiene & Scan Audit Findings

| Category | Scan Finding | Resolution & Hardening |
| :--- | :--- | :--- |
| **Google OAuth Client Secret** | No client secret committed to repository files or Git history. | Protected in `.gitignore` and `.dockerignore` (`client_secret*.json`, `*service-account*.json`). |
| **Supabase Secret Key** | Server-only `process.env.SUPABASE_SECRET_KEY` used in `lib/supabase/server.ts`. | Elevated secret key is server-only. Browser sessions use standard publishable anon key. |
| **Retell API Key & Tool Secret** | Server-only environment variables. Dedicated `RETELL_TOOL_SECRET` used for narrow tool endpoint authority rather than broad account key. | Fail-closed validation in production: missing signature/secret or unmapped agent ID returns HTTP 401/403. |
| **Google Sheets Spreadsheet ID** | Configured via environment variable or database setting. | Explicitly validated; silent fallback to arbitrary spreadsheets or first tabs is prohibited. |
| **Telephony / WhatsApp Keys** | Server-side only (`WHATSAPP_API_KEY`, `TELEPHONY_PROVIDER_AUTH_TOKEN`). | When unconfigured, transitions to `UNCONFIGURED` state without mock data leakage. |

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

### C. Narrow Tool Endpoint Authority & Rate Limiting
- **Risk**: Exposing broad Retell account API credentials for custom function execution, or flooding the tool gateway.
- **Mitigation**:
  - `app/api/retell/tool/route.ts` supports dedicated `RETELL_TOOL_SECRET` or signature verification.
  - In-memory sliding window rate limiter protects tool route against abuse.

### D. Consignment Tracking Privacy & Customer Ownership
- **Risk**: Callers querying arbitrary LR numbers to inspect competitor or cross-customer shipments.
- **Mitigation**: `get_tracking_status` verifies caller phone ownership against the registered customer on the consignment unless bearer lookup is explicitly enabled in tenant configuration.

### E. Outbox Claim Pattern & Concurrency Protection
- **Risk**: Concurrent webhook replays or cluster worker restarts causing duplicate WhatsApp messages or multiple Google Sheet appends.
- **Mitigation**: Durable Postgres table `side_effect_claims` acquires an atomic row lock in status `PROCESSING` before any external network side effect is dispatched. Subsequent replays are safely skipped.

### F. PII Minimization in Audit Logs
- **Risk**: Storing unmasked phone numbers and authorization tokens in permanent audit tables.
- **Mitigation**: Centralized `sanitizeAuditArguments` masks phone numbers (`+91 98******432`), redacts credentials/tokens, and hashes large message payloads before persistence in `audit_events`.

### G. Server-Side Tenant & Privilege Boundary
- **Risk**: Client sending custom headers (`x-tenant-id`, `x-user-role`) to escalate to `ADMIN` or access another tenant's data.
- **Mitigation**: 
  - `getAuthContext()` strictly ignores client headers for role escalation.
  - Roles must be present in validated Supabase `app_metadata` with explicit allowlist (`DISPATCHER`, `OPS_MANAGER`, `ADMIN`).
  - `SYSTEM` and `VOICE_GATEWAY` roles can never be granted via user metadata.

### H. Release v1.0.2 Security Hardening & Sonar Gate Certification
1. **Next.js 16 Proxy Migration & Bounded SSR Auth**:
   - Migrated from legacy `middleware.ts` to standard Next.js 16 `proxy.ts` and `lib/supabase/proxy.ts`.
   - Root routing evaluates unauthenticated requests instantly (< 1ms) and emits a 307 redirect to `/login` without network hops.
   - External Supabase Auth network operations (`getClaims`/`getUser`) are bound via `createBoundedFetch` to a hard upper limit of 2000ms, failing closed to `/login?error=AUTH_TEMPORARILY_UNAVAILABLE` rather than waiting for Vercel platform timeout (eliminates 504 `MIDDLEWARE_INVOCATION_TIMEOUT`).
   - Development cookie bypass (`logivoice_dev_session`) is strictly rejected when `NODE_ENV === 'production'`.

2. **Telephony TwiML & Twilio Contract Security**:
   - Integrated official `twilio` SDK (`twilio.twiml.VoiceResponse`).
   - Eliminated handwritten XML template strings and improper `encodeURIComponent` usage.
   - Enforced strict E.164 phone number validation (`/^\+[1-9]\d{1,14}$/`) and official Twilio REST Call Update resource contract (sending CallSid `CA...`, POST method, and `Twiml` parameter only without unsupported `To` parameter).

3. **SonarCloud Vulnerability Elimination (S6505)**:
   - Eliminated on-demand `npx playwright` invocation in `.github/workflows/ci.yml`.
   - Replaced with local lockfile-pinned `npm run playwright:install` script backed by verified devDependencies.
   - SonarCloud Quality Gate on `branch=main`: Security Rating **A**, 0 New Issues, 0 Security Hotspots, 2.5% Duplication (required <= 3.0%).

