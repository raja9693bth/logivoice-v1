'use client';

import React from 'react';

export interface PaginationControlsProps {
  offset: number;
  limit: number;
  totalCount: number;
  currentCount: number;
  itemLabel?: string;
  isLoading?: boolean;
  onPageChange: (newOffset: number) => void;
  className?: string;
}

export function PaginationControls({
  offset,
  limit,
  totalCount,
  currentCount,
  itemLabel = 'records',
  isLoading = false,
  onPageChange,
  className = '',
}: PaginationControlsProps) {
  if (totalCount <= limit) return null;

  return (
    <div
      className={`flex items-center justify-between px-3 py-3 rounded-xl bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 text-xs ${className}`}
    >
      <span className="text-slate-500 dark:text-slate-400">
        Showing <span className="font-semibold text-slate-900 dark:text-white">{offset + 1}</span> to{' '}
        <span className="font-semibold text-slate-900 dark:text-white">
          {Math.min(offset + currentCount, totalCount)}
        </span>{' '}
        of <span className="font-semibold text-slate-900 dark:text-white">{totalCount}</span> {itemLabel}
      </span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onPageChange(Math.max(0, offset - limit))}
          disabled={offset === 0 || isLoading}
          className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer"
        >
          Previous
        </button>
        <button
          type="button"
          onClick={() => onPageChange(offset + limit)}
          disabled={offset + currentCount >= totalCount || isLoading}
          className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer"
        >
          Next
        </button>
      </div>
    </div>
  );
}
