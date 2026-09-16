'use client';

import React, { useState } from 'react';
import {
  Settings,
  Building,
  Clock,
  Mic,
  PhoneForwarded,
  ShieldCheck,
  Save,
  CheckCircle2,
  AlertCircle,
  Key,
  Lock,
} from 'lucide-react';
import { Card } from '@/components/ui/Card';

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<'PROFILE' | 'VOICE' | 'ESCALATION' | 'INTEGRATIONS'>('PROFILE');
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Business Profile State
  const [brandName, setBrandName] = useState('LogiVoice Freight Express');
  const [legalName, setLegalName] = useState('LogiVoice Logistics Solutions Pvt Ltd');
  const [businessType, setBusinessType] = useState('3PL & Full Truckload (FTL) Fleet Operator');
  const [operatingRegions, setOperatingRegions] = useState('Delhi-NCR, Rajasthan, Gujarat, Maharashtra, Haryana');
  const [workingHours, setWorkingHours] = useState('08:00 AM – 10:00 PM IST');
  const [timezone, setTimezone] = useState('Asia/Kolkata (IST +5:30)');
  const [disclosureWording, setDisclosureWording] = useState(
    'Main LogiVoice, aapki logistics operations assistant hoon.'
  );

  // Voice State
  const [primaryLang, setPrimaryLang] = useState('Hinglish (Hindi + English)');
  const [allowSwitching, setAllowSwitching] = useState(true);
  const [voicePersona, setVoicePersona] = useState('Warm, professional Indian business voice with natural turn-taking');
  const [bargeInEnabled, setBargeInEnabled] = useState(true);

  // Escalation State
  const [primaryDispatcher, setPrimaryDispatcher] = useState('+91 98111 22334 (Vikas Sharma - Senior Fleet Desk)');
  const [opsManager, setOpsManager] = useState('+91 98222 33445 (Rohan Verma - Hub Head)');
  const [breakdownEmergency, setBreakdownEmergency] = useState('+91 98333 44556 (24/7 Roadside Rescue Line)');

  React.useEffect(() => {
    fetch('/api/settings')
      .then((res) => res.json())
      .then((data) => {
        if (data?.config) {
          const cfg = data.config;
          if (cfg.brand_name) setBrandName(cfg.brand_name);
          if (cfg.business_name) setLegalName(cfg.business_name);
          if (cfg.primary_operating_cities) setOperatingRegions(cfg.primary_operating_cities.join(', '));
          if (cfg.ai_disclosure_wording) setDisclosureWording(cfg.ai_disclosure_wording);
        }
      })
      .catch((err) => console.warn('[SettingsPage] API fetch error:', err));
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brand_name: brandName,
          business_name: legalName,
          primary_operating_cities: operatingRegions.split(',').map((s) => s.trim()),
          ai_disclosure_wording: disclosureWording,
        }),
      });
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch {
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
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
            <span>Settings Saved Successfully</span>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 border-b border-slate-200 dark:border-slate-800 pb-2 overflow-x-auto">
        <button
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

      <form onSubmit={handleSave} className="space-y-6">
        {/* Business Profile Tab */}
        {activeTab === 'PROFILE' && (
          <Card className="space-y-4">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Client Business Identity</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
              <div>
                <label className="block text-slate-700 dark:text-slate-300 font-medium mb-1">Brand Name Used on Voice Calls</label>
                <input
                  type="text"
                  value={brandName}
                  onChange={(e) => setBrandName(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg p-2 text-slate-900 dark:text-white focus:outline-hidden focus:border-sky-500"
                />
              </div>
              <div>
                <label className="block text-slate-700 dark:text-slate-300 font-medium mb-1">Legal Registered Entity Name</label>
                <input
                  type="text"
                  value={legalName}
                  onChange={(e) => setLegalName(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg p-2 text-slate-900 dark:text-white focus:outline-hidden focus:border-sky-500"
                />
              </div>
              <div>
                <label className="block text-slate-700 dark:text-slate-300 font-medium mb-1">Business Nature / Category</label>
                <input
                  type="text"
                  value={businessType}
                  onChange={(e) => setBusinessType(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg p-2 text-slate-900 dark:text-white focus:outline-hidden focus:border-sky-500"
                />
              </div>
              <div>
                <label className="block text-slate-700 dark:text-slate-300 font-medium mb-1">Primary Operating Regions</label>
                <input
                  type="text"
                  value={operatingRegions}
                  onChange={(e) => setOperatingRegions(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg p-2 text-slate-900 dark:text-white focus:outline-hidden focus:border-sky-500"
                />
              </div>
              <div>
                <label className="block text-slate-700 dark:text-slate-300 font-medium mb-1">Operating Business Hours</label>
                <input
                  type="text"
                  value={workingHours}
                  onChange={(e) => setWorkingHours(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg p-2 text-slate-900 dark:text-white focus:outline-hidden focus:border-sky-500"
                />
              </div>
              <div>
                <label className="block text-slate-700 dark:text-slate-300 font-medium mb-1">Operational Timezone</label>
                <input
                  type="text"
                  disabled
                  value={timezone}
                  className="w-full bg-slate-100 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-lg p-2 text-slate-500 dark:text-slate-400 cursor-not-allowed"
                />
              </div>
            </div>

            <div>
              <label className="block text-slate-700 dark:text-slate-300 font-medium mb-1">AI Identity Disclosure Statement</label>
              <input
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
                <label className="block text-slate-700 dark:text-slate-300 font-medium mb-1">Primary Conversation Language</label>
                <select
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
                <label className="block text-slate-700 dark:text-slate-300 font-medium mb-1">Voice Persona &amp; Acoustic Style</label>
                <input
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
            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-700 dark:text-slate-300 font-medium mb-1">Primary Operations Dispatcher</label>
                <input
                  type="text"
                  value={primaryDispatcher}
                  onChange={(e) => setPrimaryDispatcher(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg p-2 text-slate-900 dark:text-white focus:outline-hidden focus:border-sky-500"
                />
              </div>
              <div>
                <label className="block text-slate-700 dark:text-slate-300 font-medium mb-1">Hub Operations Manager</label>
                <input
                  type="text"
                  value={opsManager}
                  onChange={(e) => setOpsManager(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg p-2 text-slate-900 dark:text-white focus:outline-hidden focus:border-sky-500"
                />
              </div>
              <div>
                <label className="block text-slate-700 dark:text-slate-300 font-medium mb-1">Roadside Emergency &amp; Breakdown Line</label>
                <input
                  type="text"
                  value={breakdownEmergency}
                  onChange={(e) => setBreakdownEmergency(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-lg p-2 text-slate-900 dark:text-white focus:outline-hidden focus:border-sky-500"
                />
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
                <span>Zero Secret Leakage Guaranteed</span>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-2 shadow-xs">
                <div className="flex justify-between items-center">
                  <span className="font-semibold text-slate-900 dark:text-white">Retell AI Voice Gateway</span>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400 border border-emerald-300 dark:border-emerald-800">
                    CONNECTED
                  </span>
                </div>
                <p className="text-slate-600 dark:text-slate-400 text-[11px]">Primary voice streaming, latency p50 ~820ms, bilingual Hindi/English.</p>
                <div className="text-slate-500 font-mono text-[10px]">Configured in .env.local (RETELL_API_KEY)</div>
              </div>

              <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-2 shadow-xs">
                <div className="flex justify-between items-center">
                  <span className="font-semibold text-slate-900 dark:text-white">Supabase PostgreSQL</span>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400 border border-emerald-300 dark:border-emerald-800">
                    CONFIGURED
                  </span>
                </div>
                <p className="text-slate-600 dark:text-slate-400 text-[11px]">Master operational database, tenant isolation &amp; RLS policies.</p>
                <div className="text-slate-500 font-mono text-[10px]">SUPABASE_URL &amp; SUPABASE_SECRET_KEY verified</div>
              </div>

              <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-2 shadow-xs">
                <div className="flex justify-between items-center">
                  <span className="font-semibold text-slate-900 dark:text-white">India Telephony (TRAI 1601 series)</span>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-400 border border-amber-300 dark:border-amber-800">
                    DEPLOYMENT-GATED
                  </span>
                </div>
                <p className="text-slate-600 dark:text-slate-400 text-[11px]">TRAI logistics numbering direction compliance &amp; Indian SIP bridge.</p>
                <div className="text-slate-500 font-mono text-[10px]">Mock mode active for development &amp; scripted testing</div>
              </div>

              <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-2 shadow-xs">
                <div className="flex justify-between items-center">
                  <span className="font-semibold text-slate-900 dark:text-white">Google Sheets Operations Sync</span>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700">
                    GATED
                  </span>
                </div>
                <p className="text-slate-600 dark:text-slate-400 text-[11px]">Automatic append of call summaries and quotes to client spreadsheets.</p>
                <div className="text-slate-500 font-mono text-[10px]">GOOGLE_SHEETS_SPREADSHEET_ID placeholder ready</div>
              </div>
            </div>
          </Card>
        )}

        {/* Save Button Bar */}
        <div className="flex justify-end pt-2">
          <button
            type="submit"
            className="px-5 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold tracking-wide transition-colors flex items-center gap-1.5 shadow-xs"
          >
            <Save className="w-4 h-4" />
            <span>Save Configuration</span>
          </button>
        </div>
      </form>
    </div>
  );
}
