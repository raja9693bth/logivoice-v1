/**
 * LOGIVOICE V1 — GENERAL TOOL EXECUTION ENDPOINT
 * POST /api/tools/execute
 *
 * Secure gateway for testing, voice orchestrators, and internal integrations
 * to execute the 8 core controlled tools.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext } from '@/lib/auth/context';
import { dispatchTool } from '@/lib/tools/gateway';
import { createCorrelationContext, logTrace, logError } from '@/lib/observability/correlation';

export async function POST(req: NextRequest) {
  const authContext = await getAuthContext(req);
  const correlation = createCorrelationContext(authContext.tenantId, undefined, 'TOOL_EXECUTE_API');

  try {
    const body = await req.json();
    const { tool_name, arguments: args, call_id } = body;

    if (!tool_name) {
      return NextResponse.json(
        { error: 'Missing required field: tool_name' },
        { status: 400 }
      );
    }

    logTrace(correlation, 'TOOL_EXECUTE_CALLED', { tool_name, args });

    const result = await dispatchTool(
      {
        tool_name,
        arguments: args || {},
        call_id,
      },
      authContext
    );

    return NextResponse.json(result);
  } catch (error) {
    logError(correlation, 'TOOL_EXECUTE_ERROR', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Tool execution failed',
      },
      { status: 500 }
    );
  }
}
