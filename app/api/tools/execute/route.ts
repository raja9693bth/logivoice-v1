/**
 * LOGIVOICE V1 — GENERAL TOOL EXECUTION ENDPOINT
 * POST /api/tools/execute
 *
 * Secure gateway for voice orchestrators, dispatch dashboard, and internal services.
 * Enforces strict authentication and role authorization.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext, requireRole, AuthorizationError } from '@/lib/auth/context';
import { dispatchTool } from '@/lib/tools/gateway';
import { createCorrelationContext, logTrace, logError } from '@/lib/observability/correlation';

export async function POST(req: NextRequest) {
  try {
    const authContext = await getAuthContext(req);
    requireRole(authContext, ['DISPATCHER', 'OPS_MANAGER', 'ADMIN', 'VOICE_GATEWAY', 'SYSTEM']);

    const correlation = createCorrelationContext(authContext.tenantId, undefined, 'TOOL_EXECUTE_API');
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
    if (error instanceof AuthorizationError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Tool execution failed',
      },
      { status: 500 }
    );
  }
}
