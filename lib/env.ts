import { z } from 'zod';

/**
 * LOGIVOICE V1 — AUTHORITATIVE RUNTIME ENVIRONMENT SCHEMA
 *
 * Validates environment variables and provides fail-closed configuration guarantees.
 */
export const EnvironmentSchema = z.object({
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
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),

  // Development & Testing
  ENABLE_MOCK_INTEGRATIONS: z.enum(['true', 'false']).default('false'),
});

export type ValidatedEnvironment = z.infer<typeof EnvironmentSchema>;

/**
 * Validates environment variables at runtime.
 */
export function validateEnvironment(): { valid: boolean; errors?: string[] } {
  const result = EnvironmentSchema.safeParse(process.env);
  if (!result.success) {
    return {
      valid: false,
      errors: (result.error.issues || []).map((e: { path: PropertyKey[]; message: string }) => `${e.path.join('.')}: ${e.message}`),
    };
  }
  return { valid: true };
}
