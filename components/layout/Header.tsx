'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Search, Bell, LogOut, User, Menu, Loader2 } from 'lucide-react';
import { SystemStatusPill } from '@/components/ui/Banner';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { useSidebar } from '@/components/layout/SidebarContext';
import { createClient } from '@/lib/supabase/client';

interface HeaderProps {
  userEmail?: string;
  userRole?: string;
}

export function Header({
  userEmail,
  userRole,
}: HeaderProps) {
  const router = useRouter();
  const { toggleMobile } = useSidebar();
  const [displayEmail, setDisplayEmail] = useState(userEmail || 'Loading...');
  const [displayRole, setDisplayRole] = useState(userRole || 'Operations Desk');
  const [urgentCount, setUrgentCount] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSigningOut, setIsSigningOut] = useState(false);

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && searchQuery.trim()) {
      router.push(`/admin/calls?search=${encodeURIComponent(searchQuery.trim())}`);
    }
  };

  useEffect(() => {
    try {
      const supabase = createClient();
      supabase.auth.getUser().then(({ data: { user } }) => {
        if (user) {
          if (user.email) setDisplayEmail(user.email);
          const role = user.app_metadata?.role || user.user_metadata?.role;
          if (role === 'ADMIN') setDisplayRole('Platform Administrator');
          else if (role === 'OPS_MANAGER') setDisplayRole('Operations Hub Head');
          else if (role === 'DISPATCHER') setDisplayRole('Fleet Operations Dispatcher');
          else setDisplayRole('Operations Portal');
        } else if (!userEmail) {
          setDisplayEmail('Operations Desk');
        }
      });
    } catch {
      if (!userEmail) setDisplayEmail('Operations Desk');
    }

    // Fetch actual pending urgent requests for truthful alert notification
    fetch('/api/requests?priority=URGENT&status=PENDING')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.requests) {
          setUrgentCount(data.requests.length);
        }
      })
      .catch(() => {
        // Fallback gracefully without animating a false alarm
        setUrgentCount(0);
      });
  }, []);

  const handleSignOut = async () => {
    setIsSigningOut(true);
    try {
      const supabase = createClient();
      await supabase.auth.signOut();
    } catch (err) {
      console.warn('[Header] Sign out error:', err);
    }
    // Clear dev cookie if present
    document.cookie = 'logivoice_dev_session=; path=/; max-age=0';
    router.push('/login');
  };

  return (
    <header className="h-16 bg-white/90 dark:bg-slate-950/90 backdrop-blur-xs border-b border-slate-200 dark:border-slate-800/80 px-4 sm:px-6 flex items-center justify-between sticky top-0 z-30 transition-colors max-w-full">
      {/* Mobile Menu Toggle & Search Input */}
      <div className="flex items-center flex-1 max-w-md min-w-0 mr-2 sm:mr-4">
        <button
          onClick={toggleMobile}
          className="p-1.5 -ml-1 mr-2 rounded-lg text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 md:hidden shrink-0 transition-colors"
          aria-label="Open mobile navigation"
        >
          <Menu className="w-5 h-5" />
        </button>

        <div className="relative group w-full min-w-0">
          <Search className="w-4 h-4 text-slate-400 dark:text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 group-focus-within:text-sky-600 dark:group-focus-within:text-sky-400 transition-colors" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            placeholder="Search calls by customer, phone, or ID (press Enter)..."
            className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg pl-9 pr-3 py-1.5 text-xs text-slate-900 dark:text-slate-200 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-hidden focus:border-sky-500 focus:ring-1 focus:ring-sky-500/20 transition-all truncate"
          />
        </div>
      </div>

      {/* Right Controls */}
      <div className="flex items-center gap-1.5 sm:gap-3 shrink-0">
        <div className="hidden sm:block">
          <SystemStatusPill />
        </div>

        {/* Theme Toggle Button */}
        <ThemeToggle />

        {/* Truthful Alert indicator: badges only if genuine urgent requests exist */}
        <Link
          href="/admin/requests"
          className="relative p-2 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 hover:text-amber-600 dark:hover:text-amber-300 hover:border-amber-400 dark:hover:border-amber-800/60 transition-colors shrink-0"
          title={urgentCount > 0 ? `${urgentCount} Urgent Request${urgentCount > 1 ? 's' : ''} Pending` : 'No urgent alerts'}
          aria-label="Alerts"
        >
          <Bell className="w-4 h-4" />
          {urgentCount > 0 && (
            <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
          )}
        </Link>

        {/* User Profile */}
        <div className="flex items-center gap-2 sm:gap-3 pl-2 sm:pl-3 border-l border-slate-200 dark:border-slate-800 shrink-0">
          <div className="text-right hidden lg:block">
            <div className="text-xs font-semibold text-slate-900 dark:text-white tracking-tight truncate max-w-[180px]">{displayEmail}</div>
            <div className="text-[10px] text-sky-600 dark:text-sky-400 font-medium truncate">{displayRole}</div>
          </div>
          <div className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center text-slate-700 dark:text-slate-300 shrink-0">
            <User className="w-4 h-4" />
          </div>
          <button
            type="button"
            onClick={handleSignOut}
            disabled={isSigningOut}
            className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-slate-100 dark:hover:bg-slate-900 transition-colors shrink-0 cursor-pointer disabled:opacity-50"
            title="Sign Out"
            aria-label="Sign Out"
          >
            {isSigningOut ? <Loader2 className="w-4 h-4 animate-spin text-rose-500" /> : <LogOut className="w-4 h-4" />}
          </button>
        </div>
      </div>
    </header>
  );
}
