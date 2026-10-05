'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Truck, Lock, Mail, ArrowRight, AlertCircle, Loader2, CheckCircle2 } from 'lucide-react';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { createClient, getSupabaseBrowserConfig } from '@/lib/supabase/client';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successNotice, setSuccessNotice] = useState<string | null>(null);
  const [isDev, setIsDev] = useState(false);

  useEffect(() => {
    setIsDev(process.env.NODE_ENV !== 'production');
    const cfg = getSupabaseBrowserConfig();
    if (!cfg.isConfigured && process.env.NODE_ENV === 'production') {
      setError('Supabase authentication configuration missing: NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is not configured.');
    }
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);
    setSuccessNotice(null);

    const config = getSupabaseBrowserConfig();
    if (!config.isConfigured) {
      setError('Authentication configuration error: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY must be configured in environment.');
      setIsLoading(false);
      return;
    }

    try {
      const supabase = createClient();
      const { data, error: authError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (authError) {
        // Authentic Supabase Auth error
        setError(authError.message || 'Invalid operational credentials. Please verify email and password.');
        setIsLoading(false);
        return;
      }

      if (data.session) {
        setSuccessNotice('Session authenticated. Accessing Operations Console...');
        // Set dev cookie if in non-production to ensure seamless navigation across SSR routes
        if (process.env.NODE_ENV !== 'production') {
          document.cookie = 'logivoice_dev_session=true; path=/; max-age=86400; SameSite=Lax';
        }
        setTimeout(() => {
          router.push('/admin');
        }, 300);
      }
    } catch (err) {
      console.warn('[LoginPage] Supabase client authentication exception:', err);
      const errMsg = err instanceof Error ? err.message : 'Unknown error';
      if (errMsg.includes('missing configuration')) {
        setError('Authentication configuration error: Supabase URL or publishable key is not set.');
      } else if (process.env.NODE_ENV !== 'production') {
        setError(`Authentication service unreachable: ${errMsg}. In development mode, you may use local evaluation session.`);
      } else {
        setError(`Authentication failed: ${errMsg}`);
      }
      setIsLoading(false);
    }
  };

  const handleDevBypass = () => {
    if (process.env.NODE_ENV === 'production') return;
    document.cookie = 'logivoice_dev_session=true; path=/; max-age=86400; SameSite=Lax';
    setSuccessNotice('Local development session granted.');
    setTimeout(() => {
      router.push('/admin');
    }, 200);
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-[#090d16] flex flex-col items-center justify-center p-4 relative transition-colors">
      {/* Theme Toggle in Header / Corner */}
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>

      <div className="w-full max-w-md">
        {/* Brand Header */}
        <div className="text-center mb-8">
          <div className="w-12 h-12 rounded-xl bg-sky-600 flex items-center justify-center mx-auto mb-3 shadow-lg shadow-sky-600/20 text-white">
            <Truck className="w-6 h-6" />
          </div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white tracking-tight">LogiVoice V1</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Inbound Voice Operations &amp; Dispatcher Portal</p>
        </div>

        {/* Login Card */}
        <div className="bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-xl space-y-6">
          <div className="border-b border-slate-200 dark:border-slate-800/80 pb-4">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Dispatcher Sign In</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Enter verified Supabase credentials for operational access
            </p>
          </div>

          {error && (
            <div className="p-3 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/60 text-xs text-rose-700 dark:text-rose-300 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-600 dark:text-rose-400" />
              <span>{error}</span>
            </div>
          )}

          {successNotice && (
            <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/60 text-xs text-emerald-700 dark:text-emerald-300 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
              <span>{successNotice}</span>
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5" htmlFor="email">
                Work Email / Dispatcher ID
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-400 dark:text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  id="email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="dispatcher@company.com"
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg pl-9 pr-3 py-2 text-xs text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-hidden focus:border-sky-500 focus:ring-1 focus:ring-sky-500/30 transition-all"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5" htmlFor="password">
                Password
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-400 dark:text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  id="password"
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg pl-9 pr-3 py-2 text-xs text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-hidden focus:border-sky-500 focus:ring-1 focus:ring-sky-500/30 transition-all"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-2.5 px-4 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold tracking-wide transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed shadow-xs cursor-pointer"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Verifying Supabase Session...
                </>
              ) : (
                <>
                  Access Operations Console
                  <ArrowRight className="w-3.5 h-3.5" />
                </>
              )}
            </button>
          </form>

          {/* Development / Demo Evaluation Helper */}
          {isDev && (
            <div className="pt-2 border-t border-slate-200 dark:border-slate-800/60 flex flex-col gap-2 text-[11px] text-slate-500 dark:text-slate-400">
              <div className="flex items-center justify-between">
                <span>Offline / Local Dev Mode:</span>
                <button
                  type="button"
                  onClick={handleDevBypass}
                  className="text-amber-600 dark:text-amber-400 hover:text-amber-700 dark:hover:text-amber-300 underline font-medium focus:outline-hidden cursor-pointer"
                >
                  Enter Dev Session
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Security & Telecom Note */}
        <p className="text-center text-[11px] text-slate-500 dark:text-slate-400 mt-6 max-w-xs mx-auto">
          Authorized personnel only. Sessions are cryptographically verified and audited under LogiVoice tenant boundaries.
        </p>
      </div>
    </div>
  );
}
