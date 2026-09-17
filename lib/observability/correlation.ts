/**
 * LOGIVOICE V1 — OBSERVABILITY & CORRELATION
 * Generates and tracks correlation IDs, execution latencies, and structured logs.
 */

export interface CorrelationContext {
  correlationId: string;
  tenantId: string;
  callId?: string;
  actor: string;
  startTime: number;
}

export function createCorrelationContext(
  tenantId: string,
  callId?: string,
  actor: string = 'VOICE_GATEWAY'
): CorrelationContext {
  return {
    correlationId: `corr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    tenantId,
    callId,
    actor,
    startTime: Date.now(),
  };
}

function sanitizeForLog(obj: unknown, depth = 0): unknown {
  if (depth > 5 || obj === null || obj === undefined) return obj;
  if (typeof obj !== 'object') return obj;

  if (Array.isArray(obj)) {
    return obj.map((item) => sanitizeForLog(item, depth + 1));
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    const lower = key.toLowerCase();
    if (
      lower.includes('password') ||
      lower.includes('secret') ||
      lower.includes('token') ||
      lower.includes('authorization') ||
      lower.includes('api_key') ||
      lower.includes('apikey')
    ) {
      sanitized[key] = '[REDACTED]';
    } else if (typeof value === 'object') {
      sanitized[key] = sanitizeForLog(value, depth + 1);
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

export function logTrace(context: CorrelationContext, event: string, metadata?: Record<string, unknown>) {
  const durationMs = Date.now() - context.startTime;
  console.log(
    JSON.stringify({
      level: 'INFO',
      timestamp: new Date().toISOString(),
      correlation_id: context.correlationId,
      tenant_id: context.tenantId,
      call_id: context.callId,
      actor: context.actor,
      event,
      duration_ms: durationMs,
      ...(metadata ? (sanitizeForLog(metadata) as Record<string, unknown>) : {}),
    })
  );
}

export function logError(
  context: CorrelationContext,
  event: string,
  error: unknown,
  metadata?: Record<string, unknown>
) {
  const durationMs = Date.now() - context.startTime;
  console.error(
    JSON.stringify({
      level: 'ERROR',
      timestamp: new Date().toISOString(),
      correlation_id: context.correlationId,
      tenant_id: context.tenantId,
      call_id: context.callId,
      actor: context.actor,
      event,
      duration_ms: durationMs,
      error: error instanceof Error ? { message: error.message, stack: error.stack } : error,
      ...(metadata ? (sanitizeForLog(metadata) as Record<string, unknown>) : {}),
    })
  );
}
