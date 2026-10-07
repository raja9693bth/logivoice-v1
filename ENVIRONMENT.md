# LogiVoice V1 — Environment & Configuration Contract

This document provides the authoritative contract for all environment variables used across LogiVoice V1, generated directly from `lib/env.ts` and `.env.example`.

---

## 1. Environment Variable Master Matrix

| Variable Name | Local Dev | Production | Access Scope | Provider-Gated | Classification & Purpose |
| :--- | :---: | :---: | :---: | :---: | :--- |
| `NODE_ENV` | Optional | Required | Server-Only | No | **REQUIRED PRODUCTION**: Node runtime environment (`development`, `test`, `production`). In production, mock integrations are strictly forbidden. |
| `PORT` | Optional | Optional | Server-Only | No | **OPTIONAL**: Port on which the HTTP server listens (default: `3000`). |
| `NEXT_PUBLIC_APP_URL` | Optional | Required | Public | No | **REQUIRED PRODUCTION**: Canonical origin URL (e.g. `https://logivoice-v1.vercel.app`). Used for callbacks and CORS. |
| `NEXT_PUBLIC_DEMO_MODE` | Optional | Optional | Public | No | **PUBLIC / CLIENT-SAFE**: Flag for client-side demo banners (default: `false`). |
| `NEXT_PUBLIC_SUPABASE_URL` | Optional | Required | Public | No | **REQUIRED PRODUCTION**: Public Supabase API project endpoint. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Optional | Required | Public | No | **REQUIRED PRODUCTION**: Canonical public Supabase client key. Supported alias: `NEXT_PUBLIC_SUPABASE_ANON_KEY`. |
| `AUTHORITATIVE_TENANT_ID` | Optional | Required | Server-Only | No | **REQUIRED PRODUCTION**: Authoritative tenant UUID. In production, placeholder tenant `00000000-0000-0000-0000-000000000001` is strictly forbidden unless `ALLOW_PLACEHOLDER_TENANT_IN_PROD=true`. |
| `ALLOW_PLACEHOLDER_TENANT_IN_PROD`| Optional | Optional | Server-Only | No | **TEST-ONLY**: Permits placeholder tenant in production (strictly `false` in production). |
| `SUPABASE_SECRET_KEY` | Optional | Required | Server-Only | No | **REQUIRED PRODUCTION**: Elevated Supabase service-role secret key for backend queries, RLS bypass on server routes. Alias: `SUPABASE_SERVICE_ROLE_KEY`. |
| `DATABASE_URL` | Optional | Optional | Server-Only | No | **TEST-ONLY / LOCAL**: Direct PostgreSQL connection string for applying migrations and running isolated integration tests. |
| `RETELL_API_KEY` | Optional | Required | Server-Only | Yes (Retell AI) | **CONFIGURATION-GATED**: Cryptographic secret used for HMAC-SHA256 signature verification of inbound webhooks from Retell AI. |
| `RETELL_AGENT_ID` | Optional | Required | Server-Only | Yes (Retell AI) | **CONFIGURATION-GATED**: Authoritative Agent ID registered with Retell. Inbound requests with unmapped agent IDs are rejected. |
| `RETELL_TOOL_SECRET` | Optional | Optional | Server-Only | Yes (Retell AI) | **CONFIGURATION-GATED**: Pre-shared secret scoped strictly to `/api/retell/tool` for Retell custom tool authentication. |
| `RETELL_ALLOW_LEGACY_SIGNATURE` | Optional | Optional | Server-Only | Yes (Retell AI) | **OPTIONAL**: Permits legacy hex-only Retell signatures (default `false`). |
| `CRON_SECRET` | Optional | Required | Server-Only | No | **REQUIRED PRODUCTION**: Cryptographic bearer token required to invoke `/api/cron/retry-worker`. In production, request fails closed (HTTP 503) if unset. |
| `PLAYWRIGHT_BASE_URL` | Optional | Optional | Server-Only | No | **TEST-ONLY**: Base URL for running Playwright browser E2E test suites (default: `http://127.0.0.1:3000`). |
| `ENABLE_LIVE_TELEPHONY_TRANSFER` | Optional | Optional | Server-Only | Yes (Telephony) | **CONFIGURATION-GATED**: Set to `true` once live telephony provider credentials and purchased DID are confirmed. |
| `TELEPHONY_PROVIDER_ACCOUNT_SID`| Optional | Optional | Server-Only | Yes (Telephony) | **CONFIGURATION-GATED**: Twilio Account SID. Canonical alias: `TWILIO_ACCOUNT_SID`. |
| `TELEPHONY_PROVIDER_AUTH_TOKEN` | Optional | Optional | Server-Only | Yes (Telephony) | **CONFIGURATION-GATED**: Twilio Auth Token. Canonical alias: `TWILIO_AUTH_TOKEN`. |
| `TELEPHONY_PROVIDER_PHONE_NUMBER`| Optional| Optional | Server-Only | Yes (Telephony) | **CONFIGURATION-GATED**: Live purchased E.164 phone number. Alias: `TWILIO_PHONE_NUMBER`. |
| `GOOGLE_SHEETS_SPREADSHEET_ID` | Optional | Required (if Sheets) | Server-Only | Yes (Google Cloud) | **CONFIGURATION-GATED**: Authoritative Google Spreadsheet ID. If unset, sync is skipped and master record remains in Supabase. |
| `GOOGLE_SHEETS_WORKSHEET_NAME` | Optional | Optional | Server-Only | Yes (Google Cloud) | **CONFIGURATION-GATED**: Target sheet tab name (default: `LogiVoice_Calls`). Fails closed if tab does not exist. |
| `GOOGLE_CLIENT_ID` | Optional | Required (if Sheets) | Server-Only | Yes (Google Cloud) | **CONFIGURATION-GATED**: Google Cloud OAuth 2.0 Client ID. |
| `GOOGLE_CLIENT_SECRET` | Optional | Required (if Sheets) | Server-Only | Yes (Google Cloud) | **CONFIGURATION-GATED**: Google Cloud OAuth 2.0 Client Secret. |
| `GOOGLE_REFRESH_TOKEN` | Optional | Required (if Sheets) | Server-Only | Yes (Google Cloud) | **CONFIGURATION-GATED**: Google OAuth 2.0 refresh token obtained via consent flow. |
| `WHATSAPP_API_TOKEN` | Optional | Required (if WhatsApp)| Server-Only | Yes (Meta WhatsApp) | **CONFIGURATION-GATED**: API Bearer token for Meta WhatsApp Business Cloud API. Alias: `WHATSAPP_API_KEY`. |
| `WHATSAPP_PHONE_NUMBER_ID` | Optional | Required (if WhatsApp)| Server-Only | Yes (Meta WhatsApp) | **CONFIGURATION-GATED**: Sender WhatsApp Phone Number ID registered on Meta Business Manager. |
| `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | Optional | Optional | Server-Only | Yes (Meta WhatsApp) | **CONFIGURATION-GATED**: Secret verification challenge token configured in Meta App Dashboard for webhook subscription. |
| `WHATSAPP_APP_SECRET` | Optional | Optional | Server-Only | Yes (Meta WhatsApp) | **CONFIGURATION-GATED**: Meta App Secret used for HMAC-SHA256 signature verification (`X-Hub-Signature-256`) of incoming status webhooks. Alias: `WHATSAPP_WEBHOOK_SECRET`. |
| `ENABLE_MOCK_INTEGRATIONS` | Optional | Optional | Server-Only | No | **TEST-ONLY**: Enables mock provider boundaries for local offline testing (strictly forbidden in production). |

---

## 2. Canonical vs. Legacy Variable Aliases

When multiple environment variable names exist for the same setting, precedence is strictly evaluated in this order:

1. **Supabase Public Key**:
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (Canonical) $\rightarrow$ `NEXT_PUBLIC_SUPABASE_ANON_KEY` $\rightarrow$ `SUPABASE_ANON_KEY`.
2. **Supabase Secret Key**:
   - `SUPABASE_SECRET_KEY` (Canonical) $\rightarrow$ `SUPABASE_SERVICE_ROLE_KEY`.
3. **Telephony Credentials**:
   - `TWILIO_ACCOUNT_SID` (Canonical) $\rightarrow$ `TELEPHONY_PROVIDER_ACCOUNT_SID`.
   - `TWILIO_AUTH_TOKEN` (Canonical) $\rightarrow$ `TELEPHONY_PROVIDER_AUTH_TOKEN`.
   - `TELEPHONY_PROVIDER_PHONE_NUMBER` (Canonical) $\rightarrow$ `TWILIO_PHONE_NUMBER`.
4. **WhatsApp Token**:
   - `WHATSAPP_API_TOKEN` (Canonical) $\rightarrow$ `WHATSAPP_API_KEY`.
5. **WhatsApp Webhook Secret**:
   - `WHATSAPP_APP_SECRET` (Canonical) $\rightarrow$ `WHATSAPP_WEBHOOK_SECRET`.

---

## 3. Health & Provider Vocabulary

When auditing integrations via `/api/health` or `/admin/audit`, statuses strictly adhere to:

- `VERIFIED`: Provider credentials exist and an active connectivity probe has succeeded within the SLA window.
- `CONFIGURED_NOT_VERIFIED`: Credentials or settings are present, but live upstream network handshake has not yet been executed.
- `UNCONFIGURED`: Required keys or credentials are not present. System fails closed.
- `DEGRADED`: Upstream provider is returning errors, rate limits, or latency exceeding operational threshold.
- `MOCK`: Local or test mock adapter is explicitly enabled (strictly forbidden in production).
