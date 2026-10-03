/**
 * LOGIVOICE V1 — AUTHORITATIVE RATE ENGINE & RFC4180 CSV PARSER
 *
 * Enforces:
 * 1. Discriminator-Aware Matching: Never picks an arbitrary rate when key discriminators
 *    (vehicle, weight interval) are missing on corridors with multiple active options.
 * 2. Ambiguity Protection: Returns AMBIGUOUS / HUMAN_REVIEW if multiple active cards
 *    compete for the same commercial conditions.
 * 3. Interval & Overlap Conflict Detection: Evaluates weight bands and effective dates.
 * 4. RFC4180-Compliant CSV Parsing: Handles quotes, commas, escaped quotes, and empty cells.
 */

import { RateCard } from '@/types/logivoice';

export interface RateLookupParams {
  origin: string;
  destination: string;
  vehicleType?: string;
  weightTons?: number;
  date?: string;
  includeExpired?: boolean;
}

export type RateLookupOutcome =
  | { status: 'MATCH'; card: RateCard }
  | { status: 'MISSING_FIELDS'; missingFields: string[]; availableVehicles?: string[]; availableWeightBands?: string[] }
  | { status: 'AMBIGUOUS'; matchingCards: RateCard[] }
  | { status: 'EXPIRED'; card: RateCard }
  | { status: 'UNAVAILABLE' };

/**
 * Validates whether a string is a strict, valid ISO calendar date (YYYY-MM-DD).
 */
export function isValidIsoDate(dateStr: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  const [yearStr, monthStr, dayStr] = dateStr.split('-');
  const year = Number.parseInt(yearStr, 10);
  const month = Number.parseInt(monthStr, 10);
  const day = Number.parseInt(dayStr, 10);
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

/**
 * Checks whether two numerical intervals [minA, maxA) and [minB, maxB) overlap.
 */
export function intervalsOverlap(minA: number, maxA: number, minB: number, maxB: number): boolean {
  return Math.max(minA, minB) < Math.min(maxA, maxB);
}

/**
 * Checks whether two date ranges [fromA, toA] and [fromB, toB] overlap.
 */
export function dateRangesOverlap(
  fromA: string,
  toA: string | undefined | null,
  fromB: string,
  toB: string | undefined | null
): boolean {
  const startA = fromA || '1970-01-01';
  const endA = toA || '9999-12-31';
  const startB = fromB || '1970-01-01';
  const endB = toB || '9999-12-31';

  return startA <= endB && startB <= endA;
}

/**
 * Evaluates whether two active rate cards present a commercial conflict.
 */
export function rateCardsConflict(a: RateCard, b: RateCard): boolean {
  if (a.id === b.id) return false;
  if (a.origin.trim().toLowerCase() !== b.origin.trim().toLowerCase()) return false;
  if (a.destination.trim().toLowerCase() !== b.destination.trim().toLowerCase()) return false;
  if (a.vehicle_type.trim().toLowerCase() !== b.vehicle_type.trim().toLowerCase()) return false;
  if (a.status !== 'ACTIVE' || b.status !== 'ACTIVE') return false;

  const weightsIntersect = intervalsOverlap(
    a.weight_min_tons,
    a.weight_max_tons,
    b.weight_min_tons,
    b.weight_max_tons
  );

  const datesIntersect = dateRangesOverlap(
    a.effective_from,
    a.effective_to,
    b.effective_from,
    b.effective_to
  );

  return weightsIntersect && datesIntersect;
}

/**
 * Deterministically finds the approved rate card or surfaces missing discriminators/ambiguity.
 */
export function evaluateApprovedRate(
  cards: RateCard[],
  params: RateLookupParams
): RateLookupOutcome {
  const origin = params.origin.trim().toLowerCase();
  const dest = params.destination.trim().toLowerCase();
  const vehicle = params.vehicleType?.trim().toLowerCase();
  const weight = params.weightTons;
  const queryDateStr = params.date || new Date().toISOString().split('T')[0];

  // 1. Filter corridor cards
  const corridorCards = cards.filter(
    (rc) =>
      rc.origin.trim().toLowerCase() === origin &&
      rc.destination.trim().toLowerCase() === dest
  );

  if (corridorCards.length === 0) {
    return { status: 'UNAVAILABLE' };
  }

  // Active cards within effective dates
  const activeCards = corridorCards.filter((rc) => rc.status === 'ACTIVE');
  const validActiveCards = activeCards.filter((rc) => {
    if (rc.effective_from && rc.effective_from > queryDateStr) return false;
    if (rc.effective_to && rc.effective_to < queryDateStr) return false;
    return true;
  });

  if (validActiveCards.length === 0) {
    if (params.includeExpired) {
      const expired = corridorCards.find((rc) => rc.effective_to && rc.effective_to < queryDateStr);
      if (expired) return { status: 'EXPIRED', card: expired };
    }
    return { status: 'UNAVAILABLE' };
  }

  // 2. Discriminator requirement check
  // If the active corridor has multiple distinct vehicle types, vehicleType is required.
  const distinctVehicles = Array.from(new Set(validActiveCards.map((c) => c.vehicle_type.trim())));
  const distinctWeightIntervals = Array.from(
    new Set(validActiveCards.map((c) => `${c.weight_min_tons}-${c.weight_max_tons}`))
  );

  const missingFields: string[] = [];
  if (!vehicle && distinctVehicles.length > 1) {
    missingFields.push('vehicle_type');
  }
  if (weight === undefined && distinctWeightIntervals.length > 1) {
    missingFields.push('weight_tons');
  }

  if (missingFields.length > 0) {
    return {
      status: 'MISSING_FIELDS',
      missingFields,
      availableVehicles: distinctVehicles,
      availableWeightBands: distinctWeightIntervals,
    };
  }

  // 3. Candidate filtering using canonical [min, max) semantics for adjacent bands
  let candidates = validActiveCards.filter((c) => {
    if (vehicle && c.vehicle_type.trim().toLowerCase() !== vehicle) return false;
    if (weight !== undefined) {
      if (weight < c.weight_min_tons) return false;
      if (weight > c.weight_max_tons) return false;
      if (weight === c.weight_max_tons) {
        // Upper bound boundary check: if an adjacent higher band starts at this exact weight, this band yields
        const hasAdjacentHigher = validActiveCards.some(
          (other) =>
            other.id !== c.id &&
            other.vehicle_type.trim().toLowerCase() === c.vehicle_type.trim().toLowerCase() &&
            other.weight_min_tons === weight
        );
        if (hasAdjacentHigher) return false;
      }
    }
    return true;
  });

  if (candidates.length === 0) {
    return { status: 'UNAVAILABLE' };
  }

  if (candidates.length === 1) {
    return { status: 'MATCH', card: candidates[0] };
  }

  // 4. Precedence resolution:
  // If multiple cards match, check if effective_from resolves recency
  candidates.sort((a, b) => {
    const dateDiff = (b.effective_from || '').localeCompare(a.effective_from || '');
    if (dateDiff !== 0) return dateDiff;
    return 0;
  });

  const topCard = candidates[0];
  const secondCard = candidates[1];

  // If top 2 candidates have the same effective_from and different prices, it is ambiguous
  if (
    topCard.effective_from === secondCard.effective_from &&
    topCard.price_inr !== secondCard.price_inr
  ) {
    return { status: 'AMBIGUOUS', matchingCards: candidates };
  }

  return { status: 'MATCH', card: topCard };
}

// =========================================================================
// RFC4180 COMPLIANT CSV PARSER
// =========================================================================
export interface ParsedCsvRateRow {
  origin: string;
  destination: string;
  vehicle_type: string;
  weight_min_tons: number;
  weight_max_tons: number;
  price_inr: number;
  minimum_charge_inr?: number | null;
  transit_time_hours?: number | null;
  effective_from: string;
  effective_to?: string | null;
  quote_type: 'ESTIMATE' | 'CONFIRMED';
  supports_confirmed_quote: boolean;
  status: 'ACTIVE' | 'DRAFT' | 'EXPIRED';
  error?: string;
  conflict?: boolean;
  conflictNote?: string;
}

/**
 * Robust RFC4180 CSV tokenizer supporting quoted fields with commas, newlines, and escaped quotes ("").
 */
export function parseCsvTokens(text: string): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = '';
  let inQuotes = false;
  let i = 0;

  while (i < text.length) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (i + 1 < text.length && text[i + 1] === '"') {
          currentField += '"';
          i += 2;
          continue;
        } else {
          inQuotes = false;
          i++;
          continue;
        }
      } else {
        currentField += char;
        i++;
        continue;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
        i++;
        continue;
      } else if (char === ',') {
        currentRow.push(currentField.trim());
        currentField = '';
        i++;
        continue;
      } else if (char === '\r') {
        if (i + 1 < text.length && text[i + 1] === '\n') {
          i++;
        }
        currentRow.push(currentField.trim());
        if (currentRow.some((f) => f.length > 0)) {
          rows.push(currentRow);
        }
        currentRow = [];
        currentField = '';
        i++;
        continue;
      } else if (char === '\n') {
        currentRow.push(currentField.trim());
        if (currentRow.some((f) => f.length > 0)) {
          rows.push(currentRow);
        }
        currentRow = [];
        currentField = '';
        i++;
        continue;
      } else {
        currentField += char;
        i++;
        continue;
      }
    }
  }

  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(currentField.trim());
    if (currentRow.some((f) => f.length > 0)) {
      rows.push(currentRow);
    }
  }

  return rows;
}

/**
 * Validates and parses CSV rows against the LogiVoice V1 Rate Card contract.
 * Enforces commercial truthfulness: requires explicit effective_from, stores null
 * for omitted minimum_charge and transit_time, and defaults status to DRAFT.
 */
export function parseRateCardsCsv(
  csvContent: string,
  existingActiveCards: RateCard[] = []
): {
  validRows: ParsedCsvRateRow[];
  allRows: ParsedCsvRateRow[];
  errors: string[];
} {
  const tokenRows = parseCsvTokens(csvContent);
  if (tokenRows.length < 2) {
    return { validRows: [], allRows: [], errors: ['CSV contains no data rows or missing header row'] };
  }

  const rawHeaders = tokenRows[0].map((h) => h.toLowerCase().replace(/['"]/g, '').trim());
  const headerMap: Record<string, number> = {};
  rawHeaders.forEach((h, idx) => {
    headerMap[h] = idx;
  });

  const getIdx = (...aliases: string[]): number => {
    for (const a of aliases) {
      if (headerMap[a] !== undefined) return headerMap[a];
    }
    return -1;
  };

  const originIdx = getIdx('origin', 'from', 'pickup', 'pickup_city', 'source');
  const destIdx = getIdx('destination', 'to', 'drop', 'delivery_city', 'dest');
  const vehicleIdx = getIdx('vehicle_type', 'vehicle', 'truck', 'truck_type');
  const minWIdx = getIdx('weight_min_tons', 'weight_min', 'min_weight');
  const maxWIdx = getIdx('weight_max_tons', 'weight_max', 'max_weight');
  const priceIdx = getIdx('price_inr', 'price', 'freight', 'rate');
  const effectiveFromIdx = getIdx('effective_from', 'valid_from', 'start_date');
  const effectiveToIdx = getIdx('effective_to', 'valid_to', 'expiry_date');
  const statusIdx = getIdx('status', 'state');
  const minChargeIdx = getIdx('minimum_charge_inr', 'minimum_charge', 'min_charge');
  const transitIdx = getIdx('transit_time_hours', 'transit_hours', 'transit_time');
  const quoteTypeIdx = getIdx('quote_type', 'type');
  const supportsConfirmedIdx = getIdx('supports_confirmed_quote', 'confirmed_quote');

  if (
    originIdx === -1 ||
    destIdx === -1 ||
    vehicleIdx === -1 ||
    priceIdx === -1 ||
    minWIdx === -1 ||
    maxWIdx === -1 ||
    effectiveFromIdx === -1
  ) {
    return {
      validRows: [],
      allRows: [],
      errors: [
        'Missing required CSV headers: origin, destination, vehicle_type, price_inr, weight_min_tons, weight_max_tons, and effective_from are mandatory.',
      ],
    };
  }

  const allRows: ParsedCsvRateRow[] = [];
  const validRows: ParsedCsvRateRow[] = [];
  const errors: string[] = [];

  const seenKeys = new Map<string, { minW: number; maxW: number; from: string; to?: string }[]>();

  for (let i = 1; i < tokenRows.length; i++) {
    const parts = tokenRows[i];
    if (parts.length === 0 || (parts.length === 1 && !parts[0])) continue;

    const origin = (parts[originIdx] || '').trim();
    const destination = (parts[destIdx] || '').trim();
    const vehicleType = (parts[vehicleIdx] || '').trim();
    const priceRaw = (parts[priceIdx] || '').trim();
    const minWRaw = (parts[minWIdx] || '').trim();
    const maxWRaw = (parts[maxWIdx] || '').trim();
    const effectiveFromRaw = (parts[effectiveFromIdx] || '').trim();
    const effectiveToRaw = effectiveToIdx !== -1 ? (parts[effectiveToIdx] || '').trim() || null : null;
    const statusRaw = statusIdx !== -1 ? (parts[statusIdx] || '').trim().toUpperCase() : 'DRAFT';
    const minChargeRaw = minChargeIdx !== -1 ? (parts[minChargeIdx] || '').trim() : '';
    const transitRaw = transitIdx !== -1 ? (parts[transitIdx] || '').trim() : '';
    const quoteTypeRaw = quoteTypeIdx !== -1 ? (parts[quoteTypeIdx] || '').trim().toUpperCase() : 'ESTIMATE';
    const supportsConfirmedRaw = supportsConfirmedIdx !== -1 ? (parts[supportsConfirmedIdx] || '').trim().toLowerCase() : 'false';

    let rowErr: string | undefined;

    const price = Number.parseFloat(priceRaw);
    const minW = Number.parseFloat(minWRaw);
    const maxW = Number.parseFloat(maxWRaw);
    const minCharge = minChargeRaw ? Number.parseFloat(minChargeRaw) : null;
    const transit = transitRaw ? Number.parseInt(transitRaw, 10) : null;

    if (!origin || !destination) {
      rowErr = 'Missing origin or destination';
    } else if (!vehicleType) {
      rowErr = 'Missing vehicle type';
    } else if (!priceRaw || Number.isNaN(price) || price <= 0) {
      rowErr = 'Invalid price INR (must be positive number)';
    } else if (!minWRaw || Number.isNaN(minW) || minW < 0) {
      rowErr = 'Invalid min weight tons (must be explicit non-negative number)';
    } else if (!maxWRaw || Number.isNaN(maxW) || maxW <= minW) {
      rowErr = 'Max weight must be greater than min weight';
    } else if (!effectiveFromRaw || !isValidIsoDate(effectiveFromRaw)) {
      rowErr = `Invalid effective_from date '${effectiveFromRaw}'. Expected valid ISO calendar date (YYYY-MM-DD).`;
    } else if (effectiveToRaw && !isValidIsoDate(effectiveToRaw)) {
      rowErr = `Invalid effective_to date '${effectiveToRaw}'. Expected valid ISO calendar date (YYYY-MM-DD).`;
    } else if (effectiveToRaw && effectiveToRaw < effectiveFromRaw) {
      rowErr = 'effective_to cannot be earlier than effective_from date.';
    } else if (minCharge !== null && (Number.isNaN(minCharge) || minCharge < 0)) {
      rowErr = 'minimum_charge_inr must be a non-negative number if specified';
    } else if (transit !== null && (Number.isNaN(transit) || transit <= 0)) {
      rowErr = 'transit_time_hours must be a positive integer if specified';
    }

    const parsedStatus: 'ACTIVE' | 'DRAFT' | 'EXPIRED' =
      statusRaw === 'ACTIVE' || statusRaw === 'EXPIRED' ? statusRaw : 'DRAFT';

    const parsedQuoteType: 'ESTIMATE' | 'CONFIRMED' =
      quoteTypeRaw === 'CONFIRMED' ? 'CONFIRMED' : 'ESTIMATE';

    const parsedSupportsConfirmed = supportsConfirmedRaw === 'true' || supportsConfirmedRaw === '1' || supportsConfirmedRaw === 'yes';

    const corridorKey = `${origin.toLowerCase()}|${destination.toLowerCase()}|${vehicleType.toLowerCase()}`;

    // In-CSV Overlap Detection (considering both weight interval [min, max) and date range)
    if (!rowErr && parsedStatus === 'ACTIVE') {
      const existingBands = seenKeys.get(corridorKey) || [];
      const hasCsvOverlap = existingBands.some(
        (b) =>
          intervalsOverlap(b.minW, b.maxW, minW, maxW) &&
          dateRangesOverlap(b.from, b.to, effectiveFromRaw, effectiveToRaw || undefined)
      );
      if (hasCsvOverlap) {
        rowErr = 'Overlapping tariff band for same lane, vehicle, and date interval in this CSV';
      } else {
        existingBands.push({ minW, maxW, from: effectiveFromRaw, to: effectiveToRaw || undefined });
        seenKeys.set(corridorKey, existingBands);
      }
    }

    // Existing Database Active Cards Conflict Check (weights + dates)
    let isConflict = false;
    let conflictNote: string | undefined;
    if (!rowErr && parsedStatus === 'ACTIVE') {
      const dbConflicts = existingActiveCards.filter(
        (c) =>
          c.origin.toLowerCase() === origin.toLowerCase() &&
          c.destination.toLowerCase() === destination.toLowerCase() &&
          c.vehicle_type.toLowerCase() === vehicleType.toLowerCase() &&
          c.status === 'ACTIVE' &&
          intervalsOverlap(c.weight_min_tons, c.weight_max_tons, minW, maxW) &&
          dateRangesOverlap(c.effective_from, c.effective_to, effectiveFromRaw, effectiveToRaw || undefined)
      );

      if (dbConflicts.length > 0) {
        isConflict = true;
        conflictNote = `Conflicts with active card (₹${dbConflicts[0].price_inr.toLocaleString('en-IN')}, [${dbConflicts[0].weight_min_tons}, ${dbConflicts[0].weight_max_tons})T)`;
      }
    }

    const rowObj: ParsedCsvRateRow = {
      origin,
      destination,
      vehicle_type: vehicleType,
      weight_min_tons: Number.isNaN(minW) ? 0 : minW,
      weight_max_tons: Number.isNaN(maxW) ? 0 : maxW,
      price_inr: Number.isNaN(price) ? 0 : price,
      minimum_charge_inr: minCharge,
      transit_time_hours: transit,
      effective_from: effectiveFromRaw,
      effective_to: effectiveToRaw,
      quote_type: parsedQuoteType,
      supports_confirmed_quote: parsedSupportsConfirmed,
      status: parsedStatus,
      error: rowErr,
      conflict: isConflict,
      conflictNote,
    };

    allRows.push(rowObj);
    if (!rowErr) {
      validRows.push(rowObj);
    } else {
      errors.push(`Row ${i}: ${rowErr}`);
    }
  }

  return { validRows, allRows, errors };
}
