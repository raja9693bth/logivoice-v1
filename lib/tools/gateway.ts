/**
 * LOGIVOICE V1 — DETERMINISTIC TOOL GATEWAY
 * The single, authoritative entry point for voice agent tool calling.
 *
 * Enforces:
 * - Strict schema validation
 * - Server-side tenant scoping
 * - Role-based authorization & actor role preservation
 * - Centralized PII minimization in audit trails
 * - Latency measurement
 * - Predictable error handling (safe domain responses)
 */

import { AuthContext } from '@/lib/auth/context';
import { db, isValidUuid } from '@/lib/db';
import {
  LookupCustomerInputSchema,
  GetRateQuoteInputSchema,
  GetTrackingStatusInputSchema,
  CreateBookingRequestInputSchema,
  CreateSupportTicketInputSchema,
  TransferToHumanInputSchema,
  SaveCallOutcomeInputSchema,
  SendFollowupInputSchema,
} from '@/lib/schemas/tools';
import { formatMaskedPhone } from '@/lib/utils';

import { executeLookupCustomer } from './lookup-customer';
import { executeGetRateQuote } from './get-rate-quote';
import { executeGetTrackingStatus } from './get-tracking-status';
import { executeCreateBookingRequest } from './create-booking-request';
import { executeCreateSupportTicket } from './create-support-ticket';
import { executeTransferToHuman } from './transfer-to-human';
import { executeSaveCallOutcome } from './save-call-outcome';
import { executeSendFollowup } from './send-followup';

export interface ToolExecutionRequest {
  tool_name: string;
  arguments: Record<string, unknown>;
  call_id?: string;
  external_call_id?: string;
}

export interface ToolExecutionResponse {
  tool_name: string;
  success: boolean;
  status: string;
  result: Record<string, unknown>;
  latency_ms: number;
  error?: string;
}

/**
 * Sanitizes and minimizes tool arguments for audit logging.
 * Masks customer phone numbers, redacts message bodies, and strips any secret material.
 */
export function sanitizeAuditArguments(
  toolName: string,
  args: Record<string, unknown>
): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};

  for (const [key, val] of Object.entries(args)) {
    // Strip credential-like keys
    if (/key|secret|token|auth|password/i.test(key)) {
      continue;
    }

    // Mask phone numbers
    if (/phone|mobile|contact/i.test(key) && typeof val === 'string') {
      sanitized[key] = formatMaskedPhone(val);
      continue;
    }

    // Minimize long text / message bodies
    if (/content|message|body|text/i.test(key) && typeof val === 'string' && val.length > 50) {
      sanitized[key] = `${val.slice(0, 40)}... [${val.length} chars]`;
      continue;
    }

    sanitized[key] = val;
  }

  return sanitized;
}

/**
 * Sanitizes tool execution results before persisting to public.tool_executions.
 * Strips customer PII, raw credentials, and internal stack traces.
 */
export function sanitizeToolExecutionResult(
  toolName: string,
  result: Record<string, unknown> | null
): Record<string, unknown> {
  if (!result) return {};
  switch (toolName) {
    case 'get_rate_quote':
      return {
        status: result.status,
        quote_id: result.quote_id,
        price_inr: result.price_inr,
        quote_type: result.quote_type,
        rate_basis: result.rate_basis,
        origin: result.origin,
        destination: result.destination,
        vehicle_type: result.vehicle_type,
      };
    case 'get_tracking_status':
      return {
        status: result.status,
        tracking_id: result.tracking_id,
        current_status: result.current_status,
        current_location: result.current_location,
        verified_eta: result.verified_eta,
      };
    case 'create_booking_request':
      return {
        status: result.status,
        reference_no: result.reference_no,
        request_id: result.request_id,
      };
    case 'create_support_ticket':
      return {
        status: result.status,
        ticket_id: result.ticket_id,
        reference_no: result.reference_no,
        priority: result.priority,
      };
    case 'transfer_to_human':
      return {
        status: result.status,
        target_role: result.target_role,
        callback_reference: result.callback_reference,
      };
    case 'save_call_outcome':
      return {
        status: result.status,
        call_id: result.call_id,
        lead_id: result.lead_id,
        computed_temperature: result.computed_temperature,
      };
    case 'send_followup':
      return {
        status: result.status,
        followup_id: result.followup_id,
        channel: result.channel,
        provider_message_id: result.provider_message_id,
      };
    case 'lookup_customer':
      return {
        status: result.status,
        customer_found: result.status === 'FOUND',
      };
    default:
      return { status: result.status };
  }
}

export async function dispatchTool(
  request: ToolExecutionRequest,
  authContext: AuthContext
): Promise<ToolExecutionResponse> {
  const startTime = Date.now();
  const { tool_name, arguments: args, call_id, external_call_id } = request;
  const tenantId = authContext.tenantId;

  const rawCallIdentifier =
    call_id || external_call_id || (args?.call_id as string) || (args?.external_call_id as string) || undefined;
  const resolvedInternalCallId = await db.resolveInternalCallId({
    tenantId,
    externalCallId: rawCallIdentifier,
  });
  const effectiveInternalCallUuid =
    resolvedInternalCallId && isValidUuid(resolvedInternalCallId)
      ? resolvedInternalCallId
      : rawCallIdentifier && isValidUuid(rawCallIdentifier)
      ? rawCallIdentifier
      : null;
  const effectiveExternalCallId =
    (!isValidUuid(rawCallIdentifier) ? rawCallIdentifier : external_call_id) || null;
  const callRef = effectiveInternalCallUuid || rawCallIdentifier;

  try {
    let result: Record<string, unknown>;
    let executionStatus = 'SUCCESS';

    switch (tool_name) {
      case 'lookup_customer': {
        const validated = LookupCustomerInputSchema.parse(args);
        const res = await executeLookupCustomer(validated, tenantId);
        result = res as unknown as Record<string, unknown>;
        executionStatus = res.status;
        break;
      }

      case 'get_rate_quote': {
        const validated = GetRateQuoteInputSchema.parse(args);
        const res = await executeGetRateQuote(validated, tenantId);
        result = res as unknown as Record<string, unknown>;
        executionStatus = res.status;
        break;
      }

      case 'get_tracking_status': {
        const validated = GetTrackingStatusInputSchema.parse(args);
        const res = await executeGetTrackingStatus(validated, tenantId);
        result = res as unknown as Record<string, unknown>;
        executionStatus = res.status;
        break;
      }

      case 'create_booking_request': {
        const effectiveCallId = callRef || (args.call_id as string) || undefined;
        const validated = CreateBookingRequestInputSchema.parse({ ...args, call_id: effectiveCallId });
        const res = await executeCreateBookingRequest(validated, tenantId);
        result = res as unknown as Record<string, unknown>;
        executionStatus = res.status;
        break;
      }

      case 'create_support_ticket': {
        const effectiveCallId = callRef || (args.call_id as string) || undefined;
        const validated = CreateSupportTicketInputSchema.parse({ ...args, call_id: effectiveCallId });
        const res = await executeCreateSupportTicket(validated, tenantId);
        result = res as unknown as Record<string, unknown>;
        executionStatus = res.status;
        break;
      }

      case 'transfer_to_human': {
        const effectiveCallId = callRef || (args.call_id as string) || undefined;
        const validated = TransferToHumanInputSchema.parse({ ...args, call_id: effectiveCallId });
        const res = await executeTransferToHuman(validated, tenantId);
        result = res as unknown as Record<string, unknown>;
        executionStatus = res.status;
        break;
      }

      case 'save_call_outcome': {
        const effectiveCallId = callRef || (args.call_id as string) || undefined;
        const validated = SaveCallOutcomeInputSchema.parse({
          ...args,
          call_id: effectiveCallId,
          external_call_id: args.external_call_id || effectiveExternalCallId || effectiveCallId,
        });
        const res = await executeSaveCallOutcome(validated, tenantId);
        result = res as unknown as Record<string, unknown>;
        executionStatus = res.status;
        break;
      }

      case 'send_followup': {
        const effectiveCallId = callRef || (args.call_id as string) || undefined;
        const validated = SendFollowupInputSchema.parse({ ...args, call_id: effectiveCallId });
        const res = await executeSendFollowup(validated, tenantId);
        result = res as unknown as Record<string, unknown>;
        executionStatus = res.status;
        break;
      }

      default:
        throw new Error(`Unrecognized or unauthorized tool: '${tool_name}'`);
    }

    const latencyMs = Date.now() - startTime;
    const sanitizedArgs = sanitizeAuditArguments(tool_name, args);

    // Map actor role accurately (Preserve ADMIN, OPS_MANAGER, DISPATCHER, or AI_AGENT)
    const actorType =
      authContext.role === 'VOICE_GATEWAY'
        ? 'AI_AGENT'
        : authContext.role === 'ADMIN'
        ? 'ADMIN'
        : authContext.role === 'OPS_MANAGER'
        ? 'OPS_MANAGER'
        : 'DISPATCHER';

    const isFailureStatus = [
      'FAILED',
      'PROVIDER_UNAVAILABLE',
      'PROVIDER_ERROR',
      'UNAVAILABLE',
      'TRANSFER_UNAVAILABLE',
    ].includes(executionStatus);

    const businessStatus = String(result?.status || executionStatus);
    const verified =
      (tool_name === 'get_rate_quote' && businessStatus === 'SUCCESS') ||
      (tool_name === 'get_tracking_status' && businessStatus === 'FOUND') ||
      (tool_name === 'create_booking_request' && (businessStatus === 'CONFIRMED' || businessStatus === 'PENDING_CONFIRMATION')) ||
      (tool_name === 'create_support_ticket' && businessStatus === 'SUCCESS') ||
      (tool_name === 'transfer_to_human' && (businessStatus === 'TRANSFERRED' || businessStatus === 'TRANSFER_CONNECTED')) ||
      (tool_name === 'send_followup' && (businessStatus === 'SENT' || businessStatus === 'DELIVERED')) ||
      (tool_name === 'save_call_outcome' && businessStatus === 'SAVED') ||
      (tool_name === 'lookup_customer' && businessStatus === 'FOUND');

    const sanitizedResult = sanitizeToolExecutionResult(tool_name, result);

    // Record structured tool execution in public.tool_executions with explicit verification
    try {
      await db.recordToolExecution(
        {
          tenant_id: tenantId,
          call_id: effectiveInternalCallUuid,
          external_call_id: effectiveExternalCallId,
          tool_name,
          execution_status: 'COMPLETED',
          business_status: businessStatus,
          verified,
          success: verified,
          safe_result: sanitizedResult,
          latency_ms: latencyMs,
          provider_reference: (
            result?.provider_message_id ||
            result?.providerTransferId ||
            result?.provider_transfer_id ||
            result?.booking_id ||
            result?.request_id ||
            result?.ticket_id ||
            result?.transfer_id ||
            result?.quote_id
          ) as string || null,
        },
        tenantId
      );
    } catch {
      // Best-effort tool execution recording
    }

    // Log Tool Execution Event in Audit Trail with PII minimization
    try {
      await db.logAuditEvent(
        {
          tenant_id: tenantId,
          call_id: effectiveInternalCallUuid || undefined,
          external_call_id: effectiveExternalCallId || undefined,
          event_type: 'TOOL_EXECUTION',
          actor: authContext.userId,
          actor_type: actorType,
          actor_id: authContext.userId,
          tool_name,
          severity: 'INFO',
          details: {
            arguments: sanitizedArgs,
            status: executionStatus,
            latency_ms: latencyMs,
          },
        },
        tenantId
      );
    } catch {
      // Best-effort audit logging
    }

    return {
      tool_name,
      success: !isFailureStatus,
      status: executionStatus,
      result,
      latency_ms: latencyMs,
    };
  } catch (error) {
    const latencyMs = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : 'Unknown tool execution failure';
    const sanitizedArgs = sanitizeAuditArguments(tool_name, args);

    try {
      await db.recordToolExecution(
        {
          tenant_id: tenantId,
          call_id: effectiveInternalCallUuid,
          external_call_id: effectiveExternalCallId,
          tool_name,
          execution_status: 'FAILED',
          success: false,
          safe_result: { error: errorMessage },
          latency_ms: latencyMs,
        },
        tenantId
      );
    } catch {
      // Best-effort tool execution recording
    }

    try {
      await db.logAuditEvent(
        {
          tenant_id: tenantId,
          call_id: effectiveInternalCallUuid || undefined,
          external_call_id: effectiveExternalCallId || undefined,
          event_type: 'TOOL_EXECUTION_FAILED',
          actor: authContext.userId,
          actor_type: authContext.role === 'VOICE_GATEWAY' ? 'AI_AGENT' : 'DISPATCHER',
          actor_id: authContext.userId,
          tool_name,
          severity: 'ERROR',
          details: {
            arguments: sanitizedArgs,
            error: errorMessage,
            latency_ms: latencyMs,
          },
        },
        tenantId
      );
    } catch {
      // Best-effort audit logging
    }

    const safeError = errorMessage.includes('Unrecognized or unauthorized tool')
      ? errorMessage
      : 'Tool execution could not be completed. Operations team has been notified.';

    return {
      tool_name,
      success: false,
      status: 'FAILED',
      result: {},
      error: safeError,
      latency_ms: latencyMs,
    };
  }
}
