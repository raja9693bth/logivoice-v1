/**
 * LOGIVOICE V1 — AUTHORITATIVE RETRY WORKER
 *
 * Durable background job executor scanning eligible RETRYABLE rows:
 * - next_retry_at <= now()
 * - attempt_count < max_attempts
 * - lease is free / expired
 * - bounded exponential backoff
 */

import { db } from '@/lib/db';
import { processPostCallPipeline } from '@/lib/pipeline/post-call';
import { syncCallToGoogleSheets } from '@/lib/integrations/google-sheets';
import { sendControlledFollowup } from '@/lib/integrations/messaging';

export interface RetryExecutionResult {
  claim_key: string;
  job_type: string;
  status: 'PROCESSED' | 'SKIPPED' | 'FAILED' | 'UNKNOWN';
  message: string;
}

export async function runRetryWorker(limit = 10): Promise<{
  processed_count: number;
  results: RetryExecutionResult[];
}> {
  const eligibleClaims = await db.listEligibleRetryClaims(limit);
  const results: RetryExecutionResult[] = [];

  for (const claim of eligibleClaims) {
    try {
      if (claim.job_type === 'POST_CALL_PIPELINE') {
        const externalCallId = claim.claim_key.split(':').pop() || '';
        const call = await db.getCallByExternalId(externalCallId, claim.tenant_id);
        if (!call) {
          const orphanedClaim = await db.claimSideEffect(
            claim.tenant_id,
            claim.claim_key,
            claim.job_type,
            claim.call_id
          );
          if (orphanedClaim.claimed) {
            await db.failSideEffect(
              claim.tenant_id,
              claim.claim_key,
              `Call record for ${externalCallId} not found`,
              false,
              60000,
              orphanedClaim.claim_token
            );
          }
          results.push({
            claim_key: claim.claim_key,
            job_type: claim.job_type,
            status: 'FAILED',
            message: `Call record not found for external_call_id ${externalCallId}`,
          });
          continue;
        }

        const res = await processPostCallPipeline({
          external_call_id: externalCallId,
          from_number: call.customer?.phone,
          caller_name: call.customer?.name,
          started_at: call.started_at,
          ended_at: call.ended_at,
          duration_seconds: call.duration_seconds,
          transcript: call.transcript,
          summary: call.summary,
          intent: call.primary_intent,
          sentiment: call.sentiment,
          outcome: call.outcome,
          facts: call.facts || {},
          tenant_id: claim.tenant_id,
        });

        results.push({
          claim_key: claim.claim_key,
          job_type: claim.job_type,
          status: res.success ? 'PROCESSED' : 'FAILED',
          message: res.message,
        });
      } else if (claim.job_type === 'SHEETS_SYNC' || claim.job_type === 'GOOGLE_SHEETS_SYNC') {
        const externalCallId = claim.claim_key.split(':').pop() || '';
        const call = await db.getCallByExternalId(externalCallId, claim.tenant_id);
        if (!call) {
          const orphanedClaim = await db.claimSideEffect(
            claim.tenant_id,
            claim.claim_key,
            claim.job_type,
            claim.call_id
          );
          if (orphanedClaim.claimed) {
            await db.failSideEffect(
              claim.tenant_id,
              claim.claim_key,
              `Call record for ${externalCallId} not found`,
              false,
              60000,
              orphanedClaim.claim_token
            );
          }
          results.push({
            claim_key: claim.claim_key,
            job_type: claim.job_type,
            status: 'FAILED',
            message: 'Call not found',
          });
          continue;
        }

        const sheetsRes = await syncCallToGoogleSheets(call);
        results.push({
          claim_key: claim.claim_key,
          job_type: claim.job_type,
          status: sheetsRes.synced ? 'PROCESSED' : 'FAILED',
          message: `Sheets sync status: ${sheetsRes.status}`,
        });
      } else if (claim.job_type === 'FOLLOWUP_SEND') {
        if (!claim.call_id) {
          const orphanedClaim = await db.claimSideEffect(
            claim.tenant_id,
            claim.claim_key,
            claim.job_type,
            claim.call_id
          );
          if (orphanedClaim.claimed) {
            await db.failSideEffect(
              claim.tenant_id,
              claim.claim_key,
              'Missing call_id on claim record',
              false,
              60000,
              orphanedClaim.claim_token
            );
          }
          continue;
        }
        const call = await db.getCallById(claim.call_id, claim.tenant_id);
        const followup = await db.getFollowupByCallId(claim.call_id, claim.tenant_id);
        if (!call || !followup) {
          const orphanedClaim = await db.claimSideEffect(
            claim.tenant_id,
            claim.claim_key,
            claim.job_type,
            claim.call_id
          );
          if (orphanedClaim.claimed) {
            await db.failSideEffect(
              claim.tenant_id,
              claim.claim_key,
              'Call or followup record not found',
              false,
              60000,
              orphanedClaim.claim_token
            );
          }
          continue;
        }

        const sendRes = await sendControlledFollowup({
          tenantId: claim.tenant_id,
          callId: call.id,
          recipientPhone: followup.recipient,
          templateId: (followup.template_id as any) || 'INQUIRY_RECEIVED',
          templateData: { customerName: call.customer?.name },
          channel: followup.channel as any,
        });

        results.push({
          claim_key: claim.claim_key,
          job_type: claim.job_type,
          status: sendRes.success ? 'PROCESSED' : 'FAILED',
          message: `Followup send status: ${sendRes.status}`,
        });
      } else {
        const unknownJobClaim = await db.claimSideEffect(
          claim.tenant_id,
          claim.claim_key,
          claim.job_type,
          claim.call_id
        );
        if (unknownJobClaim.claimed) {
          await db.failSideEffect(
            claim.tenant_id,
            claim.claim_key,
            `Unknown side effect job type: ${claim.job_type}`,
            false,
            60000,
            unknownJobClaim.claim_token
          );
        }
        results.push({
          claim_key: claim.claim_key,
          job_type: claim.job_type,
          status: 'FAILED',
          message: `Unknown job type ${claim.job_type}`,
        });
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Unknown retry worker error';
      results.push({
        claim_key: claim.claim_key,
        job_type: claim.job_type,
        status: 'FAILED',
        message: errMsg,
      });
    }
  }

  return {
    processed_count: results.filter((r) => r.status === 'PROCESSED').length,
    results,
  };
}
