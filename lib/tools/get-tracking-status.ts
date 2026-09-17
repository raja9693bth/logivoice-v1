/**
 * TOOL 3: get_tracking_status
 * Deterministic shipment tracking behind a pluggable adapter.
 * Never invents status or ETAs; returns explicit unavailable states if not verified.
 */

import { db, DEFAULT_TENANT_ID } from '@/lib/db';
import { GetTrackingStatusInput, GetTrackingStatusOutput } from '@/lib/schemas/tools';

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

    // In production, MOCK_TMS records must never be presented as real live shipment telemetry
    if (process.env.NODE_ENV === 'production' && record.source === 'MOCK_TMS') {
      return {
        status: 'PROVIDER_UNAVAILABLE',
        tracking_reference: ref,
        message: 'Live TMS provider integration is unconfigured in production environment.',
      };
    }

    return {
      status: 'FOUND',
      tracking_reference: record.tracking_reference,
      current_status: record.status,
      current_location: record.current_location,
      status_timestamp: record.status_timestamp,
      eta_if_verified: record.eta_if_verified || null,
      exception_reason: record.exception_reason || null,
      message: `Consignment ${record.tracking_reference} is currently ${record.status.replace(/_/g, ' ')} at ${record.current_location}.${record.eta_if_verified ? ` Estimated arrival: ${new Date(record.eta_if_verified).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}.` : ''}`,
    };
  } catch (error) {
    return {
      status: 'PROVIDER_UNAVAILABLE',
      tracking_reference: ref,
      message: error instanceof Error ? error.message : 'Tracking system connector unavailable',
    };
  }
}
