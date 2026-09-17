/**
 * LOGIVOICE V1 — GENERAL TOOL EXECUTION ENDPOINT
 * POST /api/tools/execute
 *
 * Secure gateway for voice orchestrators, dispatch dashboard, and internal services.
 * Enforces strict authentication, role authorization, and input validation.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext, requireRole, AuthorizationError } from '@/lib/auth/context';
import { dispatchTool } from '@/lib/tools/gateway';
import { createCorrelationContext, logTrace } from '@/lib/observability/correlation';

export async function POST(req: NextRequest) {
  try {
    const authContext = await getAuthContext(req);
    requireRole(authContext, ['DISPATCHER', 'OPS_MANAGER', 'ADMIN', 'VOICE_GATEWAY', 'SYSTEM']);

    const correlation = createCorrelationContext(authContext.tenantId, undefined, 'TOOL_EXECUTE_API');

    let body: any;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Malformed JSON payload' }, { status: 400 });
    }

    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    const { tool_name, arguments: args, call_id } = body;

    if (!tool_name || typeof tool_name !== 'string') {
      return NextResponse.json(
        { error: 'Missing or invalid required field: tool_name' },
        { status: 400 }
      );
    }

    if (args && (typeof args !== 'object' || Array.isArray(args))) {
      return NextResponse.json(
        { error: 'Invalid arguments field: must be a JSON object' },
        { status: 400 }
      );
    }

    logTrace(correlation, 'TOOL_EXECUTE_CALLED', { tool_name, args });

    const result = await dispatchTool(
      {
        tool_name,
        arguments: args || {},
        call_id: typeof call_id === 'string' ? call_id : undefined,
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
