# LogiVoice V1 — Inbound Logistics Voice Operations Portal

LogiVoice V1 is an inbound voice AI operations portal and dispatcher interface tailored for Indian road freight, full-truckload (FTL), and 3PL carriers. It integrates voice stream telemetry with deterministic backend tools to handle freight rate quotation, shipment tracking, booking intake, human escalation routing, and post-call commercial nurturing.

---

## 1. Feature Implementation Status Matrix

In accordance with LogiVoice V1 SSOT principles, all capabilities are classified strictly into one of four states:

| Status Class | Meaning |
| :--- | :--- |
| **`IMPLEMENTED`** | Fully built, covered by automated integration tests, and ready for production operation. |
| **`CONFIGURATION-GATED`** | Code path is complete and fails closed; requires real client/provider credentials or approvals to activate live operations. |
| **`MOCK / DEMO`** | Local sandbox fixture only; strictly isolated and disabled in production. |
| **`FUTURE / NOT IN V1`** | Out of V1 scope. |

### Capability Breakdown

| Capability / Surface | Status | Notes |
| :--- | :---: | :--- |
| **Operations Dashboard (`/admin`)** | `IMPLEMENTED` | Truthful KPIs calculated in `Asia/Kolkata` timezone; actual tool execution telemetry; no synthetic mock counters. |
| **Inbound Calls & Forensic Audit (`/admin/calls`, `/[id]`)** | `IMPLEMENTED` | Transcript view, audio playback, structured extracted facts, tool execution timeline, and follow-up delivery tracking. |
| **Operations Requests & Tickets (`/admin/requests`)** | `IMPLEMENTED` | Backed by `operations_requests` table with durable database idempotency column and unique index. |
| **Commercial Leads & Nurturing (`/admin/leads`)** | `IMPLEMENTED` | Deterministic temperature classification (`HOT`, `WARM`, `COLD`, `REVIEW`). |
| **Rate Cards & Tariff Management (`/admin/rate-cards`)** | `IMPLEMENTED` | Full CRUD operations, explicit `ESTIMATE` vs `CONFIRMED` designation, and CSV preview/validation import. |
| **Operational Knowledge Base (`/admin/knowledge`)** | `IMPLEMENTED` | 6-layer context assembly retrieves approved operational rules per caller intent. |
| **Dispatcher Settings (`/admin/settings`)** | `IMPLEMENTED` | Real database persistence of tenant identity, brand names, and escalation directories. Fails safely on network error. |
| **System Status & Audit Log (`/admin/audit`)** | `IMPLEMENTED` | Masked audit event stream with PII redaction and integration health indicator. |
| **Retell Webhook HMAC-SHA256 Signature Verification** | `IMPLEMENTED` | Timing-safe raw-body cryptographic verification with registered agent ID validation. |
| **Deterministic Tool Gateway (`dispatchTool`)** | `IMPLEMENTED` | Server-side role enforcement, schema validation, and latency measurement for 8 controlled tools. |
| **Human Transfer Tool (`transfer_to_human`)** | `IMPLEMENTED` | Returns `TRANSFERRED` only with verified telephony handshake; otherwise creates durable callback ticket (`CB-XXXXX`). |
| **Google Sheets Sync (`syncCallToGoogleSheets`)** | `IMPLEMENTED` | Secondary operational view with spreadsheet formula injection sanitization (`=, +, -, @`). |
| **Post-Call Pipeline (`processPostCallPipeline`)** | `IMPLEMENTED` | Durable idempotency ledger, angry caller follow-up suppression, and database state persistence. |
| **Live Indian Telephony (SIP Trunk / PSTN)** | `CONFIGURATION-GATED` | Requires client KYC-approved telecom carrier and Retell number mapping. |
| **Meta WhatsApp Business API Integration** | `CONFIGURATION-GATED` | Requires client WhatsApp Business Account token and pre-approved templates. |
| **Google Cloud Service Account / Sheet ID** | `CONFIGURATION-GATED` | Requires client GCP credentials and designated destination Google Sheet. |
| **Live TMS / GPS Telemetry Connector** | `CONFIGURATION-GATED` | Requires client fleet management REST endpoint. Fails closed with `PROVIDER_UNAVAILABLE` in production. |
| **Automated Outbound SMS & Email** | `NOT IN V1` | V1 commercial nurturing is focused exclusively on WhatsApp. |

---

## 2. Architecture Overview

```
                                INBOUND CALL
                                     │
                                     ▼
                        [Indian Telephony / SIP Trunk]
                                     │
                                     ▼
                            [Retell Voice Agent]
                                     │
                  (Bilingual: Hindi / Hinglish / English)
                                     │
                                     ▼
                 [Deterministic Tool Gateway / API Routes]
             ┌───────────────────────┼───────────────────────┐
             ▼                       ▼                       ▼
    [Rate Card Engine]      [Tracking Lookup]      [Transfer / Callback]
     (Approved Matrix)       (Live TMS / Adapt)     (Telephony / Ticket)
             │                       │                       │
             └───────────────────────┼───────────────────────┘
                                     │
                                     ▼
                         [PostgreSQL Master Record]
                            (Hosted on Supabase)
                                     │
                         ┌───────────┴───────────┐
                         ▼                       ▼
             [Post-Call Pipeline]      [Operations Portal]
            (Durable Idempotency)      (/admin Next.js App)
                         │
             ┌───────────┴───────────┐
             ▼                       ▼
   [Google Sheets Sync]    [WhatsApp Follow-up]
   (Secondary Export)      (Suppressed on Angry)
```

---

## 3. Technology Stack

- **Framework**: Next.js 16 (App Router)
- **Frontend**: React 19, Tailwind CSS v4, Lucide React
- **Language**: TypeScript (Strict Mode)
- **Database**: PostgreSQL 15+ (Supabase)
- **Voice Platform**: Retell AI Voice Streaming SDK Contract
- **Testing**: Native TypeScript Regression, PostgreSQL DB Integration & Voice QA Suite (206 tests)

---

## 4. Local Development Setup

### Prerequisites
- Node.js 20.x or 22.x LTS
- npm 10.x+

### Step-by-Step Instructions
1. **Clone the repository**:
   ```bash
   git clone https://github.com/raja9693bth/logivoice-v1.git
   cd logivoice-v1
   ```

2. **Install dependencies**:
   ```bash
   npm ci --ignore-scripts
   ```

3. **Configure environment variables**:
   ```bash
   cp .env.example .env.local
   ```
   *(See `ENVIRONMENT.md` for detailed variable definitions)*

4. **Run the local development server**:
   ```bash
   npm run dev
   ```
   Navigate to `http://localhost:3000`.

---

## 5. Verification & Quality Gates

Run the complete verification pipeline before committing or deploying:

```bash
# 1. Static code linting
npm run lint

# 2. TypeScript typecheck
npm run typecheck

# 3. Unit, integration & Voice QA tests
npm test

# 4. Real PostgreSQL database integration suite
DATABASE_URL=postgresql://postgres@127.0.0.1:5433/postgres npm run test:integration

# 5. Test coverage generation (LCOV)
npm run test:coverage

# 6. Production standalone build
npm run build
```

---

## 6. Authoritative Documentation Set

- [ENVIRONMENT.md](file:///./ENVIRONMENT.md): Environment variable contract and health states.
- [IMPLEMENTATION_STATUS.md](file:///./IMPLEMENTATION_STATUS.md): Complete feature-by-feature status breakdown.
- [GO_LIVE_BLOCKERS.md](file:///./GO_LIVE_BLOCKERS.md): Remaining client/provider approvals before DNS cutover.
- [SECURITY_NOTES.md](file:///./SECURITY_NOTES.md): Credential hygiene, HMAC verification, and formula injection mitigations.
- [TEST_REPORT.md](file:///./TEST_REPORT.md): 206 passed automated test cases, PostgreSQL integration suite, and 32 voice QA scenarios.
- [RUNBOOK.md](file:///./RUNBOOK.md): SRE deployment guide, liveness probes, and rollback procedures.
- [MIGRATION_NOTES.md](file:///./MIGRATION_NOTES.md): Database schema updates, idempotency constraints, and RLS architecture.
