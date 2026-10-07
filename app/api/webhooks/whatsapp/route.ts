import { NextRequest, NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { db } from '@/lib/db';
import { handleApiError } from '@/lib/api/error-handler';
import { FollowupStatus } from '@/types/logivoice';

/**
 * LOGIVOICE V1 — META WHATSAPP BUSINESS CLOUD API WEBHOOK
 * Route: /api/webhooks/whatsapp
 *
 * Implements current Meta Cloud API Webhook contract:
 * - GET: Challenge verification (hub.mode, hub.verify_token, hub.challenge)
 * - POST: Delivery status notifications (X-Hub-Signature-256 HMAC-SHA256, sent/delivered/read/failed)
 * - Out-of-order and duplicate safe (monotonic state hierarchy)
 * - Reconciles UNKNOWN claims to SUCCEEDED when delivery is confirmed
 */

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const mode = searchParams.get('hub.mode');
    const verifyToken = searchParams.get('hub.verify_token');
    const challenge = searchParams.get('hub.challenge');

    const expectedToken =
      process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN ||
      process.env.WHATSAPP_VERIFY_TOKEN ||
      'logivoice_whatsapp_verify_token';

    if (mode === 'subscribe' && verifyToken === expectedToken) {
      return new Response(challenge || '', {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      });
    }

    return NextResponse.json(
      { error: 'Forbidden: Verification token mismatch or invalid mode' },
      { status: 403 }
    );
  } catch (error) {
    return handleApiError(error, 'api/webhooks/whatsapp:GET');
  }
}

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text();
    const appSecret = process.env.WHATSAPP_APP_SECRET || process.env.WHATSAPP_WEBHOOK_SECRET;

    // Strict HMAC-SHA256 signature verification in production or whenever secret is configured
    if (appSecret || process.env.NODE_ENV === 'production') {
      const signatureHeader = req.headers.get('x-hub-signature-256') || req.headers.get('X-Hub-Signature-256') || '';
      if (!signatureHeader || !signatureHeader.startsWith('sha256=')) {
        return NextResponse.json(
          { error: 'Unauthorized: Missing or malformed X-Hub-Signature-256 header' },
          { status: 401 }
        );
      }

      if (!appSecret) {
        return NextResponse.json(
          { error: 'Server configuration error: WhatsApp webhook secret not configured' },
          { status: 500 }
        );
      }

      const signatureHash = signatureHeader.slice(7);
      const expectedHash = crypto
        .createHmac('sha256', appSecret)
        .update(rawBody)
        .digest('hex');

      const sigBuffer = Buffer.from(signatureHash, 'utf8');
      const expectedBuffer = Buffer.from(expectedHash, 'utf8');

      if (sigBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(sigBuffer, expectedBuffer)) {
        return NextResponse.json(
          { error: 'Unauthorized: Invalid webhook signature' },
          { status: 401 }
        );
      }
    }

    let payload: any;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ error: 'Malformed JSON payload' }, { status: 400 });
    }

    let processedCount = 0;
    const entries = Array.isArray(payload?.entry) ? payload.entry : [];

    for (const entry of entries) {
      const changes = Array.isArray(entry?.changes) ? entry.changes : [];
      for (const change of changes) {
        const statuses = Array.isArray(change?.value?.statuses) ? change.value.statuses : [];
        for (const item of statuses) {
          const providerMsgId = item.id;
          const rawStatus = (item.status || '').toLowerCase();
          if (!providerMsgId) continue;

          let targetStatus: FollowupStatus | null = null;
          if (rawStatus === 'sent') {
            targetStatus = 'SENT';
          } else if (rawStatus === 'delivered') {
            targetStatus = 'DELIVERED';
          } else if (rawStatus === 'read') {
            targetStatus = 'DELIVERED';
          } else if (rawStatus === 'failed') {
            targetStatus = 'FAILED';
          }

          if (targetStatus) {
            const timestampIso = item.timestamp
              ? new Date(Number(item.timestamp) * 1000).toISOString()
              : new Date().toISOString();

            const { followup, updated } = await db.updateFollowupStatusByProviderMessageId(
              providerMsgId,
              targetStatus,
              {
                error: item.errors?.[0]?.message || item.errors?.[0]?.title,
                timestamp: timestampIso,
              }
            );

            // Audit log the status transition (only when updated or when new)
            if (updated && followup) {
              await db.logAuditEvent(
                {
                  tenant_id: followup.tenant_id,
                  call_id: followup.call_id || undefined,
                  event_type: 'WHATSAPP_STATUS_WEBHOOK',
                  actor: 'WEBHOOK',
                  actor_type: 'WEBHOOK',
                  actor_id: 'meta-whatsapp-webhook',
                  tool_name: 'whatsapp_messaging',
                  severity: targetStatus === 'FAILED' ? 'WARNING' : 'INFO',
                  details: {
                    provider_message_id: providerMsgId,
                    status: targetStatus,
                    raw_status: rawStatus,
                    recipient: item.recipient_id,
                  },
                },
                followup.tenant_id
              );
            }

            processedCount++;
          }
        }
      }
    }

    return NextResponse.json({
      success: true,
      processed: processedCount,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return handleApiError(error, 'api/webhooks/whatsapp:POST');
  }
}
