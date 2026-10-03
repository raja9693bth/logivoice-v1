/**
 * LOGIVOICE V1 — RETELL REAL-TIME TOOL EXECUTION ENDPOINT
 * POST /api/retell/tool
 *
 * Called by Retell during an active call to execute any of the 8 controlled tools.
 * 
 * Narrow Authority Security Model:
 * 1. Requires verified X-Retell-Signature OR dedicated RETELL_TOOL_SECRET.
 *    Does NOT accept broad master RETELL_API_KEY for custom tool execution.
 * 2. Strict allowlist for tool names and runtime argument validation.
 * 3. Enforces authoritative tenant mapping and agent mapping.
 * 4. Lightweight sliding-window rate limiting to prevent abuse.
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
] as const;

// Advisory in-memory sliding rate limiter: max 120 calls per minute per IP / caller.
// NOTE: This is an advisory per-process limiter and does NOT provide distributed cluster-wide throttling.
// Authoritative security boundary is strictly enforced by Retell cryptographic signature verification
// (X-Retell-Signature) and dedicated RETELL_TOOL_SECRET validation.
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(key: string, limit = 120, windowMs = 60000): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(key);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (entry.count >= limit) {
    return false;
  }
  entry.count++;
  return true;
}

export async function POST(req: NextRequest) {
  const correlation = createCorrelationContext(DEFAULT_TENANT_ID, undefined, 'RETELL_TOOL_ENDPOINT');
  const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';

  if (!checkRateLimit(clientIp)) {
    logError(correlation, 'RATE_LIMIT_EXCEEDED', { clientIp });
    return NextResponse.json(
      { error: 'Rate limit exceeded. Too many tool requests.', correlation_id: correlation.correlationId },
      { status: 429 }
    );
  }

  try {
    const rawBodyText = await req.text();
    const signature = req.headers.get('x-retell-signature');
    const toolSecretHeader = req.headers.get('x-tool-secret') || req.headers.get('x-api-key');

    const dedicatedToolSecret = process.env.RETELL_TOOL_SECRET;
    const isTestBypass = process.env.NODE_ENV === 'test' && req.headers.get('x-test-bypass-sig') === 'true';

    // 1. Signature Verification
    const hasValidSignature = isTestBypass || (await verifyRetellWebhookSignature(rawBodyText, signature));

    // 2. Dedicated Tool Secret Verification (Never reuses master RETELL_API_KEY in production)
    const hasValidToolSecret = Boolean(dedicatedToolSecret) && toolSecretHeader === dedicatedToolSecret;

    const isAuthorized = hasValidSignature || hasValidToolSecret;

    if (!isAuthorized && (process.env.NODE_ENV === 'production' || dedicatedToolSecret || signature)) {
      logError(correlation, 'RETELL_TOOL_AUTH_FAILED', {
        hasSignature: Boolean(signature),
        hasSecret: Boolean(toolSecretHeader),
      });
      return NextResponse.json(
        {
          error: 'Unauthorized: Invalid or missing Retell tool credentials (signature or dedicated tool secret required)',
          correlation_id: correlation.correlationId,
        },
        { status: 401 }
      );
    }

    let body: any;
    try {
      body = JSON.parse(rawBodyText);
    } catch {
      return NextResponse.json(
        { error: 'Malformed JSON payload', correlation_id: correlation.correlationId },
        { status: 400 }
      );
    }

    const toolName = body.name || body.tool_name;
    const args = body.args || body.arguments || {};
    const callId = body.call_id || body.callId || args.call_id;
    const agentId = body.agent_id || args.agent_id;

    // Validate agent ID mapping in production: fail closed on missing config, missing agent, or mismatch
    const configuredAgentId = process.env.RETELL_AGENT_ID;
    if (process.env.NODE_ENV === 'production') {
      if (!configuredAgentId) {
        logError(correlation, 'RETELL_AGENT_CONFIG_MISSING', {});
        return NextResponse.json(
          { error: 'Production configuration error: RETELL_AGENT_ID is unconfigured', correlation_id: correlation.correlationId },
          { status: 500 }
        );
      }
      if (!agentId) {
        logError(correlation, 'RETELL_AGENT_ID_MISSING', {});
        return NextResponse.json(
          { error: 'Unauthorized: Agent identifier is required in production requests', correlation_id: correlation.correlationId },
          { status: 401 }
        );
      }
      if (agentId !== configuredAgentId) {
        logError(correlation, 'RETELL_AGENT_MISMATCH', { agentId, configuredAgentId });
        return NextResponse.json(
          { error: 'Unauthorized: Agent identifier mismatch', correlation_id: correlation.correlationId },
          { status: 403 }
        );
      }
    }

    let tenantId: string;
    if (process.env.NODE_ENV === 'production') {
      const authTenant = process.env.AUTHORITATIVE_TENANT_ID;
      if (!authTenant || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(authTenant)) {
        logError(correlation, 'PRODUCTION_TOOL_TENANT_MISSING', {});
        return NextResponse.json(
          { error: 'Authoritative tenant mapping missing or invalid in production configuration', correlation_id: correlation.correlationId },
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
        { error: 'Missing required tool name parameter', correlation_id: correlation.correlationId },
        { status: 400 }
      );
    }

    // Strict allowlist: never allow arbitrary tool invocations
    if (!ALLOWED_TOOLS.includes(toolName as any)) {
      logError(correlation, 'UNAUTHORIZED_TOOL_REJECTED', { toolName });
      return NextResponse.json(
        {
          error: `Tool '${toolName}' is not an authorized LogiVoice tool`,
          allowed_tools: ALLOWED_TOOLS,
          correlation_id: correlation.correlationId,
        },
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

    const execution = await dispatchTool(
      {
        tool_name: toolName,
        arguments: args,
        call_id: callId,
        external_call_id: callId,
      },
      authContext
    );

    return NextResponse.json({
      success: execution.success,
      tool_name: execution.tool_name,
      status: execution.status,
      result: execution.result,
      latency_ms: execution.latency_ms,
      correlation_id: correlation.correlationId,
      ...(execution.error ? { error: execution.error } : {}),
    });
  } catch (error) {
    logError(correlation, 'RETELL_TOOL_EXCEPTION', error);
    return NextResponse.json(
      {
        success: false,
        status: 'FAILED',
        error: 'Tool execution internal failure',
        correlation_id: correlation.correlationId,
      },
      { status: 500 }
    );
  }
}
