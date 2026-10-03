-- =========================================================================
-- LOGIVOICE V1 — ENTERPRISE INTEGRITY HARDENING MIGRATION
-- Migration: 20261003020000_enterprise_integrity_hardening.sql
--
-- Enforces:
-- 1. Mandatory Claim Token Ownership in complete_side_effect & fail_side_effect
-- 2. record_side_effect_unknown RPC for network/provider uncertainty
-- 3. Deterministic Lane Advisory Locking in bulk_import_rate_cards
-- 4. Batch-internal identical duplicate rejection in bulk_import_rate_cards
-- 5. True [min, max) half-open intervals & preserving NULL commercial values
-- 6. Lead uniqueness per call (tenant_id, call_id) WHERE call_id IS NOT NULL
-- 7. Structured tool_executions business_status and verified fact columns
-- =========================================================================

-- 1. LEAD IDEMPOTENCY BY CALL CONSTRAINT & OPTIONAL COMMERCIAL VALUES
-- -------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS uq_leads_tenant_call 
    ON public.leads (tenant_id, call_id) 
    WHERE call_id IS NOT NULL;

-- Policy B: Commercial values such as minimum_charge_inr are optional and must remain NULL if not supplied
ALTER TABLE public.rate_cards ALTER COLUMN minimum_charge_inr DROP NOT NULL;
ALTER TABLE public.rate_cards ALTER COLUMN minimum_charge_inr DROP DEFAULT;

-- 2. TOOL EXECUTIONS EXTENSION FOR BUSINESS TRUTH
-- -------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'tool_executions' AND column_name = 'business_status'
    ) THEN
        ALTER TABLE public.tool_executions ADD COLUMN business_status TEXT;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'tool_executions' AND column_name = 'verified'
    ) THEN
        ALTER TABLE public.tool_executions ADD COLUMN verified BOOLEAN NOT NULL DEFAULT false;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_tool_exec_fact_lookup 
    ON public.tool_executions (tenant_id, call_id, tool_name, business_status, verified);

-- 3. ATOMIC COMPLETE RPC FUNCTION — MANDATORY TOKEN OWNERSHIP
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.complete_side_effect(
    p_tenant_id UUID,
    p_claim_key TEXT,
    p_claim_token UUID,
    p_result JSONB
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
    v_updated INT;
BEGIN
    IF p_claim_token IS NULL THEN
        RAISE EXCEPTION 'p_claim_token is mandatory for complete_side_effect';
    END IF;

    UPDATE public.side_effect_claims
    SET status = 'SUCCEEDED',
        completed_at = clock_timestamp(),
        result = p_result,
        updated_at = clock_timestamp()
    WHERE tenant_id = p_tenant_id
      AND claim_key = p_claim_key
      AND claim_token = p_claim_token
      AND status = 'PROCESSING';

    GET DIAGNOSTICS v_updated = ROW_COUNT;
    RETURN v_updated > 0;
END;
$$;

-- 4. ATOMIC FAIL RPC FUNCTION — MANDATORY TOKEN OWNERSHIP
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fail_side_effect(
    p_tenant_id UUID,
    p_claim_key TEXT,
    p_claim_token UUID,
    p_error TEXT,
    p_is_retryable BOOLEAN,
    p_retry_delay_seconds INT DEFAULT 60
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
    v_updated INT;
    v_status TEXT := CASE WHEN p_is_retryable THEN 'RETRYABLE' ELSE 'FAILED' END;
    v_next_retry TIMESTAMPTZ := CASE WHEN p_is_retryable THEN clock_timestamp() + (p_retry_delay_seconds || ' seconds')::interval ELSE NULL END;
BEGIN
    IF p_claim_token IS NULL THEN
        RAISE EXCEPTION 'p_claim_token is mandatory for fail_side_effect';
    END IF;

    UPDATE public.side_effect_claims
    SET status = v_status,
        last_error = p_error,
        next_retry_at = v_next_retry,
        updated_at = clock_timestamp()
    WHERE tenant_id = p_tenant_id
      AND claim_key = p_claim_key
      AND claim_token = p_claim_token
      AND status = 'PROCESSING';

    GET DIAGNOSTICS v_updated = ROW_COUNT;
    RETURN v_updated > 0;
END;
$$;

-- 5. ATOMIC RECORD UNKNOWN RPC FUNCTION — UNCERTAINTY SETTLEMENT
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_side_effect_unknown(
    p_tenant_id UUID,
    p_claim_key TEXT,
    p_claim_token UUID,
    p_error TEXT,
    p_result JSONB DEFAULT '{}'::jsonb
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
    v_updated INT;
BEGIN
    IF p_claim_token IS NULL THEN
        RAISE EXCEPTION 'p_claim_token is mandatory for record_side_effect_unknown';
    END IF;

    UPDATE public.side_effect_claims
    SET status = 'UNKNOWN',
        last_error = p_error,
        result = p_result,
        updated_at = clock_timestamp()
    WHERE tenant_id = p_tenant_id
      AND claim_key = p_claim_key
      AND claim_token = p_claim_token
      AND status = 'PROCESSING';

    GET DIAGNOSTICS v_updated = ROW_COUNT;
    RETURN v_updated > 0;
END;
$$;

-- 6. ATOMIC BULK IMPORT RATE CARDS RPC — DETERMINISTIC ADVISORY LOCK & EXACT DUPLICATE REJECTION
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bulk_import_rate_cards(
    p_tenant_id UUID,
    p_cards JSONB,
    p_actor_id TEXT DEFAULT 'rate-engine',
    p_actor_type TEXT DEFAULT 'SYSTEM'
)
RETURNS TABLE (
    inserted_count INT,
    rate_card_ids UUID[]
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_card RECORD;
    v_lane RECORD;
    v_idx INT := 0;
    v_inserted_ids UUID[] := '{}';
    v_now TIMESTAMPTZ := clock_timestamp();
    v_conflict_count INT;
    v_new_id UUID;
BEGIN
    IF p_cards IS NULL OR jsonb_array_length(p_cards) = 0 THEN
        RAISE EXCEPTION 'Rate cards batch cannot be empty';
    END IF;

    -- 1. Validate complete batch structure and constraints
    FOR v_card IN SELECT * FROM jsonb_to_recordset(p_cards) AS (
        origin TEXT,
        destination TEXT,
        vehicle_type TEXT,
        weight_min_tons NUMERIC,
        weight_max_tons NUMERIC,
        price_inr NUMERIC,
        minimum_charge_inr NUMERIC,
        transit_time_hours INT,
        effective_from DATE,
        effective_to DATE,
        status TEXT,
        quote_type TEXT,
        supports_confirmed_quote BOOLEAN,
        source_version TEXT,
        surcharge_notes TEXT
    ) LOOP
        v_idx := v_idx + 1;
        IF v_card.origin IS NULL OR trim(v_card.origin) = '' THEN
            RAISE EXCEPTION 'Row %: origin is required', v_idx;
        END IF;
        IF v_card.destination IS NULL OR trim(v_card.destination) = '' THEN
            RAISE EXCEPTION 'Row %: destination is required', v_idx;
        END IF;
        IF v_card.vehicle_type IS NULL OR trim(v_card.vehicle_type) = '' THEN
            RAISE EXCEPTION 'Row %: vehicle_type is required', v_idx;
        END IF;
        IF v_card.price_inr IS NULL OR v_card.price_inr <= 0 THEN
            RAISE EXCEPTION 'Row %: price_inr must be positive', v_idx;
        END IF;
        IF v_card.weight_min_tons IS NULL OR v_card.weight_min_tons < 0 THEN
            RAISE EXCEPTION 'Row %: weight_min_tons must be non-negative', v_idx;
        END IF;
        IF v_card.weight_max_tons IS NULL OR v_card.weight_max_tons <= v_card.weight_min_tons THEN
            RAISE EXCEPTION 'Row %: weight_max_tons must be greater than weight_min_tons', v_idx;
        END IF;
        IF v_card.effective_from IS NULL THEN
            RAISE EXCEPTION 'Row %: effective_from date is required', v_idx;
        END IF;
        IF v_card.effective_to IS NOT NULL AND v_card.effective_to < v_card.effective_from THEN
            RAISE EXCEPTION 'Row %: effective_to cannot be earlier than effective_from', v_idx;
        END IF;
    END LOOP;

    -- 2. Check batch-internal overlap AND identical duplicates among ACTIVE cards [min, max)
    IF EXISTS (
        WITH indexed_cards AS (
            SELECT 
                (elem->>'origin') as origin,
                (elem->>'destination') as destination,
                (elem->>'vehicle_type') as vehicle_type,
                (elem->>'weight_min_tons')::numeric as weight_min_tons,
                (elem->>'weight_max_tons')::numeric as weight_max_tons,
                (elem->>'effective_from')::date as effective_from,
                (elem->>'effective_to')::date as effective_to,
                coalesce(elem->>'status', 'DRAFT') as status,
                ord
            FROM jsonb_array_elements(p_cards) WITH ORDINALITY AS t(elem, ord)
        )
        SELECT 1
        FROM indexed_cards a
        JOIN indexed_cards b ON (
            a.ord < b.ord AND
            lower(trim(a.origin)) = lower(trim(b.origin)) AND
            lower(trim(a.destination)) = lower(trim(b.destination)) AND
            lower(trim(a.vehicle_type)) = lower(trim(b.vehicle_type)) AND
            a.status = 'ACTIVE' AND
            b.status = 'ACTIVE' AND
            GREATEST(a.weight_min_tons, b.weight_min_tons) < LEAST(a.weight_max_tons, b.weight_max_tons) AND
            a.effective_from <= coalesce(b.effective_to, '9999-12-31'::date) AND
            b.effective_from <= coalesce(a.effective_to, '9999-12-31'::date)
        )
    ) THEN
        RAISE EXCEPTION 'Batch-internal overlap detected among active cards for the same corridor';
    END IF;

    -- 3. Acquire deterministic advisory transaction lock per (tenant, corridor lane)
    -- This guarantees mutual exclusion even when zero existing rows exist in public.rate_cards
    FOR v_lane IN 
        SELECT DISTINCT lower(trim(origin)) as origin, lower(trim(destination)) as destination, lower(trim(vehicle_type)) as vehicle_type
        FROM jsonb_to_recordset(p_cards) AS (origin TEXT, destination TEXT, vehicle_type TEXT)
    LOOP
        PERFORM pg_advisory_xact_lock(hashtext(p_tenant_id::text || ':' || v_lane.origin || ':' || v_lane.destination || ':' || v_lane.vehicle_type));
    END LOOP;

    -- Also row-lock any existing active rows in the target lanes
    PERFORM 1
    FROM public.rate_cards r
    WHERE r.tenant_id = p_tenant_id
      AND r.status = 'ACTIVE'
      AND (r.origin, r.destination, r.vehicle_type) IN (
          SELECT DISTINCT trim(origin), trim(destination), trim(vehicle_type)
          FROM jsonb_to_recordset(p_cards) AS (origin TEXT, destination TEXT, vehicle_type TEXT)
      )
    FOR UPDATE;

    -- 4. Check for active interval conflicts against existing rows in DB [min, max)
    FOR v_card IN SELECT * FROM jsonb_to_recordset(p_cards) AS (
        origin TEXT, destination TEXT, vehicle_type TEXT,
        weight_min_tons NUMERIC, weight_max_tons NUMERIC,
        effective_from DATE, effective_to DATE, status TEXT
    ) LOOP
        IF coalesce(v_card.status, 'DRAFT') = 'ACTIVE' THEN
            SELECT count(*) INTO v_conflict_count
            FROM public.rate_cards r
            WHERE r.tenant_id = p_tenant_id
              AND r.status = 'ACTIVE'
              AND lower(trim(r.origin)) = lower(trim(v_card.origin))
              AND lower(trim(r.destination)) = lower(trim(v_card.destination))
              AND lower(trim(r.vehicle_type)) = lower(trim(v_card.vehicle_type))
              AND GREATEST(r.weight_min_tons, v_card.weight_min_tons) < LEAST(r.weight_max_tons, v_card.weight_max_tons)
              AND r.effective_from <= coalesce(v_card.effective_to, '9999-12-31'::date)
              AND v_card.effective_from <= coalesce(r.effective_to, '9999-12-31'::date);

            IF v_conflict_count > 0 THEN
                RAISE EXCEPTION 'Active rate card conflict on lane % -> % (%) in weight interval [%, %)',
                    v_card.origin, v_card.destination, v_card.vehicle_type, v_card.weight_min_tons, v_card.weight_max_tons;
            END IF;
        END IF;
    END LOOP;

    -- 5. Insert all rows into public.rate_cards (Preserving NULL minimum_charge_inr)
    FOR v_card IN SELECT * FROM jsonb_to_recordset(p_cards) AS (
        origin TEXT,
        destination TEXT,
        vehicle_type TEXT,
        weight_min_tons NUMERIC,
        weight_max_tons NUMERIC,
        price_inr NUMERIC,
        minimum_charge_inr NUMERIC,
        transit_time_hours INT,
        effective_from DATE,
        effective_to DATE,
        status TEXT,
        quote_type TEXT,
        supports_confirmed_quote BOOLEAN,
        source_version TEXT,
        surcharge_notes TEXT
    ) LOOP
        v_new_id := gen_random_uuid();
        INSERT INTO public.rate_cards (
            id,
            tenant_id,
            origin,
            destination,
            vehicle_type,
            weight_min_tons,
            weight_max_tons,
            price_inr,
            minimum_charge_inr,
            transit_time_hours,
            effective_from,
            effective_to,
            status,
            quote_type,
            supports_confirmed_quote,
            source_version,
            surcharge_notes,
            created_at,
            updated_at
        ) VALUES (
            v_new_id,
            p_tenant_id,
            trim(v_card.origin),
            trim(v_card.destination),
            trim(v_card.vehicle_type),
            v_card.weight_min_tons,
            v_card.weight_max_tons,
            v_card.price_inr,
            v_card.minimum_charge_inr,
            v_card.transit_time_hours,
            v_card.effective_from,
            v_card.effective_to,
            coalesce(v_card.status, 'DRAFT'),
            coalesce(v_card.quote_type, 'ESTIMATE'),
            coalesce(v_card.supports_confirmed_quote, false),
            coalesce(v_card.source_version, 'v1.0-bulk-import'),
            v_card.surcharge_notes,
            v_now,
            v_now
        );
        v_inserted_ids := array_append(v_inserted_ids, v_new_id);
    END LOOP;

    -- 6. Write exactly ONE canonical audit event in this transaction
    INSERT INTO public.audit_events (
        tenant_id,
        event_type,
        actor_type,
        actor_id,
        severity,
        details,
        created_at
    ) VALUES (
        p_tenant_id,
        'RATE_BULK_IMPORTED',
        p_actor_type,
        p_actor_id,
        'INFO',
        jsonb_build_object(
            'imported_count', array_length(v_inserted_ids, 1),
            'rate_card_ids', v_inserted_ids,
            'source', 'DATABASE_TRANSACTION_RPC'
        ),
        v_now
    );

    RETURN QUERY SELECT array_length(v_inserted_ids, 1), v_inserted_ids;
END;
$$;
