import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';

export function getSupabaseBrowserConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || '';
  return {
    url,
    publishableKey,
    isConfigured: Boolean(url && publishableKey && url.startsWith('http')),
  };
}

export function createClient(): SupabaseClient {
  const { url, publishableKey, isConfigured } = getSupabaseBrowserConfig();

  if (!isConfigured) {
    throw new Error(
      'Supabase browser client is missing configuration. Please verify NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY in the environment.'
    );
  }

  return createBrowserClient(url, publishableKey);
}
