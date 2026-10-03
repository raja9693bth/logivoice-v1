import { NextRequest, NextResponse } from 'next/server';
import { runRetryWorker } from '@/lib/pipeline/retry-worker';
import { handleApiError } from '@/lib/api/error-handler';

export async function GET(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization') || '';
    const expectedSecret = process.env.CRON_SECRET;

    // Fail-closed authentication in production (Prompt Item 6)
    if (process.env.NODE_ENV === 'production') {
      if (!expectedSecret) {
        console.error('[CronRetryWorker] CRON_SECRET is unconfigured in production environment.');
        return NextResponse.json(
          { error: 'Server configuration error: CRON_SECRET is not configured' },
          { status: 500 }
        );
      }
      if (authHeader !== `Bearer ${expectedSecret}`) {
        return NextResponse.json(
          { error: 'Unauthorized: Invalid or missing Bearer token' },
          { status: 401 }
        );
      }
    } else if (expectedSecret) {
      if (authHeader !== `Bearer ${expectedSecret}`) {
        return NextResponse.json(
          { error: 'Unauthorized: Invalid or missing Bearer token' },
          { status: 401 }
        );
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
