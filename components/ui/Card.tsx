import React from 'react';
import { cn } from '@/lib/utils';

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

export function Card({ className, children, ...props }: CardProps) {
  return (
    <div
      className={cn(
        'bg-white dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-xs transition-colors min-w-0 max-w-full',
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function BentoCard({
  title,
  value,
  subtitle,
  trend,
  icon: Icon,
  badgeText,
  badgeVariant,
  className,
  onClick,
}: {
  title: string;
  value: string | number;
  subtitle?: string;
  trend?: string;
  icon?: React.ElementType;
  badgeText?: string;
  badgeVariant?: 'success' | 'warning' | 'danger' | 'info' | 'neutral';
  className?: string;
  onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      className={cn(
        'bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800/80 rounded-xl p-5 flex flex-col justify-between hover:border-slate-300 dark:hover:border-slate-700/80 transition-all group shadow-xs min-w-0 max-w-full',
        onClick && 'cursor-pointer hover:bg-slate-50/80 dark:hover:bg-slate-800/40 focus:outline-hidden focus:ring-2 focus:ring-sky-500',
        className
      )}
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <span className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider truncate">
          {title}
        </span>
        {Icon && (
          <div className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700/50 flex items-center justify-center text-slate-600 dark:text-slate-300 group-hover:text-sky-600 dark:group-hover:text-sky-400 group-hover:border-sky-300 dark:group-hover:border-sky-500/30 transition-colors shrink-0">
            <Icon className="w-4 h-4" />
          </div>
        )}
      </div>

      <div className="space-y-1 min-w-0">
        <div className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight flex items-baseline gap-2 flex-wrap">
          <span className="truncate">{value}</span>
          {badgeText && (
            <span
              className={cn(
                'text-xs font-semibold px-2 py-0.5 rounded-sm border shrink-0',
                badgeVariant === 'danger'
                  ? 'bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800/60'
                  : badgeVariant === 'warning'
                  ? 'bg-amber-50 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border-amber-200 dark:border-amber-800/60'
                  : 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800/60'
              )}
            >
              {badgeText}
            </span>
          )}
        </div>
        {(subtitle || trend) && (
          <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 flex-wrap">
            {trend && <span className="font-medium text-slate-700 dark:text-slate-300 shrink-0">{trend}</span>}
            {subtitle && <span className="truncate">{subtitle}</span>}
          </div>
        )}
      </div>
    </div>
  );
}
