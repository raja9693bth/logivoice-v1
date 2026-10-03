# LogiVoice V1 — Environment & Configuration Contract

This document provides the authoritative contract for all environment variables used across LogiVoice V1.

---

## Environment Variable Master Matrix

| Variable Name | Local Dev | Production | Access Scope | Provider-Gated | Purpose & Description |
| :--- | :---: | :---: | :---: | :---: | :--- |
| `NODE_ENV` | Optional | Required | Server-Only | No | Standard Node environment (`development`, `test`, `production`). In production, mock integrations are strictly disabled. |
| `PORT` | Optional | Optional | Server-Only | No | Port on which the HTTP server listens (default: `3000`). |
| `NEXT_PUBLIC_APP_URL` | Optional | Required | Public (Client + Server) | No | Canonical origin URL (e.g. `https://logivoice.example.com`). Used for callbacks and CORS. |
| `NEXT_PUBLIC_SUPABASE_URL` | Optional | Required | Public (Client + Server) | No | Supabase API URL. Required for frontend authentication and client sessions. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Optional | Required | Public (Client + Server) | No | Public Supabase anonymous client key for session token verification. Elevated keys must never be used here. |
| `SUPABASE_SECRET_KEY` | Optional | Required | Server-Only | No | Elevated Supabase service-role key for backend queries, RLS bypass on server routes, and database operations. |
| `SUPABASE_SERVICE_ROLE_KEY` | Optional | Optional | Server-Only | No | Supported alias for `SUPABASE_SECRET_KEY`. |
| `DATABASE_URL` | Optional | Optional | Server-Only | No | Direct PostgreSQL connection string for running migrations and isolated integration test suites. |
| `RETELL_API_KEY` | Optional | Required | Server-Only | Yes (Retell AI) | Cryptographic secret used for HMAC-SHA256 signature verification of inbound webhooks and tool executions from Retell AI. |
| `RETELL_AGENT_ID` | Optional | Required | Server-Only | Yes (Retell AI) | Authoritative Agent ID registered with Retell. Inbound requests with unmapped agent IDs are rejected. |
| `GOOGLE_SHEETS_SPREADSHEET_ID` | Optional | Required | Server-Only | Yes (Google Cloud) | Target Google Spreadsheet ID for secondary operational sync. If unset, sync is skipped and master record remains in Supabase. |
| `GOOGLE_SHEETS_WORKSHEET_NAME` | Optional | Optional | Server-Only | Yes (Google Cloud) | Specific sheet tab name (default: `LogiVoice_Calls`). Fails with configuration error if tab does not exist (never writes to arbitrary sheets). |
| `GOOGLE_CLIENT_ID` | Optional | Required (if Sheets enabled) | Server-Only | Yes (Google Cloud) | Google Cloud OAuth 2.0 Client ID. |
| `GOOGLE_CLIENT_SECRET` | Optional | Required (if Sheets enabled) | Server-Only | Yes (Google Cloud) | Google Cloud OAuth 2.0 Client Secret. |
| `GOOGLE_REFRESH_TOKEN` | Optional | Required (if Sheets enabled) | Server-Only | Yes (Google Cloud) | Google OAuth 2.0 refresh token obtained via consent flow to authenticate Google Sheets API requests. |
| `WHATSAPP_API_TOKEN` | Optional | Required (if WhatsApp enabled)| Server-Only | Yes (Meta WhatsApp) | API Bearer token for Meta WhatsApp Business Cloud API. (Alias: `WHATSAPP_API_KEY`). |
| `WHATSAPP_PHONE_NUMBER_ID` | Optional | Required (if WhatsApp enabled)| Server-Only | Yes (Meta WhatsApp) | Senders WhatsApp Phone Number ID registered on Meta Business Manager. |
| `ENABLE_LIVE_TELEPHONY_TRANSFER` | Optional | Optional | Server-Only | Yes (Telephony) | Set to `true` only when live telephony provider credentials are confirmed and tested. |
| `TWILIO_ACCOUNT_SID` | Optional | Optional | Server-Only | Yes (Telephony) | Account SID for Twilio telephony provider (supported alias: `TELEPHONY_PROVIDER_ACCOUNT_SID`). |
| `TWILIO_AUTH_TOKEN` | Optional | Optional | Server-Only | Yes (Telephony) | Authentication token for Twilio telephony provider (supported alias: `TELEPHONY_PROVIDER_AUTH_TOKEN`). |

---

## Health & Provider State Vocabulary

When auditing integrations or querying `/api/health`, provider states strictly follow this vocabulary:

1. **`VERIFIED`**: Provider credentials exist and an active connectivity probe has succeeded within the SLA window.
2. **`CONFIGURED_NOT_VERIFIED`**: Environment variables or database settings are populated, but live upstream handshake has not yet been executed.
3. **`UNCONFIGURED`**: Necessary keys or credentials are not present in environment or database. System fails closed.
4. **`DEGRADED`**: Upstream provider is returning errors, rate limits, or latency exceeding operational threshold.
5. **`MOCK`**: Local or test environment mock adapter is explicitly enabled. Forbidden in production.
