import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext, requireRole, AuthorizationError } from '@/lib/auth/context';
import { db } from '@/lib/db';
import { CreateRateCardApiSchema, UpdateRateCardApiSchema, GetRateQuoteQuerySchema, BulkCreateRateCardsApiSchema } from '@/lib/schemas/api';

export async function GET(req: NextRequest) {
  try {
    const authContext = await getAuthContext(req);
    requireRole(authContext, ['DISPATCHER', 'OPS_MANAGER', 'ADMIN', 'SYSTEM', 'VOICE_GATEWAY']);

    const { searchParams } = new URL(req.url);
    const rawQuery = {
      origin: searchParams.get('origin') || undefined,
      destination: searchParams.get('destination') || undefined,
      vehicle_type: searchParams.get('vehicle_type') || undefined,
      weight_tons: searchParams.get('weight_tons') || undefined,
      pickup_date: searchParams.get('pickup_date') || undefined,
      status: searchParams.get('status') || undefined,
      search: searchParams.get('search') || undefined,
      limit: searchParams.get('limit') || undefined,
      offset: searchParams.get('offset') || undefined,
    };

    const parsedQuery = GetRateQuoteQuerySchema.safeParse(rawQuery);
    if (!parsedQuery.success) {
      return NextResponse.json(
        { error: 'Invalid query parameters', details: parsedQuery.error.flatten() },
        { status: 400 }
      );
    }

    const { origin, destination, vehicle_type, weight_tons, pickup_date, status, search, limit, offset } = parsedQuery.data;

    // If query parameters for quote are given, run rate search
    if (origin && destination) {
      const rate = await db.findApprovedRate(
        {
          origin,
          destination,
          vehicleType: vehicle_type,
          weightTons: weight_tons,
          date: pickup_date,
        },
        authContext.tenantId
      );

      if (!rate) {
        return NextResponse.json({
          found: false,
          message: `No approved rate card found for ${origin} to ${destination}`,
        });
      }

      return NextResponse.json({
        found: true,
        rate,
      });
    }

    // Otherwise list all rate cards with filters
    const rateCards = await db.listRateCards(authContext.tenantId, { status, search, limit, offset });
    return NextResponse.json({ rate_cards: rateCards });
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal Server Error' },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const authContext = await getAuthContext(req);
    requireRole(authContext, ['ADMIN', 'OPS_MANAGER', 'SYSTEM']);

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Malformed JSON payload' }, { status: 400 });
    }

    // Bulk Rate Card Import Handler
    if (typeof body === 'object' && body !== null && 'bulk' in body && (body as any).bulk === true) {
      const bulkParse = BulkCreateRateCardsApiSchema.safeParse(body);
      if (!bulkParse.success) {
        return NextResponse.json(
          { error: 'Validation failed on bulk import payload', details: bulkParse.error.flatten() },
          { status: 400 }
        );
      }
      const itemsToInsert = bulkParse.data.items.map((val) => ({
        tenant_id: authContext.tenantId,
        origin: val.origin,
        destination: val.destination,
        vehicle_type: val.vehicle_type,
        weight_min_tons: val.weight_min_tons,
        weight_max_tons: val.weight_max_tons,
        price_inr: val.price_inr,
        minimum_charge_inr: val.minimum_charge_inr,
        effective_from: val.effective_from,
        effective_to: val.effective_to,
        status: val.status,
        transit_time_hours: val.transit_time_hours,
        quote_type: val.quote_type,
        supports_confirmed_quote: val.supports_confirmed_quote,
        source_version: 'v1.2-csv-bulk-import',
        surcharge_notes: val.surcharge_notes,
      }));

      const res = await db.bulkCreateRateCards(itemsToInsert, authContext.tenantId);

      // Log bulk audit event
      await db.logAuditEvent(
        {
          tenant_id: authContext.tenantId,
          event_type: 'BULK_RATE_IMPORT',
          actor: authContext.userId,
          actor_type: 'DISPATCHER',
          actor_id: authContext.userId,
          severity: 'INFO',
          details: {
            imported_count: res.count,
            source: 'CSV_IMPORT',
          },
        },
        authContext.tenantId
      );

      return NextResponse.json({ success: true, count: res.count, rate_cards: res.inserted }, { status: 201 });
    }

    const parseResult = CreateRateCardApiSchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parseResult.error.flatten() },
        { status: 400 }
      );
    }

    const val = parseResult.data;
    const newCard = await db.createRateCard(
      {
        tenant_id: authContext.tenantId,
        origin: val.origin,
        destination: val.destination,
        vehicle_type: val.vehicle_type,
        weight_min_tons: val.weight_min_tons,
        weight_max_tons: val.weight_max_tons,
        price_inr: val.price_inr,
        minimum_charge_inr: val.minimum_charge_inr,
        effective_from: val.effective_from,
        effective_to: val.effective_to,
        status: val.status,
        transit_time_hours: val.transit_time_hours,
        quote_type: val.quote_type,
        supports_confirmed_quote: val.supports_confirmed_quote,
        source_version: 'v1.2-admin-created',
        surcharge_notes: val.surcharge_notes,
      },
      authContext.tenantId
    );

    return NextResponse.json({ rate_card: newCard }, { status: 201 });
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal Server Error' },
      { status: 500 }
    );
  }
}

export async function PUT(req: NextRequest) {
  try {
    const authContext = await getAuthContext(req);
    requireRole(authContext, ['ADMIN', 'OPS_MANAGER', 'SYSTEM']);

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Malformed JSON payload' }, { status: 400 });
    }

    const parseResult = UpdateRateCardApiSchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parseResult.error.flatten() },
        { status: 400 }
      );
    }

    const { id, ...updates } = parseResult.data;
    const updated = await db.updateRateCard(id, updates, authContext.tenantId);
    if (!updated) {
      return NextResponse.json({ error: 'Rate card not found' }, { status: 404 });
    }

    return NextResponse.json({ rate_card: updated });
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal Server Error' },
      { status: 500 }
    );
  }
}
