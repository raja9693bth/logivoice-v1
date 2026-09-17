/**
 * LOGIVOICE V1 — GOOGLE SHEETS OPERATIONAL VIEW SYNC
 * Secondary operational synchronization layer. Supabase remains master record.
 * Handles duplicate prevention, safe auth, and deterministic mock adapter when unconfigured.
 *
 * Configured Spreadsheet:
 * ID: 1bvfGYB8btM_Ce7QWTg7JdLVEKl4yJSX0goocyTzLADE
 */

import { Call, Lead } from '@/types/logivoice';

export const DEFAULT_SPREADSHEET_ID = '1bvfGYB8btM_Ce7QWTg7JdLVEKl4yJSX0goocyTzLADE';

export interface SheetRowData {
  date: string;
  call_id: string;
  customer: string;
  phone: string;
  company: string;
  intent: string;
  origin: string;
  destination: string;
  weight: string;
  vehicle: string;
  quote: string;
  quote_type: string;
  tracking_ref: string;
  lead_status: string;
  lead_temp: string;
  summary: string;
  escalated: string;
  next_action: string;
  assigned_to: string;
}

export interface SheetSyncResult {
  synced: boolean;
  status: 'SYNCED' | 'SKIPPED' | 'MOCK_SYNCED' | 'FAILED' | 'UNCONFIGURED';
  spreadsheet_id?: string;
  row_index?: number;
  provider: string;
  error?: string;
}

// In-memory set of synced call IDs to prevent duplicate row append
const syncedCallIds = new Set<string>();

export function resetSheetsSyncIdempotency(): void {
  syncedCallIds.clear();
}

/**
 * Exchanges OAuth refresh token for a short-lived Google Sheets API access token.
 */
async function getGoogleAccessToken(): Promise<string | null> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    return null;
  }

  try {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.warn('[GoogleSheets] Token exchange failed:', res.status, errText);
      return null;
    }

    const data = await res.json();
    return data.access_token || null;
  } catch (err) {
    console.warn('[GoogleSheets] Token request exception:', err);
    return null;
  }
}

export async function syncCallToGoogleSheets(
  call: Call,
  lead?: Lead | null
): Promise<SheetSyncResult> {
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID || DEFAULT_SPREADSHEET_ID;

  // Format row columns strictly according to SSOT 03_STRUCTURED_DATA_MODEL line 214
  const rowData: SheetRowData = {
    date: new Date(call.started_at).toLocaleDateString('en-IN'),
    call_id: call.external_call_id,
    customer: call.customer?.name || 'Inbound Caller',
    phone: call.customer?.phone || '',
    company: call.customer?.company || '',
    intent: call.primary_intent,
    origin: call.facts?.route_from || '',
    destination: call.facts?.route_to || '',
    weight: call.facts?.weight || '',
    vehicle: call.facts?.vehicle_type || '',
    quote: call.facts?.quoted_amount ? `₹${call.facts.quoted_amount}` : '',
    quote_type: call.facts?.quote_type || '',
    tracking_ref: call.facts?.tracking_id || '',
    lead_status: lead?.status || 'NEW',
    lead_temp: call.lead_temperature,
    summary: call.summary || '',
    escalated: call.escalation_status?.is_escalated ? 'YES' : 'NO',
    next_action: lead?.next_action || 'Review outcome',
    assigned_to: lead?.assigned_to || 'Primary Dispatcher',
  };

  // Idempotency: skip if already synced in current runtime
  if (syncedCallIds.has(call.external_call_id)) {
    return {
      synced: true,
      status: 'SKIPPED',
      provider: 'IDEMPOTENCY_GUARD',
      spreadsheet_id: spreadsheetId,
    };
  }

  // 1. Live Google Sheets REST API integration (Requires OAuth credentials)
  const hasCredentials = Boolean(
    process.env.GOOGLE_CLIENT_ID &&
    process.env.GOOGLE_CLIENT_SECRET &&
    process.env.GOOGLE_REFRESH_TOKEN
  );

  if (hasCredentials) {
    try {
      const accessToken = await getGoogleAccessToken();
      if (!accessToken) {
        return {
          synced: false,
          status: 'FAILED',
          provider: 'GOOGLE_SHEETS_API_V4',
          error: 'Failed to obtain Google Sheets access token from refresh token',
        };
      }

      const appendRes = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Sheet1!A1:append?valueInputOption=USER_ENTERED`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            values: [
              [
                rowData.date,
                rowData.call_id,
                rowData.customer,
                rowData.phone,
                rowData.company,
                rowData.intent,
                rowData.origin,
                rowData.destination,
                rowData.weight,
                rowData.vehicle,
                rowData.quote,
                rowData.quote_type,
                rowData.tracking_ref,
                rowData.lead_status,
                rowData.lead_temp,
                rowData.summary,
                rowData.escalated,
                rowData.next_action,
                rowData.assigned_to,
              ],
            ],
          }),
          signal: AbortSignal.timeout(10000),
        }
      );

      if (!appendRes.ok) {
        const errText = await appendRes.text();
        return {
          synced: false,
          status: 'FAILED',
          provider: 'GOOGLE_SHEETS_API_V4',
          error: `Google Sheets API error HTTP ${appendRes.status}: ${errText}`,
        };
      }

      syncedCallIds.add(call.external_call_id);
      return {
        synced: true,
        status: 'SYNCED',
        spreadsheet_id: spreadsheetId,
        provider: 'GOOGLE_SHEETS_API_V4',
      };
    } catch (err) {
      return {
        synced: false,
        status: 'FAILED',
        provider: 'GOOGLE_SHEETS_API_V4',
        error: err instanceof Error ? err.message : 'Google Sheets API network error',
      };
    }
  }

  // 2. Unconfigured credentials check (Production fail closed)
  if (process.env.NODE_ENV === 'production' || process.env.ENABLE_MOCK_INTEGRATIONS !== 'true') {
    return {
      synced: false,
      status: 'UNCONFIGURED',
      provider: 'GOOGLE_SHEETS_API_V4',
      error: 'Google Sheets OAuth credentials not configured in environment. Master record preserved in Supabase.',
    };
  }

  // 3. Explicit Mock Sync for non-production development/testing only
  syncedCallIds.add(call.external_call_id);
  return {
    synced: true,
    status: 'MOCK_SYNCED',
    spreadsheet_id: spreadsheetId,
    provider: 'DETERMINISTIC_MOCK_SHEETS_ADAPTER',
  };
}
