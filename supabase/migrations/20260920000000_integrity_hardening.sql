-- =========================================================================
-- LOGIVOICE V1 — INTEGRITY HARDENING MIGRATION
-- Migration: 20260920000000_integrity_hardening.sql
-- 
-- 1. Synchronizes client_configs schema with API / TypeScript entities
-- 2. Implements phone_normalized storage column & canonical uniqueness
-- 3. Updates knowledge_items default approval state to DRAFT
-- 4. Establishes durable side_effect_claims outbox / job table
-- 5. Establishes durable customer_suppressions table for messaging opt-outs
-- 6. Enforces tenant-isolated Row Level Security (RLS) policies
-- =========================================================================

-- 1. CLIENT_CONFIGS COLUMNS SYNCHRONIZATION
-- -------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'client_configs' AND column_name = 'business_type'
    ) THEN
        ALTER TABLE public.client_configs ADD COLUMN business_type TEXT NOT NULL DEFAULT 'Full Truckload (FTL)';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'client_configs' AND column_name = 'booking_url'
    ) THEN
        ALTER TABLE public.client_configs ADD COLUMN booking_url TEXT;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'client_configs' AND column_name = 'voice_persona'
    ) THEN
        ALTER TABLE public.client_configs ADD COLUMN voice_persona TEXT NOT NULL DEFAULT 'Professional Logistics Coordinator';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'client_configs' AND column_name = 'barge_in_enabled'
    ) THEN
        ALTER TABLE public.client_configs ADD COLUMN barge_in_enabled BOOLEAN NOT NULL DEFAULT true;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'client_configs' AND column_name = 'allow_language_switching'
    ) THEN
        ALTER TABLE public.client_configs ADD COLUMN allow_language_switching BOOLEAN NOT NULL DEFAULT true;
    END IF;
END $$;

-- 2. CUSTOMER PHONE NORMALIZATION & UNIQUE CANONICAL INDEX
-- -------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'customers' AND column_name = 'phone_normalized'
    ) THEN
        ALTER TABLE public.customers ADD COLUMN phone_normalized TEXT;
        
        -- Backfill canonical normalized phone numbers for existing rows:
        -- Strip non-digit characters, prepend +91 for 10-digit Indian numbers, ensure + prefix
        UPDATE public.customers
        SET phone_normalized = CASE
            WHEN regexp_replace(phone, '[^0-9+]', '', 'g') LIKE '+%' THEN regexp_replace(phone, '[^0-9+]', '', 'g')
            WHEN length(regexp_replace(phone, '[^0-9]', '', 'g')) = 10 THEN '+91' || regexp_replace(phone, '[^0-9]', '', 'g')
            WHEN length(regexp_replace(phone, '[^0-9]', '', 'g')) = 12 AND regexp_replace(phone, '[^0-9]', '', 'g') LIKE '91%' THEN '+' || regexp_replace(phone, '[^0-9]', '', 'g')
            ELSE '+' || regexp_replace(phone, '[^0-9]', '', 'g')
        END
        WHERE phone_normalized IS NULL;

        -- Make phone_normalized NOT NULL after backfill
        ALTER TABLE public.customers ALTER COLUMN phone_normalized SET NOT NULL;
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_tenant_phone_normalized 
ON public.customers (tenant_id, phone_normalized);

-- 3. KNOWLEDGE ITEMS SAFE DRAFT DEFAULT & AUDIT ATTRIBUTION
-- -------------------------------------------------------------------------
ALTER TABLE public.knowledge_items ALTER COLUMN status SET DEFAULT 'DRAFT';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'knowledge_items' AND column_name = 'approved_by'
    ) THEN
        ALTER TABLE public.knowledge_items ADD COLUMN approved_by TEXT;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'knowledge_items' AND column_name = 'approved_at'
    ) THEN
        ALTER TABLE public.knowledge_items ADD COLUMN approved_at TIMESTAMPTZ;
    END IF;
END $$;

-- 4. DURABLE SIDE-EFFECT CLAIMS / OUTBOX TABLE
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.side_effect_claims (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    claim_key TEXT NOT NULL,
    job_type TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'RETRYABLE', 'UNKNOWN')),
    attempt_count INT NOT NULL DEFAULT 1,
    payload JSONB,
    result JSONB,
    error TEXT,
    claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    claimed_by TEXT NOT NULL DEFAULT 'worker',
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_side_effect_claims_tenant_key UNIQUE (tenant_id, claim_key)
);

CREATE INDEX IF NOT EXISTS idx_claims_tenant_status ON public.side_effect_claims (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_claims_tenant_type ON public.side_effect_claims (tenant_id, job_type);

-- 5. DURABLE CUSTOMER SUPPRESSIONS TABLE
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.customer_suppressions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    phone_normalized TEXT NOT NULL,
    channel TEXT NOT NULL DEFAULT 'WHATSAPP',
    opt_out BOOLEAN NOT NULL DEFAULT true,
    reason TEXT,
    source TEXT NOT NULL DEFAULT 'CALLER_REQUEST',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_customer_suppression UNIQUE (tenant_id, phone_normalized, channel)
);

CREATE INDEX IF NOT EXISTS idx_suppressions_tenant_phone ON public.customer_suppressions (tenant_id, phone_normalized);

-- 6. ROW LEVEL SECURITY (RLS) FOR NEW TABLES
-- -------------------------------------------------------------------------
ALTER TABLE public.side_effect_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_suppressions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'side_effect_claims' AND policyname = 'tenant_isolation_side_effect_claims'
    ) THEN
        CREATE POLICY "tenant_isolation_side_effect_claims" ON public.side_effect_claims
            FOR ALL USING (tenant_id = (current_setting('app.current_tenant_id', true))::uuid);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'customer_suppressions' AND policyname = 'tenant_isolation_customer_suppressions'
    ) THEN
        CREATE POLICY "tenant_isolation_customer_suppressions" ON public.customer_suppressions
            FOR ALL USING (tenant_id = (current_setting('app.current_tenant_id', true))::uuid);
    END IF;
END $$;
