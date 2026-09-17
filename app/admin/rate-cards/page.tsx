'use client';

import React, { useState, useMemo } from 'react';
import {
  BadgePercent,
  Search,
  Plus,
  Upload,
  CheckCircle2,
  AlertCircle,
  FileSpreadsheet,
  Edit2,
  X,
} from 'lucide-react';
import { formatCurrencyINR } from '@/lib/utils';
import { Drawer } from '@/components/ui/Drawer';
import { EmptyState } from '@/components/ui/EmptyState';
import { RateCard } from '@/types/logivoice';

export default function RateCardsPage() {
  const [rateCards, setRateCards] = useState<RateCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [isEditDrawerOpen, setIsEditDrawerOpen] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [editingCard, setEditingCard] = useState<RateCard | null>(null);

  const fetchRateCards = React.useCallback(() => {
    setLoading(true);
    setError(null);
    fetch('/api/rates')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        if (data?.rate_cards && Array.isArray(data.rate_cards)) {
          setRateCards(data.rate_cards);
        } else {
          setRateCards([]);
        }
      })
      .catch((err) => {
        console.error('[RateCardsPage] API fetch error:', err);
        setError('Failed to fetch rate cards from server.');
      })
      .finally(() => setLoading(false));
  }, []);

  React.useEffect(() => {
    fetchRateCards();
  }, [fetchRateCards]);

  // Form State
  const [formOrigin, setFormOrigin] = useState('');
  const [formDest, setFormDest] = useState('');
  const [formVehicle, setFormVehicle] = useState('');
  const [formMinWeight, setFormMinWeight] = useState<number>(1);
  const [formMaxWeight, setFormMaxWeight] = useState<number>(5);
  const [formPrice, setFormPrice] = useState<number>(15000);
  const [formMinCharge, setFormMinCharge] = useState<number>(12000);
  const [formEffectiveFrom, setFormEffectiveFrom] = useState('2026-09-01');
  const [formStatus, setFormStatus] = useState<'ACTIVE' | 'DRAFT' | 'EXPIRED'>('ACTIVE');
  const [formTransitHours, setFormTransitHours] = useState<number>(24);
  const [formNotes, setFormNotes] = useState('');

  const filteredRateCards = useMemo(() => {
    return rateCards.filter((rc) => {
      const q = searchQuery.toLowerCase();
      const matchesSearch =
        !searchQuery ||
        rc.origin.toLowerCase().includes(q) ||
        rc.destination.toLowerCase().includes(q) ||
        rc.vehicle_type.toLowerCase().includes(q);

      const matchesStatus = statusFilter === 'ALL' || rc.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [rateCards, searchQuery, statusFilter]);

  const openNewRateCardModal = () => {
    setEditingCard(null);
    setFormOrigin('');
    setFormDest('');
    setFormVehicle('Eicher 14ft Open');
    setFormMinWeight(1);
    setFormMaxWeight(3.5);
    setFormPrice(18000);
    setFormMinCharge(15000);
    setFormEffectiveFrom('2026-09-01');
    setFormStatus('ACTIVE');
    setFormTransitHours(24);
    setFormNotes('Tolls included; standard detention rules apply.');
    setIsEditDrawerOpen(true);
  };

  const openEditModal = (rc: RateCard) => {
    setEditingCard(rc);
    setFormOrigin(rc.origin);
    setFormDest(rc.destination);
    setFormVehicle(rc.vehicle_type);
    setFormMinWeight(rc.weight_min_tons);
    setFormMaxWeight(rc.weight_max_tons);
    setFormPrice(rc.price_inr);
    setFormMinCharge(rc.minimum_charge_inr);
    setFormEffectiveFrom(rc.effective_from);
    setFormStatus(rc.status);
    setFormTransitHours(rc.transit_time_hours || 24);
    setFormNotes(rc.surcharge_notes || '');
    setIsEditDrawerOpen(true);
  };

  const handleSaveRateCard = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (editingCard) {
        // Update via API
        const res = await fetch('/api/rates', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: editingCard.id,
            origin: formOrigin,
            destination: formDest,
            vehicle_type: formVehicle,
            weight_min_tons: formMinWeight,
            weight_max_tons: formMaxWeight,
            price_inr: formPrice,
            minimum_charge_inr: formMinCharge,
            effective_from: formEffectiveFrom,
            status: formStatus,
            transit_time_hours: formTransitHours,
            surcharge_notes: formNotes,
          }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      } else {
        // Create via API
        const res = await fetch('/api/rates', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            origin: formOrigin,
            destination: formDest,
            vehicle_type: formVehicle,
            weight_min_tons: formMinWeight,
            weight_max_tons: formMaxWeight,
            price_inr: formPrice,
            minimum_charge_inr: formMinCharge,
            effective_from: formEffectiveFrom,
            status: formStatus,
            transit_time_hours: formTransitHours,
            surcharge_notes: formNotes,
            source_version: 'v1.2-portal-created',
          }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      }
      setIsEditDrawerOpen(false);
      fetchRateCards();
    } catch (err) {
      console.error('[RateCardsPage] Save rate card failed:', err);
      setError('Failed to save rate card to database.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 min-w-0 max-w-full">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800/80 pb-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white tracking-tight">Approved Rate Cards &amp; Pricing</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Deterministic commercial price matrix queried by LogiVoice during inbound rate queries
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsImportModalOpen(true)}
            className="px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-900 hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-medium border border-slate-300 dark:border-slate-800 transition-colors inline-flex items-center gap-1.5"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>Import CSV</span>
          </button>
          <button
            onClick={openNewRateCardModal}
            className="px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold transition-colors inline-flex items-center gap-1.5 shadow-xs"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New Rate Card</span>
          </button>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="p-4 rounded-xl bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col md:flex-row items-stretch md:items-center gap-3">
        <div className="flex-1 relative">
          <Search className="w-4 h-4 text-slate-400 dark:text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter by origin city, destination, vehicle type..."
            className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg pl-9 pr-4 py-1.5 text-xs text-slate-900 dark:text-slate-200 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-hidden focus:border-sky-500"
          />
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500 dark:text-slate-400 shrink-0">Status:</span>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-200 focus:outline-hidden focus:border-sky-500"
          >
            <option value="ALL">All Statuses</option>
            <option value="ACTIVE">ACTIVE (Verified Commercial Rate)</option>
            <option value="DRAFT">DRAFT (Under Review)</option>
            <option value="EXPIRED">EXPIRED</option>
          </select>
        </div>
      </div>

      {/* Error Alert */}
      {error && (
        <div className="p-3 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-lg text-amber-800 dark:text-amber-200 text-xs flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => fetchRateCards()} className="underline font-semibold hover:text-amber-900">
            Retry
          </button>
        </div>
      )}

      {/* Rate Matrix Table */}
      {loading ? (
        <div className="p-8 text-center text-xs text-slate-500 bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-xl">
          <div className="inline-block w-6 h-6 border-2 border-sky-500 border-t-transparent rounded-full animate-spin mb-2"></div>
          <p>Loading active rate cards from database...</p>
        </div>
      ) : filteredRateCards.length === 0 ? (
        <EmptyState
          title="No rate cards found"
          description="Try adjusting your search criteria or create a new approved corridor."
          actionLabel="Clear Filters"
          onAction={() => {
            setStatusFilter('ALL');
            setSearchQuery('');
          }}
        />
      ) : (
        <div className="table-container bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 shadow-xs">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-100/80 dark:bg-slate-950/80 text-slate-600 dark:text-slate-400 uppercase text-[11px] tracking-wider">
                <th className="py-3 px-4">Lane / Route</th>
                <th className="py-3 px-4">Vehicle Category</th>
                <th className="py-3 px-4">Weight Band</th>
                <th className="py-3 px-4">Base Rate</th>
                <th className="py-3 px-4">Min Charge</th>
                <th className="py-3 px-4">Transit SLA</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Effective Date</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800/60">
              {filteredRateCards.map((rc) => (
                <tr key={rc.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors">
                  <td className="py-3 px-4">
                    <span className="font-semibold text-slate-900 dark:text-white">{rc.origin}</span>
                    <span className="text-slate-400 dark:text-slate-500"> &rarr; </span>
                    <span className="font-semibold text-slate-900 dark:text-white">{rc.destination}</span>
                    {rc.surcharge_notes && (
                      <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5 truncate max-w-xs">{rc.surcharge_notes}</div>
                    )}
                  </td>
                  <td className="py-3 px-4 text-slate-700 dark:text-slate-300 font-medium">{rc.vehicle_type}</td>
                  <td className="py-3 px-4 text-slate-700 dark:text-slate-300">
                    {rc.weight_min_tons} – {rc.weight_max_tons} Tons
                  </td>
                  <td className="py-3 px-4 font-mono font-bold text-emerald-600 dark:text-emerald-400 text-sm">
                    {formatCurrencyINR(rc.price_inr)}
                  </td>
                  <td className="py-3 px-4 font-mono text-slate-700 dark:text-slate-300 text-xs">
                    {formatCurrencyINR(rc.minimum_charge_inr)}
                  </td>
                  <td className="py-3 px-4 text-slate-700 dark:text-slate-300">
                    {rc.transit_time_hours ? `${rc.transit_time_hours} hrs` : 'Standard'}
                  </td>
                  <td className="py-3 px-4">
                    {rc.status === 'ACTIVE' ? (
                      <span className="px-2 py-0.5 rounded-sm bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 text-[10px] font-bold">
                        ACTIVE (VERIFIED)
                      </span>
                    ) : rc.status === 'DRAFT' ? (
                      <span className="px-2 py-0.5 rounded-sm bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800 text-[10px] font-bold">
                        DRAFT (UNVERIFIED)
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-sm bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700 text-[10px] font-bold">
                        EXPIRED
                      </span>
                    )}
                  </td>
                  <td className="py-3 px-4 font-mono text-slate-500 dark:text-slate-400 text-[11px]">{rc.effective_from}</td>
                  <td className="py-3 px-4 text-right">
                    <button
                      onClick={() => openEditModal(rc)}
                      className="px-2.5 py-1 rounded-md bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-sky-600 dark:text-sky-400 hover:text-sky-700 dark:hover:text-sky-300 text-xs font-medium transition-colors border border-slate-300 dark:border-slate-700 inline-flex items-center gap-1"
                    >
                      <Edit2 className="w-3 h-3" />
                      <span>Edit</span>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Edit / New Rate Card Drawer */}
      <Drawer
        isOpen={isEditDrawerOpen}
        onClose={() => setIsEditDrawerOpen(false)}
        title={editingCard ? `Edit Rate Card — ${editingCard.origin} to ${editingCard.destination}` : 'Create Approved Rate Card'}
        subtitle="Voice agent will quote this exact amount when criteria are met"
      >
        <form onSubmit={handleSaveRateCard} className="space-y-4 text-xs">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-700 dark:text-slate-300 font-medium mb-1">Origin City / Hub</label>
              <input
                type="text"
                required
                value={formOrigin}
                onChange={(e) => setFormOrigin(e.target.value)}
                placeholder="e.g. Delhi (NCR)"
                className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-800 rounded-lg p-2 text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-hidden focus:border-sky-500"
              />
            </div>
            <div>
              <label className="block text-slate-700 dark:text-slate-300 font-medium mb-1">Destination City / Hub</label>
              <input
                type="text"
                required
                value={formDest}
                onChange={(e) => setFormDest(e.target.value)}
                placeholder="e.g. Ahmedabad (Gujarat)"
                className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-800 rounded-lg p-2 text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-hidden focus:border-sky-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-slate-700 dark:text-slate-300 font-medium mb-1">Vehicle Type / Size</label>
            <input
              type="text"
              required
              value={formVehicle}
              onChange={(e) => setFormVehicle(e.target.value)}
              placeholder="e.g. Eicher 14ft Open, 32ft MXL Container"
              className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-800 rounded-lg p-2 text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-hidden focus:border-sky-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-700 dark:text-slate-300 font-medium mb-1">Min Weight (Tons)</label>
              <input
                type="number"
                step="0.5"
                required
                value={formMinWeight}
                onChange={(e) => setFormMinWeight(parseFloat(e.target.value))}
                className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-800 rounded-lg p-2 text-slate-900 dark:text-white focus:outline-hidden focus:border-sky-500"
              />
            </div>
            <div>
              <label className="block text-slate-700 dark:text-slate-300 font-medium mb-1">Max Weight (Tons)</label>
              <input
                type="number"
                step="0.5"
                required
                value={formMaxWeight}
                onChange={(e) => setFormMaxWeight(parseFloat(e.target.value))}
                className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-800 rounded-lg p-2 text-slate-900 dark:text-white focus:outline-hidden focus:border-sky-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-700 dark:text-slate-300 font-medium mb-1">Commercial Price (₹ INR)</label>
              <input
                type="number"
                required
                value={formPrice}
                onChange={(e) => setFormPrice(parseInt(e.target.value, 10))}
                className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-800 rounded-lg p-2 text-slate-900 dark:text-white focus:outline-hidden focus:border-sky-500 font-mono font-bold text-emerald-600 dark:text-emerald-400"
              />
            </div>
            <div>
              <label className="block text-slate-700 dark:text-slate-300 font-medium mb-1">Minimum Charge (₹ INR)</label>
              <input
                type="number"
                required
                value={formMinCharge}
                onChange={(e) => setFormMinCharge(parseInt(e.target.value, 10))}
                className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-800 rounded-lg p-2 text-slate-900 dark:text-white focus:outline-hidden focus:border-sky-500 font-mono"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-slate-700 dark:text-slate-300 font-medium mb-1">Transit SLA (Hours)</label>
              <input
                type="number"
                value={formTransitHours}
                onChange={(e) => setFormTransitHours(parseInt(e.target.value, 10))}
                className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-800 rounded-lg p-2 text-slate-900 dark:text-white focus:outline-hidden focus:border-sky-500"
              />
            </div>
            <div>
              <label className="block text-slate-700 dark:text-slate-300 font-medium mb-1">Effective Date</label>
              <input
                type="date"
                required
                value={formEffectiveFrom}
                onChange={(e) => setFormEffectiveFrom(e.target.value)}
                className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-800 rounded-lg p-2 text-slate-900 dark:text-white focus:outline-hidden focus:border-sky-500"
              />
            </div>
            <div>
              <label className="block text-slate-700 dark:text-slate-300 font-medium mb-1">Status</label>
              <select
                value={formStatus}
                onChange={(e) => setFormStatus(e.target.value as any)}
                className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-800 rounded-lg p-2 text-slate-900 dark:text-white focus:outline-hidden focus:border-sky-500"
              >
                <option value="ACTIVE">ACTIVE (Approved)</option>
                <option value="DRAFT">DRAFT (Unverified)</option>
                <option value="EXPIRED">EXPIRED</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-slate-700 dark:text-slate-300 font-medium mb-1">Surcharges &amp; Detention Conditions</label>
            <textarea
              rows={3}
              value={formNotes}
              onChange={(e) => setFormNotes(e.target.value)}
              placeholder="e.g. Free waiting time 4 hrs. Unloading detention ₹1,500/day. Tolls included."
              className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-800 rounded-lg p-2 text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-hidden focus:border-sky-500"
            />
          </div>

          <div className="pt-4 border-t border-slate-200 dark:border-slate-800 flex justify-end gap-3">
            <button
              type="button"
              onClick={() => setIsEditDrawerOpen(false)}
              className="px-4 py-2 rounded-lg bg-slate-100 dark:bg-slate-900 hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white border border-slate-300 dark:border-slate-800 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-semibold transition-colors shadow-xs"
            >
              Save Rate Card
            </button>
          </div>
        </form>
      </Drawer>

      {/* CSV Import Modal */}
      {isImportModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 dark:bg-black/70 backdrop-blur-xs">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-lg w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                <FileSpreadsheet className="w-4 h-4 text-sky-600 dark:text-sky-400" />
                <span>Import Rate Cards (CSV)</span>
              </h2>
              <button
                onClick={() => setIsImportModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              Upload client-approved rate sheet. Columns required: <br />
              <code className="bg-slate-100 dark:bg-slate-950 p-2 rounded font-mono text-[11px] text-sky-700 dark:text-sky-300 border border-slate-200 dark:border-slate-800 block mt-1 overflow-x-auto max-w-full break-all whitespace-pre-wrap">
                origin, destination, vehicle_type, weight_min, weight_max, price_inr, minimum_charge, transit_hours
              </code>
            </p>

            <div className="border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-xl p-8 text-center bg-slate-50 dark:bg-slate-950/50 hover:border-sky-500/50 transition-colors cursor-pointer">
              <Upload className="w-8 h-8 text-slate-400 dark:text-slate-500 mx-auto mb-2" />
              <p className="text-xs font-medium text-slate-800 dark:text-white">Click or drag &amp; drop .csv file here</p>
              <p className="text-[10px] text-slate-500 mt-1">Maximum 5,000 rows per batch</p>
            </div>

            <div className="flex justify-between items-center pt-2">
              <a
                href="#sample-template"
                onClick={(e) => {
                  e.preventDefault();
                  alert('Sample CSV format: origin,destination,vehicle_type,weight_min_tons,weight_max_tons,price_inr,minimum_charge_inr,transit_time_hours');
                }}
                className="text-xs text-sky-600 dark:text-sky-400 hover:underline"
              >
                Download Sample Template
              </a>
              <button
                onClick={() => {
                  alert('CSV Import Preview: 0 records loaded (Demo Mode).');
                  setIsImportModalOpen(false);
                }}
                className="px-4 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-medium transition-colors shadow-xs"
              >
                Upload &amp; Validate
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
