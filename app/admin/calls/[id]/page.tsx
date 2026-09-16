'use client';

import React, { use } from 'react';
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
} from 'lucide-react';
import {
  TemperatureBadge,
  OutcomeBadge,
  IntentBadge,
} from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { MOCK_CALLS } from '@/lib/mock/logivoice-data';
import { formatCurrencyINR, formatDuration, formatDateTime } from '@/lib/utils';

export default function CallDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  const call = MOCK_CALLS.find((c) => c.id === resolvedParams.id) || MOCK_CALLS[0];

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
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate">
              Retell AI Voice Session &bull; Started {formatDateTime(call.started_at)} &bull; Duration:{' '}
              {formatDuration(call.duration_seconds)}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          <OutcomeBadge outcome={call.outcome} />
          <IntentBadge intent={call.primary_intent} />
        </div>
      </div>

      {/* Grid: Left 2 cols (Facts, Summary, Transcript) | Right 1 col (Customer, Escalation, Tools, Follow-up) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 min-w-0 max-w-full">
        {/* Left Column */}
        <div className="lg:col-span-2 space-y-6 min-w-0 max-w-full">
          {/* Executive Summary Card */}
          <Card className="space-y-3 min-w-0 max-w-full">
            <h2 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider flex items-center gap-2">
              <FileText className="w-4 h-4 text-sky-600 dark:text-sky-400 shrink-0" />
              <span>Operational Call Summary</span>
            </h2>
            <p className="text-sm text-slate-800 dark:text-slate-200 leading-relaxed bg-slate-50 dark:bg-slate-950/60 p-4 rounded-xl border border-slate-200 dark:border-slate-800/80 break-words">
              {call.summary}
            </p>
          </Card>

          {/* Structured Operational Facts Card */}
          <Card className="space-y-4 min-w-0 max-w-full">
            <h2 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider flex items-center gap-2">
              <Truck className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <span>Extracted Operational Facts</span>
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 text-xs min-w-0 max-w-full">
              <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800/80 min-w-0">
                <span className="text-[11px] text-slate-500 dark:text-slate-400 block mb-1">Pickup Origin</span>
                <span className="text-slate-900 dark:text-white font-medium truncate block">{call.facts.route_from || '—'}</span>
              </div>
              <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800/80 min-w-0">
                <span className="text-[11px] text-slate-500 dark:text-slate-400 block mb-1">Drop Destination</span>
                <span className="text-slate-900 dark:text-white font-medium truncate block">{call.facts.route_to || '—'}</span>
              </div>
              <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800/80 min-w-0">
                <span className="text-[11px] text-slate-500 dark:text-slate-400 block mb-1">Weight / Capacity</span>
                <span className="text-slate-900 dark:text-white font-medium truncate block">{call.facts.weight || '—'}</span>
              </div>
              <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800/80 min-w-0">
                <span className="text-[11px] text-slate-500 dark:text-slate-400 block mb-1">Vehicle Type</span>
                <span className="text-slate-900 dark:text-white font-medium truncate block">{call.facts.vehicle_type || '—'}</span>
              </div>
              <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800/80 min-w-0">
                <span className="text-[11px] text-slate-500 dark:text-slate-400 block mb-1">Cargo / Material</span>
                <span className="text-slate-900 dark:text-white font-medium truncate block">{call.facts.material_type || '—'}</span>
              </div>
              <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800/80 min-w-0">
                <span className="text-[11px] text-slate-500 dark:text-slate-400 block mb-1">Pickup Date</span>
                <span className="text-slate-900 dark:text-white font-medium truncate block">{call.facts.pickup_date || '—'}</span>
              </div>
              {call.facts.quoted_amount && (
                <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800/40 min-w-0">
                  <span className="text-[11px] text-emerald-800 dark:text-emerald-400 block mb-1">Commercial Quoted Amount</span>
                  <span className="text-emerald-700 dark:text-emerald-300 font-bold font-mono text-sm truncate block">
                    {formatCurrencyINR(call.facts.quoted_amount)} ({call.facts.quote_type})
                  </span>
                </div>
              )}
              {call.facts.tracking_id && (
                <div className="p-3 rounded-lg bg-sky-50 dark:bg-sky-950/20 border border-sky-200 dark:border-sky-800/40 min-w-0">
                  <span className="text-[11px] text-sky-800 dark:text-sky-400 block mb-1">Consignment LR #</span>
                  <span className="text-sky-700 dark:text-sky-300 font-bold font-mono text-sm truncate block">{call.facts.tracking_id}</span>
                </div>
              )}
              {call.facts.booking_reference && (
                <div className="p-3 rounded-lg bg-violet-50 dark:bg-violet-950/20 border border-violet-200 dark:border-violet-800/40 min-w-0">
                  <span className="text-[11px] text-violet-800 dark:text-violet-400 block mb-1">Booking Reference</span>
                  <span className="text-violet-700 dark:text-violet-300 font-bold font-mono text-sm truncate block">{call.facts.booking_reference}</span>
                </div>
              )}
            </div>

            {call.facts.special_requirements && (
              <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs min-w-0 max-w-full">
                <span className="text-slate-500 dark:text-slate-400 block text-[11px] mb-1 font-medium">Special Requirements:</span>
                <p className="text-slate-800 dark:text-slate-200 break-words">{call.facts.special_requirements}</p>
              </div>
            )}
          </Card>

          {/* Turn-by-turn Transcript Viewer */}
          <Card className="space-y-4 min-w-0 max-w-full">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <h2 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider flex items-center gap-2">
                <Layers className="w-4 h-4 text-purple-600 dark:text-purple-400 shrink-0" />
                <span>Full Verbatim Call Transcript</span>
              </h2>
              <span className="text-[11px] text-slate-500 dark:text-slate-400">Hindi / Hinglish / English Audio Stream</span>
            </div>

            {call.transcript && call.transcript.length > 0 ? (
              <div className="space-y-3 max-h-96 overflow-y-auto pr-1 min-w-0 max-w-full">
                {call.transcript.map((turn, i) => (
                  <div
                    key={i}
                    className={`p-3.5 rounded-xl border text-xs leading-relaxed transition-colors min-w-0 max-w-full ${
                      turn.speaker === 'agent'
                        ? 'bg-sky-50 dark:bg-sky-950/20 border-sky-200 dark:border-sky-900/40 text-sky-950 dark:text-sky-200 ml-4 sm:ml-8'
                        : 'bg-slate-100/70 dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200 mr-4 sm:mr-8'
                    }`}
                  >
                    <div className="flex justify-between items-center text-[10px] text-slate-500 dark:text-slate-400 mb-1.5 pb-1 border-b border-slate-200 dark:border-slate-800/60 gap-2 flex-wrap">
                      <span className="font-bold tracking-wider uppercase text-slate-700 dark:text-slate-300 truncate">
                        {turn.speaker === 'agent' ? '🤖 LogiVoice Assistant' : '👤 Customer / Transporter'}
                      </span>
                      <div className="flex items-center gap-2 font-mono shrink-0">
                        <span className="uppercase text-[9px] px-1 rounded bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-400">
                          {turn.language || 'Hinglish'}
                        </span>
                        <span>{turn.timestamp}</span>
                      </div>
                    </div>
                    <p className="text-xs break-words">{turn.text}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-500 dark:text-slate-400 italic">No audio transcript recorded for this session.</p>
            )}
          </Card>
        </div>

        {/* Right Column: Meta, Tools, Escalation, Followup */}
        <div className="space-y-6 min-w-0 max-w-full">
          {/* Customer Card */}
          <Card className="space-y-3 min-w-0 max-w-full">
            <h2 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider flex items-center gap-2">
              <User className="w-4 h-4 text-sky-600 dark:text-sky-400 shrink-0" />
              <span>Customer Identification</span>
            </h2>
            <div className="space-y-2 text-xs min-w-0 max-w-full">
              <div className="min-w-0">
                <span className="text-slate-500 dark:text-slate-400 block text-[11px]">Customer Name</span>
                <span className="text-slate-900 dark:text-white font-semibold text-sm truncate block">{call.customer?.name}</span>
              </div>
              <div className="min-w-0">
                <span className="text-slate-500 dark:text-slate-400 block text-[11px]">Contact Phone</span>
                <span className="text-slate-800 dark:text-slate-200 font-mono truncate block">{call.customer?.phone}</span>
              </div>
              <div className="min-w-0">
                <span className="text-slate-500 dark:text-slate-400 block text-[11px]">Company / Organization</span>
                <span className="text-slate-800 dark:text-slate-200 truncate block">{call.customer?.company || 'Not Specified'}</span>
              </div>
              <div className="min-w-0">
                <span className="text-slate-500 dark:text-slate-400 block text-[11px]">Customer Category</span>
                <span className="text-slate-700 dark:text-slate-300 font-medium truncate block">{call.customer?.customer_type || 'SHIPPER'}</span>
              </div>
            </div>
          </Card>

          {/* Escalation Card if Applicable */}
          {call.escalation_status?.is_escalated && (
            <Card className="space-y-3 bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800/50 min-w-0 max-w-full">
              <h2 className="text-xs font-semibold text-amber-900 dark:text-amber-300 uppercase tracking-wider flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
                <span>Human Escalation Triggered</span>
              </h2>
              <div className="space-y-2 text-xs text-amber-950 dark:text-slate-300 min-w-0">
                <p className="break-words">
                  <strong className="text-amber-900 dark:text-amber-200">Reason:</strong> {call.escalation_status.reason}
                </p>
                <p className="break-words">
                  <strong className="text-amber-900 dark:text-amber-200">Escalated To:</strong> {call.escalation_status.target_role} (
                  {call.escalation_status.target_phone})
                </p>
                <div className="flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400 font-medium pt-1">
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                  <span>Call Transfer Successfully Connected</span>
                </div>
              </div>
            </Card>
          )}

          {/* Tool Execution Timeline - Robust JSON Container */}
          <Card className="space-y-3 min-w-0 max-w-full">
            <h2 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider flex items-center gap-2">
              <Wrench className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
              <span>Operational Tool Events</span>
            </h2>
            {call.tool_events && call.tool_events.length > 0 ? (
              <div className="space-y-3 min-w-0 max-w-full">
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
