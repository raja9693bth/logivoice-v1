import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext, requireRole } from '@/lib/auth/context';
import { db } from '@/lib/db';
import { UpdateSettingsApiSchema } from '@/lib/schemas/api';
import { handleApiError } from '@/lib/api/error-handler';
import { parseAndValidateJson } from '@/lib/api/request-helper';

import { isSupabaseLive } from '@/lib/db';

export async function GET(req: NextRequest) {
  try {
    const authContext = await getAuthContext(req);
    requireRole(authContext, ['DISPATCHER', 'OPS_MANAGER', 'ADMIN', 'SYSTEM']);

    const config = await db.getClientConfig(authContext.tenantId);

    const hasSupabase = Boolean(
      process.env.NEXT_PUBLIC_SUPABASE_URL &&
      (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_SECRET_KEY)
    );
    const isSupabaseReachable = await isSupabaseLive();
    const hasRetell = Boolean(process.env.RETELL_API_KEY);
    const hasGoogleSheets = Boolean(
      process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REFRESH_TOKEN
    );
    const hasMessaging = Boolean(
      (process.env.WHATSAPP_API_KEY || process.env.WHATSAPP_API_TOKEN) && process.env.WHATSAPP_PHONE_NUMBER_ID
    );
    const hasTelephony =
      process.env.ENABLE_LIVE_TELEPHONY_TRANSFER === 'true' &&
      Boolean(process.env.TELEPHONY_PROVIDER_ACCOUNT_SID);

    const integration_status = {
      supabase: isSupabaseReachable ? 'VERIFIED' : (hasSupabase ? 'CONFIGURED_NOT_VERIFIED' : 'UNCONFIGURED'),
      retell: hasRetell ? 'CONFIGURED_NOT_VERIFIED' : 'UNCONFIGURED',
      google_sheets: hasGoogleSheets ? 'CONFIGURED_NOT_VERIFIED' : 'UNCONFIGURED',
      messaging: hasMessaging ? 'CONFIGURED_NOT_VERIFIED' : 'UNCONFIGURED',
      telephony: hasTelephony ? 'CONFIGURED_NOT_VERIFIED' : 'DEPLOYMENT_GATED',
      tracking: 'DATABASE_FED_CACHE',
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

    const { data: updateData, errorResponse } = await parseAndValidateJson(req, UpdateSettingsApiSchema);
    if (errorResponse) return errorResponse;

    const updated = await db.updateClientConfig(authContext.tenantId, updateData);

    // Log settings update audit event
    await db.logAuditEvent(
      {
        tenant_id: authContext.tenantId,
        event_type: 'SETTINGS_UPDATED',
        actor: authContext.userId,
        actor_type: (authContext.role === 'VOICE_GATEWAY' ? 'AI_AGENT' : authContext.role) as any,
        actor_id: authContext.userId,
        severity: 'INFO',
        details: {
          updated_fields: Object.keys(updateData),
        },
      },
      authContext.tenantId
    );

    return NextResponse.json({ config: updated });
  } catch (error) {
    return handleApiError(error, 'api/settings:PUT');
  }
}
