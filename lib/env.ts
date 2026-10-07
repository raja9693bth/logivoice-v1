import { z } from 'zod';

/**
 * LOGIVOICE V1 — AUTHORITATIVE RUNTIME ENVIRONMENT SCHEMA
 *
 * Validates environment variables and provides fail-closed configuration guarantees.
 */
export const EnvironmentSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.string().default('3000'),
    NEXT_PUBLIC_APP_URL: z.string().default('http://localhost:3000'),
    NEXT_PUBLIC_DEMO_MODE: z.enum(['true', 'false']).default('false'),

    // Retell Voice Gateway
    RETELL_API_KEY: z.string().optional(),
    RETELL_AGENT_ID: z.string().optional(),
    RETELL_TOOL_SECRET: z.string().optional(),
    RETELL_ALLOW_LEGACY_SIGNATURE: z.enum(['true', 'false']).default('false'),

    // Cron / Internal Workers
    CRON_SECRET: z.string().optional(),

    // Database & Testing
    DATABASE_URL: z.string().optional(),
    PLAYWRIGHT_BASE_URL: z.string().optional(),

    // Tenant Configuration
    AUTHORITATIVE_TENANT_ID: z.string().uuid().default('00000000-0000-0000-0000-000000000001'),
    ALLOW_PLACEHOLDER_TENANT_IN_PROD: z.enum(['true', 'false']).default('false'),

    // Supabase
    SUPABASE_URL: z.string().optional(),
    SUPABASE_SECRET_KEY: z.string().optional(),
    SUPABASE_ANON_KEY: z.string().optional(),
    NEXT_PUBLIC_SUPABASE_URL: z.string().optional(),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().optional(),
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().optional(),

    // Google Sheets
    GOOGLE_SHEETS_SPREADSHEET_ID: z.string().optional(),
    GOOGLE_SHEETS_WORKSHEET_NAME: z.string().default('LogiVoice_Calls'),
    GOOGLE_CLIENT_ID: z.string().optional(),
    GOOGLE_CLIENT_SECRET: z.string().optional(),
    GOOGLE_REFRESH_TOKEN: z.string().optional(),

    // Live Telephony Transfer
    ENABLE_LIVE_TELEPHONY_TRANSFER: z.enum(['true', 'false']).default('false'),
    TELEPHONY_PROVIDER_ACCOUNT_SID: z.string().optional(),
    TELEPHONY_PROVIDER_AUTH_TOKEN: z.string().optional(),
    TWILIO_ACCOUNT_SID: z.string().optional(),
    TWILIO_AUTH_TOKEN: z.string().optional(),

    // Meta WhatsApp Business Cloud API & Messaging
    WHATSAPP_API_KEY: z.string().optional(),
    WHATSAPP_API_TOKEN: z.string().optional(),
    WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
    SMS_API_KEY: z.string().optional(),

    // Development & Testing
    ENABLE_MOCK_INTEGRATIONS: z.enum(['true', 'false']).default('false'),
  })
  .superRefine((data, ctx) => {
    // 1. Production Supabase Contract (Phase 11 & Phase 9)
    if (data.NODE_ENV === 'production') {
      const publicUrl = data.NEXT_PUBLIC_SUPABASE_URL;
      const publicKey = data.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || data.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      const secretKey = data.SUPABASE_SECRET_KEY;

      if (!publicUrl) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'NEXT_PUBLIC_SUPABASE_URL is required in production',
          path: ['NEXT_PUBLIC_SUPABASE_URL'],
        });
      }

      if (!publicKey) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is required in production',
          path: ['NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'],
        });
      }

      if (!secretKey) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'SUPABASE_SECRET_KEY is required in production for server operations',
          path: ['SUPABASE_SECRET_KEY'],
        });
      }

      if (!data.CRON_SECRET) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'CRON_SECRET is required in production for worker invocation security',
          path: ['CRON_SECRET'],
        });
      }

      if (
        data.AUTHORITATIVE_TENANT_ID === '00000000-0000-0000-0000-000000000001' &&
        data.ALLOW_PLACEHOLDER_TENANT_IN_PROD !== 'true'
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            'Placeholder tenant 00000000-0000-0000-0000-000000000001 is prohibited in production without ALLOW_PLACEHOLDER_TENANT_IN_PROD=true',
          path: ['AUTHORITATIVE_TENANT_ID'],
        });
      }
    }

    // 2. Production Retell requirements
    if (data.NODE_ENV === 'production' && data.RETELL_API_KEY) {
      if (!data.RETELL_AGENT_ID) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'RETELL_AGENT_ID is required when RETELL_API_KEY is configured in production',
          path: ['RETELL_AGENT_ID'],
        });
      }
    }

    // 3. Google Sheets tuple consistency
    const hasAnySheets =
      Boolean(data.GOOGLE_SHEETS_SPREADSHEET_ID) ||
      Boolean(data.GOOGLE_CLIENT_ID) ||
      Boolean(data.GOOGLE_CLIENT_SECRET) ||
      Boolean(data.GOOGLE_REFRESH_TOKEN);

    if (hasAnySheets && data.ENABLE_MOCK_INTEGRATIONS !== 'true') {
      if (!data.GOOGLE_SHEETS_SPREADSHEET_ID) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'GOOGLE_SHEETS_SPREADSHEET_ID is required when Google Sheets sync is enabled',
          path: ['GOOGLE_SHEETS_SPREADSHEET_ID'],
        });
      }
      if (!data.GOOGLE_CLIENT_ID || !data.GOOGLE_CLIENT_SECRET || !data.GOOGLE_REFRESH_TOKEN) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            'Complete OAuth tuple (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN) is required for Google Sheets',
          path: ['GOOGLE_CLIENT_ID'],
        });
      }
    }

    // 4. WhatsApp tuple consistency
    const hasWhatsappKey = Boolean(data.WHATSAPP_API_KEY || data.WHATSAPP_API_TOKEN);
    const hasWhatsappPhone = Boolean(data.WHATSAPP_PHONE_NUMBER_ID);
    if ((hasWhatsappKey || hasWhatsappPhone) && data.ENABLE_MOCK_INTEGRATIONS !== 'true') {
      if (!hasWhatsappKey) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'WHATSAPP_API_TOKEN (or WHATSAPP_API_KEY) is required when WhatsApp phone number ID is set',
          path: ['WHATSAPP_API_TOKEN'],
        });
      }
      if (!hasWhatsappPhone) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'WHATSAPP_PHONE_NUMBER_ID is required when WhatsApp API key is set',
          path: ['WHATSAPP_PHONE_NUMBER_ID'],
        });
      }
    }

    // 5. Live Telephony Transfer requirements (Phase 12)
    if (data.ENABLE_LIVE_TELEPHONY_TRANSFER === 'true') {
      const accountSid = data.TELEPHONY_PROVIDER_ACCOUNT_SID || data.TWILIO_ACCOUNT_SID;
      const authToken = data.TELEPHONY_PROVIDER_AUTH_TOKEN || data.TWILIO_AUTH_TOKEN;
      if (!accountSid || !authToken) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            'TELEPHONY_PROVIDER_ACCOUNT_SID and TELEPHONY_PROVIDER_AUTH_TOKEN are required when ENABLE_LIVE_TELEPHONY_TRANSFER is true',
          path: ['TELEPHONY_PROVIDER_ACCOUNT_SID'],
        });
      }
    }
  });

export type ValidatedEnvironment = z.infer<typeof EnvironmentSchema>;

let cachedEnv: ValidatedEnvironment | null = null;

/**
 * Validates environment variables at runtime.
 */
export function validateEnvironment(): { valid: boolean; errors?: string[]; env?: ValidatedEnvironment } {
  const result = EnvironmentSchema.safeParse(process.env);
  if (!result.success) {
    return {
      valid: false,
      errors: (result.error.issues || []).map((e) => `${e.path.join('.')}: ${e.message}`),
    };
  }
  cachedEnv = result.data;
  return { valid: true, env: result.data };
}

/**
 * Retrieves authoritative validated environment or triggers validation.
 */
export function getEnvironment(): ValidatedEnvironment {
  if (cachedEnv) return cachedEnv;
  const res = validateEnvironment();
  if (!res.valid || !res.env) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(`Critical environment validation failure:\n${(res.errors || []).join('\n')}`);
    }
    // In dev/test, fallback to parsed raw values
    return EnvironmentSchema.parse(process.env);
  }
  return res.env;
}

/**
 * Canonical helper for browser-safe Supabase publishable key (Phase 12).
 */
export function getCanonicalSupabasePublishableKey(): string {
  return (
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    ''
  );
}

/**
 * Canonical helper for Telephony provider credentials (Phase 12).
 */
export function getCanonicalTelephonyCredentials(): { accountSid: string; authToken: string } {
  return {
    accountSid:
      process.env.TELEPHONY_PROVIDER_ACCOUNT_SID || process.env.TWILIO_ACCOUNT_SID || '',
    authToken:
      process.env.TELEPHONY_PROVIDER_AUTH_TOKEN || process.env.TWILIO_AUTH_TOKEN || '',
  };
}

/**
 * Canonical helper for Meta WhatsApp API Token (Phase 12).
 */
export function getCanonicalWhatsAppToken(): string {
  return process.env.WHATSAPP_API_TOKEN || process.env.WHATSAPP_API_KEY || '';
}
