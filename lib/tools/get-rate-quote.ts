/**
 * TOOL 2: get_rate_quote
 * Deterministic rate retrieval from approved rate cards.
 * 
 * Enforces:
 * 1. Discriminator-Aware Matching: Missing vehicle or weight interval on corridors
 *    with multiple options returns `MISSING_FIELDS`. Never guesses a default.
 * 2. Ambiguity Protection: Competing rates return `UNAVAILABLE` for human dispatcher review.
 * 3. Commercial Semantics: Separates indicative ESTIMATE from pre-authorized CONFIRMED QUOTE.
 */

import { db, DEFAULT_TENANT_ID } from '@/lib/db';
import { GetRateQuoteInput, GetRateQuoteOutput } from '@/lib/schemas/tools';
import { evaluateApprovedRate } from '@/lib/rules/rate-engine';

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

    // Retrieve approved rate cards for tenant
    const allCards = await db.listRateCards(tenantId);

    const outcome = evaluateApprovedRate(allCards, {
      origin,
      destination,
      vehicleType: vehicle_type,
      weightTons: weight_tons,
      date: input.pickup_date,
      includeExpired: true,
    });

    if (outcome.status === 'MISSING_FIELDS') {
      const fieldLabels = outcome.missingFields.map((f) =>
        f === 'vehicle_type' ? 'truck type' : 'cargo weight'
      );
      const vehicleHint = outcome.availableVehicles?.length
        ? ` Available vehicles on this corridor: ${outcome.availableVehicles.join(', ')}.`
        : '';

      return {
        status: 'MISSING_FIELDS',
        message: `To provide an accurate freight quote for ${origin} to ${destination}, please specify ${fieldLabels.join(' and ')}.${vehicleHint}`,
      };
    }

    if (outcome.status === 'AMBIGUOUS') {
      return {
        status: 'UNAVAILABLE',
        message: `Multiple commercial tariff options exist for ${origin} to ${destination} with the provided specifications. Transferring context to operations dispatcher for custom quotation.`,
      };
    }

    if (outcome.status === 'EXPIRED') {
      return {
        status: 'EXPIRED',
        message: `The rate card for ${origin} to ${destination} has expired for requested pickup date ${input.pickup_date || 'today'}. Please connect to a human dispatcher.`,
      };
    }

    if (outcome.status === 'UNAVAILABLE') {
      return {
        status: 'UNAVAILABLE',
        message: `No approved direct rate card found for ${origin} to ${destination}${vehicle_type ? ` with ${vehicle_type}` : ''}. This requires human dispatcher quotation.`,
      };
    }

    const matchedCard = outcome.card;

    // Determine whether this is an ESTIMATE or CONFIRMED QUOTE
    // Commercial Rule: A quote is strictly an ESTIMATE unless the approved rate card
    // explicitly authorizes commercial confirmation AND full vehicle and weight inputs are provided.
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
      message: 'Error accessing rate repository. Dispatch desk notified.',
    };
  }
}
