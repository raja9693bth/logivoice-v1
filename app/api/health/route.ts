import { NextRequest, NextResponse } from 'next/server';
import { isSupabaseLive } from '@/lib/db';
import { validateEnvironment } from '@/lib/env';

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

  // 2. Readiness check: verifies critical dependencies (authoritative DB & runtime env)
  const envValidation = validateEnvironment();
  const isDbLive = await isSupabaseLive();
  const isProduction = process.env.NODE_ENV === 'production';

  // In production, readiness MUST return 503 if required database connection is down or env invalid
  if (isProduction && (!isDbLive || !envValidation.valid)) {
    return NextResponse.json(
      {
        status: 'DEGRADED',
        service: 'logivoice-v1',
        version: '1.0.0',
        timestamp: new Date().toISOString(),
      },
      { status: 503 }
    );
  }

  return NextResponse.json(
    {
      status: isDbLive && envValidation.valid ? 'HEALTHY' : 'DEGRADED',
      service: 'logivoice-v1',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      readiness: (isDbLive && envValidation.valid) || !isProduction,
    },
    { status: 200 }
  );
}

