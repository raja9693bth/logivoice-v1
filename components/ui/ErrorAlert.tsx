'use client';

import React from 'react';
import { AlertTriangle, X } from 'lucide-react';

export interface ErrorAlertProps {
  error: string | null;
  onDismiss?: () => void;
  className?: string;
}

export function ErrorAlert({ error, onDismiss, className = '' }: ErrorAlertProps) {
  if (!error) return null;

  return (
    <div
      className={`p-4 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/60 flex items-center justify-between gap-3 text-rose-800 dark:text-rose-300 text-xs ${className}`}
      role="alert"
    >
      <div className="flex items-center gap-2">
        <AlertTriangle className="w-4 h-4 shrink-0 text-rose-600 dark:text-rose-400" />
        <span>{error}</span>
      </div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className="text-rose-500 hover:text-rose-700 dark:text-rose-400 dark:hover:text-rose-200 cursor-pointer"
          title="Dismiss Error"
          aria-label="Dismiss Error"
        >
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}
