-- ====================================================================
-- LOGIVOICE V1 — FORWARD MIGRATION: DURABLE IDEMPOTENCY CONSTRAINTS
-- Migration: 20260918000000_durable_idempotency_constraints.sql
-- ====================================================================

-- 1. Calls: Unique constraint on external_call_id per tenant
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'uq_calls_tenant_external_id'
    ) THEN
        ALTER TABLE public.calls
        ADD CONSTRAINT uq_calls_tenant_external_id UNIQUE (tenant_id, external_call_id);
    END IF;
END $$;

-- 2. Operations Requests: Add idempotency_key column and unique constraint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'operations_requests' AND column_name = 'idempotency_key'
    ) THEN
        ALTER TABLE public.operations_requests ADD COLUMN idempotency_key TEXT;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'uq_requests_tenant_idempotency'
    ) THEN
        ALTER TABLE public.operations_requests
        ADD CONSTRAINT uq_requests_tenant_idempotency UNIQUE (tenant_id, idempotency_key);
    END IF;
END $$;

-- 3. Followups: Unique constraint on (tenant_id, call_id) for V1 one-followup-per-call semantics
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'uq_followups_tenant_call'
    ) THEN
        ALTER TABLE public.followups
        ADD CONSTRAINT uq_followups_tenant_call UNIQUE (tenant_id, call_id);
    END IF;
END $$;

-- 4. Rate Cards: Integrity check constraints
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'ck_rate_cards_weight_bounds'
    ) THEN
        ALTER TABLE public.rate_cards
        ADD CONSTRAINT ck_rate_cards_weight_bounds CHECK (weight_max_tons >= weight_min_tons);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'ck_rate_cards_effective_dates'
    ) THEN
        ALTER TABLE public.rate_cards
        ADD CONSTRAINT ck_rate_cards_effective_dates CHECK (effective_to IS NULL OR effective_to >= effective_from);
    END IF;
END $$;
