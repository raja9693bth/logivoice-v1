# LogiVoice V1 — Security & Credential Hygiene Report

## 1. Executive Security Summary
LogiVoice V1 implements a defense-in-depth security model across its voice agent gateway, web operations portal, Supabase database, and third-party integrations (Retell AI, Google Sheets, WhatsApp).

As part of the client delivery hardening:
1. Complete static credential scan performed across repository tree, Git history, fixtures, and documentation.
2. Zero unencrypted or plaintext credentials exist in tracked source code.
3. Elevated service-role credentials (`SUPABASE_SECRET_KEY`) are strictly confined to server-side data access and never exposed to browser sessions or cookie verifications.
4. Cryptographic HMAC-SHA256 signature verification enforced for Retell voice webhooks and tool invocation endpoints.
5. Spreadsheet formula injection mitigation implemented for Google Sheets integration.
6. Role-based access control (RBAC) and tenant isolation enforced server-side.

---

## 2. Credential Hygiene & Scan Audit Findings

| Category | Scan Finding | Resolution & Hardening |
| :--- | :--- | :--- |
| **Google OAuth Client Secret** | No client secret committed to repository files or Git history. | Protected in `.gitignore` and `.dockerignore` (`client_secret*.json`, `*service-account*.json`). |
| **Supabase Secret Key** | Server-only `process.env.SUPABASE_SECRET_KEY` used in `lib/supabase/server.ts`. | Removed fallback that allowed browser session cookies to check against secret key. Browser sessions must use `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. |
| **Retell API Key & Agent ID** | Server-only environment variables. Never returned in API responses or serialized to frontend bundles. | Fail-closed validation in production: missing signature or unmapped agent ID returns HTTP 400/401. |
| **Google Sheets Spreadsheet ID** | Previously hardcoded default ID present in source and example. | Removed hardcoded default ID; dynamic tenant resolution from `client_configs` or environment variable. |
| **Telephony / WhatsApp Keys** | Server-side only (`WHATSAPP_API_KEY`, `WHATSAPP_PHONE_NUMBER_ID`). | When unconfigured, transitions to `UNCONFIGURED` state without mock data leakage. |

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
3. **Retell AI API Key**:
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
  - HMAC-SHA256 computed using `RETELL_API_KEY`.
  - Constant-time comparison using `crypto.timingSafeEqual`.
  - Agent ID validation ensuring the call belongs to the tenant's configured agent.

### C. PII Minimization in Audit Logs
- **Risk**: Storing unmasked phone numbers and authorization tokens in permanent audit tables.
- **Mitigation**: Implemented `redactPii()` sanitizer masking phone numbers (`+91 98******432`) and redacting tokens/secrets before persistence in `audit_events`.

### D. Server-Side Tenant & Privilege Boundary
- **Risk**: Client sending custom headers (`x-tenant-id`, `x-user-role`) to escalate to `ADMIN` or access another tenant's data.
- **Mitigation**: 
  - `getAuthContext()` strictly ignores client headers for role escalation.
  - Roles must be present in validated Supabase `app_metadata` with explicit allowlist (`DISPATCHER`, `OPS_MANAGER`, `ADMIN`).
  - `SYSTEM` and `VOICE_GATEWAY` roles can never be granted via user metadata.
