# LogiVoice V1 — Production Go-Live External Blockers

> **Document Status**: Production Readiness Gate  
> **Target Version**: V1.0.2  
> **Engineering Scope**: COMPLETE. All engineering-controlled items, fail-closed handlers, database idempotency, rate resolution, PostgreSQL migrations, and security gates are implemented. Only genuine human, client, or external regulatory approvals/credentials remain.

---

## Authoritative External Blockers Matrix

| # | Exact Missing Item | Required Provider / Authority | Where to Configure | Verification & Test Procedure Upon Provisioning |
| :- | :--- | :--- | :--- | :--- |
| **B-01** | **Client Legal & Brand Name Formal Approval** | Client Operations / Executive Leadership | `client_configs.business_name`, `client_configs.brand_name`, `lib/config/tenant.ts` | Verify voice prompt and WhatsApp follow-up messages dynamically reflect approved brand name without fallback. |
| **B-02** | **Production Tariff Matrix / Authoritative Rate Cards** | Client Commercial / Pricing Desk | Admin Portal `/admin/rate-cards` or CSV Import | Dispatch `get_rate_quote` for key commercial lanes (e.g., Delhi-Mumbai, Pune-Hyderabad) and verify exact rate retrieval with appropriate `ESTIMATE` vs `CONFIRMED` designation. |
| **B-03** | **Live Indian Telephony (SIP Trunk / PSTN Number & KYC Approval)** | Indian Telephony Provider (Airtel / Tata Tele / Jio) & Retell AI | Retell AI Dashboard (`Inbound Number Mapping`) & `app/api/retell/webhook/route.ts` | Place live inbound PSTN test call from Indian mobile number; confirm Retell voice agent answers within 2 rings and logs valid webhook event. |
| **B-04** | **Human Escalation Phone Numbers & Primary Dispatch Directory** | Client Operations Team | `client_configs.escalation_contacts` or Admin Settings `/admin/settings` | Trigger human transfer via `transfer_to_human` with intent `HUMAN_REQUEST`; verify SIP transfer rings designated operational phone number. |
| **B-05** | **Authoritative TMS Ingestion Feed / Connector Integration** | Client TMS / Dispatch System | Ingestion pipeline into `public.tracking_records` table | Feed live consignment status and GPS checkpoint into `tracking_records`; verify voice lookup `get_tracking_status` returns verified location and ETA. |
| **B-06** | **Meta WhatsApp Business API Production Account & Approved Templates** | Meta Business Manager / WhatsApp Cloud API | `WHATSAPP_API_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` in production environment | Trigger post-call pipeline with quote inquiry; verify WhatsApp message arrives on test phone and records `SENT` with provider message ID. |
| **B-07** | **Google Cloud OAuth Production Client & Dedicated Sheet ID** | Client IT / GCP Administrator | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`, `GOOGLE_SHEETS_SPREADSHEET_ID` | Complete test call and verify structured row appears in designated production Google Sheet worksheet within 5 seconds without formula injection. |
| **B-08** | **Approved Call Recording & AI Voice Disclosure Script** | Client Legal / Compliance Department | `client_configs.greeting_text`, `lib/voice/context-assembler.ts` | Place test call and verify agent initial greeting includes legally compliant AI identity and call recording disclosure. |
| **B-09** | **Data Retention & PII Masking Regulatory Policy** | Client Data Protection Officer | `client_configs.retention_days`, cron maintenance script | Verify audit logs and call records honor agreed retention windows and customer phone numbers remain masked in logs. |
| **B-10** | **Shared Development Credential Rotation** | GCP Console Admin, Retell Admin, Supabase Owner | Respective cloud provider consoles | Perform manual secret rotation on any credentials touched in shared development environments before production DNS cutover. |

---

## Zero Synthetic Simulation Policy
In accordance with LogiVoice V1 SSOT, whenever any of the external dependencies above is unconfigured:
- The system **fails closed**.
- Live operations will **never simulate** fake WhatsApp delivery, fake live tracking data, or fake SIP transfers.
- Calls needing human escalation fall back to a durable, idempotent callback ticket (`CB-XXXXX`) logged directly into Supabase.
