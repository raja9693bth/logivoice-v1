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
import { ExecuteToolApiSchema } from '@/lib/schemas/api';

function redactToolArgs(args: Record<string, unknown>): Record<string, unknown> {
  const redacted: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    if (typeof v === 'string' && (k.toLowerCase().includes('phone') || k.toLowerCase().includes('number'))) {
      redacted[k] = v.length > 5 ? `${v.slice(0, 3)}****${v.slice(-2)}` : '***';
    } else if (k.toLowerCase().includes('token') || k.toLowerCase().includes('secret') || k.toLowerCase().includes('key') || k.toLowerCase().includes('password')) {
      redacted[k] = '[REDACTED]';
    } else {
      redacted[k] = v;
    }
  }
  return redacted;
}

export async function POST(req: NextRequest) {
  try {
    const authContext = await getAuthContext(req);
    requireRole(authContext, ['DISPATCHER', 'OPS_MANAGER', 'ADMIN', 'VOICE_GATEWAY', 'SYSTEM']);

    const correlation = createCorrelationContext(authContext.tenantId, undefined, 'TOOL_EXECUTE_API');

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Malformed JSON payload' }, { status: 400 });
    }

    const parseResult = ExecuteToolApiSchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: 'Invalid tool execution payload', details: parseResult.error.flatten() },
        { status: 400 }
      );
    }

    const { tool_name, arguments: args, call_id } = parseResult.data;

    logTrace(correlation, 'TOOL_EXECUTE_CALLED', {
      tool_name,
      args: redactToolArgs(args),
    });

    const result = await dispatchTool(
      {
        tool_name,
        arguments: args,
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
