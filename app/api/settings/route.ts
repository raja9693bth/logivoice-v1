import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext, requireRole } from '@/lib/auth/context';
import { db } from '@/lib/db';
import { UpdateSettingsApiSchema } from '@/lib/schemas/api';
import { handleApiError } from '@/lib/api/error-handler';

export async function GET(req: NextRequest) {
  try {
    const authContext = await getAuthContext(req);
    requireRole(authContext, ['DISPATCHER', 'OPS_MANAGER', 'ADMIN', 'SYSTEM']);

    const config = await db.getClientConfig(authContext.tenantId);

    const hasSupabase = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_SECRET_KEY));
    const hasRetell = Boolean(process.env.RETELL_API_KEY);
    const hasGoogleSheets = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REFRESH_TOKEN);
    const hasMessaging = Boolean(process.env.WHATSAPP_API_TOKEN || process.env.TWILIO_AUTH_TOKEN);
    const hasTelephony = process.env.ENABLE_LIVE_TELEPHONY_TRANSFER === 'true';

    const integration_status = {
      supabase: hasSupabase ? 'VERIFIED' : 'UNCONFIGURED',
      retell: hasRetell ? 'CONFIGURED_NOT_VERIFIED' : 'UNCONFIGURED',
      google_sheets: hasGoogleSheets ? 'CONFIGURED_NOT_VERIFIED' : 'UNCONFIGURED',
      messaging: hasMessaging ? 'CONFIGURED_NOT_VERIFIED' : 'UNCONFIGURED',
      telephony: hasTelephony ? 'CONFIGURED_NOT_VERIFIED' : 'DEPLOYMENT_GATED',
      tracking: 'DEPLOYMENT_GATED',
    };

    return NextResponse.json({ config, integration_status });
  } catch (error) {
    return handleApiError(error, 'api/settings:GET');
  }
}

export async function PUT(req: NextRequest) {
  try {
    const authContext = await getAuthContext(req);
    // Section 33: Sensitive settings mutations restricted to ADMIN and OPS_MANAGER
    requireRole(authContext, ['ADMIN', 'OPS_MANAGER', 'SYSTEM']);

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Malformed JSON payload' }, { status: 400 });
    }

    const parseResult = UpdateSettingsApiSchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parseResult.error.flatten() },
        { status: 400 }
      );
    }

    const updated = await db.updateClientConfig(authContext.tenantId, parseResult.data);
    return NextResponse.json({ config: updated });
  } catch (error) {
    return handleApiError(error, 'api/settings:PUT');
  }
}
