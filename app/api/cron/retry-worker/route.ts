import { NextRequest, NextResponse } from 'next/server';
import { runRetryWorker } from '@/lib/pipeline/retry-worker';
import { handleApiError } from '@/lib/api/error-handler';

export async function GET(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization') || '';
    const expectedSecret = process.env.CRON_SECRET;

    // Fail-closed authentication in production (Directive Section 28)
    if (process.env.NODE_ENV === 'production') {
      if (!expectedSecret) {
        console.error('[CronRetryWorker] CRON_SECRET is unconfigured in production environment.');
        return NextResponse.json(
          { error: 'Server configuration error: CRON_SECRET is not configured' },
          { status: 503 }
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

    // Reconcile UNKNOWN side-effect claims first, then process eligible retries (Directive Section 26)
    const { reconcileUnknownClaims } = await import('@/lib/pipeline/retry-worker');
    const unknownOutcome = await reconcileUnknownClaims(limit);
    const retryOutcome = await runRetryWorker(limit);

    return NextResponse.json({
      success: true,
      reconciled_count: unknownOutcome.reconciled_count,
      processed_count: retryOutcome.processed_count,
      results: [...unknownOutcome.results, ...retryOutcome.results],
      executed_at: new Date().toISOString(),
    });
  } catch (error) {
    return handleApiError(error, 'api/cron/retry-worker:GET');
  }
}

export async function POST(req: NextRequest) {
  return GET(req);
}
