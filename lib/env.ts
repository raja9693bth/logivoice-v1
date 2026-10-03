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

    // Tenant Configuration
    AUTHORITATIVE_TENANT_ID: z.string().uuid().default('00000000-0000-0000-0000-000000000001'),

    // Supabase
    SUPABASE_URL: z.string().optional(),
    SUPABASE_SECRET_KEY: z.string().optional(),
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

    // Meta WhatsApp Business Cloud API
    WHATSAPP_API_KEY: z.string().optional(),
    WHATSAPP_API_TOKEN: z.string().optional(),
    WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),

    // Development & Testing
    ENABLE_MOCK_INTEGRATIONS: z.enum(['true', 'false']).default('false'),
  })
  .superRefine((data, ctx) => {
    // 1. Production Retell requirements
    if (data.NODE_ENV === 'production' && data.RETELL_API_KEY) {
      if (!data.RETELL_AGENT_ID) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'RETELL_AGENT_ID is required when RETELL_API_KEY is configured in production',
          path: ['RETELL_AGENT_ID'],
        });
      }
    }

    // 2. Google Sheets tuple consistency
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
          message: 'Complete OAuth tuple (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN) is required for Google Sheets',
          path: ['GOOGLE_CLIENT_ID'],
        });
      }
    }

    // 3. WhatsApp tuple consistency
    const hasWhatsappKey = Boolean(data.WHATSAPP_API_KEY || data.WHATSAPP_API_TOKEN);
    const hasWhatsappPhone = Boolean(data.WHATSAPP_PHONE_NUMBER_ID);
    if ((hasWhatsappKey || hasWhatsappPhone) && data.ENABLE_MOCK_INTEGRATIONS !== 'true') {
      if (!hasWhatsappKey) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'WHATSAPP_API_KEY is required when WhatsApp phone number ID is set',
          path: ['WHATSAPP_API_KEY'],
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

    // 4. Live Telephony Transfer requirements
    if (data.ENABLE_LIVE_TELEPHONY_TRANSFER === 'true') {
      if (!data.TELEPHONY_PROVIDER_ACCOUNT_SID || !data.TELEPHONY_PROVIDER_AUTH_TOKEN) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'TELEPHONY_PROVIDER_ACCOUNT_SID and TELEPHONY_PROVIDER_AUTH_TOKEN are required when ENABLE_LIVE_TELEPHONY_TRANSFER is true',
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
