'use client';

import React, { useState } from 'react';
import {
  Search,
  Plus,
  Layers,
  Edit2,
  CheckCircle2,
  Clock,
  Archive,
  ArrowRight,
  Send,
} from 'lucide-react';
import { Drawer } from '@/components/ui/Drawer';
import { EmptyState } from '@/components/ui/EmptyState';
import { KnowledgeItem } from '@/types/logivoice';

const PAGE_SIZE = 10;

export default function KnowledgeBasePage() {
  const [items, setItems] = useState<KnowledgeItem[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [editingItem, setEditingItem] = useState<KnowledgeItem | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  // Form State
  const [formCategory, setFormCategory] = useState<KnowledgeItem['category']>('OPERATIONAL_FAQ');
  const [formTitle, setFormTitle] = useState('');
  const [formContent, setFormContent] = useState('');

  const fetchKnowledge = React.useCallback((currentOffset: number, cat: string, search: string) => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    if (cat !== 'ALL') params.set('category', cat);
    if (search.trim()) params.set('search', search.trim());
    params.set('limit', String(PAGE_SIZE));
    params.set('offset', String(currentOffset));

    fetch(`/api/knowledge?${params.toString()}`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        if (data?.knowledge_items && Array.isArray(data.knowledge_items)) {
          setItems(data.knowledge_items);
          setTotalCount(typeof data.total === 'number' ? data.total : data.knowledge_items.length);
        } else {
          setItems([]);
          setTotalCount(0);
        }
      })
      .catch((err) => {
        console.error('[KnowledgePage] API fetch error:', err);
        setError('Failed to fetch knowledge items from server.');
      })
      .finally(() => setLoading(false));
  }, []);

  React.useEffect(() => {
    fetchKnowledge(offset, selectedCategory, searchQuery);
  }, [fetchKnowledge, offset, selectedCategory, searchQuery]);

  const handleSearchChange = (val: string) => {
    setSearchQuery(val);
    setOffset(0);
  };

  const handleCategoryChange = (val: string) => {
    setSelectedCategory(val);
    setOffset(0);
  };

  const openNewModal = () => {
    setEditingItem(null);
    setFormCategory('OPERATIONAL_FAQ');
    setFormTitle('');
    setFormContent('');
    setIsDrawerOpen(true);
  };

  const openEditModal = (item: KnowledgeItem) => {
    setEditingItem(item);
    setFormCategory(item.category);
    setFormTitle(item.title);
    setFormContent(item.content);
    setIsDrawerOpen(true);
  };

  const handleSave = async (e: React.FormEvent, targetStatus?: KnowledgeItem['status']) => {
    if (e) e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      if (editingItem) {
        const payload: Record<string, unknown> = {
          id: editingItem.id,
          category: formCategory,
          title: formTitle,
          content: formContent,
        };
        if (targetStatus) {
          payload.status = targetStatus;
        }
        const res = await fetch('/api/knowledge', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const errData = await res.json().catch(() => null);
          throw new Error(errData?.error || `HTTP ${res.status}`);
        }
      } else {
        const res = await fetch('/api/knowledge', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            category: formCategory,
            title: formTitle,
            content: formContent,
            status: 'DRAFT', // Always DRAFT on initial creation
            version: '1.0',
          }),
        });
        if (!res.ok) {
          const errData = await res.json().catch(() => null);
          throw new Error(errData?.error || `HTTP ${res.status}`);
        }
      }
      setIsDrawerOpen(false);
      fetchKnowledge(offset, selectedCategory, searchQuery);
    } catch (err: any) {
      console.error('[KnowledgePage] Save error:', err);
      setError(err?.message || 'Failed to persist knowledge item.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 min-w-0 max-w-full">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800/80 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-slate-900 dark:text-white tracking-tight">Approved Operational Knowledge</h1>
            <span className="text-xs font-bold px-2 py-0.5 rounded-sm bg-sky-50 dark:bg-sky-950 text-sky-700 dark:text-sky-400 border border-sky-200 dark:border-sky-800/60">
              Layer 02
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Structured business policies, service rules &amp; FAQs dynamically retrieved for voice agent turns
          </p>
        </div>
        <button
          onClick={openNewModal}
          className="px-3.5 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold transition-colors inline-flex items-center gap-1.5 shadow-xs cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>New Policy / FAQ</span>
        </button>
      </div>

      {/* 6-Layer Architecture Notice */}
      <div className="p-4 rounded-xl bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800 text-xs flex items-start gap-3 shadow-xs">
        <Layers className="w-4 h-4 text-sky-600 dark:text-sky-400 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <span className="font-semibold text-slate-900 dark:text-white">SSOT Runtime Mapping Discipline:</span>
          <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
            LogiVoice divides knowledge into 6 discrete layers. Items below represent <strong>Layer 02 (Operational Knowledge)</strong> and are retrieved on-demand per caller intent. The voice model NEVER receives the entire knowledge base as one monolithic prompt.
          </p>
        </div>
      </div>

      {/* Filter & Search Bar */}
      <div className="p-4 rounded-xl bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col md:flex-row items-stretch md:items-center gap-3">
        <div className="flex-1 relative">
          <Search className="w-4 h-4 text-slate-400 dark:text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder="Search operational policies, FAQs, and service rules..."
            className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg pl-9 pr-4 py-1.5 text-xs text-slate-900 dark:text-slate-200 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-hidden focus:border-sky-500"
          />
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500 dark:text-slate-400 shrink-0">Category:</span>
          <select
            value={selectedCategory}
            onChange={(e) => handleCategoryChange(e.target.value)}
            className="bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-200 focus:outline-hidden focus:border-sky-500"
          >
            <option value="ALL">All Categories</option>
            <option value="RATE_POLICY">Rate Policy &amp; Quotation</option>
            <option value="OPERATIONAL_FAQ">Detention &amp; Operating FAQs</option>
            <option value="SERVICE_AREA">Service Coverage Hubs</option>
            <option value="BOOKING_RULES">Advance &amp; Booking Rules</option>
            <option value="ESCALATION_RULES">Escalation Directory</option>
          </select>
        </div>
      </div>

      {/* Error Alert */}
      {error && (
        <div className="p-3 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-lg text-amber-800 dark:text-amber-200 text-xs flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => fetchKnowledge(offset, selectedCategory, searchQuery)} className="underline font-semibold hover:text-amber-900 cursor-pointer">
            Retry
          </button>
        </div>
      )}

      {/* Knowledge Cards Grid */}
      {loading ? (
        <div className="p-8 text-center text-xs text-slate-500 bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-xl">
          <div className="inline-block w-6 h-6 border-2 border-sky-500 border-t-transparent rounded-full animate-spin mb-2"></div>
          <p>Loading operational knowledge items from database...</p>
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          title="No knowledge items found"
          description="Try selecting another category or create a new operational policy."
          actionLabel="Clear Filters"
          onAction={() => {
            setSelectedCategory('ALL');
            setSearchQuery('');
            setOffset(0);
          }}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 min-w-0 max-w-full">
          {items.map((item) => (
            <div
              key={item.id}
              className="p-5 rounded-xl bg-white dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 flex flex-col justify-between hover:border-slate-300 dark:hover:border-slate-700 transition-all group shadow-xs min-w-0 max-w-full"
            >
              <div className="space-y-2 min-w-0">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-sm bg-slate-100 dark:bg-slate-800 text-sky-700 dark:text-sky-400 border border-slate-200 dark:border-slate-700 shrink-0">
                    {item.category.replace('_', ' ')}
                  </span>
                  <div className="flex items-center gap-2 shrink-0">
                    <span
                      className={`text-[10px] font-bold px-1.5 py-0.5 rounded border uppercase ${
                        item.status === 'APPROVED'
                          ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800'
                          : item.status === 'UNDER_REVIEW'
                          ? 'bg-sky-50 dark:bg-sky-950/60 text-sky-700 dark:text-sky-300 border-sky-200 dark:border-sky-800'
                          : item.status === 'ARCHIVED'
                          ? 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-300 dark:border-slate-700'
                          : 'bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800'
                      }`}
                    >
                      {item.status}
                    </span>
                    <button
                      onClick={() => openEditModal(item)}
                      className="p-1 rounded text-slate-400 hover:text-slate-700 dark:hover:text-white transition-colors cursor-pointer"
                      title="Edit Item"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                <h3 className="text-sm font-semibold text-slate-900 dark:text-white group-hover:text-sky-600 dark:group-hover:text-sky-300 transition-colors break-words">
                  {item.title}
                </h3>
                <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed bg-slate-50 dark:bg-slate-950/50 p-3.5 rounded-lg border border-slate-200 dark:border-slate-800/80 break-words">
                  {item.content}
                </p>
              </div>

              <div className="flex items-center justify-between pt-3 mt-3 border-t border-slate-200 dark:border-slate-800 text-[10px] text-slate-500 font-mono">
                <span>Version: v{item.version}</span>
                <span>Updated: {item.last_updated}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pagination Controls */}
      {totalCount > PAGE_SIZE && (
        <div className="flex items-center justify-between px-3 py-3 rounded-xl bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 text-xs">
          <span className="text-slate-500 dark:text-slate-400">
            Showing <span className="font-semibold text-slate-900 dark:text-white">{offset + 1}</span> to{' '}
            <span className="font-semibold text-slate-900 dark:text-white">{Math.min(offset + items.length, totalCount)}</span> of{' '}
            <span className="font-semibold text-slate-900 dark:text-white">{totalCount}</span> policies
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              disabled={offset === 0 || loading}
              className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            >
              Previous
            </button>
            <button
              type="button"
              onClick={() => setOffset(offset + PAGE_SIZE)}
              disabled={offset + items.length >= totalCount || loading}
              className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {/* Add / Edit Drawer */}
      <Drawer
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        title={editingItem ? `Edit Policy — ${editingItem.title}` : 'Create Operational Policy Item'}
        subtitle="This knowledge will be used to ground voice AI answers for relevant queries"
      >
        <form onSubmit={(e) => handleSave(e)} className="space-y-4 text-xs">
          <div>
            <label htmlFor="knowledge-category" className="block text-slate-700 dark:text-slate-300 font-medium mb-1">Knowledge Category</label>
            <select
              id="knowledge-category"
              value={formCategory}
              onChange={(e) => setFormCategory(e.target.value as any)}
              className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-800 rounded-lg p-2 text-slate-900 dark:text-white focus:outline-hidden focus:border-sky-500"
            >
              <option value="RATE_POLICY">Rate Policy &amp; Quotation</option>
              <option value="OPERATIONAL_FAQ">Detention &amp; Operating FAQs</option>
              <option value="SERVICE_AREA">Service Coverage Hubs</option>
              <option value="BOOKING_RULES">Advance &amp; Booking Rules</option>
              <option value="ESCALATION_RULES">Immediate Escalation Protocol</option>
            </select>
          </div>

          <div>
            <label htmlFor="knowledge-title" className="block text-slate-700 dark:text-slate-300 font-medium mb-1">Title / Policy Topic</label>
            <input
              id="knowledge-title"
              type="text"
              required
              value={formTitle}
              onChange={(e) => setFormTitle(e.target.value)}
              placeholder="e.g. Detention & Waiting Charges Guidelines"
              className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-800 rounded-lg p-2 text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-hidden focus:border-sky-500"
            />
          </div>

          <div>
            <label htmlFor="knowledge-content" className="block text-slate-700 dark:text-slate-300 font-medium mb-1">Content / Policy Rules</label>
            <textarea
              id="knowledge-content"
              rows={6}
              required
              value={formContent}
              onChange={(e) => setFormContent(e.target.value)}
              placeholder="Clear, operational rules. Speak numbers, charges, and conditions plainly."
              className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-800 rounded-lg p-2 text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-hidden focus:border-sky-500 leading-relaxed font-sans"
            />
          </div>

          <div>
            <span className="block text-slate-700 dark:text-slate-300 font-medium mb-1">Approval &amp; Governance Status</span>
            {!editingItem ? (
              <div className="p-2.5 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300 flex items-center gap-2">
                <Clock className="w-4 h-4 shrink-0" />
                <span>New policies are strictly created as <strong>DRAFT</strong> and require review before approval.</span>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between p-2.5 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                  <span className="text-slate-600 dark:text-slate-400">Current Status:</span>
                  <span className="font-bold px-2 py-0.5 rounded text-[11px] bg-slate-200 dark:bg-slate-800 text-slate-900 dark:text-white">
                    {editingItem.status}
                  </span>
                </div>

                <div className="space-y-1.5 pt-1">
                  <span className="text-slate-500 text-[11px] font-medium block">Permitted Governance Transitions:</span>
                  <div className="flex flex-wrap gap-2">
                    {editingItem.status === 'DRAFT' && (
                      <button
                        type="button"
                        disabled={saving}
                        onClick={(e) => handleSave(e, 'UNDER_REVIEW')}
                        className="px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-medium flex items-center gap-1.5 disabled:opacity-50 cursor-pointer shadow-xs"
                      >
                        <Send className="w-3.5 h-3.5" />
                        <span>Submit for Review</span>
                      </button>
                    )}

                    {editingItem.status === 'UNDER_REVIEW' && (
                      <>
                        <button
                          type="button"
                          disabled={saving}
                          onClick={(e) => handleSave(e, 'APPROVED')}
                          className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-medium flex items-center gap-1.5 disabled:opacity-50 cursor-pointer shadow-xs"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>Approve Policy</span>
                        </button>
                        <button
                          type="button"
                          disabled={saving}
                          onClick={(e) => handleSave(e, 'DRAFT')}
                          className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-medium flex items-center gap-1.5 disabled:opacity-50 cursor-pointer shadow-xs"
                        >
                          <ArrowRight className="w-3.5 h-3.5" />
                          <span>Return to Draft</span>
                        </button>
                      </>
                    )}

                    {editingItem.status === 'APPROVED' && (
                      <button
                        type="button"
                        disabled={saving}
                        onClick={(e) => handleSave(e, 'ARCHIVED')}
                        className="px-3 py-1.5 rounded-lg bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-700 font-medium flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
                      >
                        <Archive className="w-3.5 h-3.5" />
                        <span>Archive Policy</span>
                      </button>
                    )}

                    {editingItem.status === 'ARCHIVED' && (
                      <button
                        type="button"
                        disabled={saving}
                        onClick={(e) => handleSave(e, 'DRAFT')}
                        className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-medium flex items-center gap-1.5 disabled:opacity-50 cursor-pointer shadow-xs"
                      >
                        <ArrowRight className="w-3.5 h-3.5" />
                        <span>Re-open as Draft</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="pt-4 border-t border-slate-200 dark:border-slate-800 flex justify-end gap-3">
            <button
              type="button"
              disabled={saving}
              onClick={() => setIsDrawerOpen(false)}
              className="px-4 py-2 rounded-lg bg-slate-100 dark:bg-slate-900 hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white border border-slate-300 dark:border-slate-800 transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-semibold transition-colors shadow-xs disabled:opacity-50 cursor-pointer"
            >
              {saving ? 'Saving...' : editingItem ? 'Save Content' : 'Create Draft Policy'}
            </button>
          </div>
        </form>
      </Drawer>
    </div>
  );
}
