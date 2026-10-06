import { createClient as createSupabaseClient, SupabaseClient } from '@supabase/supabase-js';
import { createBoundedFetch } from './bounded-fetch';

/**
 * Creates an authoritative Supabase admin client bound with a strict network timeout.
 * Prevents PostgREST queries and Auth lookups from stalling and causing serverless/edge timeouts.
 */
export function createAdminClient(timeoutMs = 3000): SupabaseClient {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY || '';

  if (!supabaseSecretKey && process.env.NODE_ENV === 'production') {
    throw new Error('[Supabase Server] SUPABASE_SECRET_KEY is required in production.');
  }

  return createSupabaseClient(supabaseUrl, supabaseSecretKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    global: {
      fetch: createBoundedFetch(timeoutMs, 'Supabase Admin Request'),
    },
  });
}
