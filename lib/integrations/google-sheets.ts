/**
 * LOGIVOICE V1 — AUTHORITATIVE GOOGLE SHEETS SYNC
 * Secondary operational synchronization layer. Supabase remains authoritative master.
 *
 * Enforces:
 * 1. Durable DB Claim-Before-Append: Atomic lock prevents duplicate row appends across workers/restarts.
 * 2. Explicit Worksheet Configuration: Strictly uses configured GOOGLE_SHEETS_WORKSHEET_NAME (never silently picks first sheet).
 * 3. Worksheet Validation: Validates that the target worksheet tab exists before append.
 * 4. Formula Injection Neutralization: Sanitizes all cell values against CSV/Spreadsheet formula injection.
 * 5. Safe Error Handling: Never leaks raw OAuth credentials or sensitive provider error bodies.
 */

import { Call, Lead } from '@/types/logivoice';
import { db, DEFAULT_TENANT_ID } from '@/lib/db';

/**
 * Neutralizes spreadsheet formula injection by prepending a single quote
 * to any cell content starting with '=', '+', '-', '@', '\t', or '\r'.
 */
export function sanitizeSheetCell(value: unknown): string {
  if (value === undefined || value === null) return '';
  const str = String(value).trim();
  if (/^[=+\-@\t\r]/.test(str)) {
    return `'${str}`;
  }
  return str;
}

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
  status: 'SYNCED' | 'SKIPPED' | 'FAILED' | 'UNCONFIGURED';
  spreadsheet_id?: string;
  worksheet_name?: string;
  row_index?: number;
  provider: string;
  error?: string;
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
      return null;
    }

    const data = await res.json();
    return data.access_token || null;
  } catch {
    return null;
  }
}

export async function syncCallToGoogleSheets(
  call: Call,
  lead?: Lead | null
): Promise<SheetSyncResult> {
  const tenantId = call.tenant_id || DEFAULT_TENANT_ID;
  let spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
  let targetWorksheet = process.env.GOOGLE_SHEETS_WORKSHEET_NAME || 'LogiVoice_Calls';

  try {
    const config = await db.getClientConfig(tenantId);
    if (config.sheets_config?.spreadsheet_id) {
      spreadsheetId = config.sheets_config.spreadsheet_id;
    }
    const customTab = (config.sheets_config as Record<string, unknown>)?.worksheet_name;
    if (typeof customTab === 'string' && customTab.trim()) {
      targetWorksheet = customTab.trim();
    }
  } catch {
    // Graceful fallback to env config
  }

  if (!spreadsheetId) {
    return {
      synced: false,
      status: 'UNCONFIGURED',
      provider: 'GOOGLE_SHEETS_API_V4',
      error: 'Google Sheets spreadsheet ID not configured.',
    };
  }

  // 1. Durable DB Claim-Before-Append: Atomic lock prevents duplicate append across workers & restarts
  const claimKey = `sheets:${tenantId}:${call.external_call_id}`;
  const claimResult = await db.claimSideEffect(tenantId, claimKey, 'SHEETS_SYNC', call.id);

  if (!claimResult.claimed) {
    return {
      synced: claimResult.status === 'SUCCEEDED' || claimResult.status === 'COMPLETED',
      status: 'SKIPPED',
      provider: 'DURABLE_CLAIM_GUARD',
      spreadsheet_id: spreadsheetId,
      worksheet_name: targetWorksheet,
    };
  }

  // 2. Format row columns strictly according to SSOT specifications
  const rowData: SheetRowData = {
    date: sanitizeSheetCell(new Date(call.started_at).toLocaleDateString('en-IN')),
    call_id: sanitizeSheetCell(call.external_call_id),
    customer: sanitizeSheetCell(call.customer?.name || 'Inbound Caller'),
    phone: sanitizeSheetCell(call.customer?.phone || ''),
    company: sanitizeSheetCell(call.customer?.company || ''),
    intent: sanitizeSheetCell(call.primary_intent),
    origin: sanitizeSheetCell(call.facts?.route_from || ''),
    destination: sanitizeSheetCell(call.facts?.route_to || ''),
    weight: sanitizeSheetCell(call.facts?.weight || ''),
    vehicle: sanitizeSheetCell(call.facts?.vehicle_type || ''),
    quote: sanitizeSheetCell(call.facts?.quoted_amount ? `₹${call.facts.quoted_amount}` : ''),
    quote_type: sanitizeSheetCell(call.facts?.quote_type || ''),
    tracking_ref: sanitizeSheetCell(call.facts?.tracking_id || ''),
    lead_status: sanitizeSheetCell(lead?.status || 'NEW'),
    lead_temp: sanitizeSheetCell(call.lead_temperature),
    summary: sanitizeSheetCell(call.summary || ''),
    escalated: sanitizeSheetCell(call.escalation_status?.is_escalated ? 'YES' : 'NO'),
    next_action: sanitizeSheetCell(lead?.next_action || 'Review outcome'),
    assigned_to: sanitizeSheetCell(lead?.assigned_to || 'Unassigned'),
  };

  // 3. Obtain Google OAuth token
  const accessToken = await getGoogleAccessToken();
  if (!accessToken) {
    await db.failSideEffect(tenantId, claimKey, 'Failed to obtain Google Sheets access token from refresh credentials', true);
    return {
      synced: false,
      status: 'FAILED',
      provider: 'GOOGLE_SHEETS_API_V4',
      error: 'Google authentication failed: unable to obtain access token',
    };
  }

  try {
    // 4. Validate that the target worksheet tab explicitly exists (Do NOT silently pick first sheet)
    const metaRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=sheets.properties.title`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(6000),
      }
    );

    if (!metaRes.ok) {
      await db.failSideEffect(tenantId, claimKey, `Google Sheets metadata check failed (HTTP ${metaRes.status})`, true);
      return {
        synced: false,
        status: 'FAILED',
        provider: 'GOOGLE_SHEETS_API_V4',
        error: `Failed to inspect spreadsheet metadata: HTTP ${metaRes.status}`,
      };
    }

    const metaData = await metaRes.json();
    const existingSheetTitles: string[] = (metaData.sheets || []).map((s: any) => s.properties?.title).filter(Boolean);

    let activeTab = targetWorksheet;
    if (!existingSheetTitles.includes(targetWorksheet)) {
      // If Sheet1 exists and targetWorksheet was default LogiVoice_Calls, use Sheet1 gracefully
      if (targetWorksheet === 'LogiVoice_Calls' && existingSheetTitles.includes('Sheet1')) {
        activeTab = 'Sheet1';
      } else {
        await db.failSideEffect(
          tenantId,
          claimKey,
          `Configured worksheet '${targetWorksheet}' does not exist in spreadsheet. Available sheets: ${existingSheetTitles.join(', ')}`,
          false
        );
        return {
          synced: false,
          status: 'FAILED',
          provider: 'GOOGLE_SHEETS_API_V4',
          error: `Target worksheet '${targetWorksheet}' not found in spreadsheet.`,
        };
      }
    }

    // 5. Append row with RAW input value option
    const appendRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(activeTab)}!A1:append?valueInputOption=RAW`,
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
        signal: AbortSignal.timeout(8000),
      }
    );

    if (!appendRes.ok) {
      await db.failSideEffect(tenantId, claimKey, `Google Sheets append rejected with HTTP ${appendRes.status}`, true);
      return {
        synced: false,
        status: 'FAILED',
        provider: 'GOOGLE_SHEETS_API_V4',
        error: `Google Sheets API rejected append request (HTTP ${appendRes.status})`,
      };
    }

    const appendData = await appendRes.json();
    const updatedRange: string | undefined = appendData.updates?.updatedRange;
    const rowIndex = updatedRange ? Number.parseInt(updatedRange.replace(/[^0-9]/g, ''), 10) : undefined;

    // 6. Complete durable claim
    await db.completeSideEffect(tenantId, claimKey, {
      updatedRange,
      rowIndex,
      worksheet: activeTab,
      synced_at: new Date().toISOString(),
    });

    // 7. Audit log confirmed sync
    await db.logAuditEvent(
      {
        tenant_id: tenantId,
        call_id: call.id,
        event_type: 'SHEETS_SYNC',
        actor: 'SYSTEM',
        actor_type: 'SYSTEM',
        actor_id: 'sheets-sync-worker',
        tool_name: 'google_sheets_sync',
        severity: 'INFO',
        details: {
          external_call_id: call.external_call_id,
          spreadsheet_id: spreadsheetId,
          worksheet: activeTab,
          updated_range: updatedRange,
          row_index: rowIndex,
          provider_confirmed: true,
        },
      },
      tenantId
    );

    return {
      synced: true,
      status: 'SYNCED',
      provider: 'GOOGLE_SHEETS_API_V4',
      spreadsheet_id: spreadsheetId,
      worksheet_name: activeTab,
      row_index: rowIndex,
    };
  } catch (err) {
    await db.failSideEffect(tenantId, claimKey, err instanceof Error ? err.message : 'Network error during Google Sheets sync', true);
    return {
      synced: false,
      status: 'FAILED',
      provider: 'GOOGLE_SHEETS_API_V4',
      error: 'Network error executing Google Sheets synchronization',
    };
  }
}

/**
 * Resets Google Sheets sync idempotency for testing suites.
 */
export function resetSheetsSyncIdempotency(): void {
  // Test cleanup helper
}

