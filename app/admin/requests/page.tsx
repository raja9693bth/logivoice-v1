'use client';

import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import {
  ClipboardList,
  Search,
  CheckCircle2,
  AlertCircle,
  RotateCcw,
  UserCheck,
  Loader2,
  RefreshCw,
  AlertTriangle,
} from 'lucide-react';
import { RequestStatusBadge } from '@/components/ui/Badge';
import { MOCK_REQUESTS } from '@/lib/mock/logivoice-data';
import { formatDateTime } from '@/lib/utils';
import { Drawer } from '@/components/ui/Drawer';
import { EmptyState } from '@/components/ui/EmptyState';
import { OperationsRequest, RequestStatus } from '@/types/logivoice';

export default function RequestsPage() {
  const [requests, setRequests] = useState<OperationsRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isDemoMode, setIsDemoMode] = useState(false);
  const [activeTab, setActiveTab] = useState<'ALL' | 'BOOKING_REQUEST' | 'SUPPORT_TICKET' | 'CALLBACK_REQUEST'>('ALL');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [inspectReq, setInspectReq] = useState<OperationsRequest | null>(null);

  const fetchRequests = async () => {
    setIsLoading(true);
    setError(null);

    const demoActive = process.env.NODE_ENV !== 'production' && typeof window !== 'undefined' && localStorage.getItem('logivoice_demo_mode') === 'true';
    setIsDemoMode(demoActive);

    if (demoActive) {
      setRequests(MOCK_REQUESTS);
      setIsLoading(false);
      return;
    }

    try {
      const res = await fetch('/api/requests');
      if (res.status === 401) {
        window.location.href = '/login';
        return;
      }
      if (!res.ok) {
        throw new Error(`Failed to load requests (HTTP ${res.status})`);
      }
      const data = await res.json();
      setRequests(data?.requests || []);
    } catch (err) {
      console.warn('[RequestsPage] API fetch error:', err);
      setError(err instanceof Error ? err.message : 'Error loading operations requests.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchRequests();
  }, []);

  const filteredRequests = useMemo(() => {
    return requests.filter((req) => {
      const matchesTab = activeTab === 'ALL' || req.type === activeTab;
      const matchesStatus = statusFilter === 'ALL' || req.status === statusFilter;
      const q = searchQuery.toLowerCase();
      const matchesSearch =
        !searchQuery ||
        req.reference_no.toLowerCase().includes(q) ||
        req.customer_name.toLowerCase().includes(q) ||
        req.customer_phone.toLowerCase().includes(q) ||
        req.summary.toLowerCase().includes(q);

      return matchesTab && matchesStatus && matchesSearch;
    });
  }, [requests, activeTab, statusFilter, searchQuery]);

  const handleUpdateStatus = async (reqId: string, newStatus: RequestStatus) => {
    // Optimistic UI update
    setRequests((prev) =>
      prev.map((r) => (r.id === reqId ? { ...r, status: newStatus, updated_at: new Date().toISOString() } : r))
    );
    if (inspectReq && inspectReq.id === reqId) {
      setInspectReq({ ...inspectReq, status: newStatus, updated_at: new Date().toISOString() });
    }

    // Persist update to authoritative backend API
    try {
      await fetch('/api/requests', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: reqId, status: newStatus }),
      });
    } catch (err) {
      console.warn('[RequestsPage] Failed to persist request status update:', err);
    }
  };

  const resetFilters = () => {
    setSearchQuery('');
    setStatusFilter('ALL');
    setActiveTab('ALL');
  };

  return (
    <div className="space-y-6 min-w-0 max-w-full">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800/80 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-slate-900 dark:text-white tracking-tight">Operations Requests &amp; Tickets</h1>
            {isDemoMode && (
              <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded-sm bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                Demo Mode
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Real-time booking closures, human escalation requests &amp; support tickets
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={fetchRequests}
            disabled={isLoading}
            className="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-xs font-medium transition-colors border border-slate-300 dark:border-slate-700 cursor-pointer disabled:opacity-50"
            title="Refresh requests"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
          <div className="text-xs text-slate-500 dark:text-slate-400">
            Showing <span className="text-slate-900 dark:text-white font-semibold">{filteredRequests.length}</span> of{' '}
            <span className="text-slate-900 dark:text-white font-semibold">{requests.length}</span> total
          </div>
        </div>
      </div>

      {/* Error Alert */}
      {error && (
        <div className="p-4 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/60 flex items-center justify-between text-xs text-rose-800 dark:text-rose-300">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 text-rose-600 dark:text-rose-400" />
            <span>{error}</span>
          </div>
          <button
            type="button"
            onClick={fetchRequests}
            className="px-2.5 py-1 rounded-md bg-rose-600 hover:bg-rose-500 text-white font-medium text-[11px] transition-colors cursor-pointer"
          >
            Retry
          </button>
        </div>
      )}

      {/* Type Tabs */}
      <div className="flex gap-2 border-b border-slate-200 dark:border-slate-800 pb-2 overflow-x-auto">
        <button
          onClick={() => setActiveTab('ALL')}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
            activeTab === 'ALL'
              ? 'bg-sky-600 text-white'
              : 'bg-slate-100 dark:bg-slate-900 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
          }`}
        >
          All Requests ({requests.length})
        </button>
        <button
          onClick={() => setActiveTab('BOOKING_REQUEST')}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
            activeTab === 'BOOKING_REQUEST'
              ? 'bg-sky-600 text-white'
              : 'bg-slate-100 dark:bg-slate-900 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
          }`}
        >
          Bookings ({requests.filter((r) => r.type === 'BOOKING_REQUEST').length})
        </button>
        <button
          onClick={() => setActiveTab('SUPPORT_TICKET')}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
            activeTab === 'SUPPORT_TICKET'
              ? 'bg-sky-600 text-white'
              : 'bg-slate-100 dark:bg-slate-900 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
          }`}
        >
          Support Tickets ({requests.filter((r) => r.type === 'SUPPORT_TICKET').length})
        </button>
        <button
          onClick={() => setActiveTab('CALLBACK_REQUEST')}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
            activeTab === 'CALLBACK_REQUEST'
              ? 'bg-sky-600 text-white'
              : 'bg-slate-100 dark:bg-slate-900 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
          }`}
        >
          Escalations ({requests.filter((r) => r.type === 'CALLBACK_REQUEST').length})
        </button>
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
              placeholder="Search reference #, customer name, phone, summary..."
              className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg pl-9 pr-4 py-1.5 text-xs text-slate-900 dark:text-slate-200 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-hidden focus:border-sky-500 focus:ring-1 focus:ring-sky-500/20"
            />
          </div>

          {/* Status Filter */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500 dark:text-slate-400 shrink-0">Status:</span>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-800 dark:text-slate-200 focus:outline-hidden focus:border-sky-500"
            >
              <option value="ALL">All Statuses</option>
              <option value="PENDING">Pending</option>
              <option value="CONFIRMED">Confirmed</option>
              <option value="IN_REVIEW">In Review</option>
              <option value="COMPLETED">Completed</option>
              <option value="REJECTED">Rejected</option>
            </select>
          </div>

          {(searchQuery || statusFilter !== 'ALL' || activeTab !== 'ALL') && (
            <button
              onClick={resetFilters}
              className="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
              title="Reset Filters"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Requests Table */}
      {isLoading ? (
        <div className="p-16 text-center text-xs text-slate-400 bg-white dark:bg-slate-900/60 rounded-xl border border-slate-200 dark:border-slate-800">
          <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2 text-sky-500" />
          Loading operations requests from database...
        </div>
      ) : filteredRequests.length === 0 ? (
        <EmptyState
          title={requests.length === 0 ? 'No Operations Requests Recorded' : 'No requests match your filter criteria'}
          description={
            requests.length === 0
              ? 'Customer booking requests, human transfers, and support tickets created by voice calls will appear here.'
              : 'Try clearing your search query or selecting a different status/tab.'
          }
          actionLabel={requests.length > 0 ? 'Reset Filters' : undefined}
          onAction={requests.length > 0 ? resetFilters : undefined}
        />
      ) : (
        <div className="table-container bg-white dark:bg-slate-900/60 shadow-xs">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/80 text-slate-500 dark:text-slate-400 uppercase text-[11px] tracking-wider">
                <th className="py-3 px-4">Reference</th>
                <th className="py-3 px-4">Created</th>
                <th className="py-3 px-4">Customer</th>
                <th className="py-3 px-4">Summary</th>
                <th className="py-3 px-4">Priority</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Assigned</th>
                <th className="py-3 px-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800/60">
              {filteredRequests.map((req) => (
                <tr key={req.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors">
                  <td className="py-3 px-4 font-mono font-semibold text-sky-600 dark:text-sky-400">
                    {req.reference_no}
                    <span className="block text-[10px] text-slate-400 uppercase font-sans font-normal">{req.type.replace('_', ' ')}</span>
                  </td>
                  <td className="py-3 px-4 text-slate-500 font-mono text-[11px]">
                    {formatDateTime(req.created_at)}
                  </td>
                  <td className="py-3 px-4">
                    <div className="font-semibold text-slate-900 dark:text-white">{req.customer_name}</div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono">{req.customer_phone}</div>
                  </td>
                  <td className="py-3 px-4 max-w-sm">
                    <p className="text-slate-700 dark:text-slate-200 line-clamp-2">{req.summary}</p>
                  </td>
                  <td className="py-3 px-4">
                    <span
                      className={`text-[10px] font-bold px-1.5 py-0.5 rounded border uppercase ${
                        req.priority === 'URGENT'
                          ? 'bg-rose-50 dark:bg-rose-950/80 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800'
                          : req.priority === 'HIGH'
                          ? 'bg-amber-50 dark:bg-amber-950/80 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700'
                      }`}
                    >
                      {req.priority}
                    </span>
                  </td>
                  <td className="py-3 px-4">
                    <RequestStatusBadge status={req.status} />
                  </td>
                  <td className="py-3 px-4 text-slate-700 dark:text-slate-300">
                    <div className="flex items-center gap-1.5">
                      <UserCheck className="w-3.5 h-3.5 text-slate-400" />
                      <span>{req.assigned_to || 'Unassigned'}</span>
                    </div>
                  </td>
                  <td className="py-3 px-4 text-right">
                    <button
                      type="button"
                      onClick={() => setInspectReq(req)}
                      className="px-2.5 py-1 rounded-md bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-sky-600 dark:text-sky-400 text-xs font-medium transition-colors border border-slate-300 dark:border-slate-700 cursor-pointer"
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

      {/* Request Inspection Drawer */}
      <Drawer
        isOpen={!!inspectReq}
        onClose={() => setInspectReq(null)}
        title={`Request Investigation — ${inspectReq?.reference_no}`}
        subtitle={`Type: ${inspectReq?.type} • Customer: ${inspectReq?.customer_name}`}
      >
        {inspectReq && (
          <div className="space-y-6 text-xs">
            {/* Status & Priority */}
            <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-slate-500 dark:text-slate-400 font-medium">Current Status</span>
                <RequestStatusBadge status={inspectReq.status} />
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-500 dark:text-slate-400 font-medium">Priority Level</span>
                <span className="font-bold text-amber-600 dark:text-amber-300">{inspectReq.priority}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-500 dark:text-slate-400 font-medium">Assigned Dispatcher</span>
                <span className="text-slate-900 dark:text-white font-medium">{inspectReq.assigned_to || 'Primary Dispatcher'}</span>
              </div>
            </div>

            {/* Requirement Summary */}
            <div className="space-y-1.5">
              <h3 className="font-semibold text-slate-900 dark:text-white uppercase text-[11px] tracking-wider">Requirement Summary</h3>
              <p className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-300 leading-relaxed">
                {inspectReq.summary}
              </p>
            </div>

            {/* Structured Details Payload */}
            {inspectReq.payload && Object.keys(inspectReq.payload).length > 0 && (
              <div className="space-y-1.5 min-w-0 max-w-full">
                <h3 className="font-semibold text-slate-900 dark:text-white uppercase text-[11px] tracking-wider">Operational Payload</h3>
                <div className="p-3.5 rounded-xl bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 font-mono text-[11px] space-y-1.5 min-w-0 max-w-full overflow-hidden">
                  {Object.entries(inspectReq.payload).map(([key, value]) => (
                    <div key={key} className="flex justify-between items-baseline gap-2 min-w-0">
                      <span className="text-slate-500 capitalize shrink-0">{key.replace('_', ' ')}:</span>
                      <span className="text-slate-900 dark:text-slate-200 break-all text-right font-mono">{String(value)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Workflow Status Actions */}
            <div className="space-y-2 pt-2 border-t border-slate-200 dark:border-slate-800">
              <h3 className="font-semibold text-slate-900 dark:text-white uppercase text-[11px] tracking-wider">Update Dispatcher Status</h3>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => handleUpdateStatus(inspectReq.id, 'CONFIRMED')}
                  className="py-2 px-3 rounded-lg bg-emerald-50 dark:bg-emerald-600/20 hover:bg-emerald-100 dark:hover:bg-emerald-600/30 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-500/30 font-medium transition-colors cursor-pointer"
                >
                  Mark Confirmed
                </button>
                <button
                  type="button"
                  onClick={() => handleUpdateStatus(inspectReq.id, 'IN_REVIEW')}
                  className="py-2 px-3 rounded-lg bg-amber-50 dark:bg-amber-600/20 hover:bg-amber-100 dark:hover:bg-amber-600/30 text-amber-700 dark:text-amber-300 border border-amber-300 dark:border-amber-500/30 font-medium transition-colors cursor-pointer"
                >
                  Mark In Review
                </button>
                <button
                  type="button"
                  onClick={() => handleUpdateStatus(inspectReq.id, 'COMPLETED')}
                  className="py-2 px-3 rounded-lg bg-sky-50 dark:bg-sky-600/20 hover:bg-sky-100 dark:hover:bg-sky-600/30 text-sky-700 dark:text-sky-300 border border-sky-300 dark:border-sky-500/30 font-medium transition-colors cursor-pointer"
                >
                  Mark Completed
                </button>
                <button
                  type="button"
                  onClick={() => handleUpdateStatus(inspectReq.id, 'REJECTED')}
                  className="py-2 px-3 rounded-lg bg-rose-50 dark:bg-rose-600/20 hover:bg-rose-100 dark:hover:bg-rose-600/30 text-rose-700 dark:text-rose-300 border border-rose-300 dark:border-rose-500/30 font-medium transition-colors cursor-pointer"
                >
                  Mark Rejected
                </button>
              </div>
            </div>

            {/* Link to Source Call */}
            {inspectReq.call_id && (
              <div className="pt-2">
                <Link
                  href={`/admin/calls/${inspectReq.call_id}`}
                  className="w-full py-2.5 px-4 rounded-lg bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-sky-600 dark:text-sky-400 border border-slate-200 dark:border-slate-800 font-semibold text-center block transition-colors shadow-xs"
                >
                  Inspect Source Call Voice Transcript &rarr;
                </Link>
              </div>
            )}
          </div>
        )}
      </Drawer>
    </div>
  );
}
