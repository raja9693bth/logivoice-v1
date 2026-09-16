import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext } from '@/lib/auth/context';
import { db } from '@/lib/db';
import { LeadTemperature } from '@/types/logivoice';

export async function GET(req: NextRequest) {
  const authContext = await getAuthContext(req);
  const { searchParams } = new URL(req.url);

  const temperature = searchParams.get('temperature') as LeadTemperature | null;
  const search = searchParams.get('search') || undefined;

  const leads = await db.listLeads(authContext.tenantId, {
    temperature: temperature || undefined,
    search,
  });

  return NextResponse.json({ leads });
}

export async function POST(req: NextRequest) {
  const authContext = await getAuthContext(req);
  const body = await req.json();

  const newLead = await db.createLead(body, authContext.tenantId);
  return NextResponse.json({ lead: newLead }, { status: 201 });
}
