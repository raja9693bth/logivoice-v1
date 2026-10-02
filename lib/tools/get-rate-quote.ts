/**
 * TOOL 2: get_rate_quote
 * Deterministic rate retrieval from approved rate cards.
 * Strictly separates ESTIMATE from CONFIRMED QUOTE and rejects unsupported or stale rates.
 */

import { db, DEFAULT_TENANT_ID } from '@/lib/db';
import { GetRateQuoteInput, GetRateQuoteOutput } from '@/lib/schemas/tools';

export async function executeGetRateQuote(
  input: GetRateQuoteInput,
  tenantId: string = DEFAULT_TENANT_ID
): Promise<GetRateQuoteOutput> {
  try {
    const { origin, destination, vehicle_type, weight_tons } = input;

    // Validate essential routing fields
    if (!origin || !destination) {
      return {
        status: 'MISSING_FIELDS',
        message: 'Both origin and destination cities are required for freight calculation.',
      };
    }

    // Lookup in approved active rate cards with pickup_date
    const matchedCard = await db.findApprovedRate(
      {
        origin,
        destination,
        vehicleType: vehicle_type,
        weightTons: weight_tons,
        date: input.pickup_date,
        includeExpired: true,
      },
      tenantId
    );

    if (!matchedCard) {
      return {
        status: 'UNAVAILABLE',
        message: `No approved direct rate card found for ${origin} to ${destination}${vehicle_type ? ` with ${vehicle_type}` : ''}. This requires human dispatcher quotation.`,
      };
    }

    // Check expiry against requested pickup date
    const targetDate = input.pickup_date ? new Date(input.pickup_date) : new Date();
    if (matchedCard.effective_to && new Date(matchedCard.effective_to) < targetDate) {
      return {
        status: 'EXPIRED',
        message: `The rate card for ${matchedCard.origin} to ${matchedCard.destination} has expired for requested pickup date ${input.pickup_date || 'today'}. Please connect to a human dispatcher.`,
      };
    }

    // Determine whether this is an ESTIMATE or CONFIRMED QUOTE
    // SSOT & Knowledge Base Rule: Standard tariff matrix rates are indicative ESTIMATES.
    // Complete route, vehicle, and weight inputs do NOT automatically prove commercial confirmation.
    // A quote is strictly an ESTIMATE unless the approved rate card explicitly authorizes
    // commercial confirmation (quote_type === 'CONFIRMED' or supports_confirmed_quote === true).
    const isExplicitlyConfirmable =
      (matchedCard.quote_type === 'CONFIRMED' || matchedCard.supports_confirmed_quote === true) &&
      Boolean(vehicle_type) &&
      weight_tons !== undefined;
    const quoteType: 'ESTIMATE' | 'CONFIRMED' = isExplicitlyConfirmable ? 'CONFIRMED' : 'ESTIMATE';

    const statusExplanation =
      quoteType === 'CONFIRMED'
        ? 'Pre-authorized commercial tariff authorized by operations desk.'
        : 'Indicative estimate from approved tariff matrix. Formal commercial confirmation finalized upon vehicle placement.';

    return {
      status: 'QUOTED',
      quote_type: quoteType,
      price_inr: matchedCard.price_inr,
      minimum_charge_inr: matchedCard.minimum_charge_inr,
      transit_time_hours: matchedCard.transit_time_hours,
      route: `${matchedCard.origin} -> ${matchedCard.destination}`,
      vehicle_type: matchedCard.vehicle_type,
      source_version: matchedCard.source_version,
      surcharge_notes: matchedCard.surcharge_notes,
      message: `Approved rate: ₹${matchedCard.price_inr.toLocaleString('en-IN')} (${quoteType}) for ${matchedCard.origin} to ${matchedCard.destination} via ${matchedCard.vehicle_type}.${matchedCard.transit_time_hours ? ` Estimated transit: ~${matchedCard.transit_time_hours} hours.` : ''} ${statusExplanation}`,
    };
  } catch (error) {
    return {
      status: 'FAILED',
      message: error instanceof Error ? error.message : 'Error accessing rate repository',
    };
  }
}
