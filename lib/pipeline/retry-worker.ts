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
import { syncCallToGoogleSheets, checkIfCallExistsInGoogleSheets } from '@/lib/integrations/google-sheets';
import { sendControlledFollowup } from '@/lib/integrations/messaging';
import { SideEffectClaim, Call } from '@/types/logivoice';

export interface RetryExecutionResult {
  claim_key: string;
  job_type: string;
  status: 'PROCESSED' | 'SKIPPED' | 'FAILED' | 'UNKNOWN';
  message: string;
}

/**
 * Atomically marks an orphaned claim as failed with a non-retryable error.
 */
async function failOrphanedClaim(
  tenantId: string,
  claimKey: string,
  jobType: string,
  callId: string | undefined,
  reason: string
): Promise<void> {
  const orphanedClaim = await db.claimSideEffect(tenantId, claimKey, jobType, callId);
  if (orphanedClaim.claimed) {
    await db.failSideEffect(
      tenantId,
      claimKey,
      reason,
      false,
      60000,
      orphanedClaim.claim_token
    );
  }
}

async function resolveCallForClaim(claim: SideEffectClaim): Promise<Call | null> {
  const externalCallId = claim.claim_key.split(':').pop() || '';
  const call = await db.getCallByExternalId(externalCallId, claim.tenant_id);
  if (!call) {
    await failOrphanedClaim(
      claim.tenant_id,
      claim.claim_key,
      claim.job_type,
      claim.call_id,
      `Call record for ${externalCallId} not found`
    );
  }
  return call;
}

async function transitionUnknownClaim(
  tenantId: string,
  claimKey: string,
  jobType: string,
  callId: string | undefined,
  targetStatus: 'SUCCEEDED' | 'RETRYABLE',
  businessStatus: string,
  providerRef?: string
): Promise<void> {
  const takeover = await db.claimSideEffect(tenantId, claimKey, jobType, callId);
  if (takeover.claimed) {
    if (targetStatus === 'SUCCEEDED') {
      await db.completeSideEffect(
        tenantId,
        claimKey,
        { business_status: businessStatus, reconciled: true, provider_message_id: providerRef },
        takeover.claim_token
      );
    } else {
      await db.failSideEffect(
        tenantId,
        claimKey,
        'Reconciled from UNKNOWN: safe for controlled retry',
        true,
        60000,
        takeover.claim_token
      );
    }
  }
  await db.updateClaimReconciliation(tenantId, claimKey, targetStatus, providerRef);
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
        const call = await resolveCallForClaim(claim);
        if (!call) {
          results.push({
            claim_key: claim.claim_key,
            job_type: claim.job_type,
            status: 'FAILED',
            message: 'Call record not found',
          });
          continue;
        }

        const externalCallId = claim.claim_key.split(':').pop() || '';
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
        const call = await resolveCallForClaim(claim);
        if (!call) {
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
          await failOrphanedClaim(
            claim.tenant_id,
            claim.claim_key,
            claim.job_type,
            claim.call_id,
            'Missing call_id on claim record'
          );
          continue;
        }
        const call = await db.getCallById(claim.call_id, claim.tenant_id);
        const followup = await db.getFollowupByCallId(claim.call_id, claim.tenant_id);
        if (!call || !followup) {
          await failOrphanedClaim(
            claim.tenant_id,
            claim.claim_key,
            claim.job_type,
            claim.call_id,
            'Call or followup record not found'
          );
          continue;
        }

        const config = await db.getClientConfig(claim.tenant_id);
        const sendRes = await sendControlledFollowup({
          tenantId: claim.tenant_id,
          callId: call.id,
          recipientPhone: followup.recipient,
          templateId: (followup.template_id as any) || 'INQUIRY_RECEIVED',
          templateData: {
            customerName: call.customer?.name,
            brand: config.brand_name || config.business_name || 'LogiVoice',
            origin: call.facts?.route_from,
            destination: call.facts?.route_to,
            vehicleType: call.facts?.vehicle_type,
            quotedAmount: call.facts?.quoted_amount,
            trackingId: call.facts?.tracking_id,
            currentStatus: call.facts?.tracking_status,
            currentLocation: call.facts?.tracking_location,
            etaFormatted: call.facts?.verified_eta,
            bookingUrl: config.booking_url,
          },
          channel: 'WHATSAPP',
        });

        results.push({
          claim_key: claim.claim_key,
          job_type: claim.job_type,
          status: sendRes.success ? 'PROCESSED' : 'FAILED',
          message: `Followup send status: ${sendRes.status}`,
        });
      } else {
        await failOrphanedClaim(
          claim.tenant_id,
          claim.claim_key,
          claim.job_type,
          claim.call_id,
          `Unknown side effect job type: ${claim.job_type}`
        );
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

/**
 * Reconciles UNKNOWN side-effect claims according to provider truth:
 * - Never blindly re-runs UNKNOWN side-effects
 * - Inspects provider state / target data
 * - Transitions to SUCCEEDED if operation confirmed
 * - Transitions to RETRYABLE only if safe to resend
 * - Persists reconciliation metadata (last_reconciled_at, attempts, result)
 */
export async function reconcileUnknownClaims(limit = 10): Promise<{
  reconciled_count: number;
  results: RetryExecutionResult[];
}> {
  const unknownClaims = await db.listUnknownClaims(limit);
  const results: RetryExecutionResult[] = [];

  for (const claim of unknownClaims) {
    try {
      const tenantId = claim.tenant_id;
      const claimKey = claim.claim_key;

      if (claim.job_type === 'SHEETS_SYNC' || claim.job_type === 'GOOGLE_SHEETS_SYNC') {
        const claimRecord = await db.getSideEffectClaim(tenantId, claimKey);
        const isAlreadySynced =
          claimRecord?.result &&
          (claimRecord.result as Record<string, unknown>).business_status === 'SYNCED';

        if (isAlreadySynced) {
          await transitionUnknownClaim(
            tenantId,
            claimKey,
            claim.job_type,
            claim.call_id,
            'SUCCEEDED',
            'SYNCED'
          );
          results.push({
            claim_key: claimKey,
            job_type: claim.job_type,
            status: 'PROCESSED',
            message: 'Reconciliation confirmed Google Sheets append completed',
          });
        } else {
          // Authoritatively query target worksheet to prevent duplicate appends (Phase 30)
          const externalCallId = claimKey.split(':').pop() || '';
          const sheetPresence = await checkIfCallExistsInGoogleSheets(externalCallId, tenantId);

          if (sheetPresence === 'EXISTS') {
            await transitionUnknownClaim(
              tenantId,
              claimKey,
              claim.job_type,
              claim.call_id,
              'SUCCEEDED',
              'SYNCED'
            );
            results.push({
              claim_key: claimKey,
              job_type: claim.job_type,
              status: 'PROCESSED',
              message: 'Reconciliation verified row already present in Google Sheet: marked SUCCEEDED',
            });
          } else if (sheetPresence === 'NOT_FOUND') {
            await transitionUnknownClaim(
              tenantId,
              claimKey,
              claim.job_type,
              claim.call_id,
              'RETRYABLE',
              'PENDING'
            );
            results.push({
              claim_key: claimKey,
              job_type: claim.job_type,
              status: 'PROCESSED',
              message: 'Reconciliation verified row absent in Google Sheet: safe for controlled retry',
            });
          } else {
            // Uncertain / provider unreachable: remain UNKNOWN
            await db.updateClaimReconciliation(tenantId, claimKey, 'STILL_UNKNOWN');
            results.push({
              claim_key: claimKey,
              job_type: claim.job_type,
              status: 'UNKNOWN',
              message: 'Google Sheets reconciliation uncertain: remained UNKNOWN awaiting verification',
            });
          }
        }
      } else if (claim.job_type === 'FOLLOWUP_SEND') {
        let isDispatched = false;
        let providerMsgId: string | undefined;

        if (claim.call_id) {
          const followup = await db.getFollowupByCallId(claim.call_id, tenantId);
          if (followup && (followup.status === 'SENT' || followup.status === 'DELIVERED')) {
            isDispatched = true;
            providerMsgId = followup.provider_message_id || undefined;
          }
        }

        if (isDispatched) {
          await transitionUnknownClaim(
            tenantId,
            claimKey,
            claim.job_type,
            claim.call_id,
            'SUCCEEDED',
            'SENT',
            providerMsgId
          );
          results.push({
            claim_key: claimKey,
            job_type: claim.job_type,
            status: 'PROCESSED',
            message: 'Reconciliation confirmed WhatsApp follow-up was dispatched',
          });
        } else if (claim.call_id) {
          // Controlled safe resend only when distinct call record exists
          await transitionUnknownClaim(
            tenantId,
            claimKey,
            claim.job_type,
            claim.call_id,
            'RETRYABLE',
            'PENDING'
          );
          results.push({
            claim_key: claimKey,
            job_type: claim.job_type,
            status: 'PROCESSED',
            message: 'Reconciled from UNKNOWN to RETRYABLE for controlled send',
          });
        } else {
          // Phase 31: If uncertain or missing call record, do not blindly resend
          await db.updateClaimReconciliation(tenantId, claimKey, 'STILL_UNKNOWN');
          results.push({
            claim_key: claimKey,
            job_type: claim.job_type,
            status: 'UNKNOWN',
            message: 'Follow-up provider status uncertain: remained UNKNOWN for operator review',
          });
        }
      } else {
        await db.updateClaimReconciliation(tenantId, claimKey, 'STILL_UNKNOWN');
        results.push({
          claim_key: claimKey,
          job_type: claim.job_type,
          status: 'UNKNOWN',
          message: `Job type ${claim.job_type} remains UNKNOWN awaiting provider confirmation`,
        });
      }
    } catch (err) {
      results.push({
        claim_key: claim.claim_key,
        job_type: claim.job_type,
        status: 'FAILED',
        message: err instanceof Error ? err.message : 'Reconciliation error',
      });
    }
  }

  return {
    reconciled_count: results.filter((r) => r.status === 'PROCESSED').length,
    results,
  };
}
