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
      ...metadata,
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
      ...metadata,
    })
  );
}
