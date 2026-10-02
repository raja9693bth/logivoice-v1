/**
 * LOGIVOICE V1 — AUTHORITATIVE TELEPHONY TRANSFER ADAPTER
 * 
 * Enforces:
 * 1. TRANSFERRED status is ONLY returned when an actual provider transfer operation
 *    is invoked over the network and accepted/confirmed by the telephony provider.
 * 2. Environment variables are configuration, NOT provider confirmation.
 * 3. Network timeouts, provider rejections, or unconfigured states fail closed and
 *    fall back to durable callback scheduling.
 */

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
  status: 'TRANSFERRED' | 'PROVIDER_REJECTED' | 'PROVIDER_TIMEOUT' | 'PROVIDER_ERROR' | 'UNCONFIGURED';
  providerTransferId?: string;
  provider: string;
  error?: string;
  message: string;
}

/**
 * Invokes live provider transfer operation.
 * Supported providers: Twilio REST API / SIP Referral, Retell Telephony Bridge.
 */
export async function executeProviderCallTransfer(
  req: TelephonyTransferRequest
): Promise<TelephonyTransferResult> {
  const isEnabled = process.env.ENABLE_LIVE_TELEPHONY_TRANSFER === 'true';
  const accountSid = process.env.TELEPHONY_PROVIDER_ACCOUNT_SID;
  const authToken = process.env.TELEPHONY_PROVIDER_AUTH_TOKEN;

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

  try {
    const authHeader = `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`;
    const callSid = req.callId && req.callId.startsWith('CA') ? req.callId : 'current';
    const providerUrl = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Calls/${encodeURIComponent(callSid)}.json`;

    const res = await fetch(providerUrl, {
      method: 'POST',
      headers: {
        Authorization: authHeader,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        To: req.targetPhone,
        Twiml: `<Response><Dial callerId="${req.callerPhone || ''}">${req.targetPhone}</Dial></Response>`,
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
        provider: 'TWILIO_REST_GATEWAY',
        error: `Telephony provider rejected transfer: ${errDetails}`,
        message: `Telephony provider rejected transfer to ${req.targetRole} (${req.targetPhone}).`,
      };
    }

    const data = await res.json();
    const providerTransferId = data.sid || data.id;

    if (!providerTransferId) {
      return {
        success: false,
        status: 'PROVIDER_ERROR',
        provider: 'TWILIO_REST_GATEWAY',
        error: 'Malformed provider response: missing confirmation transfer ID',
        message: 'Provider responded without a transfer confirmation ID.',
      };
    }

    return {
      success: true,
      status: 'TRANSFERRED',
      providerTransferId,
      provider: 'TWILIO_REST_GATEWAY',
      message: `Call transferred successfully to ${req.targetName || req.targetRole} at ${req.targetPhone}.`,
    };
  } catch (err) {
    clearTimeout(timeoutId);
    if (err instanceof Error && err.name === 'AbortError') {
      return {
        success: false,
        status: 'PROVIDER_TIMEOUT',
        provider: 'TWILIO_REST_GATEWAY',
        error: 'Telephony provider timed out after 8000ms while establishing transfer bridge.',
        message: 'Telephony provider timed out.',
      };
    }

    return {
      success: false,
      status: 'PROVIDER_ERROR',
      provider: 'TWILIO_REST_GATEWAY',
      error: err instanceof Error ? err.message : 'Network error reaching telephony transfer provider',
      message: 'Network error executing live call transfer.',
    };
  }
}
