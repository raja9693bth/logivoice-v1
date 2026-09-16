/**
 * TOOL 1: lookup_customer
 * Deterministic customer retrieval by phone or reference.
 * Returns verified customer context without leaking cross-tenant data.
 */

import { db, DEFAULT_TENANT_ID } from '@/lib/db';
import { LookupCustomerInput, LookupCustomerOutput } from '@/lib/schemas/tools';

export async function executeLookupCustomer(
  input: LookupCustomerInput,
  tenantId: string = DEFAULT_TENANT_ID
): Promise<LookupCustomerOutput> {
  try {
    const customer = await db.getCustomerByPhone(input.phone, tenantId);

    if (!customer) {
      return {
        status: 'NOT_FOUND',
        customer: null,
        message: 'No existing customer record found for this phone number.',
      };
    }

    return {
      status: 'FOUND',
      customer: {
        id: customer.id,
        phone: customer.phone,
        name: customer.name,
        company: customer.company,
        customer_type: customer.customer_type,
      },
      message: `Verified customer found: ${customer.name}${customer.company ? ` (${customer.company})` : ''}`,
    };
  } catch (error) {
    return {
      status: 'FAILED',
      customer: null,
      message: error instanceof Error ? error.message : 'Database error during customer lookup',
    };
  }
}
