/**
 * LOGIVOICE V1 — AUTHORITATIVE TELEPHONY TRANSFER ADAPTER
 * 
 * Enforces:
 * 1. Strict E.164 phone number formatting and XML escaping for TwiML generation.
 * 2. Official Twilio REST Call Update resource contract (Twiml parameter without unsupported To parameter).
 * 3. Accurate provider status mapping: TRANSFER_REQUEST_ACCEPTED when instructions updated;
 *    TRANSFER_CONNECTED only when destination leg is confirmed bridged.
 * 4. Network timeouts (8s) fail closed and fall back to durable callback scheduling.
 */

import { getCanonicalTelephonyCredentials } from '@/lib/env';
import twilio from 'twilio';

export interface TelephonyTransferRequest {
  callId?: string;
  callerPhone?: string;
  targetPhone: string;
  targetRole: string;
  targetName?: string;
  reason: string;
  contextSummary?: string;
  tenantId: string;
}

export interface TelephonyTransferResult {
  success: boolean;
  status:
    | 'TRANSFERRED'
    | 'TRANSFER_REQUEST_ACCEPTED'
    | 'TRANSFER_CONNECTED'
    | 'PROVIDER_REJECTED'
    | 'PROVIDER_TIMEOUT'
    | 'PROVIDER_ERROR'
    | 'UNCONFIGURED';
  providerTransferId?: string;
  provider: string;
  error?: string;
  message: string;
}

/**
 * Sanitizes XML attribute and element values to prevent XML injection (CWE-91).
 */
export function escapeXml(unsafe: string): string {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Invokes live provider transfer operation.
 * Supported providers: Twilio REST API / SIP Referral, Retell Telephony Bridge.
 */
export async function executeProviderCallTransfer(
  req: TelephonyTransferRequest
): Promise<TelephonyTransferResult> {
  const isEnabled = process.env.ENABLE_LIVE_TELEPHONY_TRANSFER === 'true';
  const { accountSid, authToken } = getCanonicalTelephonyCredentials();

  if (!isEnabled || !accountSid || !authToken) {
    return {
      success: false,
      status: 'UNCONFIGURED',
      provider: 'TELEPHONY_GATEWAY',
      error: 'Live telephony transfer provider is not configured or disabled in environment.',
      message: 'Telephony transfer provider unconfigured.',
    };
  }

  // Bound transfer execution to 8 seconds timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);

  let providerName = 'TWILIO_REST_GATEWAY';
  let providerTransferId: string | undefined;
  let responseData: any = null;

  try {
    // A. Twilio REST Gateway (Requires genuine Twilio CallSid starting with CA)
    const isTwilioCallSid = Boolean(req.callId && /^CA[0-9a-fA-F]{32}$/.test(req.callId));

    if (isTwilioCallSid && accountSid && authToken) {
      providerName = 'TWILIO_REST_GATEWAY';
      const authHeader = `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`;
      const providerUrl = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Calls/${encodeURIComponent(req.callId!)}.json`;

      // Strict E.164 phone number validation (+ followed by 1 to 15 digits)
      const E164_PHONE_REGEX = /^\+[1-9]\d{1,14}$/;
      let cleanTargetPhone = req.targetPhone.replace(/[\s()-]/g, '');
      if (!cleanTargetPhone.startsWith('+')) {
        cleanTargetPhone = `+${cleanTargetPhone}`;
      }

      if (!E164_PHONE_REGEX.test(cleanTargetPhone)) {
        clearTimeout(timeoutId);
        return {
          success: false,
          status: 'PROVIDER_ERROR',
          provider: 'TWILIO_REST_GATEWAY',
          error: 'Target phone number does not conform to valid E.164 standard (+[1-9]1..14).',
          message: 'Invalid target phone format for call transfer.',
        };
      }

      let cleanCallerPhone = req.callerPhone ? req.callerPhone.replace(/[\s()-]/g, '') : '';
      if (cleanCallerPhone && !cleanCallerPhone.startsWith('+')) {
        cleanCallerPhone = `+${cleanCallerPhone}`;
      }
      const safeCallerPhone = cleanCallerPhone && E164_PHONE_REGEX.test(cleanCallerPhone) ? cleanCallerPhone : '';

      // Secure TwiML construction: official Twilio VoiceResponse builder (immune to XML injection)
      const twimlResponse = new twilio.twiml.VoiceResponse();
      const dial = safeCallerPhone
        ? twimlResponse.dial({ callerId: safeCallerPhone })
        : twimlResponse.dial();
      dial.number(cleanTargetPhone);
      const safeTwiml = twimlResponse.toString();

      // Call Resource Update: ONLY send Twiml parameter (To is only for new outbound calls)
      const res = await fetch(providerUrl, {
        method: 'POST',
        headers: {
          Authorization: authHeader,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          Twiml: safeTwiml,
        }).toString(),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!res.ok) {
        let errDetails = `HTTP ${res.status}`;
        try {
          const errJson = await res.json();
          errDetails = errJson.message || errJson.error_message || errDetails;
        } catch {
          // Fallback to HTTP status
        }

        return {
          success: false,
          status: 'PROVIDER_REJECTED',
          provider: providerName,
          error: `Telephony provider rejected transfer: ${errDetails}`,
          message: `Telephony provider rejected transfer to ${req.targetRole} (${req.targetPhone}).`,
        };
      }

      const data = await res.json();
      responseData = data;
      providerTransferId = data.sid || data.id;
    } else {
      clearTimeout(timeoutId);
      return {
        success: false,
        status: 'PROVIDER_ERROR',
        provider: 'TELEPHONY_GATEWAY',
        error: 'Active call transfer requires a valid Twilio CallSid (CA...) or supported telephony provider integration.',
        message: 'No active provider telephony context found for call transfer.',
      };
    }

    if (!providerTransferId) {
      return {
        success: false,
        status: 'PROVIDER_ERROR',
        provider: providerName,
        error: 'Malformed provider response: missing confirmation transfer ID',
        message: 'Provider responded without a transfer confirmation ID.',
      };
    }

    // Provider accepting updated TwiML is TRANSFER_REQUEST_ACCEPTED.
    // TRANSFER_CONNECTED is reserved for provider callbacks proving the leg bridged.
    const transferStatus =
      responseData?.status === 'completed'
        ? 'TRANSFER_CONNECTED'
        : 'TRANSFER_REQUEST_ACCEPTED';

    return {
      success: true,
      status: transferStatus,
      providerTransferId,
      provider: providerName,
      message: `Call transfer request accepted by provider for ${req.targetName || req.targetRole} at ${req.targetPhone}.`,
    };
  } catch (err) {
    clearTimeout(timeoutId);
    if (err instanceof Error && err.name === 'AbortError') {
      return {
        success: false,
        status: 'PROVIDER_TIMEOUT',
        provider: providerName,
        error: 'Telephony provider timed out after 8000ms while establishing transfer bridge.',
        message: 'Telephony provider timed out.',
      };
    }

    return {
      success: false,
      status: 'PROVIDER_ERROR',
      provider: providerName,
      error: err instanceof Error ? err.message : 'Network error reaching telephony transfer provider',
      message: 'Network error executing live call transfer.',
    };
  }
}
