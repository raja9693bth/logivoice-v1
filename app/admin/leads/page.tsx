'use client';

import React, { useState, useMemo } from 'react';
import Link from 'next/link';
import {
  Flame,
  Search,
  Filter,
  CheckCircle2,
  Clock,
  ArrowRight,
  ExternalLink,
  MessageSquare,
  Send,
} from 'lucide-react';
import { TemperatureBadge } from '@/components/ui/Badge';
import { MOCK_LEADS } from '@/lib/mock/logivoice-data';
import { formatDateTime } from '@/lib/utils';
import { Drawer } from '@/components/ui/Drawer';
import { EmptyState } from '@/components/ui/EmptyState';
import { Lead, LeadTemperature } from '@/types/logivoice';

export default function LeadsPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tempFilter, setTempFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [inspectLead, setInspectLead] = useState<Lead | null>(null);

  const fetchLeads = React.useCallback(() => {
    setLoading(true);
    setError(null);
    fetch('/api/leads')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        if (data?.leads && Array.isArray(data.leads)) {
          setLeads(data.leads);
        } else {
          setLeads([]);
        }
      })
      .catch((err) => {
        console.error('[LeadsPage] API fetch error:', err);
        setError('Failed to fetch live commercial leads from server.');
      })
      .finally(() => setLoading(false));
  }, []);

  React.useEffect(() => {
    void fetchLeads();
  }, [fetchLeads]);

  const filteredLeads = useMemo(() => {
    return leads.filter((lead) => {
      const matchesTemp = tempFilter === 'ALL' || lead.temperature === tempFilter;
      const matchesStatus = statusFilter === 'ALL' || lead.status === statusFilter;
      const q = searchQuery.toLowerCase();
      const matchesSearch =
        !searchQuery ||
        lead.customer_name.toLowerCase().includes(q) ||
        lead.phone.toLowerCase().includes(q) ||
        lead.company?.toLowerCase().includes(q) ||
        lead.route?.toLowerCase().includes(q) ||
        lead.requirement.toLowerCase().includes(q);

      return matchesTemp && matchesStatus && matchesSearch;
    });
  }, [leads, tempFilter, statusFilter, searchQuery]);

  const handleUpdateStatus = async (leadId: string, newStatus: Lead['status']) => {
    // Optimistic UI update
    setLeads((prev) =>
      prev.map((l) => (l.id === leadId ? { ...l, status: newStatus, updated_at: new Date().toISOString() } : l))
    );
    if (inspectLead && inspectLead.id === leadId) {
      setInspectLead({ ...inspectLead, status: newStatus, updated_at: new Date().toISOString() });
    }

    try {
      const res = await fetch('/api/leads', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: leadId, status: newStatus }),
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
    } catch (err) {
      console.error('[LeadsPage] Failed to update lead status:', err);
      // Revert on failure
      fetchLeads();
    }
  };

  return (
    <div className="space-y-6 min-w-0 max-w-full">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800/80 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-slate-900 dark:text-white tracking-tight">Leads &amp; Post-Call Nurturing</h1>
            <span className="text-xs font-bold px-2 py-0.5 rounded-sm bg-sky-50 dark:bg-sky-950 text-sky-700 dark:text-sky-400 border border-sky-200 dark:border-sky-800/60">
              Service 2
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Commercial pipeline converted from inbound voice calls &bull; Temperature assigned by deterministic business rules
          </p>
        </div>
        <div className="text-xs text-slate-500 dark:text-slate-400">
          Showing <span className="text-slate-900 dark:text-white font-semibold">{filteredLeads.length}</span> commercial leads
        </div>
      </div>

      {/* Filter & Search Bar */}
      <div className="p-4 rounded-xl bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col md:flex-row items-stretch md:items-center gap-3">
        <div className="flex-1 relative">
          <Search className="w-4 h-4 text-slate-400 dark:text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by customer name, phone, company, route or requirement..."
            className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg pl-9 pr-4 py-1.5 text-xs text-slate-900 dark:text-slate-200 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-hidden focus:border-sky-500"
          />
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500 dark:text-slate-400 shrink-0">Temperature:</span>
          <select
            value={tempFilter}
            onChange={(e) => setTempFilter(e.target.value)}
            className="bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-200 focus:outline-hidden focus:border-sky-500"
          >
            <option value="ALL">All Temperatures</option>
            <option value="HOT">HOT (Immediate Intent)</option>
            <option value="WARM">WARM (Pending Decision)</option>
            <option value="COLD">COLD (Informational)</option>
            <option value="REVIEW">REVIEW (Human Judgement)</option>
          </select>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500 dark:text-slate-400 shrink-0">Status:</span>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-200 focus:outline-hidden focus:border-sky-500"
          >
            <option value="ALL">All Stages</option>
            <option value="NEW">New</option>
            <option value="CONTACTED">Contacted</option>
            <option value="QUALIFIED">Qualified</option>
            <option value="CONVERTED">Converted</option>
            <option value="LOST">Lost</option>
          </select>
        </div>
      </div>

      {/* Error Alert */}
      {error && (
        <div className="p-3 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-lg text-amber-800 dark:text-amber-200 text-xs flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => fetchLeads()} className="underline font-semibold hover:text-amber-900">
            Retry
          </button>
        </div>
      )}

      {/* Leads Table */}
      {loading ? (
        <div className="p-8 text-center text-xs text-slate-500 bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-xl">
          <div className="inline-block w-6 h-6 border-2 border-sky-500 border-t-transparent rounded-full animate-spin mb-2"></div>
          <p>Loading commercial pipeline from database...</p>
        </div>
      ) : filteredLeads.length === 0 ? (
        <EmptyState
          title="No commercial leads found"
          description="Try changing the temperature or stage filter."
          actionLabel="Clear Filters"
          onAction={() => {
            setTempFilter('ALL');
            setStatusFilter('ALL');
            setSearchQuery('');
          }}
        />
      ) : (
        <div className="table-container bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 shadow-xs">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-100/80 dark:bg-slate-950/80 text-slate-600 dark:text-slate-400 uppercase text-[11px] tracking-wider">
                <th className="py-3 px-4">Customer</th>
                <th className="py-3 px-4">Requirement &amp; Route</th>
                <th className="py-3 px-4">Temperature</th>
                <th className="py-3 px-4">Stage</th>
                <th className="py-3 px-4">Next Action</th>
                <th className="py-3 px-4">Follow-up</th>
                <th className="py-3 px-4">Assigned To</th>
                <th className="py-3 px-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800/60">
              {filteredLeads.map((lead) => (
                <tr key={lead.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors">
                  <td className="py-3 px-4">
                    <div className="font-semibold text-slate-900 dark:text-white">{lead.customer_name}</div>
                    <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400">{lead.phone}</div>
                    {lead.company && <div className="text-[10px] text-slate-500 dark:text-slate-400">{lead.company}</div>}
                  </td>
                  <td className="py-3 px-4 max-w-sm">
                    {lead.route && (
                      <div className="font-medium text-sky-600 dark:text-sky-400 text-xs mb-0.5">
                        {lead.route} {lead.weight && `(${lead.weight})`}
                      </div>
                    )}
                    <p className="text-slate-700 dark:text-slate-300 line-clamp-2 text-xs">{lead.requirement}</p>
                  </td>
                  <td className="py-3 px-4">
                    <TemperatureBadge temperature={lead.temperature} />
                  </td>
                  <td className="py-3 px-4">
                    <span className="px-2 py-0.5 rounded-sm bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-[11px] font-medium border border-slate-200 dark:border-slate-700">
                      {lead.status}
                    </span>
                  </td>
                  <td className="py-3 px-4 max-w-xs">
                    <p className="text-slate-800 dark:text-slate-200 text-xs font-medium">{lead.next_action}</p>
                    <span className="text-[10px] text-slate-500">Call at {formatDateTime(lead.last_call_at)}</span>
                  </td>
                  <td className="py-3 px-4">
                    {lead.followup_status === 'SENT' || lead.followup_status === 'DELIVERED' ? (
                      <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 text-[11px] font-medium">
                        <CheckCircle2 className="w-3 h-3" />
                        {lead.followup_status}
                      </span>
                    ) : (
                      <span className="text-[11px] text-slate-500">{lead.followup_status}</span>
                    )}
                  </td>
                  <td className="py-3 px-4 text-slate-700 dark:text-slate-300 text-xs">
                    {lead.assigned_to || 'Unassigned'}
                  </td>
                  <td className="py-3 px-4 text-right">
                    <button
                      onClick={() => setInspectLead(lead)}
                      className="px-2.5 py-1 rounded-md bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-sky-600 dark:text-sky-400 text-xs font-medium transition-colors border border-slate-300 dark:border-slate-700"
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

      {/* Lead Inspection Drawer */}
      <Drawer
        isOpen={!!inspectLead}
        onClose={() => setInspectLead(null)}
        title={`Lead Record — ${inspectLead?.customer_name}`}
        subtitle={`Phone: ${inspectLead?.phone} • Company: ${inspectLead?.company || 'N/A'}`}
      >
        {inspectLead && (
          <div className="space-y-6 text-xs">
            <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-slate-500 dark:text-slate-400">Rule-Computed Temperature:</span>
                <TemperatureBadge temperature={inspectLead.temperature} />
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-500 dark:text-slate-400">Current Sales Stage:</span>
                <span className="font-semibold text-slate-900 dark:text-white">{inspectLead.status}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-500 dark:text-slate-400">Inbound Source:</span>
                <span className="font-mono text-sky-600 dark:text-sky-400">{inspectLead.source}</span>
              </div>
            </div>

            <div className="space-y-1.5 min-w-0 max-w-full">
              <h3 className="font-semibold text-slate-900 dark:text-white uppercase text-[11px] tracking-wider">Requirement Summary</h3>
              <p className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-300 leading-relaxed break-words">
                {inspectLead.requirement}
              </p>
            </div>

            <div className="space-y-1.5 min-w-0 max-w-full">
              <h3 className="font-semibold text-slate-900 dark:text-white uppercase text-[11px] tracking-wider">Recommended Next Action</h3>
              <p className="p-3.5 rounded-xl bg-sky-50 dark:bg-sky-950/20 border border-sky-200 dark:border-sky-800/40 text-sky-900 dark:text-sky-200 font-medium leading-relaxed break-words">
                {inspectLead.next_action}
              </p>
            </div>

            {/* Stage Actions */}
            <div className="space-y-2 pt-2 border-t border-slate-200 dark:border-slate-800">
              <h3 className="font-semibold text-slate-900 dark:text-white uppercase text-[11px] tracking-wider">Update Pipeline Stage</h3>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => handleUpdateStatus(inspectLead.id, 'QUALIFIED')}
                  className="py-2 px-3 rounded-lg bg-emerald-50 dark:bg-emerald-600/20 hover:bg-emerald-100 dark:hover:bg-emerald-600/30 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-500/30 font-medium transition-colors"
                >
                  Mark Qualified
                </button>
                <button
                  onClick={() => handleUpdateStatus(inspectLead.id, 'CONTACTED')}
                  className="py-2 px-3 rounded-lg bg-sky-50 dark:bg-sky-600/20 hover:bg-sky-100 dark:hover:bg-sky-600/30 text-sky-700 dark:text-sky-300 border border-sky-300 dark:border-sky-500/30 font-medium transition-colors"
                >
                  Mark Contacted
                </button>
                <button
                  onClick={() => handleUpdateStatus(inspectLead.id, 'CONVERTED')}
                  className="py-2 px-3 rounded-lg bg-purple-50 dark:bg-purple-600/20 hover:bg-purple-100 dark:hover:bg-purple-600/30 text-purple-700 dark:text-purple-300 border border-purple-300 dark:border-purple-500/30 font-medium transition-colors"
                >
                  Mark Converted
                </button>
                <button
                  onClick={() => handleUpdateStatus(inspectLead.id, 'LOST')}
                  className="py-2 px-3 rounded-lg bg-rose-50 dark:bg-rose-600/20 hover:bg-rose-100 dark:hover:bg-rose-600/30 text-rose-700 dark:text-rose-300 border border-rose-300 dark:border-rose-500/30 font-medium transition-colors"
                >
                  Mark Lost
                </button>
              </div>
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
}
