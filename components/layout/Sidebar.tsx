'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  PhoneCall,
  ClipboardList,
  Flame,
  BadgePercent,
  BookOpen,
  Settings,
  ShieldAlert,
  Truck,
  Headphones,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSidebar } from '@/components/layout/SidebarContext';

interface NavigationItem {
  name: string;
  href: string;
  icon: typeof LayoutDashboard;
  badge?: string;
}

const NAVIGATION_ITEMS: NavigationItem[] = [
  {
    name: 'Dashboard',
    href: '/admin',
    icon: LayoutDashboard,
    badge: undefined,
  },
  {
    name: 'Inbound Calls',
    href: '/admin/calls',
    icon: PhoneCall,
    badge: undefined,
  },
  {
    name: 'Operations Requests',
    href: '/admin/requests',
    icon: ClipboardList,
    badge: undefined,
  },
  {
    name: 'Leads & Nurturing',
    href: '/admin/leads',
    icon: Flame,
    badge: undefined,
  },
  {
    name: 'Rate Cards',
    href: '/admin/rate-cards',
    icon: BadgePercent,
    badge: undefined,
  },
  {
    name: 'Knowledge Base',
    href: '/admin/knowledge',
    icon: BookOpen,
    badge: undefined,
  },
  {
    name: 'System Status & Audit',
    href: '/admin/audit',
    icon: ShieldAlert,
    badge: undefined,
  },
  {
    name: 'Settings',
    href: '/admin/settings',
    icon: Settings,
    badge: undefined,
  },
];

export function Sidebar() {
  const pathname = usePathname();
  const { isMobileOpen, closeMobile } = useSidebar();

  const navContent = (
    <>
      {/* Brand Header */}
      <div className="h-16 flex items-center justify-between px-6 border-b border-slate-200 dark:border-slate-800/80">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-sky-600 flex items-center justify-center text-white shadow-xs shrink-0">
            <Truck className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="font-bold text-slate-900 dark:text-white tracking-tight text-base truncate">LogiVoice</span>
              <span className="text-[10px] uppercase font-bold tracking-widest px-1.5 py-0.5 rounded-sm bg-sky-100 dark:bg-sky-950 text-sky-700 dark:text-sky-400 border border-sky-200 dark:border-sky-800/60 shrink-0">
                V1
              </span>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">Voice Operations Portal</p>
          </div>
        </div>
        <button
          onClick={closeMobile}
          className="p-1 rounded-md text-slate-400 hover:text-slate-600 dark:hover:text-white md:hidden"
          aria-label="Close sidebar"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Navigation List */}
      <div className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
        <div className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          Dispatcher Operations
        </div>
        {NAVIGATION_ITEMS.map((item) => {
          const isActive =
            item.href === '/admin'
              ? pathname === '/admin'
              : pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;

          return (
            <Link
              key={item.name}
              href={item.href}
              onClick={closeMobile}
              className={cn(
                'flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-all group',
                isActive
                  ? 'bg-sky-50 dark:bg-sky-600/10 text-sky-700 dark:text-sky-400 border border-sky-200 dark:border-sky-500/20 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-100/70 dark:hover:bg-slate-900 border border-transparent'
              )}
            >
              <div className="flex items-center gap-3 truncate">
                <Icon
                  className={cn(
                    'w-4 h-4 transition-colors shrink-0',
                    isActive ? 'text-sky-600 dark:text-sky-400' : 'text-slate-400 group-hover:text-slate-600 dark:group-hover:text-slate-300'
                  )}
                />
                <span className="truncate">{item.name}</span>
              </div>
              {item.badge && (
                <span
                  className={cn(
                    'text-[10px] font-bold px-1.5 py-0.5 rounded-sm border shrink-0',
                    item.badge.includes('Hot')
                      ? 'bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-400 border-rose-200 dark:border-rose-800/40'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700'
                  )}
                >
                  {item.badge}
                </span>
              )}
            </Link>
          );
        })}
      </div>

      {/* Bottom Dispatcher Status Card */}
      <div className="p-3 border-t border-slate-200 dark:border-slate-800/80">
        <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 text-xs">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-slate-500 dark:text-slate-400 font-medium">Telephony Bridge</span>
            <span className="inline-flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400 font-medium">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
              Gated / Standby
            </span>
          </div>
          <div className="flex items-center gap-2 text-slate-800 dark:text-slate-300 font-mono text-[11px]">
            <Headphones className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400 shrink-0" />
            <span className="truncate">Retell Inbound Gateway</span>
          </div>
        </div>
      </div>
    </>
  );

  return (
    <>
      {/* Desktop Static Sidebar */}
      <aside className="w-64 bg-white dark:bg-slate-950 border-r border-slate-200 dark:border-slate-800/80 hidden md:flex flex-col shrink-0 h-screen sticky top-0 transition-colors">
        {navContent}
      </aside>

      {/* Mobile Drawer Sidebar */}
      {isMobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden flex">
          <div
            className="fixed inset-0 bg-black/50 backdrop-blur-xs transition-opacity"
            onClick={closeMobile}
            aria-hidden="true"
          />
          <aside className="relative w-64 max-w-[80vw] bg-white dark:bg-slate-950 border-r border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col h-full z-10 animate-in slide-in-from-left duration-200">
            {navContent}
          </aside>
        </div>
      )}
    </>
  );
}
