import { createClient as createSupabaseClient } from '@supabase/supabase-js';

export function createAdminClient() {
  const supabaseUrl = process.env.SUPABASE_URL || 'https://izfcoyyimxmcltxfopvi.supabase.co';
  const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY || '';

  if (!supabaseSecretKey) {
    console.warn('[Supabase Server] SUPABASE_SECRET_KEY is not configured.');
  }

  return createSupabaseClient(supabaseUrl, supabaseSecretKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
