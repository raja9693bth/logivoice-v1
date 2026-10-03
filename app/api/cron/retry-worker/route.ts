import { NextRequest, NextResponse } from 'next/server';
import { runRetryWorker } from '@/lib/pipeline/retry-worker';
import { handleApiError } from '@/lib/api/error-handler';

export async function GET(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization') || '';
    const cronSecretHeader = req.headers.get('x-cron-secret') || '';
    const expectedSecret = process.env.CRON_SECRET;

    // In production, require valid CRON_SECRET
    if (process.env.NODE_ENV === 'production' && expectedSecret) {
      const isBearerValid = authHeader === `Bearer ${expectedSecret}`;
      const isHeaderValid = cronSecretHeader === expectedSecret;
      if (!isBearerValid && !isHeaderValid) {
        return NextResponse.json({ error: 'Unauthorized: Invalid CRON_SECRET' }, { status: 401 });
      }
    }

    const { searchParams } = new URL(req.url);
    const limit = Math.min(Math.max(Number.parseInt(searchParams.get('limit') || '10', 10), 1), 50);

    const outcome = await runRetryWorker(limit);
    return NextResponse.json({
      success: true,
      processed: outcome.processed_count,
      results: outcome.results,
      executed_at: new Date().toISOString(),
    });
  } catch (error) {
    return handleApiError(error, 'api/cron/retry-worker:GET');
  }
}

export async function POST(req: NextRequest) {
  return GET(req);
}
