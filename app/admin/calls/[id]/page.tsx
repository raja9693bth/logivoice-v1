'use client';

import React, { use, useState, useEffect } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  User,
  CheckCircle2,
  AlertTriangle,
  Send,
  Wrench,
  Layers,
  FileText,
  Truck,
  Loader2,
} from 'lucide-react';
import {
  TemperatureBadge,
  OutcomeBadge,
  IntentBadge,
} from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { MOCK_CALLS } from '@/lib/mock/logivoice-data';
import { formatCurrencyINR, formatDuration, formatDateTime } from '@/lib/utils';
import { Call } from '@/types/logivoice';

export default function CallDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  const [call, setCall] = useState<Call | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isDemoMode, setIsDemoMode] = useState(false);

  useEffect(() => {
    const demoActive = process.env.NODE_ENV !== 'production' && typeof window !== 'undefined' && localStorage.getItem('logivoice_demo_mode') === 'true';
    setIsDemoMode(demoActive);

    if (demoActive) {
      const found = MOCK_CALLS.find((c) => c.id === resolvedParams.id) || MOCK_CALLS[0];
      setCall(found);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    void fetch(`/api/calls/${resolvedParams.id}`)
      .then(async (res) => {
        if (res.status === 401) {
          window.location.href = '/login';
          return null;
        }
        if (res.status === 404) {
          throw new Error(`Call session '${resolvedParams.id}' was not found in the operations database.`);
        }
        if (!res.ok) {
          throw new Error(`Failed to load call details (HTTP ${res.status})`);
        }
        return res.json();
      })
      .then((data) => {
        if (data?.call) {
          setCall(data.call);
        } else if (data !== null) {
          throw new Error('Invalid response structure received from call API.');
        }
      })
      .catch((err) => {
        console.warn('[CallDetailPage] API fetch error:', err);
        setError(err instanceof Error ? err.message : 'Error loading call details.');
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [resolvedParams.id]);

  if (isLoading) {
    return (
      <div className="space-y-6 min-w-0 max-w-full">
        <div className="flex items-center gap-3 border-b border-slate-200 dark:border-slate-800/80 pb-4">
          <Link
            href="/admin/calls"
            className="p-1.5 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div className="text-xs text-slate-400">Loading call session investigation...</div>
        </div>
        <div className="p-16 text-center text-xs text-slate-400 bg-white dark:bg-slate-900/60 rounded-xl border border-slate-200 dark:border-slate-800">
          <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2 text-sky-500" />
          Fetching call record and transcript from operations store...
        </div>
      </div>
    );
  }

  if (error || !call) {
    return (
      <div className="space-y-6 min-w-0 max-w-full">
        <div className="flex items-center gap-3 border-b border-slate-200 dark:border-slate-800/80 pb-4">
          <Link
            href="/admin/calls"
            className="p-1.5 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white tracking-tight">Call Not Found</h1>
        </div>
        <div className="p-8 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/60 text-xs text-rose-800 dark:text-rose-300 space-y-4 text-center max-w-md mx-auto">
          <AlertTriangle className="w-8 h-8 text-rose-600 dark:text-rose-400 mx-auto" />
          <p>{error || 'The requested call record does not exist or has been archived.'}</p>
          <Link
            href="/admin/calls"
            className="inline-block px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-semibold transition-colors"
          >
            Return to Calls Directory
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 min-w-0 max-w-full">
      {/* Top Breadcrumb & Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800/80 pb-4 min-w-0 max-w-full">
        <div className="flex items-center gap-3 min-w-0">
          <Link
            href="/admin/calls"
            className="p-1.5 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors shrink-0"
            title="Back to Calls"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-bold text-slate-900 dark:text-white tracking-tight truncate">Call Investigation: {call.id}</h1>
              <TemperatureBadge temperature={call.lead_temperature} />
              {isDemoMode && (
                <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded-sm bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                  Demo Fixture
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate">
              Retell AI Voice Session &bull; Started {formatDateTime(call.started_at)} &bull; Duration:{' '}
              <span className="font-mono text-slate-700 dark:text-slate-300 font-semibold">{formatDuration(call.duration_seconds)}</span>
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <OutcomeBadge outcome={call.outcome} />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 min-w-0 max-w-full">
        {/* Left Column: Facts, Transcript & Audio Details */}
        <div className="lg:col-span-2 space-y-6 min-w-0 max-w-full">
          {/* Structured Operational Facts Card */}
          <Card className="space-y-4 min-w-0 max-w-full">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800/80 pb-3">
              <h2 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider flex items-center gap-2">
                <Truck className="w-4 h-4 text-sky-600 dark:text-sky-400 shrink-0" />
                <span>Extracted Commercial Facts</span>
              </h2>
              <IntentBadge intent={call.primary_intent} />
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-xs">
              <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800">
                <span className="text-slate-400 dark:text-slate-500 block text-[10px] uppercase">Route Origin</span>
                <span className="text-slate-900 dark:text-white font-semibold mt-0.5 block">{call.facts?.route_from || '—'}</span>
              </div>
              <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800">
                <span className="text-slate-400 dark:text-slate-500 block text-[10px] uppercase">Destination</span>
                <span className="text-slate-900 dark:text-white font-semibold mt-0.5 block">{call.facts?.route_to || '—'}</span>
              </div>
              <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800">
                <span className="text-slate-400 dark:text-slate-500 block text-[10px] uppercase">Vehicle Type</span>
                <span className="text-slate-900 dark:text-white font-semibold mt-0.5 block">{call.facts?.vehicle_type || '—'}</span>
              </div>
              <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800">
                <span className="text-slate-400 dark:text-slate-500 block text-[10px] uppercase">Weight Band</span>
                <span className="text-slate-900 dark:text-white font-semibold mt-0.5 block">{call.facts?.weight || '—'}</span>
              </div>
              <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800">
                <span className="text-slate-400 dark:text-slate-500 block text-[10px] uppercase">Quoted Freight Rate</span>
                <span className="text-emerald-700 dark:text-emerald-400 font-bold font-mono text-sm mt-0.5 block">
                  {call.facts?.quoted_amount ? formatCurrencyINR(call.facts.quoted_amount) : '—'}
                  {call.facts?.quote_type && ` (${call.facts.quote_type})`}
                </span>
              </div>
              <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800">
                <span className="text-slate-400 dark:text-slate-500 block text-[10px] uppercase">LR / Consignment #</span>
                <span className="text-sky-600 dark:text-sky-400 font-mono font-bold mt-0.5 block">
                  {call.facts?.tracking_id || '—'}
                </span>
              </div>
            </div>

            {call.facts?.special_requirements && (
              <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/40 text-xs">
                <span className="font-semibold text-amber-900 dark:text-amber-300 block mb-0.5">Special Operational Notes:</span>
                <p className="text-amber-800 dark:text-amber-200">{call.facts.special_requirements}</p>
              </div>
            )}
          </Card>

          {/* AI Executive Summary */}
          <Card className="space-y-2 min-w-0 max-w-full">
            <h2 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider flex items-center gap-2">
              <FileText className="w-4 h-4 text-purple-600 dark:text-purple-400 shrink-0" />
              <span>AI Call Turn Synthesis</span>
            </h2>
            <p className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200 text-xs leading-relaxed break-words">
              {call.summary || 'Inbound call completed. No detailed synthesis generated.'}
            </p>
          </Card>

          {/* Transcript Dialogue Feed */}
          <Card className="space-y-4 min-w-0 max-w-full">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800/80 pb-3">
              <h2 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider flex items-center gap-2">
                <Layers className="w-4 h-4 text-sky-600 dark:text-sky-400 shrink-0" />
                <span>Full Turn-by-Turn Audio Transcript</span>
              </h2>
              <span className="text-[10px] text-slate-500 dark:text-slate-400 font-mono">
                {Array.isArray(call.transcript) ? `${call.transcript.length} turns` : 'Transcript available'}
              </span>
            </div>

            <div className="space-y-3 min-w-0 max-w-full">
              {Array.isArray(call.transcript) && call.transcript.length > 0 ? (
                call.transcript.map((turn, idx) => (
                  <div
                    key={idx}
                    className={`p-3.5 rounded-xl border text-xs leading-relaxed min-w-0 max-w-full ${
                      turn.speaker === 'agent'
                        ? 'bg-sky-50/70 dark:bg-sky-950/20 border-sky-200 dark:border-sky-900/40 text-slate-900 dark:text-sky-100 ml-2 sm:ml-6'
                        : 'bg-white dark:bg-slate-950 border-slate-200 dark:border-slate-800 text-slate-900 dark:text-slate-100 mr-2 sm:mr-6'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1 text-[10px] text-slate-500 dark:text-slate-400 gap-2 flex-wrap">
                      <span className="font-bold uppercase tracking-wider truncate">
                        {turn.speaker === 'agent' ? 'LogiVoice Agent (Hinglish)' : call.customer?.name || 'Inbound Caller'}
                      </span>
                      <span className="font-mono shrink-0">{turn.timestamp}</span>
                    </div>
                    <p className="break-words">{turn.text}</p>
                  </div>
                ))
              ) : (
                <div className="p-4 bg-slate-50 dark:bg-slate-950 rounded-lg text-xs text-slate-600 dark:text-slate-400">
                  {typeof call.transcript === 'string' ? call.transcript : 'Transcript excerpt not stored for this session.'}
                </div>
              )}
            </div>
          </Card>
        </div>

        {/* Right Column: Customer Profile & Audits */}
        <div className="space-y-6 min-w-0 max-w-full">
          {/* Customer CRM Card */}
          <Card className="space-y-4 min-w-0 max-w-full">
            <h2 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider flex items-center gap-2">
              <User className="w-4 h-4 text-sky-600 dark:text-sky-400 shrink-0" />
              <span>Caller Profile</span>
            </h2>
            <div className="space-y-3 text-xs min-w-0 max-w-full">
              <div>
                <span className="text-slate-500 dark:text-slate-400 block text-[10px] uppercase">Name</span>
                <span className="font-semibold text-slate-900 dark:text-white text-sm truncate block">
                  {call.customer?.name || 'Unregistered Shipper'}
                </span>
              </div>
              <div>
                <span className="text-slate-500 dark:text-slate-400 block text-[10px] uppercase">Phone Number</span>
                <span className="font-mono text-slate-900 dark:text-slate-200 font-medium truncate block">
                  {call.customer?.phone || '—'}
                </span>
              </div>
              {call.customer?.company && (
                <div>
                  <span className="text-slate-500 dark:text-slate-400 block text-[10px] uppercase">Company / Shipper</span>
                  <span className="text-slate-900 dark:text-slate-200 font-medium truncate block">
                    {call.customer.company}
                  </span>
                </div>
              )}
            </div>
          </Card>

          {/* Tool Audit Events */}
          <Card className="space-y-3 min-w-0 max-w-full">
            <h2 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider flex items-center gap-2">
              <Wrench className="w-4 h-4 text-purple-600 dark:text-purple-400 shrink-0" />
              <span>Service 1: Tool Gateway Invocations</span>
            </h2>

            {call.tool_events && call.tool_events.length > 0 ? (
              <div className="space-y-2.5 min-w-0 max-w-full">
                {call.tool_events.map((te) => (
                  <div
                    key={te.id}
                    className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-2 font-mono text-[11px] min-w-0 max-w-full overflow-hidden"
                  >
                    <div className="flex justify-between items-center text-sky-700 dark:text-sky-400 font-bold gap-2 min-w-0">
                      <span className="truncate">{te.tool_name}()</span>
                      <span className="text-slate-400 dark:text-slate-500 text-[10px] shrink-0">{te.latency_ms} ms</span>
                    </div>

                    <div className="space-y-1 min-w-0 max-w-full">
                      <div className="text-slate-500 dark:text-slate-400 text-[10px] font-semibold uppercase tracking-wider">
                        Input Parameters:
                      </div>
                      <pre className="p-2.5 rounded-md bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 text-[10px] overflow-x-auto max-w-full font-mono whitespace-pre-wrap break-all leading-tight">
                        {JSON.stringify(te.input_params, null, 2)}
                      </pre>
                    </div>

                    <div className="space-y-1 min-w-0 max-w-full">
                      <div className="text-slate-500 dark:text-slate-400 text-[10px] font-semibold uppercase tracking-wider">
                        Output Result:
                      </div>
                      <pre className="p-2.5 rounded-md bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-emerald-700 dark:text-emerald-400 text-[10px] overflow-x-auto max-w-full font-mono whitespace-pre-wrap break-all leading-tight">
                        {JSON.stringify(te.output_result, null, 2)}
                      </pre>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-500 dark:text-slate-400 italic">No backend tools called during this session.</p>
            )}
          </Card>

          {/* Post-Call Lead Nurturing */}
          <Card className="space-y-3 min-w-0 max-w-full">
            <h2 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider flex items-center gap-2">
              <Send className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <span>Service 2: Follow-Up Nurturing</span>
            </h2>
            <div className="space-y-2 text-xs min-w-0 max-w-full">
              <div className="flex justify-between items-center gap-2 flex-wrap">
                <span className="text-slate-500 dark:text-slate-400">Policy Eligibility:</span>
                <span className={call.followup_state?.eligible ? 'text-emerald-700 dark:text-emerald-400 font-semibold' : 'text-slate-500 dark:text-slate-400'}>
                  {call.followup_state?.eligible ? 'PASSED & APPROVED' : 'SUPPRESSED BY POLICY'}
                </span>
              </div>
              {call.followup_state?.channel && (
                <div className="flex justify-between items-center gap-2 flex-wrap">
                  <span className="text-slate-500 dark:text-slate-400">Channel &amp; Status:</span>
                  <span className="font-semibold text-slate-900 dark:text-white">
                    {call.followup_state.channel} &bull; {call.followup_state.status}
                  </span>
                </div>
              )}
              {call.followup_state?.message_snippet && (
                <div className="pt-2 border-t border-slate-200 dark:border-slate-800/80 min-w-0 max-w-full">
                  <span className="text-[11px] text-slate-500 dark:text-slate-400 block mb-1">Dispatched Template Payload:</span>
                  <p className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-300 font-mono text-[11px] leading-relaxed break-words overflow-x-auto max-w-full">
                    {call.followup_state.message_snippet}
                  </p>
                </div>
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
