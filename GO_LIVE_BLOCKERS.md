# LogiVoice V1 — Production Go-Live External Blockers

> **Document Status**: Production Readiness Gate  
> **Target Version**: V1.0.2  
> **Engineering Scope**: COMPLETE (100%). All application code, schema migrations, provider fail-closed boundaries, webhooks, and retry pipelines are fully implemented and verified.  
> **Verdict**: **CLIENT DELIVERY READY — PHONE NUMBER PROCUREMENT PENDING**

---

## 1. Authoritative Remaining External Blocker

The owner has explicitly designated that the real production telephony phone number / DID has not yet been purchased. In accordance with the **LogiVoice V1 Client-Production Completion Directive**, this is the **ONLY** remaining external item before live voice traffic begins.

| # | Item Name | Provider / Authority | Where to Configure | Activation Requirement |
| :- | :--- | :--- | :--- | :--- |
| **B-01** | **Production Phone Number / DID Procurement & Binding** | Indian Telephony / PSTN Provider (Airtel, Tata Tele, Jio, or Twilio) & Retell AI | Retell Dashboard (`Inbound Number Mapping`) & Telephony Config (`TELEPHONY_PROVIDER_PHONE_NUMBER` / `TWILIO_PHONE_NUMBER`) | Procure live E.164 phone number, bind to Retell Agent, configure webhook URLs, run connectivity smoke test, and enable live traffic. **Zero additional application coding required.** |

---

## 2. Configuration-Gated Integrations (Code 100% Ready)

All external integrations are fully implemented in application code and operate in a strict, fail-closed `CONFIGURATION_GATED` / `UNCONFIGURED` posture until live credentials are provided in production:

| Integration | Code Status | Runtime Behavior When Unconfigured | Production Variable(s) |
| :--- | :---: | :--- | :--- |
| **Retell AI Voice Gateway** | `READY` | Fails closed: rejects unmapped agents & invalid signatures (HTTP 401/403). | `RETELL_API_KEY`, `RETELL_AGENT_ID`, `RETELL_TOOL_SECRET` |
| **Telephony Transfer & Webhooks** | `READY` | Generates official TwiML `<Dial action="/api/webhooks/twilio/transfer">`. Unverified transfers fall back to durable `CB-XXXXX` callback tickets. | `ENABLE_LIVE_TELEPHONY_TRANSFER`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TELEPHONY_PROVIDER_PHONE_NUMBER` |
| **Meta WhatsApp Business API** | `READY` | Records `UNCONFIGURED` without mock leakage. Persists provider message ID on acceptance, handles delivery webhook at `/api/webhooks/whatsapp`, and reconciles unknown claims. | `WHATSAPP_API_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_WEBHOOK_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET` |
| **Google Sheets Operational Sync** | `READY` | Records `UNCONFIGURED` if disabled. Persists immutable target metadata; reconciles uncertain appends against original target tab with deterministic call IDs. Formula injection neutralized. | `GOOGLE_SHEETS_SPREADSHEET_ID`, `GOOGLE_SHEETS_WORKSHEET_NAME`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN` |
| **Retry Worker Cron Scheduler** | `READY` | Secured via `Authorization: Bearer ${CRON_SECRET}`. Returns HTTP 503 if secret missing in production. Reconciles unknown claims and retries eligible side-effects. | `CRON_SECRET` |

---

## 3. Final Operator Activation Checklist for Phone Number

Once the client/owner purchases the live production phone number, follow this step-by-step checklist to activate live call traffic. **No code changes or rebuilds are necessary:**

1. **Procure Phone Number / Indian DID**:
   - Purchase national or local Indian 10-digit / E.164 DID or SIP trunk via telecom carrier or Twilio.
2. **Bind Number in Retell AI**:
   - In Retell Dashboard > Phone Numbers, click **Import Phone Number** or bind the SIP trunk.
   - Associate the phone number with the production Retell Agent (`RETELL_AGENT_ID`).
3. **Configure Telephony & Webhook Endpoints**:
   - Set Inbound Webhook URL in Retell: `https://<PRODUCTION_DOMAIN>/api/retell/webhook`
   - Set Twilio Voice URL (if utilizing Twilio gateway): `https://<PRODUCTION_DOMAIN>/api/retell/webhook`
   - Set Twilio Transfer Status Callback: `https://<PRODUCTION_DOMAIN>/api/webhooks/twilio/transfer`
   - Set Meta WhatsApp Status Callback: `https://<PRODUCTION_DOMAIN>/api/webhooks/whatsapp`
4. **Set Production Environment Variables**:
   - Set `TELEPHONY_PROVIDER_PHONE_NUMBER` (or `TWILIO_PHONE_NUMBER`) to the E.164 formatted number.
   - Set `ENABLE_LIVE_TELEPHONY_TRANSFER=true` in production environment settings.
5. **Execute Inbound Connectivity Smoke Call**:
   - Dial the procured phone number from an Indian mobile phone.
   - Confirm agent answers in bilingual/Hinglish persona within 2 rings.
   - Verify call session is created in PostgreSQL with unique call ID.
6. **Verify Transfer & Callback Webhook**:
   - Request live dispatcher escalation during test call.
   - Verify provider fires `/api/webhooks/twilio/transfer`.
   - Confirm call status updates to `TRANSFERRED` (if answered) or creates high-priority `CB-XXXXX` request (if busy/no-answer).
7. **Enable Full Live Operations**:
   - Announce number to clients/dispatchers for live logistics operations.
