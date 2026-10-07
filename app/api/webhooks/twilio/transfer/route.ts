import { NextRequest, NextResponse } from 'next/server';
import twilio from 'twilio';
import { db, DEFAULT_TENANT_ID } from '@/lib/db';
import { handleApiError } from '@/lib/api/error-handler';

/**
 * LOGIVOICE V1 — TWILIO TRANSFER CONNECTED-LEG CALLBACK WEBHOOK
 * Route: /api/webhooks/twilio/transfer
 *
 * Implements official Twilio <Dial> action callback contract:
 * - Validates X-Twilio-Signature using official Twilio SDK
 * - Reads DialCallStatus ('completed', 'answered', 'busy', 'no-answer', 'failed', 'canceled')
 * - Proves TRANSFER_CONNECTED before setting final outcome to TRANSFERRED
 * - Falls back to CALLBACK_SCHEDULED ticket on busy/failed/no-answer
 * - Enforces monotonic transitions (cannot flip connected back to failed)
 * - Returns clean TwiML <Response/>
 */

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text();
    const params: Record<string, string> = {};
    const searchParams = new URLSearchParams(rawBody);
    searchParams.forEach((val, key) => {
      params[key] = val;
    });

    const authToken =
      process.env.TELEPHONY_PROVIDER_AUTH_TOKEN ||
      process.env.TWILIO_AUTH_TOKEN;

    // Signature verification using official Twilio validator
    if (authToken || process.env.NODE_ENV === 'production') {
      const signature = req.headers.get('x-twilio-signature') || req.headers.get('X-Twilio-Signature');
      if (!signature) {
        return new Response('<Response><Reject reason="busy"/></Response>', {
          status: 401,
          headers: { 'Content-Type': 'text/xml' },
        });
      }

      if (!authToken) {
        return new Response('<Response><Reject reason="busy"/></Response>', {
          status: 500,
          headers: { 'Content-Type': 'text/xml' },
        });
      }

      // Reconstruct the authoritative request URL
      const fullUrl = req.url;
      const isValid = twilio.validateRequest(authToken, signature, fullUrl, params);

      if (!isValid) {
        return new Response('<Response><Reject reason="busy"/></Response>', {
          status: 401,
          headers: { 'Content-Type': 'text/xml' },
        });
      }
    }

    const callSid = params.CallSid || '';
    const dialCallSid = params.DialCallSid || '';
    const dialCallStatus = (params.DialCallStatus || '').toLowerCase();
    const dialCallDuration = params.DialCallDuration ? Number.parseInt(params.DialCallDuration, 10) : undefined;

    // Resolve tenant ID safely (defaults to authoritative tenant in production)
    const tenantId =
      (process.env.NODE_ENV === 'production' ? process.env.AUTHORITATIVE_TENANT_ID : null) ||
      DEFAULT_TENANT_ID;

    // Record verified transfer state with monotonic transition rules
    await db.recordConfirmedTransfer({
      tenantId,
      callSid,
      dialCallSid,
      dialCallStatus,
      dialCallDuration,
    });

    // Return standard empty TwiML response to finish call leg cleanly
    const response = new twilio.twiml.VoiceResponse();
    return new Response(response.toString(), {
      status: 200,
      headers: { 'Content-Type': 'text/xml' },
    });
  } catch (error) {
    return handleApiError(error, 'api/webhooks/twilio/transfer:POST');
  }
}
