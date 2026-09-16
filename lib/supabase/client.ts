import { createBrowserClient } from '@supabase/ssr';

export function createClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://izfcoyyimxmcltxfopvi.supabase.co';
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || '';

  return createBrowserClient(supabaseUrl, supabaseAnonKey);
}
