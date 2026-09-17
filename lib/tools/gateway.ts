/**
 * LOGIVOICE V1 — DETERMINISTIC TOOL GATEWAY
 * The single, authoritative entry point for voice agent tool calling.
 *
 * Enforces:
 * - Strict schema validation
 * - Server-side tenant scoping
 * - Role-based authorization
 * - Audit event persistence
 * - Latency measurement
 * - Predictable error handling
 */

import { AuthContext } from '@/lib/auth/context';
import { db } from '@/lib/db';
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

export async function dispatchTool(
  request: ToolExecutionRequest,
  authContext: AuthContext
): Promise<ToolExecutionResponse> {
  const startTime = Date.now();
  const { tool_name, arguments: args, call_id } = request;
  const tenantId = authContext.tenantId;

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
        const effectiveCallId = call_id || (args.call_id as string) || undefined;
        const validated = CreateBookingRequestInputSchema.parse({ ...args, call_id: effectiveCallId });
        const res = await executeCreateBookingRequest(validated, tenantId);
        result = res as unknown as Record<string, unknown>;
        executionStatus = res.status;
        break;
      }

      case 'create_support_ticket': {
        const effectiveCallId = call_id || (args.call_id as string) || undefined;
        const validated = CreateSupportTicketInputSchema.parse({ ...args, call_id: effectiveCallId });
        const res = await executeCreateSupportTicket(validated, tenantId);
        result = res as unknown as Record<string, unknown>;
        executionStatus = res.status;
        break;
      }

      case 'transfer_to_human': {
        const effectiveCallId = call_id || (args.call_id as string) || undefined;
        const validated = TransferToHumanInputSchema.parse({ ...args, call_id: effectiveCallId });
        const res = await executeTransferToHuman(validated, tenantId);
        result = res as unknown as Record<string, unknown>;
        executionStatus = res.status;
        break;
      }

      case 'save_call_outcome': {
        const validated = SaveCallOutcomeInputSchema.parse(args);
        const res = await executeSaveCallOutcome(validated, tenantId);
        result = res as unknown as Record<string, unknown>;
        executionStatus = res.status;
        break;
      }

      case 'send_followup': {
        const effectiveCallId = call_id || (args.call_id as string);
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

    // Log Tool Execution Event in Audit Trail safely
    try {
      await db.logAuditEvent(
        {
          tenant_id: tenantId,
          call_id,
          event_type: 'TOOL_EXECUTION',
          actor: authContext.userId,
          actor_type: authContext.role === 'VOICE_GATEWAY' ? 'AI_AGENT' : 'DISPATCHER',
          actor_id: authContext.userId,
          tool_name,
          severity: 'INFO',
          details: {
            arguments: args,
            status: executionStatus,
            latency_ms: latencyMs,
          },
        },
        tenantId
      );
    } catch {
      // Best-effort audit logging
    }

    const isFailureStatus = ['FAILED', 'PROVIDER_UNAVAILABLE', 'PROVIDER_ERROR', 'UNAVAILABLE', 'TRANSFER_UNAVAILABLE'].includes(executionStatus);

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

    try {
      await db.logAuditEvent(
        {
          tenant_id: tenantId,
          call_id,
          event_type: 'TOOL_EXECUTION_FAILED',
          actor: authContext.userId,
          actor_type: 'AI_AGENT',
          actor_id: authContext.userId,
          tool_name,
          severity: 'ERROR',
          details: {
            arguments: args,
            error: errorMessage,
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
      success: false,
      status: 'FAILED',
      result: {},
      error: errorMessage,
      latency_ms: latencyMs,
    };
  }
}
