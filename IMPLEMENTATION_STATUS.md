# LogiVoice V1 — Implementation Status & Feature Matrix

> **Authoritative Specification**: SSOT V1.2 & Client Delivery Master Prompt  
> **Status Classifications**: `DONE` | `CONFIGURATION-GATED` | `NOT APPLICABLE`  
> *(No ambiguous "partially done" or "mostly done" statuses are permitted)*

---

## 1. Core Voice Operations & Retell Gateway

| Feature / Requirement | Status | Verification & Operational Contract |
| :--- | :---: | :--- |
| **Retell Webhook Raw Body HMAC-SHA256 Verification** | `DONE` | `lib/auth/context.ts` preserves raw byte payload and verifies signature with timing-safe HMAC equality. |
| **Voice Agent ID Validation & Mismatched Agent Rejection** | `DONE` | Validates agent ID against configured tenant agent; rejects unmapped agents in production. |
| **Retell Lifecycle State Machine (`call_started`, `call_ended`, `call_analyzed`)** | `DONE` | `app/api/retell/webhook/route.ts` creates call shell on start, updates duration on end, and triggers post-call pipeline on final analysis. |
| **Deterministic Tool Gateway (`dispatchTool`)** | `DONE` | `lib/tools/gateway.ts` handles all 8 controlled tools with Zod schema validation, latency measurement, and audit event persistence. |
| **Dynamic Voice Context Assembly (`assembleVoiceRuntimeContext`)** | `DONE` | Layered context prompt with business hours, operational hubs, tariff matrix grounding, and code-governed guardrails. |
| **Bilingual / Hinglish Prompt Rules** | `DONE` | Strict system instructions to mirror caller's language (Hindi, Hinglish, Indian English) concisely within 1–2 sentences. |
| **Live Indian Telephony (SIP Trunk / PSTN)** | `CONFIGURATION-GATED` | Requires client KYC-approved telecom provider and Retell inbound number mapping. |

---

## 2. Controlled Domain Tools

| Tool Name | Status | Operational Behavior |
| :--- | :---: | :--- |
| `lookup_customer` | `DONE` | Normalizes phone to E.164, performs exact tenant-scoped lookup, returns `FOUND` or `NOT_FOUND`. Never leaks cross-tenant data. |
| `get_rate_quote` | `DONE` | Deterministic lookup in approved active rate cards with vehicle and weight range matching. Distinguishes `ESTIMATE` from `CONFIRMED`. Fails closed if missing fields or corridor unavailable. |
| `get_tracking_status` | `DONE` | Validates tracking reference (LR/docket). Returns verified location and status. In production, mock TMS records fail closed with `PROVIDER_UNAVAILABLE`. |
| `create_booking_request` | `DONE` | Creates booking request with deterministic idempotency key. Sets status to `REQUEST_CREATED` if confirmed or `PENDING_HUMAN_CONFIRMATION` if unconfirmed. Links customer and lead. |
| `create_support_ticket` | `DONE` | Creates support ticket with priority (`HIGH`, `MEDIUM`, `URGENT`) and tracking reference. Links call context. |
| `transfer_to_human` | `DONE` | Returns `TRANSFERRED` only if live telephony provider confirms the transfer. Otherwise creates a durable callback request (`CB-XXXXX`) and returns `CALLBACK_SCHEDULED`. |
| `save_call_outcome` | `DONE` | Persists structured call facts, intent, outcome, and lead temperature to database. |
| `send_followup` | `DONE` | Enforces eligibility rules. In production, unconfigured channels return `UNCONFIGURED` without synthetic success. |

---

## 3. Database, Migrations & Idempotency

| Feature / Requirement | Status | Operational Contract |
| :--- | :---: | :--- |
| **`logAuditEvent` Fallthrough Bug Fix** | `DONE` | Fixed in `lib/db/index.ts`. Successful live database insert returns valid `AuditEvent` without falling through to fallback logic. |
| **Call Lifecycle Full Field Persistence** | `DONE` | `updateCall` persists ended_at, duration, intent, outcome, summary, sentiment, lead_temperature, facts, and recording_url. |
| **Tenant-Scoped External Call Uniqueness** | `DONE` | Migration `20260919000000_drop_obsolete_global_call_unique.sql` removes obsolete global constraint and enforces `UNIQUE(tenant_id, external_call_id)`. |
| **Durable Database Idempotency Key Column** | `DONE` | `operations_requests.idempotency_key` backed by unique index `idx_ops_requests_idempotency`. Atomic conflict handling. |
| **Normalized E.164 Phone Identity** | `DONE` | Phone numbers normalized deterministically (+91 format). Removed ambiguous suffix/ILIKE matching. |
| **Row Level Security (RLS) Strategy** | `DONE` | Authenticated server API model using controlled service credentials; direct client access strictly blocked. |

---

## 4. Post-Call Pipeline & Integrations

| Integration / Subsystem | Status | Operational Contract |
| :--- | :---: | :--- |
| **Durable Post-Call Idempotency Ledger** | `DONE` | `lib/pipeline/post-call.ts` tracks processed call IDs across retries and restarts. |
| **Google Sheets Operational Sync** | `DONE` | Secondary operational view. Supabase is authoritative. Cell escaping (`sanitizeSheetCell`) prevents formula injection (`=, +, -, @`). |
| **Google Sheets Credentials** | `CONFIGURATION-GATED` | Requires client-supplied service account JSON or OAuth refresh token and spreadsheet ID. |
| **WhatsApp Nurturing & Follow-up** | `DONE` | Deterministic eligibility check. Escalated or angry calls automatically suppressed (`SUPPRESSED`). |
| **Meta WhatsApp Business API Provider** | `CONFIGURATION-GATED` | Requires client WhatsApp Business Account token and registered template. |
| **SMS & Email Channels** | `NOT APPLICABLE` | Not part of LogiVoice V1 core scope (WhatsApp is primary V1 channel). Explicitly returns `UNCONFIGURED`. |

---

## 5. Operations Portal & Dashboard

| Portal Feature | Status | Operational Contract |
| :--- | :---: | :--- |
| **Truthful Timezone-Aware KPIs** | `DONE` | `calls_today` calculated in `Asia/Kolkata` timezone. Tool latency and success rate derived from real tool execution telemetry. |
| **Server-Enforced RBAC & Tenant Scoping** | `DONE` | Protected API routes verify Supabase session and user role (`DISPATCHER`, `OPS_MANAGER`, `ADMIN`). |
| **Rate Cards Administration & CSV Import** | `DONE` | Full rate card management UI with quote type, confirmability toggle, and truthful file import. |
| **Call Detail & Forensic Timeline** | `DONE` | Transcript, audio player, structured facts, tool execution timeline, and follow-up status wired to real database data. |
| **System Status & Audit Log Viewer** | `DONE` | Real-time health metrics, provider status indicators, and masked audit event stream. |
| **Responsive Bento UI & WCAG Accessibility** | `DONE` | Semantic HTML, keyboard navigation, aria labels, focus trap on dialogs, and viewport user-scalable enabled. |
| **Security Headers & CSP** | `DONE` | `next.config.ts` enforces modern Content-Security-Policy, HSTS, frame-ancestors, and X-Content-Type-Options. Disables noindex for admin portal. |
