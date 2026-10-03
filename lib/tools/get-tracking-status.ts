/**
 * TOOL 3: get_tracking_status
 * Deterministic consignment tracking behind an authoritative provider boundary.
 * 
 * Enforces:
 * 1. Privacy & Customer Ownership: Never discloses another customer's shipment information
 *    unless anonymous bearer LR lookup is explicitly permitted by tenant configuration.
 * 2. Truthful ETA Formatting: Always formats verified arrival with date, time, and timezone.
 * 3. Safe Domain Responses: Maps provider failures and privacy blocks to controlled statuses.
 */

import { db, DEFAULT_TENANT_ID } from '@/lib/db';
import { GetTrackingStatusInput, GetTrackingStatusOutput } from '@/lib/schemas/tools';
import { formatDateTime, normalizePhoneNumber } from '@/lib/utils';

export async function executeGetTrackingStatus(
  input: GetTrackingStatusInput,
  tenantId: string = DEFAULT_TENANT_ID
): Promise<GetTrackingStatusOutput> {
  const ref = input.tracking_reference.trim().toUpperCase();

  try {
    const record = await db.getTrackingRecord(ref, tenantId);

    if (!record) {
      return {
        status: 'NOT_FOUND',
        tracking_reference: ref,
        message: `No consignment record found for tracking reference '${ref}'. Please verify the LR number or docket ID.`,
      };
    }

    // In production, MOCK_TMS records must never be presented as live shipment telemetry
    if (process.env.NODE_ENV === 'production' && record.source === 'MOCK_TMS') {
      return {
        status: 'PROVIDER_UNAVAILABLE',
        tracking_reference: ref,
        message: 'Live TMS provider integration is unconfigured in production environment.',
      };
    }

    // Customer Ownership & Privacy Check
    if (record.customer_id) {
      const config = await db.getClientConfig(tenantId);
      const isBearerAllowed = (config.tracking_config as Record<string, unknown>)?.allow_bearer_lookup === true;

      if (!isBearerAllowed) {
        if (!input.caller_phone) {
          return {
            status: 'IDENTITY_REQUIRED',
            tracking_reference: ref,
            message: `Consignment '${ref}' requires caller identification. For security, tracking details cannot be shared anonymously. Please provide your registered phone number.`,
          };
        }

        const callerPhoneNorm = normalizePhoneNumber(input.caller_phone);
        const caller = await db.getCustomerByPhone(callerPhoneNorm, tenantId);

        // If caller cannot be matched to an authenticated customer or does not match owner: fail closed
        if (!caller || caller.id !== record.customer_id) {
          return {
            status: 'UNAUTHORIZED_ACCESS',
            tracking_reference: ref,
            message: `Consignment '${ref}' is registered to another account or caller identity could not be verified. For security, tracking details cannot be shared. Please contact dispatch supervisor.`,
          };
        }
      }
    }

    // Format ETA with date, time, and IST timezone
    let etaFormatted = '';
    if (record.eta_if_verified) {
      etaFormatted = ` Estimated arrival: ${formatDateTime(record.eta_if_verified)} IST.`;
    }

    return {
      status: 'FOUND',
      tracking_reference: record.tracking_reference,
      current_status: record.status,
      current_location: record.current_location,
      status_timestamp: record.status_timestamp,
      eta_if_verified: record.eta_if_verified || null,
      exception_reason: record.exception_reason || null,
      message: `Consignment ${record.tracking_reference} is currently ${record.status.replace(/_/g, ' ')} at ${record.current_location}.${etaFormatted}`,
    };
  } catch (error) {
    return {
      status: 'PROVIDER_UNAVAILABLE',
      tracking_reference: ref,
      message: 'Shipment tracking service temporarily unreachable. Operations desk notified.',
    };
  }
}
