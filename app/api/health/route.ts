import { NextRequest, NextResponse } from 'next/server';
import { isSupabaseLive } from '@/lib/db';
import { validateEnvironment } from '@/lib/env';
import packageJson from '@/package.json';

const APP_VERSION = packageJson.version || '1.0.1';
const COMMIT_SHA =
  process.env.VERCEL_GIT_COMMIT_SHA ||
  process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ||
  process.env.GIT_COMMIT_SHA ||
  undefined;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const checkType = searchParams.get('check');

  // 1. Liveness check: verifies process is running and event loop is responsive (zero external dependencies)
  if (checkType === 'liveness') {
    return NextResponse.json(
      {
        status: 'UP',
        service: 'logivoice-v1',
        version: APP_VERSION,
        commit_sha: COMMIT_SHA,
        timestamp: new Date().toISOString(),
      },
      { status: 200 }
    );
  }

  // 2. Readiness check: verifies critical dependencies with strict time-bounding
  const envValidation = validateEnvironment();
  // Bound database live probe to maximum 2000ms
  const isDbLive = await isSupabaseLive(2000);
  const isProduction = process.env.NODE_ENV === 'production';

  // In production, readiness MUST return 503 if required database connection is down or env invalid
  if (isProduction && (!isDbLive || !envValidation.valid)) {
    return NextResponse.json(
      {
        status: 'DEGRADED',
        service: 'logivoice-v1',
        version: APP_VERSION,
        commit_sha: COMMIT_SHA,
        timestamp: new Date().toISOString(),
      },
      { status: 503 }
    );
  }

  return NextResponse.json(
    {
      status: isDbLive && envValidation.valid ? 'HEALTHY' : 'DEGRADED',
      service: 'logivoice-v1',
      version: APP_VERSION,
      commit_sha: COMMIT_SHA,
      timestamp: new Date().toISOString(),
      readiness: (isDbLive && envValidation.valid) || !isProduction,
    },
    { status: 200 }
  );
}
