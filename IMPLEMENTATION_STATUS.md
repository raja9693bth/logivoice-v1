# LogiVoice V1 — Implementation Status & Feature Matrix

> **Authoritative Specification**: SSOT V1.2 & Client Delivery Master Prompt  
> **Status Classifications**: `DONE` | `CONFIGURATION-GATED` | `NOT APPLICABLE`  
> *(No ambiguous "partially done" or "mostly done" statuses are permitted)*

---

## 1. Core Voice Operations & Retell Gateway

| Feature / Requirement | Status | Verification & Operational Contract |
| :--- | :---: | :--- |
| **Retell Webhook Raw Body HMAC-SHA256 Verification** | `DONE` | `lib/auth/context.ts` preserves raw byte payload and verifies signature using official `retell-sdk` (`v=<timestamp>,d=<digest>` with replay attack timeout) with legacy hex fallback strictly gated behind `RETELL_ALLOW_LEGACY_SIGNATURE=true` (default false). |
| **Voice Agent ID Validation & Fail-Closed Rejection** | `DONE` | Production requires valid configured agent mapping; unknown or missing agents fail closed and are rejected. Unknown agents are never defaulted into `DEFAULT_TENANT_ID`. |
| **Retell Lifecycle State Machine (`call_started`, `call_ended`, `call_analyzed`)** | `DONE` | `app/api/retell/webhook/route.ts` creates call shell on start, updates duration and basic provider facts on end, and triggers the authoritative post-call side-effect pipeline exactly once on `call_analyzed`. |
| **Deterministic Tool Gateway (`dispatchTool`)** | `DONE` | `lib/tools/gateway.ts` handles all controlled tools with Zod schema validation, actor role preservation, audit PII masking, latency telemetry, and safe error masking. |
| **Dynamic Voice Context Assembly (`assembleVoiceRuntimeContext`)** | `DONE` | Layered context prompt with business hours, operational hubs, tariff matrix grounding, and code-governed guardrails. |
| **Bilingual / Hinglish Prompt Rules** | `DONE` | Strict system instructions to mirror caller's language (Hindi, Hinglish, Indian English) concisely within 1–2 sentences. |
| **Live Indian Telephony (SIP Trunk / PSTN)** | `CONFIGURATION-GATED` | Requires client KYC-approved telecom provider and Retell inbound number mapping. |

---

## 2. Controlled Domain Tools

| Tool Name | Status | Operational Behavior |
| :--- | :---: | :--- |
| `lookup_customer` | `DONE` | Normalizes phone to E.164, performs exact tenant-scoped lookup, returns `FOUND` or `NOT_FOUND`. Never leaks cross-tenant data. |
| `get_rate_quote` | `DONE` | Evaluates approved active rate cards with vehicle and weight interval matching. Missing commercial discriminators return `MISSING_FIELDS`. Ambiguous cards return `UNAVAILABLE`. Distinguishes `ESTIMATE` from `CONFIRMED`. |
| `get_tracking_status` | `DONE` | Validates tracking reference (LR/docket). Verifies caller customer ownership before disclosing details. Formats verified ETA with date, time, and timezone. In production, mock TMS records fail closed as `PROVIDER_UNAVAILABLE`. |
| `create_booking_request` | `DONE` | Creates booking request with deterministic idempotency key. Sets status to `REQUEST_CREATED` if confirmed or `PENDING_HUMAN_CONFIRMATION` if unconfirmed. Links customer and lead. |
| `create_support_ticket` | `DONE` | Creates support ticket with priority (`HIGH`, `MEDIUM`, `URGENT`) and tracking reference. Links call context. |
| `transfer_to_human` | `DONE` | Returns `TRANSFERRED` only when an actual telephony provider transfer operation is invoked over the network and confirmed by the provider. Otherwise falls back to durable callback `CB-XXXXX` and returns `CALLBACK_SCHEDULED`. |
| `save_call_outcome` | `DONE` | Persists structured call facts, intent, outcome, and deterministic lead temperature to database. |
| `send_followup` | `DONE` | Pre-approved template policy with verified structured values. Claims durable DB lock before send. Suppresses angry or escalated calls. |

---

## 3. Database, Migrations & Idempotency

| Feature / Requirement | Status | Operational Contract |
| :--- | :---: | :--- |
| **Forward-Safe Schema Migration** | `DONE` | Migration `20260920000000_integrity_hardening.sql` synchronizes `client_configs` columns, creates `side_effect_claims`, `customer_suppressions`, and `phone_normalized` on `customers`. |
| **Canonical Phone Normalization** | `DONE` | Storage-level `phone_normalized` column on `customers` with unique index `(tenant_id, phone_normalized)`. Suffix/ILIKE matching removed. |
| **Durable Side-Effect Claims Outbox** | `DONE` | `side_effect_claims` table handles atomic claim-before-execute pattern for post-call processing, Sheets sync, and messaging. Eliminates in-memory race conditions. |
| **Durable Phone Suppression** | `DONE` | Authoritative `customer_suppressions` table tracks opted-out numbers. Sample opt-out numbers are not hardcoded. |
| **Durable Knowledge Base Draft Default** | `DONE` | `knowledge_items` default changed to `DRAFT` in SQL and application schemas. Explicit admin approval required for voice prompt consumption. |
| **Row Level Security (RLS) Strategy** | `DONE` | Authenticated server API model using controlled service credentials; direct client access strictly blocked. |

---

## 4. Post-Call Pipeline & Integrations

| Integration / Subsystem | Status | Operational Contract |
| :--- | :---: | :--- |
| **Durable Post-Call Idempotency** | `DONE` | `lib/pipeline/post-call.ts` uses `side_effect_claims` table with atomic claim locks, stale claim recovery, and deduplication. |
| **Google Sheets Operational Sync** | `DONE` | Durable claim-before-append. Uses explicit configured spreadsheet ID and worksheet name. Validates worksheet existence. Neutralizes formula injection (`=, +, -, @`). |
| **Google Sheets Credentials** | `CONFIGURATION-GATED` | Requires client-supplied service account JSON or OAuth refresh token and spreadsheet ID. |
| **WhatsApp Nurturing & Follow-up** | `DONE` | Pre-approved templates with verified fields. Claims send record before external dispatch. Escalated or angry calls automatically suppressed (`SUPPRESSED`). |
| **Meta WhatsApp Business API Provider** | `CONFIGURATION-GATED` | Requires client WhatsApp Business Account token and registered template. |
| **SMS & Email Channels** | `NOT APPLICABLE` | WhatsApp is primary V1 channel. Unconfigured channels return `UNCONFIGURED`. |

---

## 5. Operations Portal & Dashboard

| Portal Feature | Status | Operational Contract |
| :--- | :---: | :--- |
| **Authoritative Timezone-Aware KPIs** | `DONE` | `calls_today` calculated in `Asia/Kolkata` timezone. Tool latency and success rate derived from real tool execution telemetry. |
| **Server-Enforced RBAC & Tenant Scoping** | `DONE` | Protected API routes verify Supabase session and user role (`DISPATCHER`, `OPS_MANAGER`, `ADMIN`). |
| **Rate Cards Administration & RFC4180 CSV Import** | `DONE` | Full rate card management UI with RFC4180-compliant CSV parser, server-side duplicate/overlap detection, explicit conflict policies (`SKIP`, `REPLACE`, `VERSION`, `REJECT`), and transactional audit logging. Client does not send `source_version`. |
| **Call Detail & Forensic Timeline** | `DONE` | Transcript with deterministic segment IDs, structured facts, tool execution timeline, and follow-up status wired to real database data. |
| **Conditional Demo Banner** | `DONE` | Demo banner rendered only when `NEXT_PUBLIC_DEMO_MODE === 'true'`. Never appears in production builds. |
| **Dialog & Drawer Accessibility** | `DONE` | Shared Drawer and CSV Import Modal provide proper dialog semantics (`role="dialog"`, `aria-modal="true"`, focus trap, Escape key dismiss, focus restoration). |
| **Security Headers & CSP** | `DONE` | `next.config.ts` enforces modern Content-Security-Policy without `unsafe-eval` in production, HSTS, `frame-ancestors 'none'`, and X-Content-Type-Options. |
