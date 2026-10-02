# LogiVoice V1 — Environment & Configuration Contract

This document provides the authoritative contract for all environment variables used across LogiVoice V1.

---

## Environment Variable Master Matrix

| Variable Name | Local Dev | Production | Access Scope | Provider-Gated | Purpose & Description |
| :--- | :---: | :---: | :---: | :---: | :--- |
| `NODE_ENV` | Optional | Required | Server-Only | No | Standard Node environment (`development`, `test`, `production`). In production, mock TMS and mock transfer are strictly disabled. |
| `PORT` | Optional | Optional | Server-Only | No | Port on which the HTTP server listens (default: `3000`). |
| `NEXT_PUBLIC_APP_URL` | Optional | Required | Public (Client + Server) | No | Canonical origin URL (e.g. `https://logivoice.example.com`). Used for callbacks and CORS. |
| `NEXT_PUBLIC_SUPABASE_URL` | Optional | Required | Public (Client + Server) | No | Supabase API URL. Required for frontend authentication and client sessions. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Optional | Required | Public (Client + Server) | No | Public Supabase anonymous client key for session token verification. Elevated keys must never be used here. |
| `SUPABASE_SECRET_KEY` | Optional | Required | Server-Only | No | Elevated Supabase service-role key for backend queries, RLS bypass on server routes, and database operations. |
| `SUPABASE_SERVICE_ROLE_KEY` | Optional | Optional | Server-Only | No | Alias for `SUPABASE_SECRET_KEY`. |
| `RETELL_API_KEY` | Optional | Required | Server-Only | Yes (Retell AI) | Cryptographic secret used for HMAC-SHA256 signature verification of inbound webhooks and tool executions from Retell AI. |
| `RETELL_AGENT_ID` | Optional | Required | Server-Only | Yes (Retell AI) | Authoritative Agent ID registered with Retell. Webhooks with unmapped agent IDs are rejected in production. |
| `GOOGLE_SHEETS_SPREADSHEET_ID` | Optional | Required | Server-Only | Yes (Google Cloud) | Target Google Spreadsheet ID for secondary operational sync. If unset, sync is skipped and master record remains in Supabase. |
| `GOOGLE_SHEETS_WORKSHEET_NAME` | Optional | Optional | Server-Only | Yes (Google Cloud) | Specific sheet tab name (default: `Inbound Logistics Calls`). |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Optional | Required (if SA) | Server-Only | Yes (Google Cloud) | Stringified Google Cloud service account JSON credentials with Google Sheets API scope. |
| `GOOGLE_CLIENT_SECRET_JSON` | Optional | Required (if OAuth) | Server-Only | Yes (Google Cloud) | Google OAuth client credentials JSON (used in dev/preview if service account is unavailable). |
| `GOOGLE_OAUTH_REFRESH_TOKEN` | Optional | Required (if OAuth) | Server-Only | Yes (Google Cloud) | Refresh token obtained via consent flow to authenticate Google Sheets API requests. |
| `WHATSAPP_API_KEY` | Optional | Required | Server-Only | Yes (Meta WhatsApp) | API Bearer token for Meta WhatsApp Business Cloud API. |
| `WHATSAPP_PHONE_NUMBER_ID` | Optional | Required | Server-Only | Yes (Meta WhatsApp) | Senders WhatsApp Phone Number ID registered on Meta Business Manager. |
| `WHATSAPP_TEMPLATE_NAME` | Optional | Optional | Server-Only | Yes (Meta WhatsApp) | Pre-approved WhatsApp message template name for outbound operational follow-ups. |
| `ENABLE_LIVE_TELEPHONY_TRANSFER` | Optional | Required (for SIP) | Server-Only | Yes (Telephony) | Set to `true` only when live telephony provider (Airtel/Tata/Twilio) credentials are confirmed and tested. |
| `TELEPHONY_PROVIDER_ACCOUNT_SID` | Optional | Required (if live) | Server-Only | Yes (Telephony) | Account SID for telephony provider. |
| `TELEPHONY_PROVIDER_AUTH_TOKEN` | Optional | Required (if live) | Server-Only | Yes (Telephony) | Authentication token for telephony provider. |
| `LIVE_TMS_BASE_URL` | Optional | Required (if live) | Server-Only | Yes (TMS) | REST endpoint for live logistics transport management system tracking. |
| `LIVE_TMS_API_KEY` | Optional | Required (if live) | Server-Only | Yes (TMS) | API key for authenticating with client TMS tracking system. |

---

## Health & Provider State Vocabulary

When auditing integrations or querying `/api/health`, provider states strictly follow this vocabulary:

1. **`VERIFIED`**: Provider credentials exist and an active connectivity probe has succeeded within the SLA window.
2. **`CONFIGURED_NOT_VERIFIED`**: Environment variables or database settings are populated, but live upstream handshake has not yet been executed.
3. **`UNCONFIGURED`**: Necessary keys or credentials are not present in environment or database. System fails closed.
4. **`DEGRADED`**: Upstream provider is returning errors, rate limits, or latency exceeding operational threshold.
5. **`MOCK`**: Local or test environment mock adapter is explicitly enabled. Forbidden in production.
