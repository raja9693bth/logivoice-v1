'use client';

import React, { useState } from 'react';
import { AlertCircle, X } from 'lucide-react';

export function DemoModeBanner() {
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  return (
    <div className="bg-amber-50 dark:bg-amber-950/40 border-b border-amber-200 dark:border-amber-800/40 text-amber-900 dark:text-amber-200 text-xs px-4 py-2 flex items-center justify-between transition-colors">
      <div className="flex items-center gap-2">
        <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
        <span>
          <strong className="font-semibold text-amber-950 dark:text-amber-300">DEMO &amp; SIMULATION MODE ACTIVE:</strong>{' '}
          Showing verified prototype operational data for LogiVoice V1. Production Indian telephony (TRAI 1601 series) &amp; live WhatsApp dispatching remain deployment-gated.
        </span>
      </div>
      <button
        onClick={() => setDismissed(true)}
        className="text-amber-700 hover:text-amber-950 dark:text-amber-400 dark:hover:text-amber-200 p-1 rounded-sm transition-colors focus:outline-hidden focus:ring-1 focus:ring-amber-500"
        title="Dismiss notice"
        aria-label="Dismiss demo mode banner"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

export function SystemStatusPill() {
  return (
    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs text-slate-700 dark:text-slate-300 transition-colors">
      <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
      <span className="font-medium">System Ready (Retell Inbound)</span>
    </div>
  );
}
