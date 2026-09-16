/**
 * LOGIVOICE V1 — TENANT / CLIENT CONFIGURATION SERVICE
 * Provides runtime access to client configuration (identity, operating rules,
 * escalation directory, communication settings) without exposing secrets.
 */

import { db, ClientConfig, DEFAULT_TENANT_ID } from '@/lib/db';

export async function getTenantConfig(tenantId: string = DEFAULT_TENANT_ID): Promise<ClientConfig> {
  return await db.getClientConfig(tenantId);
}

export async function updateTenantConfig(
  tenantId: string = DEFAULT_TENANT_ID,
  updates: Partial<ClientConfig>
): Promise<ClientConfig> {
  return await db.updateClientConfig(tenantId, updates);
}

export function isWithinBusinessHours(config: ClientConfig, date: Date = new Date()): boolean {
  try {
    const hours = config.business_hours;
    if (!hours?.start || !hours?.end) return true;

    // Convert date to config timezone (e.g. Asia/Kolkata)
    const timeStr = date.toLocaleTimeString('en-GB', {
      timeZone: config.timezone || 'Asia/Kolkata',
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
    });

    return timeStr >= hours.start && timeStr <= hours.end;
  } catch {
    return true; // fail open for operational continuity
  }
}
