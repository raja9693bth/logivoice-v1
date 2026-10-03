'use client';

import React, { useState, useEffect } from 'react';
import {
  Building,
  Mic,
  PhoneForwarded,
  ShieldCheck,
  Save,
  CheckCircle2,
  AlertCircle,
  Lock,
} from 'lucide-react';
import { Card } from '@/components/ui/Card';

type IntegrationStatus = 'VERIFIED' | 'CONFIGURED_NOT_VERIFIED' | 'UNCONFIGURED' | 'DEPLOYMENT_GATED' | 'UNAVAILABLE';

interface IntegrationStatuses {
  supabase: IntegrationStatus;
  retell: IntegrationStatus;
  google_sheets: IntegrationStatus;
  messaging: IntegrationStatus;
  telephony: IntegrationStatus;
  tracking: IntegrationStatus;
}

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<'PROFILE' | 'VOICE' | 'ESCALATION' | 'INTEGRATIONS'>('PROFILE');
  const [isLoading, setIsLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Business Profile State
  const [brandName, setBrandName] = useState('');
  const [legalName, setLegalName] = useState('');
  const [businessType, setBusinessType] = useState('');
  const [operatingRegions, setOperatingRegions] = useState('');
  const [workingHours, setWorkingHours] = useState('');
  const [timezone, setTimezone] = useState('Asia/Kolkata (IST +5:30)');
  const [disclosureWording, setDisclosureWording] = useState('');

  // Voice State
  const [primaryLang, setPrimaryLang] = useState('Hinglish (Hindi + English)');
  const [allowSwitching, setAllowSwitching] = useState(true);
  const [voicePersona, setVoicePersona] = useState('');
  const [bargeInEnabled, setBargeInEnabled] = useState(true);

  // Escalation Directory State (Section 32, Section 47: Neutral non-demo names)
  const [dispatcherName, setDispatcherName] = useState('');
  const [dispatcherPhone, setDispatcherPhone] = useState('');
  const [opsManagerName, setOpsManagerName] = useState('');
  const [opsManagerPhone, setOpsManagerPhone] = useState('');
  const [emergencyName, setEmergencyName] = useState('');
  const [emergencyPhone, setEmergencyPhone] = useState('');

  // Integration Status State (Section 34: Truthful dynamic model)
  const [integrationStatus, setIntegrationStatus] = useState<IntegrationStatuses>({
    supabase: 'UNCONFIGURED',
    retell: 'UNCONFIGURED',
    google_sheets: 'UNCONFIGURED',
    messaging: 'UNCONFIGURED',
    telephony: 'DEPLOYMENT_GATED',
    tracking: 'DEPLOYMENT_GATED',
  });

  const loadSettings = async () => {
    setIsLoading(true);
    setFetchError(null);
    try {
      const res = await fetch('/api/settings');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      if (data?.config) {
        const cfg = data.config;
        if (cfg.brand_name) setBrandName(cfg.brand_name);
        if (cfg.business_name) setLegalName(cfg.business_name);
        if (cfg.business_type) setBusinessType(cfg.business_type);
        if (Array.isArray(cfg.primary_operating_cities)) {
          setOperatingRegions(cfg.primary_operating_cities.join(', '));
        }
        if (cfg.ai_disclosure_wording) setDisclosureWording(cfg.ai_disclosure_wording);
        if (cfg.primary_language) setPrimaryLang(cfg.primary_language);
        if (cfg.timezone) setTimezone(cfg.timezone);
        if (cfg.business_hours) {
          setWorkingHours(`${cfg.business_hours.start} – ${cfg.business_hours.end} (${cfg.business_hours.days})`);
        }
        if (cfg.voice_persona) setVoicePersona(cfg.voice_persona);
        if (typeof cfg.barge_in_enabled === 'boolean') setBargeInEnabled(cfg.barge_in_enabled);
        if (typeof cfg.allow_language_switching === 'boolean') setAllowSwitching(cfg.allow_language_switching);
        if (Array.isArray(cfg.escalation_contacts)) {
          const d = cfg.escalation_contacts.find((c: { role: string }) => c.role === 'DISPATCHER');
          if (d) {
            setDispatcherName(d.name || '');
            setDispatcherPhone(d.phone || '');
          }
          const m = cfg.escalation_contacts.find((c: { role: string }) => c.role === 'OPS_MANAGER');
          if (m) {
            setOpsManagerName(m.name || '');
            setOpsManagerPhone(m.phone || '');
          }
          const e = cfg.escalation_contacts.find((c: { role: string }) => c.role === 'EMERGENCY');
          if (e) {
            setEmergencyName(e.name || '');
            setEmergencyPhone(e.phone || '');
          }
        }
      }

      if (data?.integration_status) {
        setIntegrationStatus(data.integration_status);
      }
    } catch (err) {
      console.warn('[SettingsPage] API fetch error:', err);
      setFetchError(err instanceof Error ? err.message : 'Failed to connect to backend settings API');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadSettings();
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaveError(null);
    setIsSaving(true);
    try {
      const payload = {
        brand_name: brandName,
        business_name: legalName,
        business_type: businessType,
        primary_operating_cities: operatingRegions
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        ai_disclosure_wording: disclosureWording,
        primary_language: primaryLang,
        timezone: timezone.split(' ')[0] || 'Asia/Kolkata',
        business_hours: {
          start: workingHours.split('–')[0]?.trim() || '08:00',
          end: workingHours.split('–')[1]?.split('(')[0]?.trim() || '20:00',
          days: workingHours.includes('(') ? workingHours.split('(')[1]?.replace(')', '').trim() : 'Monday - Saturday',
        },
        voice_persona: voicePersona,
        barge_in_enabled: bargeInEnabled,
        allow_language_switching: allowSwitching,
        escalation_contacts: [
          {
            role: 'DISPATCHER',
            name: dispatcherName,
            phone: dispatcherPhone,
            channel: 'PHONE',
            priority: 1,
          },
          {
            role: 'OPS_MANAGER',
            name: opsManagerName,
            phone: opsManagerPhone,
            channel: 'PHONE',
            priority: 2,
          },
          {
            role: 'EMERGENCY',
            name: emergencyName,
            phone: emergencyPhone,
            channel: 'PHONE',
            priority: 3,
          },
        ],
      };

      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Failed to save configuration (HTTP ${res.status})`);
      }

      // Section 32: After save, re-fetch from server to verify actual persistence
      await loadSettings();

      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      // Section 32: Never show success in catch; show explicit error
      setSaveError(err instanceof Error ? err.message : 'Save operation failed');
      setTimeout(() => setSaveError(null), 5000);
    } finally {
      setIsSaving(false);
    }
  };

  const renderStatusBadge = (status: IntegrationStatus) => {
    switch (status) {
      case 'VERIFIED':
        return (
          <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400 border border-emerald-300 dark:border-emerald-800">
            VERIFIED
          </span>
        );
      case 'CONFIGURED_NOT_VERIFIED':
        return (
          <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-sky-50 dark:bg-sky-950 text-sky-700 dark:text-sky-400 border border-sky-300 dark:border-sky-800">
            CONFIGURED (UNVERIFIED)
          </span>
        );
      case 'DEPLOYMENT_GATED':
        return (
          <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-400 border border-amber-300 dark:border-amber-800">
            DEPLOYMENT-GATED
          </span>
        );
      case 'UNCONFIGURED':
      default:
        return (
          <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700">
            UNCONFIGURED
          </span>
        );
    }
  };

  return (
    <div className="space-y-6 min-w-0 max-w-full">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800/80 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-slate-900 dark:text-white tracking-tight">System &amp; Tenant Settings</h1>
            <span className="text-xs font-bold px-2 py-0.5 rounded-sm bg-sky-50 dark:bg-sky-950 text-sky-700 dark:text-sky-400 border border-sky-200 dark:border-sky-800/60">
              Layer 04
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Client operational configuration, voice persona, escalation directories, and provider status
          </p>
        </div>
        {saveSuccess && (
          <div className="px-3 py-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/80 border border-emerald-300 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 text-xs font-medium flex items-center gap-1.5 animate-in fade-in">
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>Settings Saved</span>
          </div>
        )}
        {saveError && (
          <div className="px-3 py-1.5 rounded-lg bg-rose-50 dark:bg-rose-950/80 border border-rose-300 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-xs font-medium flex items-center gap-1.5 animate-in fade-in">
            <AlertCircle className="w-3.5 h-3.5" />
            <span>{saveError}</span>
          </div>
        )}
      </div>

      {/* Error / Degraded Banner */}
      {fetchError && (
        <div className="p-4 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 text-amber-900 dark:text-amber-200 text-xs flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
            <div>
              <p className="font-semibold">Live Configuration Degraded / Unreachable</p>
              <p className="text-[11px] text-amber-700 dark:text-amber-300 mt-0.5">{fetchError}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={loadSettings}
            className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-medium text-xs shrink-0 cursor-pointer"
          >
            Retry Connection
          </button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-2 border-b border-slate-200 dark:border-slate-800 pb-2 overflow-x-auto">
        <button
          type="button"
          onClick={() => setActiveTab('PROFILE')}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 shrink-0 ${
            activeTab === 'PROFILE'
              ? 'bg-sky-600 text-white shadow-xs'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-900'
          }`}
        >
          <Building className="w-3.5 h-3.5" />
          <span>Business Profile</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('VOICE')}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 shrink-0 ${
            activeTab === 'VOICE'
              ? 'bg-sky-600 text-white shadow-xs'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-900'
          }`}
        >
          <Mic className="w-3.5 h-3.5" />
          <span>Voice &amp; Language</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('ESCALATION')}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 shrink-0 ${
            activeTab === 'ESCALATION'
              ? 'bg-sky-600 text-white shadow-xs'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-900'
          }`}
        >
          <PhoneForwarded className="w-3.5 h-3.5" />
          <span>Escalation Directory</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('INTEGRATIONS')}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 shrink-0 ${
            activeTab === 'INTEGRATIONS'
              ? 'bg-sky-600 text-white shadow-xs'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-900'
          }`}
        >
          <ShieldCheck className="w-3.5 h-3.5" />
          <span>Integrations &amp; Telephony</span>
        </button>
      </div>

      {isLoading ? (
        <Card className="p-12 text-center text-slate-500 dark:text-slate-400 text-xs">
          Loading live tenant configuration from server...
        </Card>
      ) : (
        <form onSubmit={handleSave} className="space-y-6">
          {/* Business Profile Tab */}
          {activeTab === 'PROFILE' && (
            <Card className="space-y-4">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Client Business Identity</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                <div>
                  <label htmlFor="brand-name" className="block text-slate-700 dark:text-slate-300 font-medium mb-1">Brand Name Used on Voice Calls</label>
                  <input
                    id="brand-name"
                    type="text"
                    value={brandName}
                    onChange={(e) => setBrandName(e.target.value)}
                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg p-2 text-slate-900 dark:text-white focus:outline-hidden focus:border-sky-500"
                  />
                </div>
                <div>
                  <label htmlFor="legal-name" className="block text-slate-700 dark:text-slate-300 font-medium mb-1">Legal Registered Entity Name</label>
                  <input
                    id="legal-name"
                    type="text"
                    value={legalName}
                    onChange={(e) => setLegalName(e.target.value)}
                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg p-2 text-slate-900 dark:text-white focus:outline-hidden focus:border-sky-500"
                  />
                </div>
                <div>
                  <label htmlFor="business-type" className="block text-slate-700 dark:text-slate-300 font-medium mb-1">Business Nature / Category</label>
                  <input
                    id="business-type"
                    type="text"
                    value={businessType}
                    onChange={(e) => setBusinessType(e.target.value)}
                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg p-2 text-slate-900 dark:text-white focus:outline-hidden focus:border-sky-500"
                  />
                </div>
                <div>
                  <label htmlFor="operating-regions" className="block text-slate-700 dark:text-slate-300 font-medium mb-1">Primary Operating Regions (Comma Separated)</label>
                  <input
                    id="operating-regions"
                    type="text"
                    value={operatingRegions}
                    onChange={(e) => setOperatingRegions(e.target.value)}
                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg p-2 text-slate-900 dark:text-white focus:outline-hidden focus:border-sky-500"
                  />
                </div>
                <div>
                  <label htmlFor="working-hours" className="block text-slate-700 dark:text-slate-300 font-medium mb-1">Operating Business Hours</label>
                  <input
                    id="working-hours"
                    type="text"
                    value={workingHours}
                    onChange={(e) => setWorkingHours(e.target.value)}
                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg p-2 text-slate-900 dark:text-white focus:outline-hidden focus:border-sky-500"
                  />
                </div>
                <div>
                  <label htmlFor="operational-timezone" className="block text-slate-700 dark:text-slate-300 font-medium mb-1">Operational Timezone</label>
                  <input
                    id="operational-timezone"
                    type="text"
                    disabled
                    value={timezone}
                    className="w-full bg-slate-100 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-lg p-2 text-slate-500 dark:text-slate-400 cursor-not-allowed"
                  />
                  <span className="text-[10px] text-slate-500 mt-1 block">Deployment gated: Standardized to Asia/Kolkata (IST) for India domestic freight network.</span>
                </div>
              </div>

            <div>
              <label htmlFor="disclosure-wording" className="block text-slate-700 dark:text-slate-300 font-medium mb-1">AI Identity Disclosure Statement</label>
              <input
                id="disclosure-wording"
                type="text"
                value={disclosureWording}
                onChange={(e) => setDisclosureWording(e.target.value)}
                className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg p-2 text-slate-900 dark:text-white focus:outline-hidden focus:border-sky-500"
              />
              <span className="text-[10px] text-slate-500 mt-1 block">
                Spoken if caller inquires whether speaking to AI or human representative.
              </span>
            </div>
          </Card>
        )}

        {/* Voice & Language Tab */}
        {activeTab === 'VOICE' && (
          <Card className="space-y-4">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Voice &amp; Conversation Behaviour</h2>
            <div className="space-y-4 text-xs">
              <div>
                <label htmlFor="primary-language" className="block text-slate-700 dark:text-slate-300 font-medium mb-1">Primary Conversation Language</label>
                <select
                  id="primary-language"
                  value={primaryLang}
                  onChange={(e) => setPrimaryLang(e.target.value)}
                  className="w-full max-w-md bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg p-2 text-slate-900 dark:text-white focus:outline-hidden focus:border-sky-500"
                >
                  <option value="Hinglish (Hindi + English)">Hinglish (Hindi + English) — Recommended</option>
                  <option value="Pure Hindi">Pure Hindi (Devanagari / Romanized)</option>
                  <option value="Indian English">Indian Business English</option>
                </select>
              </div>

              <div>
                <label htmlFor="voice-persona" className="block text-slate-700 dark:text-slate-300 font-medium mb-1">Voice Persona &amp; Acoustic Style</label>
                <input
                  id="voice-persona"
                  type="text"
                  value={voicePersona}
                  onChange={(e) => setVoicePersona(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg p-2 text-slate-900 dark:text-white focus:outline-hidden focus:border-sky-500"
                />
              </div>

              <div className="flex items-center gap-3 pt-2">
                <input
                  id="bargein"
                  type="checkbox"
                  checked={bargeInEnabled}
                  onChange={(e) => setBargeInEnabled(e.target.checked)}
                  className="rounded bg-slate-50 dark:bg-slate-950 border-slate-300 dark:border-slate-800 text-sky-600 focus:ring-sky-500"
                />
                <label htmlFor="bargein" className="text-xs text-slate-700 dark:text-slate-200">
                  <strong className="text-slate-900 dark:text-white">Enable Real-Time Interruption (Barge-in):</strong> Voice agent pauses speech immediately when caller speaks.
                </label>
              </div>

              <div className="flex items-center gap-3">
                <input
                  id="switching"
                  type="checkbox"
                  checked={allowSwitching}
                  onChange={(e) => setAllowSwitching(e.target.checked)}
                  className="rounded bg-slate-50 dark:bg-slate-950 border-slate-300 dark:border-slate-800 text-sky-600 focus:ring-sky-500"
                />
                <label htmlFor="switching" className="text-xs text-slate-700 dark:text-slate-200">
                  <strong className="text-slate-900 dark:text-white">Dynamic Language Mirroring:</strong> Automatically switch language when caller transitions between Hindi and English.
                </label>
              </div>
            </div>
          </Card>
        )}

        {/* Escalation Directory Tab */}
        {activeTab === 'ESCALATION' && (
          <Card className="space-y-4">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Human Escalation Routing Directory</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Approved phone numbers for warm/cold live transfer when AI encounters high-risk or roadside breakdown scenarios
            </p>
            <div className="space-y-4 text-xs">
              <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-2">
                <div className="font-medium text-slate-800 dark:text-slate-200">Primary Operations Dispatcher</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <input
                    type="text"
                    placeholder="Contact Title/Name"
                    value={dispatcherName}
                    onChange={(e) => setDispatcherName(e.target.value)}
                    className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-800 rounded p-1.5 text-slate-900 dark:text-white"
                  />
                  <input
                    type="text"
                    placeholder="Phone (+91...)"
                    value={dispatcherPhone}
                    onChange={(e) => setDispatcherPhone(e.target.value)}
                    className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-800 rounded p-1.5 text-slate-900 dark:text-white"
                  />
                </div>
              </div>

              <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-2">
                <div className="font-medium text-slate-800 dark:text-slate-200">Hub Operations Manager</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <input
                    type="text"
                    placeholder="Contact Title/Name"
                    value={opsManagerName}
                    onChange={(e) => setOpsManagerName(e.target.value)}
                    className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-800 rounded p-1.5 text-slate-900 dark:text-white"
                  />
                  <input
                    type="text"
                    placeholder="Phone (+91...)"
                    value={opsManagerPhone}
                    onChange={(e) => setOpsManagerPhone(e.target.value)}
                    className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-800 rounded p-1.5 text-slate-900 dark:text-white"
                  />
                </div>
              </div>

              <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-2">
                <div className="font-medium text-slate-800 dark:text-slate-200">Roadside Emergency &amp; Breakdown Line</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <input
                    type="text"
                    placeholder="Contact Title/Name"
                    value={emergencyName}
                    onChange={(e) => setEmergencyName(e.target.value)}
                    className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-800 rounded p-1.5 text-slate-900 dark:text-white"
                  />
                  <input
                    type="text"
                    placeholder="Phone (+91...)"
                    value={emergencyPhone}
                    onChange={(e) => setEmergencyPhone(e.target.value)}
                    className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-800 rounded p-1.5 text-slate-900 dark:text-white"
                  />
                </div>
              </div>
            </div>
          </Card>
        )}

        {/* Integrations & Telephony Status Tab */}
        {activeTab === 'INTEGRATIONS' && (
          <Card className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Infrastructure &amp; Provider Boundaries</h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Live connection health &amp; compliance status. Secrets remain in server-side environment variables.
                </p>
              </div>
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-[11px] text-slate-700 dark:text-slate-400">
                <Lock className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                <span>Secrets are stored server-side in secure environment variables</span>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-2 shadow-xs">
                <div className="flex justify-between items-center">
                  <span className="font-semibold text-slate-900 dark:text-white">Retell AI Voice Gateway</span>
                  {renderStatusBadge(integrationStatus.retell)}
                </div>
                <p className="text-slate-600 dark:text-slate-400 text-[11px]">Primary voice streaming, real-time audio pipeline, bilingual Hindi/English.</p>
                <div className="text-slate-500 font-mono text-[10px]">Authoritative Retell Agent ID mapped server-side</div>
              </div>

              <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-2 shadow-xs">
                <div className="flex justify-between items-center">
                  <span className="font-semibold text-slate-900 dark:text-white">Supabase PostgreSQL</span>
                  {renderStatusBadge(integrationStatus.supabase)}
                </div>
                <p className="text-slate-600 dark:text-slate-400 text-[11px]">Master operational database, tenant isolation &amp; RLS policies.</p>
                <div className="text-slate-500 font-mono text-[10px]">Validated through live Supabase connectivity health check</div>
              </div>

              <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-2 shadow-xs">
                <div className="flex justify-between items-center">
                  <span className="font-semibold text-slate-900 dark:text-white">India Telephony (TRAI 1601 series)</span>
                  {renderStatusBadge(integrationStatus.telephony)}
                </div>
                <p className="text-slate-600 dark:text-slate-400 text-[11px]">TRAI logistics numbering direction compliance &amp; Indian SIP bridge.</p>
                <div className="text-slate-500 font-mono text-[10px]">Live telephony transfer gating active</div>
              </div>

              <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-2 shadow-xs">
                <div className="flex justify-between items-center">
                  <span className="font-semibold text-slate-900 dark:text-white">Google Sheets Operations Sync</span>
                  {renderStatusBadge(integrationStatus.google_sheets)}
                </div>
                <p className="text-slate-600 dark:text-slate-400 text-[11px]">Automatic append of call summaries and quotes to client spreadsheets.</p>
                <div className="text-slate-500 font-mono text-[10px]">Approved tenant spreadsheet configuration required</div>
              </div>

              <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-2 shadow-xs">
                <div className="flex justify-between items-center">
                  <span className="font-semibold text-slate-900 dark:text-white">WhatsApp &amp; SMS Messaging</span>
                  {renderStatusBadge(integrationStatus.messaging)}
                </div>
                <p className="text-slate-600 dark:text-slate-400 text-[11px]">Post-call confirmation and quotes via WhatsApp Cloud API / Twilio.</p>
                <div className="text-slate-500 font-mono text-[10px]">Strict E.164 normalization &amp; suppression handling</div>
              </div>

              <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-2 shadow-xs">
                <div className="flex justify-between items-center">
                  <span className="font-semibold text-slate-900 dark:text-white">Live Consignment Tracking</span>
                  {renderStatusBadge(integrationStatus.tracking)}
                </div>
                <p className="text-slate-600 dark:text-slate-400 text-[11px]">Enterprise TMS &amp; GPS tracking provider integration.</p>
                <div className="text-slate-500 font-mono text-[10px]">Mock sources blocked in production</div>
              </div>
            </div>
          </Card>
        )}

        {/* Save Button Bar */}
        <div className="flex justify-end pt-2">
          <button
            type="submit"
            disabled={isSaving}
            className="px-5 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold tracking-wide transition-colors flex items-center gap-1.5 shadow-xs disabled:opacity-50 cursor-pointer"
          >
            <Save className="w-4 h-4" />
            <span>{isSaving ? 'Saving...' : 'Save Configuration'}</span>
          </button>
        </div>
      </form>
    )}
  </div>
);
}
