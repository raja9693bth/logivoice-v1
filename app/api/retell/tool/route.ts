/**
 * LOGIVOICE V1 — RETELL REAL-TIME TOOL EXECUTION ENDPOINT
 * POST /api/retell/tool
 *
 * Called by Retell during an active call to execute any of the 8 controlled tools.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext } from '@/lib/auth/context';
import { dispatchTool } from '@/lib/tools/gateway';
import { createCorrelationContext, logTrace, logError } from '@/lib/observability/correlation';

export async function POST(req: NextRequest) {
  const authContext = await getAuthContext(req);
  const correlation = createCorrelationContext(authContext.tenantId, undefined, 'RETELL_TOOL_ENDPOINT');

  try {
    const body = await req.json();
    logTrace(correlation, 'RETELL_TOOL_INVOKED', { body });

    // Handle both Retell payloads formats:
    // Format A: { name: 'get_rate_quote', args: { origin: 'Delhi', destination: 'Mumbai' }, call: { call_id: '...' } }
    // Format B: { tool_name: 'get_rate_quote', arguments: { ... }, call_id: '...' }
    const toolName = body.name || body.tool_name;
    const args = body.args || body.arguments || {};
    const callId = body.call?.call_id || body.call_id;

    if (!toolName) {
      return NextResponse.json(
        { error: 'Missing required tool name parameter' },
        { status: 400 }
      );
    }

    const response = await dispatchTool(
      {
        tool_name: toolName,
        arguments: args,
        call_id: callId,
      },
      authContext
    );

    logTrace(correlation, 'RETELL_TOOL_COMPLETED', {
      tool: toolName,
      status: response.status,
      latency_ms: response.latency_ms,
    });

    // Retell expects either { result: ... } or direct object
    return NextResponse.json({
      result: response.result,
      status: response.status,
      success: response.success,
    });
  } catch (error) {
    logError(correlation, 'RETELL_TOOL_ERROR', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Tool execution error',
      },
      { status: 500 }
    );
  }
}
