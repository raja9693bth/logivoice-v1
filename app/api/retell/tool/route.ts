/**
 * LOGIVOICE V1 — RETELL REAL-TIME TOOL EXECUTION ENDPOINT
 * POST /api/retell/tool
 *
 * Called by Retell during an active call to execute any of the 8 controlled tools.
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyRetellWebhookSignature, AuthContext } from '@/lib/auth/context';
import { dispatchTool } from '@/lib/tools/gateway';
import { DEFAULT_TENANT_ID } from '@/lib/db';
import { createCorrelationContext, logTrace, logError } from '@/lib/observability/correlation';

const ALLOWED_TOOLS = [
  'lookup_customer',
  'get_rate_quote',
  'get_tracking_status',
  'create_booking_request',
  'create_support_ticket',
  'transfer_to_human',
  'save_call_outcome',
  'send_followup',
];

export async function POST(req: NextRequest) {
  const correlation = createCorrelationContext(DEFAULT_TENANT_ID, undefined, 'RETELL_TOOL_ENDPOINT');

  try {
    const rawBodyText = await req.text();
    const signature = req.headers.get('x-retell-signature');
    const authHeader = req.headers.get('authorization');
    const apiKey = req.headers.get('x-api-key');

    const expectedKey = process.env.RETELL_API_KEY;
    const isTestBypass = process.env.NODE_ENV === 'test' && req.headers.get('x-test-bypass-sig') === 'true';

    const hasValidSignature = isTestBypass || verifyRetellWebhookSignature(rawBodyText, signature);
    const hasValidKey =
      Boolean(expectedKey) &&
      (apiKey === expectedKey || authHeader?.replace('Bearer ', '').trim() === expectedKey);

    if (!hasValidSignature && !hasValidKey && (process.env.NODE_ENV === 'production' || expectedKey)) {
      logError(correlation, 'RETELL_TOOL_AUTH_FAILED', { hasSignature: Boolean(signature), hasKey: Boolean(apiKey || authHeader) });
      return NextResponse.json(
        { error: 'Unauthorized: Invalid or missing Retell authentication credentials' },
        { status: 401 }
      );
    }

    let body: any;
    try {
      body = JSON.parse(rawBodyText);
    } catch {
      return NextResponse.json({ error: 'Malformed JSON payload' }, { status: 400 });
    }

    const toolName = body.name || body.tool_name;
    const args = body.args || body.arguments || {};
    const callId = body.call_id || body.callId || args.call_id;
    let tenantId: string;
    if (process.env.NODE_ENV === 'production') {
      const authTenant = process.env.AUTHORITATIVE_TENANT_ID;
      if (!authTenant || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(authTenant)) {
        logError(correlation, 'PRODUCTION_TOOL_TENANT_MISSING', {});
        return NextResponse.json(
          { error: 'Authoritative tenant mapping missing or invalid in production configuration' },
          { status: 403 }
        );
      }
      tenantId = authTenant;
    } else {
      tenantId = body.tenant_id || DEFAULT_TENANT_ID;
    }

    logTrace(correlation, 'RETELL_TOOL_INVOKED', { toolName, callId });

    if (!toolName) {
      return NextResponse.json(
        { error: 'Missing required tool name parameter' },
        { status: 400 }
      );
    }

    // Strict allowlist: never allow arbitrary tool invocations or raw SQL
    if (!ALLOWED_TOOLS.includes(toolName)) {
      logError(correlation, 'UNAUTHORIZED_TOOL_REJECTED', { toolName });
      return NextResponse.json(
        { error: `Tool '${toolName}' is not an authorized LogiVoice tool`, allowed_tools: ALLOWED_TOOLS },
        { status: 400 }
      );
    }

    const authContext: AuthContext = {
      userId: 'retell-voice-server',
      tenantId,
      role: 'VOICE_GATEWAY',
      isAuthenticated: true,
      source: hasValidSignature ? 'WEBHOOK_SIGNATURE' : 'API_TOKEN',
    };

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
