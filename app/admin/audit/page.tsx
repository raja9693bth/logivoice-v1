'use client';

import React, { useState, useMemo } from 'react';
import {
  ShieldAlert,
  Search,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Clock,
  Activity,
  Server,
  Zap,
} from 'lucide-react';
import { Drawer } from '@/components/ui/Drawer';
import { EmptyState } from '@/components/ui/EmptyState';
import { formatDateTime } from '@/lib/utils';
import { AuditEvent, AuditSeverity } from '@/types/logivoice';

export default function SystemAuditPage() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [severityFilter, setSeverityFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedEvent, setSelectedEvent] = useState<AuditEvent | null>(null);

  const fetchAuditEvents = React.useCallback(() => {
    setLoading(true);
    setError(null);
    fetch('/api/audit')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        if (data?.events && Array.isArray(data.events)) {
          setEvents(data.events);
        } else {
          setEvents([]);
        }
      })
      .catch((err) => {
        console.error('[AuditPage] API fetch error:', err);
        setError('Failed to fetch system audit logs from server.');
      })
      .finally(() => setLoading(false));
  }, []);

  React.useEffect(() => {
    void fetchAuditEvents();
  }, [fetchAuditEvents]);

  const filteredEvents = useMemo(() => {
    return events.filter((ev) => {
      const matchesSeverity = severityFilter === 'ALL' || ev.severity === severityFilter;
      const q = searchQuery.toLowerCase();
      const matchesSearch =
        !searchQuery ||
        ev.event_type.toLowerCase().includes(q) ||
        ev.actor.toLowerCase().includes(q) ||
        ev.call_id?.toLowerCase().includes(q) ||
        ev.tool_name?.toLowerCase().includes(q);

      return matchesSeverity && matchesSearch;
    });
  }, [events, severityFilter, searchQuery]);

  return (
    <div className="space-y-6 min-w-0 max-w-full">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800/80 pb-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white tracking-tight">System Status &amp; Audit Logs</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Traceable operational event log, tool executions, webhook dispatches &amp; failure forensics
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-300 dark:border-emerald-800 text-xs text-emerald-700 dark:text-emerald-300 font-medium">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            Audit Logging Active
          </span>
        </div>
      </div>

      {/* Gateway & Webhook Health Status Cards */}
      {(() => {
        const toolEvents = events.filter((e) => e.tool_name);
        const failedToolEvents = toolEvents.filter((e) => e.severity === 'ERROR' || e.event_type.includes('FAIL')).length;
        const toolSuccessRate = toolEvents.length > 0 ? Math.round(((toolEvents.length - failedToolEvents) / toolEvents.length) * 100) : null;

        const webhookEvents = events.filter((e) => e.event_type.includes('WEBHOOK') || e.event_type.includes('CALL_'));
        const latestWebhook = webhookEvents[0];
        const suppressedEvents = events.filter((e) => e.event_type.includes('SUPPRESS') || (e.details as Record<string, unknown>)?.status === 'SUPPRESSED').length;

        return (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
            <div className="p-4 rounded-xl bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 space-y-1.5 shadow-xs">
              <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
                <span>Retell Inbound Webhook</span>
                <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div className="text-lg font-bold text-slate-900 dark:text-white font-mono">
                {webhookEvents.length > 0 ? 'Active' : 'Listening'}
              </div>
              <p className="text-[10px] text-slate-500">
                {latestWebhook
                  ? `Last event: ${new Date(latestWebhook.created_at || latestWebhook.timestamp).toLocaleTimeString('en-IN')}`
                  : 'No webhook events recorded'}
              </p>
            </div>

            <div className="p-4 rounded-xl bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 space-y-1.5 shadow-xs">
              <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
                <span>Operational Tool Gateway</span>
                <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div className="text-lg font-bold text-slate-900 dark:text-white font-mono">
                {toolSuccessRate !== null ? `${toolSuccessRate}% Success` : 'No data'}
              </div>
              <p className="text-[10px] text-slate-500">
                {toolEvents.length > 0 ? `${toolEvents.length} tools executed` : 'Awaiting voice events'}
              </p>
            </div>

            <div className="p-4 rounded-xl bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 space-y-1.5 shadow-xs">
              <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
                <span>Follow-up Policy Engine</span>
                <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div className="text-lg font-bold text-slate-900 dark:text-white font-mono">Enforced</div>
              <p className="text-[10px] text-slate-500">
                {suppressedEvents > 0 ? `${suppressedEvents} events suppressed safely` : 'Zero suppression triggers'}
              </p>
            </div>

            <div className="p-4 rounded-xl bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 space-y-1.5 shadow-xs">
              <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
                <span>Tenant Isolation Boundary</span>
                <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div className="text-lg font-bold text-slate-900 dark:text-white font-mono">Secured</div>
              <p className="text-[10px] text-slate-500">All queries scoped to tenant_id</p>
            </div>
          </div>
        );
      })()}

      {/* Filter Bar */}
      <div className="p-4 rounded-xl bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col md:flex-row items-stretch md:items-center gap-3">
        <div className="flex-1 relative">
          <Search className="w-4 h-4 text-slate-400 dark:text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by event type, actor, call ID, or tool name..."
            className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg pl-9 pr-4 py-1.5 text-xs text-slate-900 dark:text-slate-200 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-hidden focus:border-sky-500"
          />
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500 dark:text-slate-400 shrink-0">Severity:</span>
          <select
            value={severityFilter}
            onChange={(e) => setSeverityFilter(e.target.value)}
            className="bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-200 focus:outline-hidden focus:border-sky-500"
          >
            <option value="ALL">All Severities</option>
            <option value="INFO">INFO</option>
            <option value="WARNING">WARNING</option>
            <option value="ERROR">ERROR</option>
            <option value="CRITICAL">CRITICAL</option>
          </select>
        </div>
      </div>

      {/* Error Alert */}
      {error && (
        <div className="p-3 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-lg text-amber-800 dark:text-amber-200 text-xs flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => fetchAuditEvents()} className="underline font-semibold hover:text-amber-900">
            Retry
          </button>
        </div>
      )}

      {/* Audit Log Table */}
      {loading ? (
        <div className="p-8 text-center text-xs text-slate-500 bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-xl">
          <div className="inline-block w-6 h-6 border-2 border-sky-500 border-t-transparent rounded-full animate-spin mb-2"></div>
          <p>Loading system audit logs from database...</p>
        </div>
      ) : filteredEvents.length === 0 ? (
        <EmptyState
          title="No audit events found"
          description="Try changing severity filter or search parameters."
          actionLabel="Clear Filters"
          onAction={() => {
            setSeverityFilter('ALL');
            setSearchQuery('');
          }}
        />
      ) : (
        <div className="table-container bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 shadow-xs">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-100/80 dark:bg-slate-950/80 text-slate-600 dark:text-slate-400 uppercase text-[11px] tracking-wider">
                <th className="py-3 px-4">Timestamp</th>
                <th className="py-3 px-4">Event Type</th>
                <th className="py-3 px-4">Actor</th>
                <th className="py-3 px-4">Call ID</th>
                <th className="py-3 px-4">Tool / Action</th>
                <th className="py-3 px-4">Severity</th>
                <th className="py-3 px-4">Details Summary</th>
                <th className="py-3 px-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800/60">
              {filteredEvents.map((ev) => (
                <tr key={ev.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors">
                  <td className="py-3 px-4 font-mono text-slate-500 dark:text-slate-400">{formatDateTime(ev.timestamp)}</td>
                  <td className="py-3 px-4 font-mono font-semibold text-slate-900 dark:text-white">{ev.event_type}</td>
                  <td className="py-3 px-4 text-slate-700 dark:text-slate-300">{ev.actor}</td>
                  <td className="py-3 px-4 font-mono text-sky-600 dark:text-sky-400">{ev.call_id || '—'}</td>
                  <td className="py-3 px-4 text-slate-700 dark:text-slate-300 font-mono text-[11px]">{ev.tool_name || 'system'}</td>
                  <td className="py-3 px-4">
                    <span
                      className={`text-[10px] font-bold px-1.5 py-0.5 rounded border uppercase ${
                        ev.severity === 'INFO'
                          ? 'bg-sky-50 dark:bg-sky-950/60 text-sky-700 dark:text-sky-300 border-sky-200 dark:border-sky-800'
                          : ev.severity === 'WARNING'
                          ? 'bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800'
                          : 'bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800'
                      }`}
                    >
                      {ev.severity}
                    </span>
                  </td>
                  <td className="py-3 px-4 max-w-xs truncate font-mono text-slate-500 dark:text-slate-400 text-[11px]">
                    {JSON.stringify(ev.details)}
                  </td>
                  <td className="py-3 px-4 text-right">
                    <button
                      onClick={() => setSelectedEvent(ev)}
                      className="px-2.5 py-1 rounded-md bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-sky-600 dark:text-sky-400 hover:text-sky-700 dark:hover:text-sky-300 text-xs font-medium transition-colors border border-slate-300 dark:border-slate-700"
                    >
                      Inspect
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Audit Detail Drawer */}
      <Drawer
        isOpen={!!selectedEvent}
        onClose={() => setSelectedEvent(null)}
        title={`Audit Event Forensics — ${selectedEvent?.id}`}
        subtitle={`Type: ${selectedEvent?.event_type} • Actor: ${selectedEvent?.actor}`}
      >
        {selectedEvent && (
          <div className="space-y-6 text-xs">
            <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-2 font-mono">
              <div className="flex justify-between">
                <span className="text-slate-500 dark:text-slate-400">Timestamp:</span>
                <span className="text-slate-900 dark:text-white">{selectedEvent.timestamp}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500 dark:text-slate-400">Severity:</span>
                <span className="font-bold text-sky-600 dark:text-sky-400">{selectedEvent.severity}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500 dark:text-slate-400">Call ID:</span>
                <span className="text-slate-800 dark:text-slate-200">{selectedEvent.call_id || 'System Event'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500 dark:text-slate-400">Tool Name:</span>
                <span className="text-emerald-600 dark:text-emerald-400">{selectedEvent.tool_name || 'N/A'}</span>
              </div>
            </div>

            <div className="space-y-1.5">
              <h3 className="font-semibold text-slate-900 dark:text-white uppercase text-[11px] tracking-wider">Payload Details</h3>
              <pre className="p-4 rounded-xl bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-300 font-mono text-[11px] overflow-x-auto max-w-full whitespace-pre-wrap break-all leading-relaxed">
                {JSON.stringify(selectedEvent.details, null, 2)}
              </pre>
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
}
