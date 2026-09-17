import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext, requireRole, AuthorizationError } from '@/lib/auth/context';
import { db } from '@/lib/db';

export async function GET(req: NextRequest) {
  try {
    const authContext = await getAuthContext(req);
    requireRole(authContext, ['DISPATCHER', 'OPS_MANAGER', 'ADMIN', 'SYSTEM', 'VOICE_GATEWAY']);

    const { searchParams } = new URL(req.url);
    const origin = searchParams.get('origin');
    const destination = searchParams.get('destination');
    const vehicle = searchParams.get('vehicle_type') || undefined;
    const weightStr = searchParams.get('weight_tons');
    const weightTons = weightStr ? parseFloat(weightStr) : undefined;

    // If query parameters for quote are given, run rate search
    if (origin && destination) {
      const rate = await db.findApprovedRate(
        {
          origin,
          destination,
          vehicleType: vehicle,
          weightTons,
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

    // Otherwise list all rate cards
    const rateCards = await db.listRateCards(authContext.tenantId);
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
