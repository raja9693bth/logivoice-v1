/**
 * LOGIVOICE V1 — AUTHORITATIVE MESSAGING & CONTROLLED TEMPLATE ENGINE
 *
 * Enforces:
 * 1. Claim-Before-Send Idempotency: Uses durable DB side_effect_claims lock before dispatch.
 * 2. Durable Phone Suppression: Checks tenant-scoped customer_suppressions in database.
 * 3. Controlled Template Rendering: Pre-approved templates with verified structured values;
 *    never gives LLM unconstrained authoring of outbound production messages.
 * 4. Truthful Content: Omits unsupported claims (never claims dispatch assignment without record).
 */

import { db, DEFAULT_TENANT_ID } from '@/lib/db';
import { normalizePhoneNumber } from '@/lib/utils';
import { FollowupChannel } from '@/types/logivoice';

export type FollowupTemplateId =
  | 'QUOTE_ESTIMATE'
  | 'QUOTE_CONFIRMED'
  | 'TRACKING_STATUS'
  | 'INQUIRY_RECEIVED';

export interface FollowupTemplateData {
  customerName?: string;
  brand?: string;
  origin?: string;
  destination?: string;
  vehicleType?: string;
  quotedAmount?: number;
  trackingId?: string;
  currentStatus?: string;
  currentLocation?: string;
  etaFormatted?: string;
  bookingUrl?: string;
}

export interface ControlledFollowupRequest {
  tenantId?: string;
  callId: string;
  recipientPhone: string;
  templateId: FollowupTemplateId;
  templateData: FollowupTemplateData;
  channel?: 'WHATSAPP' | 'SMS' | 'EMAIL';
}

export interface FollowupSendResult {
  success: boolean;
  status: 'SENT' | 'DELIVERED' | 'FAILED' | 'SUPPRESSED' | 'UNCONFIGURED' | 'MOCK' | 'SKIPPED' | 'UNKNOWN';
  providerMessageId?: string;
  provider: string;
  renderedText: string;
  error?: string;
}

/**
 * Deterministically renders an approved logistics follow-up message template.
 */
export function renderApprovedTemplate(
  templateId: FollowupTemplateId,
  data: FollowupTemplateData
): string {
  const brand = data.brand || 'LogiVoice';
  const name = data.customerName || 'Inbound Shipper';
  const bookingNotice = data.bookingUrl
    ? ` Booking link: ${data.bookingUrl}`
    : ' Booking information ke liye is number par sampark karein.';

  switch (templateId) {
    case 'QUOTE_ESTIMATE': {
      const amountStr = data.quotedAmount ? `₹${data.quotedAmount.toLocaleString('en-IN')}` : 'Market Tariff';
      return `Namaste ${name}! ${brand} se sampark karne ke liye dhanyawad. ${data.origin || 'origin'} se ${data.destination || 'destination'} (${data.vehicleType || 'vehicle'}) ke liye estimated rate: ${amountStr}.${bookingNotice}`;
    }

    case 'QUOTE_CONFIRMED': {
      const amountStr = data.quotedAmount ? `₹${data.quotedAmount.toLocaleString('en-IN')}` : '';
      return `Namaste ${name}! ${brand} se sampark karne ke liye dhanyawad. ${data.origin || 'origin'} se ${data.destination || 'destination'} (${data.vehicleType || 'vehicle'}) ke liye pre-authorized rate: ${amountStr} confirm kiya gaya hai.${bookingNotice}`;
    }

    case 'TRACKING_STATUS': {
      // Never invent tracking status: require verified currentStatus
      if (!data.currentStatus) {
        return renderApprovedTemplate('INQUIRY_RECEIVED', data);
      }
      const statusStr = data.currentStatus.replace(/_/g, ' ');
      const locStr = data.currentLocation ? ` at ${data.currentLocation}` : '';
      const etaStr = data.etaFormatted ? ` Estimated arrival: ${data.etaFormatted}.` : '';
      return `Namaste ${name}! Aapke consignment ${data.trackingId || 'reference'} ka current status: ${statusStr}${locStr}.${etaStr} Sahayata ke liye ${brand} se judey rahein.`;
    }

    case 'INQUIRY_RECEIVED':
    default: {
      return `Namaste ${name}! ${brand} se sampark karne ke liye dhanyawad. Aapki logistics inquiry record kar li gayi hai. Sahayata ke liye ${brand} se judey rahein.`;
    }
  }
}

export function buildFollowupTemplateData(
  call: { customer?: { name?: string }; facts?: Record<string, any> },
  config?: { brand_name?: string; business_name?: string; booking_url?: string }
): FollowupTemplateData {
  const brand = config?.brand_name || config?.business_name || 'LogiVoice';
  return {
    customerName: call?.customer?.name || 'Valued Shipper',
    brand,
    origin: call?.facts?.route_from,
    destination: call?.facts?.route_to,
    vehicleType: call?.facts?.vehicle_type,
    quotedAmount: call?.facts?.quoted_amount,
    trackingId: call?.facts?.tracking_id,
    currentStatus: call?.facts?.tracking_status,
    currentLocation: call?.facts?.tracking_location,
    etaFormatted: call?.facts?.verified_eta,
    bookingUrl: config?.booking_url,
  };
}

/**
 * Executes a controlled follow-up send with claim-before-send locking and durable suppression check.
 */
export async function sendControlledFollowup(
  req: ControlledFollowupRequest
): Promise<FollowupSendResult> {
  const tenantId = req.tenantId || DEFAULT_TENANT_ID;
  const normalizedPhone = normalizePhoneNumber(req.recipientPhone);
  const channel = req.channel || 'WHATSAPP';

  const renderedText = renderApprovedTemplate(req.templateId, req.templateData);

  // 1. Durable Suppression / Opt-Out Check in Database (Canonical customer_suppressions table)
  const isSuppressed = await db.isPhoneSuppressed(tenantId, normalizedPhone, channel);
  if (isSuppressed) {
    return {
      success: false,
      status: 'SUPPRESSED',
      provider: 'DURABLE_SUPPRESSION_ENGINE',
      renderedText,
      error: 'Recipient phone is on the tenant suppression opt-out registry.',
    };
  }

  // 2. Claim-Before-Send: Durable lock in PostgreSQL
  const claimKey = `followup:${tenantId}:${req.callId}`;
  const claimResult = await db.claimSideEffect(tenantId, claimKey, 'FOLLOWUP_SEND', req.callId);

  if (!claimResult.claimed) {
    const claim = claimResult.claim;
    const businessStatus =
      (claim?.result as Record<string, unknown> | undefined)?.business_status ||
      (claim?.result as Record<string, unknown> | undefined)?.status;

    if (businessStatus === 'UNCONFIGURED') {
      return {
        success: false,
        status: 'UNCONFIGURED',
        provider: 'DURABLE_CLAIM_GUARD',
        renderedText,
        error: `${channel} provider credentials unconfigured in environment.`,
      };
    }

    if (businessStatus === 'SUPPRESSED') {
      return {
        success: false,
        status: 'SUPPRESSED',
        provider: 'DURABLE_CLAIM_GUARD',
        renderedText,
        error: 'Recipient phone is on the tenant suppression opt-out registry.',
      };
    }

    const isSuccess = businessStatus === 'SENT' || businessStatus === 'DELIVERED' || businessStatus === 'MOCK';
    return {
      success: isSuccess,
      status: isSuccess ? (businessStatus as any) : 'SKIPPED',
      provider: 'DURABLE_CLAIM_GUARD',
      renderedText,
    };
  }

  // 3. Provider dispatch
  const whatsappKey = process.env.WHATSAPP_API_KEY || process.env.WHATSAPP_API_TOKEN;
  const whatsappPhoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  if (channel === 'WHATSAPP' && whatsappKey && whatsappPhoneId) {
    try {
      const res = await fetch(`https://graph.facebook.com/v21.0/${whatsappPhoneId}/messages`, {
        method: 'POST',
        signal: AbortSignal.timeout(10000),
        headers: {
          Authorization: `Bearer ${whatsappKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: normalizedPhone.replace('+', ''),
          type: 'text',
          text: { body: renderedText },
        }),
      });

      const data = await res.json();
      if (res.ok && data.messages?.[0]?.id) {
        const providerMessageId = data.messages[0].id;
        await db.completeSideEffect(
          tenantId,
          claimKey,
          {
            business_status: 'SENT',
            provider_message_id: providerMessageId,
            provider: 'META_WHATSAPP_CLOUD_API',
            sent_at: new Date().toISOString(),
          },
          claimResult.claim_token
        );

        return {
          success: true,
          status: 'SENT',
          providerMessageId,
          provider: 'META_WHATSAPP_CLOUD_API',
          renderedText,
        };
      } else {
        const errMsg = data.error?.message || `WhatsApp Cloud API HTTP ${res.status}`;
        await db.failSideEffect(tenantId, claimKey, errMsg, true, 60000, claimResult.claim_token);
        return {
          success: false,
          status: 'FAILED',
          provider: 'META_WHATSAPP_CLOUD_API',
          renderedText,
          error: errMsg,
        };
      }
    } catch (err: any) {
      const isTimeout =
        err?.name === 'TimeoutError' ||
        err?.name === 'AbortError' ||
        (err instanceof Error && /timeout|abort/i.test(err.message));
      const errMsg = err instanceof Error ? err.message : 'Network error reaching WhatsApp API';

      if (isTimeout) {
        await db.recordSideEffectUnknown(
          tenantId,
          claimKey,
          `Provider call timed out: ${errMsg}`,
          {},
          claimResult.claim_token
        );
        return {
          success: false,
          status: 'UNKNOWN',
          provider: 'META_WHATSAPP_CLOUD_API',
          renderedText,
          error: `Provider call timed out: ${errMsg}`,
        };
      }

      await db.failSideEffect(tenantId, claimKey, errMsg, true, 60000, claimResult.claim_token);
      return {
        success: false,
        status: 'FAILED',
        provider: 'META_WHATSAPP_CLOUD_API',
        renderedText,
        error: errMsg,
      };
    }
  }

  if (channel === 'EMAIL') {
    await db.completeSideEffect(
      tenantId,
      claimKey,
      {
        business_status: 'UNCONFIGURED',
        status: 'UNCONFIGURED',
        error: 'EMAIL channel is not supported / unconfigured.',
      },
      claimResult.claim_token
    );
    return {
      success: false,
      status: 'UNCONFIGURED',
      provider: 'EMAIL_GATEWAY',
      renderedText,
      error: 'EMAIL channel is not supported / unconfigured.',
    };
  }

  if (channel === 'SMS') {
    const isSmsConfigured = Boolean(
      process.env.SMS_API_KEY || process.env.TWILIO_AUTH_TOKEN || process.env.ENABLE_MOCK_INTEGRATIONS === 'true'
    );
    if (!isSmsConfigured) {
      await db.completeSideEffect(
        tenantId,
        claimKey,
        {
          business_status: 'UNCONFIGURED',
          status: 'UNCONFIGURED',
          error: 'SMS channel is unconfigured.',
        },
        claimResult.claim_token
      );
      return {
        success: false,
        status: 'UNCONFIGURED',
        provider: 'SMS_GATEWAY',
        renderedText,
        error: 'SMS channel is unconfigured.',
      };
    }
  }

  // Unconfigured state
  if (process.env.NODE_ENV === 'production' || process.env.ENABLE_MOCK_INTEGRATIONS !== 'true') {
    await db.completeSideEffect(
      tenantId,
      claimKey,
      {
        business_status: 'UNCONFIGURED',
        status: 'UNCONFIGURED',
        error: `${channel} provider credentials unconfigured in environment.`,
      },
      claimResult.claim_token
    );
    return {
      success: false,
      status: 'UNCONFIGURED',
      provider: channel === 'WHATSAPP' ? 'META_WHATSAPP_CLOUD_API' : 'SMS_GATEWAY',
      renderedText,
      error: `${channel} provider credentials unconfigured in environment.`,
    };
  }

  // Deterministic Development Mock Adapter
  const mockMessageId = `mock-msg-${Date.now()}`;
  await db.completeSideEffect(
    tenantId,
    claimKey,
    {
      business_status: 'MOCK',
      provider_message_id: mockMessageId,
      provider: 'DETERMINISTIC_MOCK_ADAPTER',
      sent_at: new Date().toISOString(),
    },
    claimResult.claim_token
  );

  return {
    success: true,
    status: 'MOCK',
    providerMessageId: mockMessageId,
    provider: 'DETERMINISTIC_MOCK_ADAPTER',
    renderedText,
  };
}

export interface LegacyFollowupParams {
  channel?: FollowupChannel;
  recipient: string;
  messageContent?: string;
  templateId?: string;
  callId?: string;
  tenantId?: string;
}

export async function sendFollowupMessage(params: LegacyFollowupParams): Promise<{
  success: boolean;
  status: 'SENT' | 'DELIVERED' | 'FAILED' | 'SUPPRESSED' | 'OPTED_OUT' | 'UNCONFIGURED' | 'MOCK' | 'UNKNOWN';
  providerMessageId?: string;
  provider?: string;
  error?: string;
}> {
  const normPhone = normalizePhoneNumber(params.recipient);
  const tenantId = params.tenantId || DEFAULT_TENANT_ID;

  if (params.channel === 'EMAIL') {
    return {
      success: false,
      status: 'UNCONFIGURED',
      provider: 'EMAIL_GATEWAY',
      error: 'EMAIL channel is not supported / unconfigured.',
    };
  }

  const isSuppressed = await db.isPhoneSuppressed(tenantId, normPhone, params.channel || 'WHATSAPP');

  if (isSuppressed) {
    return {
      success: false,
      status: 'OPTED_OUT',
      provider: 'POLICY_SUPPRESSION_ENGINE',
      error: `Recipient ${params.recipient} has opted out of messaging notifications.`,
    };
  }

  if (params.channel === 'SMS') {
    const isSmsConfigured = Boolean(
      process.env.SMS_API_KEY || process.env.TWILIO_AUTH_TOKEN || process.env.ENABLE_MOCK_INTEGRATIONS === 'true'
    );
    if (!isSmsConfigured) {
      return {
        success: false,
        status: 'UNCONFIGURED',
        provider: 'SMS_GATEWAY',
        error: 'SMS channel is unconfigured.',
      };
    }
  }

  const hasCreds = Boolean(
    process.env.WHATSAPP_API_KEY && process.env.WHATSAPP_PHONE_NUMBER_ID
  );

  if (params.channel !== 'SMS' && !hasCreds) {
    if (process.env.ENABLE_MOCK_INTEGRATIONS === 'true') {
      return {
        success: true,
        status: 'MOCK',
        providerMessageId: `mock-msg-${Date.now()}`,
        provider: 'DETERMINISTIC_MOCK_ADAPTER',
      };
    }
    return {
      success: false,
      status: 'UNCONFIGURED',
      provider: 'META_WHATSAPP_CLOUD_API',
      error: 'WhatsApp provider credentials unconfigured in environment.',
    };
  }

  const result = await sendControlledFollowup({
    tenantId,
    callId: params.callId || `adhoc-${Date.now()}`,
    recipientPhone: params.recipient,
    templateId: (params.templateId as FollowupTemplateId) || 'INQUIRY_RECEIVED',
    templateData: { customerName: 'Customer' },
    channel: params.channel === 'SMS' ? 'SMS' : 'WHATSAPP',
  });

  const rawStatus = result.status as string;
  const finalStatus: 'SENT' | 'DELIVERED' | 'FAILED' | 'SUPPRESSED' | 'OPTED_OUT' | 'UNCONFIGURED' | 'MOCK' | 'UNKNOWN' =
    rawStatus === 'SUPPRESSED' || rawStatus === 'SKIPPED'
      ? 'OPTED_OUT'
      : (result.status as any);

  return {
    ...result,
    status: finalStatus,
  };
}
