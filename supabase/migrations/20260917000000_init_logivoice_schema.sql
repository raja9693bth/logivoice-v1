-- LOGIVOICE V1 — INITIAL DATABASE SCHEMA MIGRATION
-- Migration Version: 20260917000000_init_logivoice_schema.sql
-- Conforms to LogiVoice V1 SSOT Table 7 & Knowledge Base 03_STRUCTURED_DATA_MODEL.txt

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ==========================================
-- 1. TENANTS TABLE
-- ==========================================
CREATE TABLE IF NOT EXISTS public.tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ==========================================
-- 2. CUSTOMERS TABLE
-- ==========================================
CREATE TABLE IF NOT EXISTS public.customers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    phone TEXT NOT NULL,
    name TEXT NOT NULL,
    company TEXT,
    customer_type TEXT CHECK (customer_type IN ('BROKER', 'SHIPPER', 'CONSIGNEE', 'FLEET_OPERATOR')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ,
    CONSTRAINT uq_tenant_customer_phone UNIQUE (tenant_id, phone)
);

CREATE INDEX IF NOT EXISTS idx_customers_tenant_phone ON public.customers(tenant_id, phone);

-- ==========================================
-- 3. CALLS TABLE
-- ==========================================
CREATE TABLE IF NOT EXISTS public.calls (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    external_call_id TEXT NOT NULL UNIQUE,
    customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ended_at TIMESTAMPTZ,
    duration_seconds INTEGER NOT NULL DEFAULT 0,
    primary_intent TEXT NOT NULL DEFAULT 'GENERAL',
    intent_confidence NUMERIC NOT NULL DEFAULT 1.0,
    sentiment TEXT NOT NULL DEFAULT 'NEUTRAL' CHECK (sentiment IN ('POSITIVE', 'NEUTRAL', 'FRUSTRATED', 'ANGRY')),
    outcome TEXT NOT NULL DEFAULT 'IN_PROGRESS' CHECK (outcome IN ('IN_PROGRESS', 'COMPLETED', 'TRANSFERRED', 'CALLBACK_SCHEDULED', 'MISSED', 'FAILED', 'ABANDONED')),
    lead_temperature TEXT NOT NULL DEFAULT 'COLD' CHECK (lead_temperature IN ('HOT', 'WARM', 'COLD', 'REVIEW')),
    summary TEXT,
    agent_version TEXT NOT NULL DEFAULT 'v1.0.0',
    recording_url TEXT,
    escalation_status JSONB NOT NULL DEFAULT '{"is_escalated": false}'::jsonb,
    followup_state JSONB NOT NULL DEFAULT '{"eligible": false, "status": "PENDING"}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_calls_tenant_started ON public.calls(tenant_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_calls_external_id ON public.calls(external_call_id);
CREATE INDEX IF NOT EXISTS idx_calls_customer ON public.calls(tenant_id, customer_id);

-- ==========================================
-- 4. CALL_FACTS TABLE
-- ==========================================
CREATE TABLE IF NOT EXISTS public.call_facts (
    call_id UUID PRIMARY KEY REFERENCES public.calls(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    route_from TEXT,
    route_to TEXT,
    weight TEXT,
    quantity TEXT,
    vehicle_type TEXT,
    material_type TEXT,
    pickup_date TEXT,
    pickup_time TEXT,
    quoted_amount NUMERIC,
    quote_type TEXT CHECK (quote_type IN ('ESTIMATE', 'CONFIRMED')),
    tracking_id TEXT,
    booking_reference TEXT,
    special_requirements TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_call_facts_tenant ON public.call_facts(tenant_id);

-- ==========================================
-- 5. TRANSCRIPT_SEGMENTS TABLE
-- ==========================================
CREATE TABLE IF NOT EXISTS public.transcript_segments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    call_id UUID NOT NULL REFERENCES public.calls(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    speaker TEXT NOT NULL CHECK (speaker IN ('agent', 'caller')),
    text TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    language TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transcript_call ON public.transcript_segments(call_id, created_at ASC);

-- ==========================================
-- 6. LEADS TABLE
-- ==========================================
CREATE TABLE IF NOT EXISTS public.leads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
    call_id UUID REFERENCES public.calls(id) ON DELETE SET NULL,
    source TEXT NOT NULL DEFAULT 'INBOUND_CALL',
    status TEXT NOT NULL DEFAULT 'NEW' CHECK (status IN ('NEW', 'CONTACTED', 'QUALIFIED', 'CONVERTED', 'LOST', 'WON')),
    temperature TEXT NOT NULL DEFAULT 'WARM' CHECK (temperature IN ('HOT', 'WARM', 'COLD', 'REVIEW')),
    requirement TEXT NOT NULL,
    route TEXT,
    vehicle_type TEXT,
    weight TEXT,
    next_action TEXT NOT NULL,
    assigned_to TEXT,
    followup_status TEXT NOT NULL DEFAULT 'PENDING' CHECK (followup_status IN ('PENDING', 'SENT', 'DELIVERED', 'FAILED', 'SUPPRESSED', 'UNCONFIGURED', 'MOCK', 'COMPLETED', 'SKIPPED_NOT_ELIGIBLE')),
    last_call_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_leads_tenant_temp ON public.leads(tenant_id, temperature);
CREATE INDEX IF NOT EXISTS idx_leads_tenant_status ON public.leads(tenant_id, status);

-- ==========================================
-- 7. OPERATIONS_REQUESTS TABLE
-- ==========================================
CREATE TABLE IF NOT EXISTS public.operations_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reference_no TEXT NOT NULL UNIQUE,
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    call_id UUID REFERENCES public.calls(id) ON DELETE SET NULL,
    customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
    type TEXT NOT NULL CHECK (type IN ('BOOKING_REQUEST', 'SUPPORT_TICKET', 'CALLBACK_REQUEST', 'RATE_REQUEST')),
    status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'CONFIRMED', 'IN_REVIEW', 'COMPLETED', 'REJECTED', 'FAILED')),
    priority TEXT NOT NULL DEFAULT 'NORMAL' CHECK (priority IN ('URGENT', 'HIGH', 'NORMAL', 'LOW')),
    summary TEXT NOT NULL,
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    assigned_to TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_requests_tenant_ref ON public.operations_requests(tenant_id, reference_no);
CREATE INDEX IF NOT EXISTS idx_requests_tenant_status ON public.operations_requests(tenant_id, status);

-- ==========================================
-- 8. RATE_CARDS TABLE
-- ==========================================
CREATE TABLE IF NOT EXISTS public.rate_cards (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    origin TEXT NOT NULL,
    destination TEXT NOT NULL,
    vehicle_type TEXT NOT NULL,
    weight_min_tons NUMERIC NOT NULL DEFAULT 0,
    weight_max_tons NUMERIC NOT NULL DEFAULT 0,
    price_inr NUMERIC NOT NULL,
    minimum_charge_inr NUMERIC NOT NULL DEFAULT 0,
    effective_from DATE NOT NULL,
    effective_to DATE,
    status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DRAFT', 'EXPIRED')),
    transit_time_hours INTEGER,
    surcharge_notes TEXT,
    source_version TEXT NOT NULL DEFAULT 'v1.0',
    quote_type TEXT NOT NULL DEFAULT 'ESTIMATE' CHECK (quote_type IN ('ESTIMATE', 'CONFIRMED')),
    supports_confirmed_quote BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rates_tenant_route ON public.rate_cards(tenant_id, origin, destination, vehicle_type);

-- ==========================================
-- 9. TRACKING_RECORDS TABLE
-- ==========================================
CREATE TABLE IF NOT EXISTS public.tracking_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    tracking_reference TEXT NOT NULL,
    customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
    status TEXT NOT NULL,
    current_location TEXT NOT NULL,
    status_timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    eta_if_verified TIMESTAMPTZ,
    exception_reason TEXT,
    source TEXT NOT NULL DEFAULT 'MOCK_TMS',
    last_synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_tenant_tracking_ref UNIQUE (tenant_id, tracking_reference)
);

CREATE INDEX IF NOT EXISTS idx_tracking_tenant_ref ON public.tracking_records(tenant_id, tracking_reference);

-- ==========================================
-- 10. FOLLOWUPS TABLE
-- ==========================================
CREATE TABLE IF NOT EXISTS public.followups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    call_id UUID NOT NULL REFERENCES public.calls(id) ON DELETE CASCADE,
    customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
    channel TEXT NOT NULL CHECK (channel IN ('WHATSAPP', 'SMS', 'EMAIL')),
    status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'SENT', 'DELIVERED', 'FAILED', 'SUPPRESSED', 'UNCONFIGURED', 'MOCK', 'COMPLETED', 'SKIPPED_NOT_ELIGIBLE')),
    recipient TEXT NOT NULL,
    template_id TEXT,
    message_content TEXT,
    message_snippet TEXT,
    provider_message_id TEXT,
    suppression_reason TEXT,
    sent_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_followups_tenant_call ON public.followups(tenant_id, call_id);

-- ==========================================
-- 11. AUDIT_EVENTS TABLE
-- ==========================================
CREATE TABLE IF NOT EXISTS public.audit_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    call_id UUID REFERENCES public.calls(id) ON DELETE SET NULL,
    event_type TEXT NOT NULL,
    actor_type TEXT NOT NULL CHECK (actor_type IN ('AI_AGENT', 'DISPATCHER', 'SYSTEM', 'WEBHOOK')),
    actor_id TEXT NOT NULL,
    tool_name TEXT,
    severity TEXT NOT NULL DEFAULT 'INFO' CHECK (severity IN ('INFO', 'WARNING', 'ERROR', 'CRITICAL')),
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_tenant_created ON public.audit_events(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_call ON public.audit_events(call_id);

-- ==========================================
-- 12. CLIENT_CONFIGS TABLE
-- ==========================================
CREATE TABLE IF NOT EXISTS public.client_configs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL UNIQUE REFERENCES public.tenants(id) ON DELETE CASCADE,
    business_name TEXT NOT NULL,
    brand_name TEXT NOT NULL,
    primary_operating_cities TEXT[] NOT NULL DEFAULT '{}',
    business_hours JSONB NOT NULL DEFAULT '{"start": "09:00", "end": "21:00", "days": "Mon-Sat"}'::jsonb,
    timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    ai_disclosure_wording TEXT NOT NULL DEFAULT 'I am an AI assistant for logistics operations.',
    primary_language TEXT NOT NULL DEFAULT 'hi',
    secondary_language TEXT NOT NULL DEFAULT 'en',
    inbound_phone_number TEXT,
    escalation_contacts JSONB NOT NULL DEFAULT '[]'::jsonb,
    tracking_config JSONB NOT NULL DEFAULT '{}'::jsonb,
    followup_config JSONB NOT NULL DEFAULT '{}'::jsonb,
    sheets_config JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ==========================================
-- 13. KNOWLEDGE_ITEMS TABLE
-- ==========================================
CREATE TABLE IF NOT EXISTS public.knowledge_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    category TEXT NOT NULL CHECK (category IN ('RATE_POLICY', 'TRACKING_POLICY', 'SERVICE_AREA', 'BOOKING_RULES', 'OPERATIONAL_FAQ', 'ESCALATION_RULES', 'SERVICE_RULE', 'SURCHARGE_POLICY', 'COMMERCIAL_CLAUSE')),
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'APPROVED' CHECK (status IN ('APPROVED', 'DRAFT', 'UNDER_REVIEW', 'ARCHIVED')),
    version TEXT NOT NULL DEFAULT 'v1.0',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_knowledge_tenant_category ON public.knowledge_items(tenant_id, category);

-- ==========================================
-- 14. ROW LEVEL SECURITY (RLS) POLICIES
-- ==========================================
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.call_facts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transcript_segments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.operations_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rate_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tracking_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.followups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.knowledge_items ENABLE ROW LEVEL SECURITY;

-- Service Role Policy (Bypasses RLS for server-side trusted execution)
-- Note: In Supabase, the service_role key automatically bypasses RLS by default.
-- Authenticated user policies for tenant-isolated access:
CREATE POLICY "tenant_isolation_customers" ON public.customers
    FOR ALL TO authenticated
    USING (tenant_id = (current_setting('app.current_tenant_id', true))::uuid)
    WITH CHECK (tenant_id = (current_setting('app.current_tenant_id', true))::uuid);

CREATE POLICY "tenant_isolation_calls" ON public.calls
    FOR ALL TO authenticated
    USING (tenant_id = (current_setting('app.current_tenant_id', true))::uuid)
    WITH CHECK (tenant_id = (current_setting('app.current_tenant_id', true))::uuid);

CREATE POLICY "tenant_isolation_leads" ON public.leads
    FOR ALL TO authenticated
    USING (tenant_id = (current_setting('app.current_tenant_id', true))::uuid)
    WITH CHECK (tenant_id = (current_setting('app.current_tenant_id', true))::uuid);

CREATE POLICY "tenant_isolation_requests" ON public.operations_requests
    FOR ALL TO authenticated
    USING (tenant_id = (current_setting('app.current_tenant_id', true))::uuid)
    WITH CHECK (tenant_id = (current_setting('app.current_tenant_id', true))::uuid);

CREATE POLICY "tenant_isolation_rates" ON public.rate_cards
    FOR ALL TO authenticated
    USING (tenant_id = (current_setting('app.current_tenant_id', true))::uuid)
    WITH CHECK (tenant_id = (current_setting('app.current_tenant_id', true))::uuid);

CREATE POLICY "tenant_isolation_call_facts" ON public.call_facts
    FOR ALL TO authenticated
    USING (tenant_id = (current_setting('app.current_tenant_id', true))::uuid)
    WITH CHECK (tenant_id = (current_setting('app.current_tenant_id', true))::uuid);

CREATE POLICY "tenant_isolation_transcript" ON public.transcript_segments
    FOR ALL TO authenticated
    USING (tenant_id = (current_setting('app.current_tenant_id', true))::uuid)
    WITH CHECK (tenant_id = (current_setting('app.current_tenant_id', true))::uuid);

CREATE POLICY "tenant_isolation_tracking" ON public.tracking_records
    FOR ALL TO authenticated
    USING (tenant_id = (current_setting('app.current_tenant_id', true))::uuid)
    WITH CHECK (tenant_id = (current_setting('app.current_tenant_id', true))::uuid);

CREATE POLICY "tenant_isolation_followups" ON public.followups
    FOR ALL TO authenticated
    USING (tenant_id = (current_setting('app.current_tenant_id', true))::uuid)
    WITH CHECK (tenant_id = (current_setting('app.current_tenant_id', true))::uuid);

CREATE POLICY "tenant_isolation_audit" ON public.audit_events
    FOR ALL TO authenticated
    USING (tenant_id = (current_setting('app.current_tenant_id', true))::uuid)
    WITH CHECK (tenant_id = (current_setting('app.current_tenant_id', true))::uuid);

CREATE POLICY "tenant_isolation_configs" ON public.client_configs
    FOR ALL TO authenticated
    USING (tenant_id = (current_setting('app.current_tenant_id', true))::uuid)
    WITH CHECK (tenant_id = (current_setting('app.current_tenant_id', true))::uuid);

CREATE POLICY "tenant_isolation_knowledge" ON public.knowledge_items
    FOR ALL TO authenticated
    USING (tenant_id = (current_setting('app.current_tenant_id', true))::uuid)
    WITH CHECK (tenant_id = (current_setting('app.current_tenant_id', true))::uuid);

