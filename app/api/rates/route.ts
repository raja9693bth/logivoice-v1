import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext } from '@/lib/auth/context';
import { db } from '@/lib/db';

export async function GET(req: NextRequest) {
  const authContext = await getAuthContext(req);
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
}
