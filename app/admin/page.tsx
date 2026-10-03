'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  PhoneCall,
  PhoneOff,
  PhoneForwarded,
  ClipboardList,
  Flame,
  Clock,
  ArrowRight,
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  ShieldCheck,
  RefreshCw,
  Loader2,
} from 'lucide-react';
import { BentoCard, Card } from '@/components/ui/Card';
import {
  TemperatureBadge,
  OutcomeBadge,
  IntentBadge,
  RequestStatusBadge,
} from '@/components/ui/Badge';
import { formatCurrencyINR, formatDuration, formatTimeOnly } from '@/lib/utils';
import { Drawer } from '@/components/ui/Drawer';
import { EmptyState } from '@/components/ui/EmptyState';
import { Call, OperationsRequest, Lead, DispatcherKPIs } from '@/types/logivoice';
import { MOCK_KPIS, MOCK_CALLS, MOCK_REQUESTS } from '@/lib/mock/logivoice-data';

export default function DashboardPage() {
  const [calls, setCalls] = useState<Call[]>([]);
  const [requests, setRequests] = useState<OperationsRequest[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [kpis, setKpis] = useState<DispatcherKPIs | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isDemoMode, setIsDemoMode] = useState(false);
  const [selectedCall, setSelectedCall] = useState<Call | null>(null);

  const fetchDashboardData = async () => {
    setIsLoading(true);
    setError(null);

    // Check if demo mode was explicitly selected (strictly forbidden in production)
    const demoActive = process.env.NODE_ENV !== 'production' && typeof window !== 'undefined' && localStorage.getItem('logivoice_demo_mode') === 'true';
    setIsDemoMode(demoActive);

    if (demoActive) {
      setCalls(MOCK_CALLS);
      setRequests(MOCK_REQUESTS);
      setKpis(MOCK_KPIS);
      setIsLoading(false);
      return;
    }

    try {
      const [callsRes, requestsRes, leadsRes, kpisRes] = await Promise.all([
        fetch('/api/calls'),
        fetch('/api/requests'),
        fetch('/api/leads'),
        fetch('/api/dashboard/kpis'),
      ]);

      if (callsRes.status === 401 || requestsRes.status === 401) {
        window.location.href = '/login';
        return;
      }

      if (!callsRes.ok || !requestsRes.ok || !leadsRes.ok || !kpisRes.ok) {
        throw new Error('Failed to fetch real-time operational data from backend services.');
      }

      const callsData = await callsRes.json();
      const requestsData = await requestsRes.json();
      const leadsData = await leadsRes.json();
      const kpisData = await kpisRes.json();

      const fetchedCalls: Call[] = callsData.calls || [];
      const fetchedRequests: OperationsRequest[] = requestsData.requests || [];
      const fetchedLeads: Lead[] = leadsData.leads || [];

      setCalls(fetchedCalls);
      setRequests(fetchedRequests);
      setLeads(fetchedLeads);
      setKpis(kpisData.kpis);
    } catch (err) {
      console.warn('[DashboardPage] Real API fetch error:', err);
      setError(err instanceof Error ? err.message : 'Database/API service temporarily unreachable.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void fetchDashboardData();
  }, []);

  const urgentRequests = requests.filter((r) => r.priority === 'URGENT' || r.priority === 'HIGH');

  return (
    <div className="space-y-6 min-w-0 max-w-full">
      {/* Page Title & Status Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800/80 pb-4 min-w-0 max-w-full">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-slate-900 dark:text-white tracking-tight">Operations Dashboard</h1>
            {isDemoMode && (
              <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded-sm bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                Demo Fixture Data
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Real-time inbound call activity, dispatcher alerts &amp; lead nurturing
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={fetchDashboardData}
            disabled={isLoading}
            className="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-xs font-medium transition-colors border border-slate-300 dark:border-slate-700 cursor-pointer disabled:opacity-50"
            title="Refresh dashboard data"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
          <Link
            href="/admin/calls"
            className="px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-medium transition-colors inline-flex items-center gap-1.5 shadow-xs"
          >
            <PhoneCall className="w-3.5 h-3.5" />
            <span>View All Calls</span>
          </Link>
        </div>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="p-4 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/60 flex items-center justify-between text-xs text-rose-800 dark:text-rose-300">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 text-rose-600 dark:text-rose-400" />
            <span>{error}</span>
          </div>
          <button
            type="button"
            onClick={fetchDashboardData}
            className="px-2.5 py-1 rounded-md bg-rose-600 hover:bg-rose-500 text-white font-medium text-[11px] transition-colors cursor-pointer"
          >
            Retry
          </button>
        </div>
      )}

      {/* KPI Bento Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 min-w-0 max-w-full">
        <BentoCard
          title="Calls Today"
          value={isLoading ? '...' : kpis?.calls_today ?? 0}
          trend={kpis?.calls_trend}
          icon={PhoneCall}
        />
        <BentoCard
          title="Missed Calls"
          value={isLoading ? '...' : kpis?.missed_calls ?? 0}
          subtitle={(kpis?.missed_calls ?? 0) > 0 ? 'Requires attention' : 'No missed calls'}
          badgeText={(kpis?.missed_calls ?? 0) > 0 ? `${kpis?.missed_calls} Missed` : 'Zero Missed'}
          badgeVariant={(kpis?.missed_calls ?? 0) > 0 ? 'danger' : 'success'}
          icon={PhoneOff}
        />
        <BentoCard
          title="Escalated Calls"
          value={isLoading ? '...' : kpis?.escalated_calls ?? 0}
          subtitle="Transferred to human"
          badgeText={kpis?.escalated_calls ? `${kpis.escalated_calls} Pending` : undefined}
          badgeVariant="warning"
          icon={PhoneForwarded}
        />
        <BentoCard
          title="Open Requests"
          value={isLoading ? '...' : kpis?.open_requests ?? 0}
          subtitle="Bookings & tickets"
          icon={ClipboardList}
        />
        <BentoCard
          title="Hot Leads"
          value={isLoading ? '...' : kpis?.hot_leads ?? 0}
          subtitle="Immediate requirement"
          badgeText="High Intent"
          badgeVariant="danger"
          icon={Flame}
        />
        <BentoCard
          title="Warm Leads"
          value={isLoading ? '...' : kpis?.warm_leads ?? 0}
          subtitle="Nurturing active"
          badgeText="Follow-up"
          badgeVariant="warning"
          icon={Clock}
        />
      </div>

      {/* Urgent Attention Feed */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 min-w-0 max-w-full">
        <div className="lg:col-span-2 space-y-3 min-w-0 max-w-full">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-500 dark:text-amber-400" />
              <span>Urgent Operational Attention</span>
            </h2>
            <Link
              href="/admin/requests"
              className="text-xs text-sky-600 dark:text-sky-400 hover:text-sky-700 dark:hover:text-sky-300 font-medium inline-flex items-center gap-1"
            >
              All Requests <ArrowRight className="w-3 h-3" />
            </Link>
          </div>

          <div className="space-y-2 min-w-0 max-w-full">
            {isLoading ? (
              <div className="p-8 rounded-xl bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 text-center text-xs text-slate-400">
                <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2 text-sky-500" />
                Loading operational requests...
              </div>
            ) : urgentRequests.length === 0 ? (
              <div className="p-6 rounded-xl bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 text-center text-xs text-slate-500 dark:text-slate-400">
                <CheckCircle2 className="w-5 h-5 text-emerald-500 mx-auto mb-2" />
                No urgent roadside escalations or critical tickets pending.
              </div>
            ) : (
              urgentRequests.map((req) => (
                <div
                  key={req.id}
                  className="p-4 rounded-xl bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:border-slate-300 dark:hover:border-slate-700 transition-colors shadow-xs min-w-0 max-w-full"
                >
                  <div className="space-y-1 min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-mono font-bold text-sky-600 dark:text-sky-400">{req.reference_no}</span>
                      <RequestStatusBadge status={req.status} />
                      {req.priority === 'URGENT' && (
                        <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded-sm bg-rose-50 dark:bg-rose-950/80 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800">
                          Urgent Roadside
                        </span>
                      )}
                    </div>
                    <p className="text-xs font-medium text-slate-900 dark:text-white break-words">{req.summary}</p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 break-words">
                      Customer: {req.customer_name} ({req.customer_phone}) &bull; Assigned:{' '}
                      <span className="text-slate-700 dark:text-slate-300">{req.assigned_to || 'Unassigned'}</span>
                    </p>
                  </div>
                  <div className="shrink-0 flex items-center gap-2">
                    {req.call_id && (
                      <Link
                        href={`/admin/calls/${req.call_id}`}
                        className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-medium transition-colors inline-flex items-center gap-1 border border-slate-200 dark:border-slate-700"
                      >
                        <span>View Call Context</span>
                        <ExternalLink className="w-3 h-3" />
                      </Link>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Operational Reliability & Voice Health */}
        <div className="space-y-3 min-w-0 max-w-full">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            <span>Voice Operational SLA</span>
          </h2>
          <Card className="space-y-4 min-w-0 max-w-full">
            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-slate-500 dark:text-slate-400">Call Success / Completion</span>
                <span className="text-slate-900 dark:text-white font-mono font-semibold">
                  {kpis?.tool_success_rate_percent !== null && kpis?.tool_success_rate_percent !== undefined
                    ? `${kpis.tool_success_rate_percent}%`
                    : 'No telemetry'}
                </span>
              </div>
              <div className="w-full bg-slate-100 dark:bg-slate-800 h-1.5 rounded-full overflow-hidden">
                <div
                  className="bg-emerald-500 h-full rounded-full transition-all"
                  style={{ width: `${Math.min(100, kpis?.tool_success_rate_percent ?? 0)}%` }}
                />
              </div>
              <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-1">Authoritative outcome resolution</p>
            </div>

            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-slate-500 dark:text-slate-400">Avg Tool Response Latency</span>
                <span className="text-slate-900 dark:text-white font-mono font-semibold">
                  {kpis?.avg_response_latency_ms !== null && kpis?.avg_response_latency_ms !== undefined
                    ? `${kpis.avg_response_latency_ms}ms`
                    : 'Not measured'}
                </span>
              </div>
              <div className="w-full bg-slate-100 dark:bg-slate-800 h-1.5 rounded-full overflow-hidden">
                <div
                  className="bg-sky-500 h-full rounded-full transition-all"
                  style={{ width: `${Math.min(100, Math.max(10, Math.round(((kpis?.avg_response_latency_ms ?? 0) / 1500) * 100)))}%` }}
                />
              </div>
              <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-1">Gateway tool execution roundtrip (target &lt; 1200ms)</p>
            </div>

            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-slate-500 dark:text-slate-400">Barge-in / Interruption</span>
                <span className="text-slate-900 dark:text-white font-mono font-semibold">Enabled</span>
              </div>
              <div className="w-full bg-slate-100 dark:bg-slate-800 h-1.5 rounded-full overflow-hidden">
                <div className="bg-purple-500 h-full rounded-full" style={{ width: '100%' }} />
              </div>
              <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-1">Voice streaming hardware interrupt detection</p>
            </div>

            <div className="pt-2 border-t border-slate-200 dark:border-slate-800 text-[11px] text-slate-500 dark:text-slate-400 flex items-center justify-between">
              <span>Agent Deployment:</span>
              <span className="font-mono text-sky-600 dark:text-sky-400 font-medium">Retell AI v1.2-hi</span>
            </div>
          </Card>
        </div>
      </div>

      {/* Recent Call Activity Feed Table */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Recent Inbound Calls</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">Latest completed voice sessions with extracted structured outcomes</p>
          </div>
          <Link
            href="/admin/calls"
            className="text-xs text-sky-600 dark:text-sky-400 hover:text-sky-700 dark:hover:text-sky-300 font-medium inline-flex items-center gap-1"
          >
            All Calls <ArrowRight className="w-3 h-3" />
          </Link>
        </div>

        <div className="table-container bg-white dark:bg-slate-900/60 shadow-xs">
          {isLoading ? (
            <div className="p-12 text-center text-xs text-slate-400">
              <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2 text-sky-500" />
              Loading live calls from operations database...
            </div>
          ) : calls.length === 0 ? (
            <EmptyState
              title="No Inbound Calls Yet"
              description="No calls have been recorded for this tenant yet. Incoming calls to the telephony gateway will appear here in real-time."
              icon={PhoneCall}
            />
          ) : (
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/80 text-slate-500 dark:text-slate-400 uppercase text-[11px] tracking-wider">
                  <th className="py-3 px-4">Time</th>
                  <th className="py-3 px-4">Customer</th>
                  <th className="py-3 px-4">Intent</th>
                  <th className="py-3 px-4">Facts / Route</th>
                  <th className="py-3 px-4">Outcome</th>
                  <th className="py-3 px-4">Lead Temp</th>
                  <th className="py-3 px-4">Follow-up</th>
                  <th className="py-3 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800/60">
                {calls.slice(0, 10).map((call) => (
                  <tr key={call.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors">
                    <td className="py-3 px-4 font-mono text-slate-600 dark:text-slate-400">
                      {formatTimeOnly(call.started_at)}
                      <span className="block text-[10px] text-slate-400 dark:text-slate-500">{formatDuration(call.duration_seconds)}</span>
                    </td>
                    <td className="py-3 px-4">
                      <div className="font-medium text-slate-900 dark:text-white">{call.customer?.name || 'Inbound Caller'}</div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">{call.customer?.phone}</div>
                    </td>
                    <td className="py-3 px-4">
                      <IntentBadge intent={call.primary_intent} />
                    </td>
                    <td className="py-3 px-4 max-w-xs">
                      {call.facts.route_from ? (
                        <div>
                          <span className="text-slate-700 dark:text-slate-300">{call.facts.route_from}</span> &rarr;{' '}
                          <span className="text-slate-700 dark:text-slate-300">{call.facts.route_to}</span>
                          {call.facts.quoted_amount && (
                            <div className="text-emerald-600 dark:text-emerald-400 font-semibold font-mono text-[11px]">
                              Quoted: {formatCurrencyINR(call.facts.quoted_amount)}
                            </div>
                          )}
                        </div>
                      ) : call.facts.tracking_id ? (
                        <span className="font-mono text-sky-600 dark:text-sky-400 font-medium">LR #{call.facts.tracking_id}</span>
                      ) : (
                        <span className="text-slate-400 dark:text-slate-500">General Information</span>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      <OutcomeBadge outcome={call.outcome} />
                    </td>
                    <td className="py-3 px-4">
                      <TemperatureBadge temperature={call.lead_temperature} />
                    </td>
                    <td className="py-3 px-4">
                      {call.followup_state?.eligible ? (
                        <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">
                          <CheckCircle2 className="w-3 h-3" />
                          {call.followup_state.channel} ({call.followup_state.status})
                        </span>
                      ) : (
                        <span className="text-[11px] text-slate-400 dark:text-slate-500">Suppressed</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <button
                        type="button"
                        onClick={() => setSelectedCall(call)}
                        className="px-2.5 py-1 rounded-md bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-sky-700 dark:text-sky-400 hover:text-sky-800 dark:hover:text-sky-300 text-xs font-medium transition-colors border border-slate-200 dark:border-slate-700 cursor-pointer"
                      >
                        Inspect
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Call Detail Slide-over Drawer */}
      <Drawer
        isOpen={!!selectedCall}
        onClose={() => setSelectedCall(null)}
        title={`Call Investigation — ${selectedCall?.id}`}
        subtitle={`External Ref: ${selectedCall?.external_call_id} • Duration: ${formatDuration(selectedCall?.duration_seconds)}`}
      >
        {selectedCall && (
          <div className="space-y-6 text-xs">
            {/* Customer & Call Meta */}
            <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-2">
              <div className="flex justify-between items-center">
                <span className="font-semibold text-slate-900 dark:text-white text-sm">{selectedCall.customer?.name}</span>
                <TemperatureBadge temperature={selectedCall.lead_temperature} />
              </div>
              <p className="text-slate-600 dark:text-slate-400">
                Company: <span className="text-slate-900 dark:text-slate-200">{selectedCall.customer?.company || 'Individual'}</span>
              </p>
              <p className="text-slate-600 dark:text-slate-400">
                Phone: <span className="text-slate-900 dark:text-slate-200 font-mono">{selectedCall.customer?.phone}</span>
              </p>
              <div className="pt-2 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between text-slate-600 dark:text-slate-400">
                <span>Primary Intent:</span>
                <IntentBadge intent={selectedCall.primary_intent} />
              </div>
              <div className="flex items-center justify-between text-slate-600 dark:text-slate-400">
                <span>Call Outcome:</span>
                <OutcomeBadge outcome={selectedCall.outcome} />
              </div>
            </div>

            {/* AI Summary */}
            <div className="space-y-1.5">
              <h3 className="font-semibold text-slate-900 dark:text-white uppercase text-[11px] tracking-wider">AI Executive Summary</h3>
              <p className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-300 leading-relaxed">
                {selectedCall.summary}
              </p>
            </div>

            {/* Structured Facts */}
            <div className="space-y-1.5">
              <h3 className="font-semibold text-slate-900 dark:text-white uppercase text-[11px] tracking-wider">Structured Operational Facts</h3>
              <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 grid grid-cols-2 gap-3">
                <div>
                  <span className="text-slate-500 dark:text-slate-400 block text-[11px]">Origin</span>
                  <span className="text-slate-800 dark:text-slate-200 font-medium">{selectedCall.facts.route_from || '—'}</span>
                </div>
                <div>
                  <span className="text-slate-500 dark:text-slate-400 block text-[11px]">Destination</span>
                  <span className="text-slate-800 dark:text-slate-200 font-medium">{selectedCall.facts.route_to || '—'}</span>
                </div>
                <div>
                  <span className="text-slate-500 dark:text-slate-400 block text-[11px]">Vehicle Type</span>
                  <span className="text-slate-800 dark:text-slate-200 font-medium">{selectedCall.facts.vehicle_type || '—'}</span>
                </div>
                <div>
                  <span className="text-slate-500 dark:text-slate-400 block text-[11px]">Weight Band</span>
                  <span className="text-slate-800 dark:text-slate-200 font-medium">{selectedCall.facts.weight || '—'}</span>
                </div>
                {selectedCall.facts.quoted_amount && (
                  <div>
                    <span className="text-slate-500 dark:text-slate-400 block text-[11px]">Quoted Rate</span>
                    <span className="text-emerald-600 dark:text-emerald-400 font-bold font-mono text-sm">
                      {formatCurrencyINR(selectedCall.facts.quoted_amount)} ({selectedCall.facts.quote_type})
                    </span>
                  </div>
                )}
                {selectedCall.facts.tracking_id && (
                  <div>
                    <span className="text-slate-500 dark:text-slate-400 block text-[11px]">Tracking LR #</span>
                    <span className="text-sky-600 dark:text-sky-400 font-mono font-bold">{selectedCall.facts.tracking_id}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Follow-up State */}
            <div className="space-y-1.5">
              <h3 className="font-semibold text-slate-900 dark:text-white uppercase text-[11px] tracking-wider">Post-Call Lead Nurturing</h3>
              <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-slate-500 dark:text-slate-400">Follow-up Eligibility:</span>
                  <span className={selectedCall.followup_state?.eligible ? 'text-emerald-600 dark:text-emerald-400 font-semibold' : 'text-slate-500 dark:text-slate-400'}>
                    {selectedCall.followup_state?.eligible ? 'ELIGIBLE' : 'SUPPRESSED'}
                  </span>
                </div>
                {selectedCall.followup_state?.message_snippet && (
                  <div>
                    <span className="text-slate-500 dark:text-slate-400 block text-[11px] mb-1">Dispatched Message Snippet:</span>
                    <p className="p-2.5 rounded-lg bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-300 font-mono text-[11px]">
                      {selectedCall.followup_state.message_snippet}
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Tool Executions */}
            {selectedCall.tool_events && selectedCall.tool_events.length > 0 && (
              <div className="space-y-1.5">
                <h3 className="font-semibold text-slate-900 dark:text-white uppercase text-[11px] tracking-wider">Tool Execution Audit</h3>
                <div className="space-y-2">
                  {selectedCall.tool_events.map((te) => (
                    <div key={te.id} className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 font-mono text-[11px]">
                      <div className="flex justify-between items-center text-sky-700 dark:text-sky-400 font-bold mb-1">
                        <span>{te.tool_name}()</span>
                        <span className="text-slate-400 dark:text-slate-500 text-[10px]">{te.latency_ms} ms</span>
                      </div>
                      <div className="text-slate-600 dark:text-slate-400">Input: {JSON.stringify(te.input_params)}</div>
                      <div className="text-emerald-600 dark:text-emerald-400">Output: {JSON.stringify(te.output_result)}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Full Call View Link */}
            <div className="pt-2">
              <Link
                href={`/admin/calls/${selectedCall.id}`}
                className="w-full py-2.5 px-4 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-semibold text-center block transition-colors shadow-xs"
              >
                Open Full Call Investigation Page
              </Link>
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
}
