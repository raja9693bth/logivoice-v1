import { NextRequest, NextResponse } from 'next/server';
import { isSupabaseLive } from '@/lib/db';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const checkType = searchParams.get('check');

  // 1. Liveness check: verifies process is running and event loop is responsive
  if (checkType === 'liveness') {
    return NextResponse.json(
      {
        status: 'UP',
        service: 'logivoice-v1',
        version: '1.0.0',
        timestamp: new Date().toISOString(),
      },
      { status: 200 }
    );
  }

  // 2. Readiness check: verifies critical dependencies (authoritative DB)
  const isDbLive = await isSupabaseLive();
  const isProduction = process.env.NODE_ENV === 'production';

  // In production, readiness MUST return 503 if required database connection is down
  if (isProduction && !isDbLive) {
    return NextResponse.json(
      {
        status: 'DEGRADED',
        service: 'logivoice-v1',
        version: '1.0.0',
        timestamp: new Date().toISOString(),
        database: 'DISCONNECTED',
        readiness: false,
        environment: 'production',
      },
      { status: 503 }
    );
  }

  return NextResponse.json(
    {
      status: isDbLive ? 'HEALTHY' : 'DEGRADED',
      service: 'logivoice-v1',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      database: isDbLive ? 'CONNECTED' : 'STANDALONE_OR_DISCONNECTED',
      readiness: isDbLive || !isProduction,
      environment: process.env.NODE_ENV || 'development',
    },
    { status: 200 }
  );
}
