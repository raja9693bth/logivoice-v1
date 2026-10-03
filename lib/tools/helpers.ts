import crypto from 'crypto';
import { db } from '@/lib/db';
import { Customer } from '@/types/logivoice';

/**
 * Resolves an existing customer by phone number, or registers a new one.
 */
export async function getOrCreateCustomer(
  phone: string,
  name: string | undefined,
  tenantId: string
): Promise<Customer> {
  const existing = await db.getCustomerByPhone(phone, tenantId);
  if (existing) {
    return existing;
  }
  return db.createCustomer(
    {
      tenant_id: tenantId,
      phone,
      name: name || 'Inbound Caller',
    },
    tenantId
  );
}

/**
 * Generates collision-resistant reference numbers with date and crypto entropy.
 * Format: {PREFIX}-YYYYMMDD-XXXX (e.g. BKG-20261002-A1B2 or TCK-20261002-F3E4)
 */
export function generateReferenceNumber(prefix: string): string {
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const entropy = crypto.randomBytes(4).toString('hex').toUpperCase();
  return `${prefix}-${dateStr}-${entropy}`;
}
