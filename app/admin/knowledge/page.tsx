'use client';

import React, { useState, useMemo } from 'react';
import {
  BookOpen,
  Search,
  Plus,
  CheckCircle2,
  AlertCircle,
  FileText,
  Clock,
  Layers,
  Edit2,
} from 'lucide-react';
import { MOCK_KNOWLEDGE_ITEMS } from '@/lib/mock/logivoice-data';
import { Drawer } from '@/components/ui/Drawer';
import { KnowledgeItem } from '@/types/logivoice';

export default function KnowledgeBasePage() {
  const [items, setItems] = useState<KnowledgeItem[]>(MOCK_KNOWLEDGE_ITEMS);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [editingItem, setEditingItem] = useState<KnowledgeItem | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  React.useEffect(() => {
    fetch('/api/knowledge')
      .then((res) => res.json())
      .then((data) => {
        if (data?.knowledge_items && Array.isArray(data.knowledge_items) && data.knowledge_items.length > 0) {
          setItems(data.knowledge_items);
        }
      })
      .catch((err) => console.warn('[KnowledgePage] API fetch error:', err));
  }, []);

  // Form State
  const [formCategory, setFormCategory] = useState<KnowledgeItem['category']>('OPERATIONAL_FAQ');
  const [formTitle, setFormTitle] = useState('');
  const [formContent, setFormContent] = useState('');
  const [formStatus, setFormStatus] = useState<KnowledgeItem['status']>('APPROVED');

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      const matchesCategory = selectedCategory === 'ALL' || item.category === selectedCategory;
      const q = searchQuery.toLowerCase();
      const matchesSearch =
        !searchQuery ||
        item.title.toLowerCase().includes(q) ||
        item.content.toLowerCase().includes(q) ||
        item.category.toLowerCase().includes(q);

      return matchesCategory && matchesSearch;
    });
  }, [items, selectedCategory, searchQuery]);

  const openNewModal = () => {
    setEditingItem(null);
    setFormCategory('OPERATIONAL_FAQ');
    setFormTitle('');
    setFormContent('');
    setFormStatus('APPROVED');
    setIsDrawerOpen(true);
  };

  const openEditModal = (item: KnowledgeItem) => {
    setEditingItem(item);
    setFormCategory(item.category);
    setFormTitle(item.title);
    setFormContent(item.content);
    setFormStatus(item.status);
    setIsDrawerOpen(true);
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingItem) {
      setItems((prev) =>
        prev.map((i) =>
          i.id === editingItem.id
            ? {
                ...i,
                category: formCategory,
                title: formTitle,
                content: formContent,
                status: formStatus,
                last_updated: new Date().toISOString().split('T')[0],
              }
            : i
        )
      );
    } else {
      const newItem: KnowledgeItem = {
        id: `kb-${Date.now()}`,
        tenant_id: '00000000-0000-0000-0000-000000000001',
        category: formCategory,
        title: formTitle,
        content: formContent,
        status: formStatus,
        last_updated: new Date().toISOString().split('T')[0],
        version: '1.0',
      };
      setItems([newItem, ...items]);
    }
    setIsDrawerOpen(false);
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
          className="px-3.5 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold transition-colors inline-flex items-center gap-1.5 shadow-xs"
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
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search operational policies, FAQs, and service rules..."
            className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg pl-9 pr-4 py-1.5 text-xs text-slate-900 dark:text-slate-200 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-hidden focus:border-sky-500"
          />
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500 dark:text-slate-400 shrink-0">Category:</span>
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
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

      {/* Knowledge Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 min-w-0 max-w-full">
        {filteredItems.map((item) => (
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
                        : 'bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800'
                    }`}
                  >
                    {item.status}
                  </span>
                  <button
                    onClick={() => openEditModal(item)}
                    className="p-1 rounded text-slate-400 hover:text-slate-700 dark:hover:text-white transition-colors"
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

      {/* Add / Edit Drawer */}
      <Drawer
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        title={editingItem ? `Edit Policy — ${editingItem.title}` : 'Create Operational Policy Item'}
        subtitle="This knowledge will be used to ground voice AI answers for relevant queries"
      >
        <form onSubmit={handleSave} className="space-y-4 text-xs">
          <div>
            <label className="block text-slate-700 dark:text-slate-300 font-medium mb-1">Knowledge Category</label>
            <select
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
            <label className="block text-slate-700 dark:text-slate-300 font-medium mb-1">Title / Policy Topic</label>
            <input
              type="text"
              required
              value={formTitle}
              onChange={(e) => setFormTitle(e.target.value)}
              placeholder="e.g. Detention & Waiting Charges Guidelines"
              className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-800 rounded-lg p-2 text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-hidden focus:border-sky-500"
            />
          </div>

          <div>
            <label className="block text-slate-700 dark:text-slate-300 font-medium mb-1">Content / Policy Rules</label>
            <textarea
              rows={6}
              required
              value={formContent}
              onChange={(e) => setFormContent(e.target.value)}
              placeholder="Clear, operational rules. Speak numbers, charges, and conditions plainly."
              className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-800 rounded-lg p-2 text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-hidden focus:border-sky-500 leading-relaxed font-sans"
            />
          </div>

          <div>
            <label className="block text-slate-700 dark:text-slate-300 font-medium mb-1">Approval Status</label>
            <select
              value={formStatus}
              onChange={(e) => setFormStatus(e.target.value as any)}
              className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-800 rounded-lg p-2 text-slate-900 dark:text-white focus:outline-hidden focus:border-sky-500"
            >
              <option value="APPROVED">APPROVED (Active in Voice RAG)</option>
              <option value="DRAFT">DRAFT (Under Internal Review)</option>
              <option value="UNDER_REVIEW">UNDER_REVIEW</option>
            </select>
          </div>

          <div className="pt-4 border-t border-slate-200 dark:border-slate-800 flex justify-end gap-3">
            <button
              type="button"
              onClick={() => setIsDrawerOpen(false)}
              className="px-4 py-2 rounded-lg bg-slate-100 dark:bg-slate-900 hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white border border-slate-300 dark:border-slate-800 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-semibold transition-colors shadow-xs"
            >
              Save Knowledge Item
            </button>
          </div>
        </form>
      </Drawer>
    </div>
  );
}
