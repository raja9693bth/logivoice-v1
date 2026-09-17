import { NextResponse } from 'next/server';
import { isSupabaseLive } from '@/lib/db';

export async function GET() {
  const isDbLive = await isSupabaseLive();

  return NextResponse.json(
    {
      status: 'HEALTHY',
      service: 'logivoice-v1',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      database: isDbLive ? 'CONNECTED' : 'STANDALONE_OR_DISCONNECTED',
      environment: process.env.NODE_ENV || 'development',
    },
    { status: 200 }
  );
}
