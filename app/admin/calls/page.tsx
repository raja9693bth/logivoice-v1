'use client';

import React, { useState, useMemo } from 'react';
import Link from 'next/link';
import {
  PhoneCall,
  Search,
  RotateCcw,
  CheckCircle2,
  ExternalLink,
} from 'lucide-react';
import {
  TemperatureBadge,
  OutcomeBadge,
  IntentBadge,
} from '@/components/ui/Badge';
import { MOCK_CALLS } from '@/lib/mock/logivoice-data';
import { formatCurrencyINR, formatDuration, formatDateTime } from '@/lib/utils';
import { Drawer } from '@/components/ui/Drawer';
import { EmptyState } from '@/components/ui/EmptyState';
import { Call } from '@/types/logivoice';

export default function CallsPage() {
  const [calls, setCalls] = useState<Call[]>(MOCK_CALLS);
  const [searchQuery, setSearchQuery] = useState('');
  const [intentFilter, setIntentFilter] = useState<string>('ALL');
  const [outcomeFilter, setOutcomeFilter] = useState<string>('ALL');
  const [tempFilter, setTempFilter] = useState<string>('ALL');
  const [selectedCall, setSelectedCall] = useState<Call | null>(null);

  React.useEffect(() => {
    fetch('/api/calls')
      .then((res) => res.json())
      .then((data) => {
        if (data?.calls && Array.isArray(data.calls) && data.calls.length > 0) {
          setCalls(data.calls);
        }
      })
      .catch((err) => console.warn('[CallsPage] API fetch error:', err));
  }, []);

  const filteredCalls = useMemo(() => {
    return calls.filter((call) => {
      const query = searchQuery.toLowerCase();
      const matchesSearch =
        !searchQuery ||
        call.id.toLowerCase().includes(query) ||
        call.customer?.name.toLowerCase().includes(query) ||
        call.customer?.phone.toLowerCase().includes(query) ||
        call.customer?.company?.toLowerCase().includes(query) ||
        call.facts.tracking_id?.toLowerCase().includes(query) ||
        call.facts.route_from?.toLowerCase().includes(query) ||
        call.facts.route_to?.toLowerCase().includes(query);

      const matchesIntent = intentFilter === 'ALL' || call.primary_intent === intentFilter;
      const matchesOutcome = outcomeFilter === 'ALL' || call.outcome === outcomeFilter;
      const matchesTemp = tempFilter === 'ALL' || call.lead_temperature === tempFilter;

      return matchesSearch && matchesIntent && matchesOutcome && matchesTemp;
    });
  }, [searchQuery, intentFilter, outcomeFilter, tempFilter]);

  const resetFilters = () => {
    setSearchQuery('');
    setIntentFilter('ALL');
    setOutcomeFilter('ALL');
    setTempFilter('ALL');
  };

  return (
    <div className="space-y-6 min-w-0 max-w-full">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800/80 pb-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white tracking-tight">Inbound Voice Calls</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Operational call audit log, intent classifications, and structured business outcomes
          </p>
        </div>
        <div className="text-xs text-slate-500 dark:text-slate-400">
          Showing <span className="text-slate-900 dark:text-white font-semibold">{filteredCalls.length}</span> of{' '}
          <span className="text-slate-900 dark:text-white font-semibold">{MOCK_CALLS.length}</span> recorded sessions
        </div>
      </div>

      {/* Filter & Search Bar */}
      <div className="p-4 rounded-xl bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 space-y-3 shadow-xs">
        <div className="flex flex-col md:flex-row items-stretch md:items-center gap-3">
          {/* Search Input */}
          <div className="flex-1 relative">
            <Search className="w-4 h-4 text-slate-400 dark:text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by customer, phone, LR #, origin or destination..."
              className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg pl-9 pr-4 py-1.5 text-xs text-slate-900 dark:text-slate-200 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-hidden focus:border-sky-500 focus:ring-1 focus:ring-sky-500/20"
            />
          </div>

          {/* Intent Filter */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500 dark:text-slate-400 shrink-0">Intent:</span>
            <select
              value={intentFilter}
              onChange={(e) => setIntentFilter(e.target.value)}
              className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-800 dark:text-slate-200 focus:outline-hidden focus:border-sky-500"
            >
              <option value="ALL">All Intents</option>
              <option value="RATE_QUOTE">Rate Quote</option>
              <option value="TRACKING">Tracking</option>
              <option value="BOOKING">Booking</option>
              <option value="SERVICE_AREA">Service Area</option>
              <option value="HUMAN_REQUEST">Human Escalation</option>
              <option value="COMPLAINT">Complaint</option>
            </select>
          </div>

          {/* Outcome Filter */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500 dark:text-slate-400 shrink-0">Outcome:</span>
            <select
              value={outcomeFilter}
              onChange={(e) => setOutcomeFilter(e.target.value)}
              className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-800 dark:text-slate-200 focus:outline-hidden focus:border-sky-500"
            >
              <option value="ALL">All Outcomes</option>
              <option value="COMPLETED">Completed</option>
              <option value="TRANSFERRED">Transferred</option>
              <option value="MISSED">Missed</option>
              <option value="FAILED">Failed</option>
            </select>
          </div>

          {/* Lead Temp Filter */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500 dark:text-slate-400 shrink-0">Temperature:</span>
            <select
              value={tempFilter}
              onChange={(e) => setTempFilter(e.target.value)}
              className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-800 dark:text-slate-200 focus:outline-hidden focus:border-sky-500"
            >
              <option value="ALL">All Temps</option>
              <option value="HOT">HOT</option>
              <option value="WARM">WARM</option>
              <option value="COLD">COLD</option>
              <option value="REVIEW">REVIEW</option>
            </select>
          </div>

          {(searchQuery || intentFilter !== 'ALL' || outcomeFilter !== 'ALL' || tempFilter !== 'ALL') && (
            <button
              onClick={resetFilters}
              className="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors"
              title="Reset Filters"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Operational Calls Table */}
      {filteredCalls.length === 0 ? (
        <EmptyState
          title="No calls match your filter criteria"
          description="Try adjusting your search query, intent category, or outcome status."
          actionLabel="Reset Filters"
          onAction={resetFilters}
        />
      ) : (
        <div className="table-container bg-white dark:bg-slate-900/60 shadow-xs">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/80 text-slate-500 dark:text-slate-400 uppercase text-[11px] tracking-wider">
                <th className="py-3 px-4">Call ID &amp; Time</th>
                <th className="py-3 px-4">Customer</th>
                <th className="py-3 px-4">Primary Intent</th>
                <th className="py-3 px-4">Extracted Facts</th>
                <th className="py-3 px-4">Outcome</th>
                <th className="py-3 px-4">Lead Temp</th>
                <th className="py-3 px-4">Follow-up</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800/60">
              {filteredCalls.map((call) => (
                <tr key={call.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors">
                  <td className="py-3 px-4 font-mono">
                    <span className="text-slate-900 dark:text-white font-semibold">{call.id}</span>
                    <span className="block text-[11px] text-slate-500 dark:text-slate-400">{formatDateTime(call.started_at)}</span>
                    <span className="text-[10px] text-slate-400 dark:text-slate-500 font-sans">
                      Duration: {formatDuration(call.duration_seconds)}
                    </span>
                  </td>
                  <td className="py-3 px-4">
                    <div className="font-medium text-slate-900 dark:text-white">{call.customer?.name}</div>
                    <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400">{call.customer?.phone}</div>
                    {call.customer?.company && (
                      <div className="text-[10px] text-slate-400 dark:text-slate-500 truncate max-w-[150px]">
                        {call.customer.company}
                      </div>
                    )}
                  </td>
                  <td className="py-3 px-4">
                    <IntentBadge intent={call.primary_intent} />
                  </td>
                  <td className="py-3 px-4 max-w-xs">
                    {call.facts.route_from ? (
                      <div>
                        <span className="text-slate-700 dark:text-slate-300 font-medium">{call.facts.route_from}</span>
                        <span className="text-slate-400"> &rarr; </span>
                        <span className="text-slate-700 dark:text-slate-300 font-medium">{call.facts.route_to}</span>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400">
                          {call.facts.weight} • {call.facts.vehicle_type}
                        </div>
                        {call.facts.quoted_amount && (
                          <div className="text-emerald-600 dark:text-emerald-400 font-bold font-mono text-[11px]">
                            ₹{call.facts.quoted_amount.toLocaleString('en-IN')} ({call.facts.quote_type})
                          </div>
                        )}
                      </div>
                    ) : call.facts.tracking_id ? (
                      <div>
                        <span className="text-sky-600 dark:text-sky-400 font-mono font-bold">LR #{call.facts.tracking_id}</span>
                        <span className="block text-[11px] text-slate-500 dark:text-slate-400">{call.facts.route_from} &rarr; {call.facts.route_to}</span>
                      </div>
                    ) : (
                      <span className="text-slate-400 dark:text-slate-500 italic">General inquiry / No freight facts</span>
                    )}
                  </td>
                  <td className="py-3 px-4">
                    <OutcomeBadge outcome={call.outcome} />
                    {call.escalation_status?.is_escalated && (
                      <span className="block text-[10px] text-amber-600 dark:text-amber-400 mt-0.5">
                        &rarr; {call.escalation_status.target_role}
                      </span>
                    )}
                  </td>
                  <td className="py-3 px-4">
                    <TemperatureBadge temperature={call.lead_temperature} />
                  </td>
                  <td className="py-3 px-4">
                    {call.followup_state?.eligible ? (
                      <div>
                        <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">
                          <CheckCircle2 className="w-3 h-3" />
                          {call.followup_state.channel}
                        </span>
                        <span className="block text-[10px] text-slate-400 dark:text-slate-500">{call.followup_state.status}</span>
                      </div>
                    ) : (
                      <span className="text-[11px] text-slate-400 dark:text-slate-500">Suppressed</span>
                    )}
                  </td>
                  <td className="py-3 px-4 text-right space-x-1.5 whitespace-nowrap">
                    <button
                      onClick={() => setSelectedCall(call)}
                      className="px-2.5 py-1 rounded-md bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-sky-700 dark:text-sky-400 text-xs font-medium transition-colors border border-slate-200 dark:border-slate-700"
                    >
                      Quick View
                    </button>
                    <Link
                      href={`/admin/calls/${call.id}`}
                      className="px-2.5 py-1 rounded-md bg-slate-50 hover:bg-slate-100 dark:bg-slate-900 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-medium transition-colors border border-slate-200 dark:border-slate-800 inline-flex items-center gap-1"
                    >
                      <span>Full</span>
                      <ExternalLink className="w-3 h-3" />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Quick View Drawer */}
      <Drawer
        isOpen={!!selectedCall}
        onClose={() => setSelectedCall(null)}
        title={`Call Audit — ${selectedCall?.id}`}
        subtitle={`Caller: ${selectedCall?.customer?.name} (${selectedCall?.customer?.phone})`}
      >
        {selectedCall && (
          <div className="space-y-6 text-xs">
            <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-slate-900 dark:text-white font-semibold text-sm">{selectedCall.customer?.name}</span>
                <TemperatureBadge temperature={selectedCall.lead_temperature} />
              </div>
              <div className="flex justify-between text-slate-500 dark:text-slate-400">
                <span>Outcome:</span>
                <OutcomeBadge outcome={selectedCall.outcome} />
              </div>
              <div className="flex justify-between text-slate-500 dark:text-slate-400">
                <span>Duration:</span>
                <span className="font-mono text-slate-800 dark:text-slate-200">{formatDuration(selectedCall.duration_seconds)}</span>
              </div>
            </div>

            <div className="space-y-1.5 min-w-0 max-w-full">
              <h3 className="font-semibold text-slate-900 dark:text-white uppercase text-[11px] tracking-wider">Summary</h3>
              <p className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-300 leading-relaxed break-words">
                {selectedCall.summary}
              </p>
            </div>

            {selectedCall.transcript && (
              <div className="space-y-2 min-w-0 max-w-full">
                <h3 className="font-semibold text-slate-900 dark:text-white uppercase text-[11px] tracking-wider">Transcript Excerpt</h3>
                <div className="space-y-2 max-h-64 overflow-y-auto pr-1 min-w-0 max-w-full">
                  {selectedCall.transcript.map((t, idx) => (
                    <div
                      key={idx}
                      className={`p-3 rounded-lg border text-xs leading-relaxed min-w-0 max-w-full ${
                        t.speaker === 'agent'
                          ? 'bg-sky-50 dark:bg-sky-950/20 border-sky-200 dark:border-sky-900/30 text-sky-950 dark:text-sky-200 ml-2 sm:ml-4'
                          : 'bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200 mr-2 sm:mr-4'
                      }`}
                    >
                      <div className="flex justify-between text-[10px] text-slate-500 dark:text-slate-400 mb-1 gap-2 flex-wrap">
                        <span className="font-bold uppercase text-slate-700 dark:text-slate-300 truncate">
                          {t.speaker === 'agent' ? 'LogiVoice AI' : 'Caller'}
                        </span>
                        <span className="font-mono shrink-0">{t.timestamp}</span>
                      </div>
                      <p className="break-words">{t.text}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="pt-2">
              <Link
                href={`/admin/calls/${selectedCall.id}`}
                className="w-full py-2.5 px-4 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-semibold text-center block transition-colors shadow-xs"
              >
                Go to Dedicated Call Detail Page
              </Link>
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
}
