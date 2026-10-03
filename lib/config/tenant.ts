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

export type BusinessHoursStatus = 'OPEN' | 'CLOSED' | 'CONFIGURATION_ERROR';

export interface BusinessHoursEvaluation {
  isOpen: boolean;
  status: BusinessHoursStatus;
  error?: string;
}

export function evaluateBusinessHours(
  config: ClientConfig,
  date: Date = new Date()
): BusinessHoursEvaluation {
  try {
    const hours = config?.business_hours;
    if (!hours?.start || !hours?.end) {
      return {
        isOpen: false,
        status: 'CONFIGURATION_ERROR',
        error: 'Business hours configuration missing or incomplete.',
      };
    }

    if (!/^\d{2}:\d{2}$/.test(hours.start) || !/^\d{2}:\d{2}$/.test(hours.end)) {
      return {
        isOpen: false,
        status: 'CONFIGURATION_ERROR',
        error: `Malformed business hours format ('${hours.start}' - '${hours.end}'). Expected HH:MM.`,
      };
    }

    // Convert date to config timezone (e.g. Asia/Kolkata)
    const timeStr = date.toLocaleTimeString('en-GB', {
      timeZone: config.timezone || 'Asia/Kolkata',
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
    });

    const isOpen = timeStr >= hours.start && timeStr <= hours.end;
    return {
      isOpen,
      status: isOpen ? 'OPEN' : 'CLOSED',
    };
  } catch (err) {
    return {
      isOpen: false,
      status: 'CONFIGURATION_ERROR',
      error: err instanceof Error ? err.message : 'Business hours evaluation exception',
    };
  }
}

export function isWithinBusinessHours(config: ClientConfig, date: Date = new Date()): boolean {
  return evaluateBusinessHours(config, date).isOpen;
}
