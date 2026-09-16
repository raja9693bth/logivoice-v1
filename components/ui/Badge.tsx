import React from 'react';
import { cn } from '@/lib/utils';
import { LeadTemperature, CallOutcome, CallIntent, RequestStatus } from '@/types/logivoice';

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'purple';
  children: React.ReactNode;
}

export function Badge({ variant = 'default', className, children, ...props }: BadgeProps) {
  const variantStyles = {
    default: 'bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 border-slate-200 dark:border-slate-700',
    success: 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800/60',
    warning: 'bg-amber-50 dark:bg-amber-950/60 text-amber-900 dark:text-amber-300 border-amber-200 dark:border-amber-800/60',
    danger: 'bg-rose-50 dark:bg-rose-950/60 text-rose-800 dark:text-rose-300 border-rose-200 dark:border-rose-800/60',
    info: 'bg-sky-50 dark:bg-sky-950/60 text-sky-800 dark:text-sky-300 border-sky-200 dark:border-sky-800/60',
    neutral: 'bg-slate-100 dark:bg-slate-900 text-slate-700 dark:text-slate-400 border-slate-200 dark:border-slate-800',
    purple: 'bg-violet-50 dark:bg-violet-950/60 text-violet-800 dark:text-violet-300 border-violet-200 dark:border-violet-800/60',
  };

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-xs font-medium border transition-colors',
        variantStyles[variant],
        className
      )}
      {...props}
    >
      {children}
    </span>
  );
}

export function TemperatureBadge({ temperature }: { temperature: LeadTemperature }) {
  switch (temperature) {
    case 'HOT':
      return (
        <Badge variant="danger" className="font-semibold tracking-wide">
          <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" />
          HOT LEAD
        </Badge>
      );
    case 'WARM':
      return (
        <Badge variant="warning" className="font-semibold tracking-wide">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
          WARM LEAD
        </Badge>
      );
    case 'COLD':
      return (
        <Badge variant="neutral">
          <span className="w-1.5 h-1.5 rounded-full bg-slate-400 dark:bg-slate-500" />
          COLD
        </Badge>
      );
    case 'REVIEW':
      return (
        <Badge variant="purple" className="font-semibold">
          <span className="w-1.5 h-1.5 rounded-full bg-violet-500" />
          HUMAN REVIEW
        </Badge>
      );
    default:
      return <Badge variant="neutral">{temperature}</Badge>;
  }
}

export function OutcomeBadge({ outcome }: { outcome: CallOutcome }) {
  switch (outcome) {
    case 'COMPLETED':
      return <Badge variant="success">Completed</Badge>;
    case 'TRANSFERRED':
      return <Badge variant="warning">Transferred to Human</Badge>;
    case 'CALLBACK_SCHEDULED':
      return <Badge variant="info">Callback Scheduled</Badge>;
    case 'MISSED':
      return <Badge variant="danger">Missed Call</Badge>;
    case 'FAILED':
      return <Badge variant="danger">Failed</Badge>;
    case 'ABANDONED':
      return <Badge variant="neutral">Abandoned</Badge>;
    default:
      return <Badge variant="neutral">{outcome}</Badge>;
  }
}

export function IntentBadge({ intent }: { intent: CallIntent }) {
  switch (intent) {
    case 'RATE_QUOTE':
      return <Badge variant="info">Rate Quote</Badge>;
    case 'TRACKING':
      return <Badge variant="purple">Tracking</Badge>;
    case 'BOOKING':
      return <Badge variant="success">Booking</Badge>;
    case 'SERVICE_AREA':
      return <Badge variant="neutral">Service Area</Badge>;
    case 'HUMAN_REQUEST':
      return <Badge variant="warning">Human Request</Badge>;
    case 'COMPLAINT':
      return <Badge variant="danger">Complaint</Badge>;
    default:
      return <Badge variant="default">{intent}</Badge>;
  }
}

export function RequestStatusBadge({ status }: { status: RequestStatus }) {
  switch (status) {
    case 'PENDING':
      return <Badge variant="warning">Pending Confirmation</Badge>;
    case 'CONFIRMED':
      return <Badge variant="success">Confirmed</Badge>;
    case 'IN_REVIEW':
      return <Badge variant="purple">In Review</Badge>;
    case 'COMPLETED':
      return <Badge variant="success">Completed</Badge>;
    case 'REJECTED':
      return <Badge variant="danger">Rejected</Badge>;
    case 'FAILED':
      return <Badge variant="danger">Failed</Badge>;
    default:
      return <Badge variant="neutral">{status}</Badge>;
  }
}
