-- =========================================================================
-- LOGIVOICE V1 — ATOMIC SIDE EFFECT CLAIMS & STRUCTURED TOOL EXECUTIONS
-- Migration: 20261003010000_atomic_side_effects_and_tool_executions.sql
-- 
-- 1. Adds claim_token to side_effect_claims for atomic worker ownership
-- 2. Creates atomic PostgreSQL claim, complete, and fail RPC functions with FOR UPDATE row-level locking
-- 3. Creates dedicated public.tool_executions store for verified operational facts
-- 4. Adds external_call_id to audit_events to decouple provider strings from relational UUIDs
-- =========================================================================

-- 1. SIDE_EFFECT_CLAIMS CLAIM TOKEN
-- -------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'side_effect_claims' AND column_name = 'claim_token'
    ) THEN
        ALTER TABLE public.side_effect_claims ADD COLUMN claim_token UUID DEFAULT gen_random_uuid();
    END IF;
END $$;

-- 2. AUDIT_EVENTS EXTERNAL CALL ID COLUMN
-- -------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'audit_events' AND column_name = 'external_call_id'
    ) THEN
        ALTER TABLE public.audit_events ADD COLUMN external_call_id TEXT;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_audit_events_ext_call ON public.audit_events (external_call_id) WHERE external_call_id IS NOT NULL;

-- 3. DEDICATED TOOL_EXECUTIONS TABLE
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tool_executions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    call_id UUID REFERENCES public.calls(id) ON DELETE CASCADE,
    external_call_id TEXT,
    tool_name TEXT NOT NULL,
    execution_status TEXT NOT NULL,
    success BOOLEAN NOT NULL DEFAULT true,
    safe_result JSONB,
    latency_ms INT,
    provider_reference TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tool_exec_call ON public.tool_executions (call_id, tool_name);
CREATE INDEX IF NOT EXISTS idx_tool_exec_ext_call ON public.tool_executions (external_call_id, tool_name);
CREATE INDEX IF NOT EXISTS idx_tool_exec_tenant_created ON public.tool_executions (tenant_id, created_at DESC);

-- Enable RLS on tool_executions
ALTER TABLE public.tool_executions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'tool_executions' AND policyname = 'tool_executions_tenant_isolation'
    ) THEN
        CREATE POLICY tool_executions_tenant_isolation ON public.tool_executions
            FOR ALL TO authenticated
            USING (tenant_id = (current_setting('app.current_tenant_id', true))::uuid)
            WITH CHECK (tenant_id = (current_setting('app.current_tenant_id', true))::uuid);
    END IF;
END $$;

-- 4. ATOMIC CLAIM RPC FUNCTION (CAS with FOR UPDATE row locking)
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_side_effect(
    p_tenant_id UUID,
    p_claim_key TEXT,
    p_job_type TEXT,
    p_call_id UUID,
    p_claimed_by TEXT,
    p_claim_token UUID,
    p_lease_duration_seconds INT DEFAULT 120,
    p_max_attempts INT DEFAULT 3
)
RETURNS TABLE (
    acquired BOOLEAN,
    claim_id UUID,
    tenant_id UUID,
    claim_key TEXT,
    job_type TEXT,
    call_id UUID,
    status TEXT,
    attempt_count INT,
    max_attempts INT,
    claimed_by TEXT,
    claim_token UUID,
    lease_expires_at TIMESTAMPTZ,
    result JSONB,
    last_error TEXT
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_row public.side_effect_claims%ROWTYPE;
    v_now TIMESTAMPTZ := clock_timestamp();
    v_lease_expiry TIMESTAMPTZ := v_now + (p_lease_duration_seconds || ' seconds')::interval;
BEGIN
    -- 1. Attempt fresh insert in state PROCESSING
    INSERT INTO public.side_effect_claims (
        tenant_id,
        claim_key,
        job_type,
        call_id,
        status,
        attempt_count,
        max_attempts,
        claimed_by,
        claim_token,
        claimed_at,
        lease_expires_at,
        created_at,
        updated_at
    )
    VALUES (
        p_tenant_id,
        p_claim_key,
        coalesce(p_job_type, 'GENERIC_SIDE_EFFECT'),
        p_call_id,
        'PROCESSING',
        1,
        p_max_attempts,
        p_claimed_by,
        p_claim_token,
        v_now,
        v_lease_expiry,
        v_now,
        v_now
    )
    ON CONFLICT (tenant_id, claim_key) DO NOTHING
    RETURNING * INTO v_row;

    -- If freshly inserted, this worker successfully acquired it!
    IF FOUND THEN
        RETURN QUERY SELECT 
            true,
            v_row.id,
            v_row.tenant_id,
            v_row.claim_key,
            v_row.job_type,
            v_row.call_id,
            v_row.status,
            v_row.attempt_count,
            v_row.max_attempts,
            v_row.claimed_by,
            v_row.claim_token,
            v_row.lease_expires_at,
            v_row.result,
            v_row.last_error;
        RETURN;
    END IF;

    -- 2. Row already exists: acquire exclusive row lock (FOR UPDATE)
    SELECT * INTO v_row
    FROM public.side_effect_claims
    WHERE public.side_effect_claims.tenant_id = p_tenant_id
      AND public.side_effect_claims.claim_key = p_claim_key
    FOR UPDATE;

    -- Terminal states: cannot be claimed
    IF v_row.status = 'SUCCEEDED' OR v_row.status = 'FAILED' THEN
        RETURN QUERY SELECT 
            false,
            v_row.id,
            v_row.tenant_id,
            v_row.claim_key,
            v_row.job_type,
            v_row.call_id,
            v_row.status,
            v_row.attempt_count,
            v_row.max_attempts,
            v_row.claimed_by,
            v_row.claim_token,
            v_row.lease_expires_at,
            v_row.result,
            v_row.last_error;
        RETURN;
    END IF;

    -- RETRYABLE check: check retry backoff and attempt count
    IF v_row.status = 'RETRYABLE' THEN
        IF v_row.next_retry_at IS NOT NULL AND v_row.next_retry_at > v_now THEN
            RETURN QUERY SELECT 
                false,
                v_row.id,
                v_row.tenant_id,
                v_row.claim_key,
                v_row.job_type,
                v_row.call_id,
                v_row.status,
                v_row.attempt_count,
                v_row.max_attempts,
                v_row.claimed_by,
                v_row.claim_token,
                v_row.lease_expires_at,
                v_row.result,
                v_row.last_error;
            RETURN;
        END IF;

        IF v_row.attempt_count >= v_row.max_attempts THEN
            UPDATE public.side_effect_claims
            SET status = 'FAILED', updated_at = v_now
            WHERE id = v_row.id;
            
            RETURN QUERY SELECT 
                false,
                v_row.id,
                v_row.tenant_id,
                v_row.claim_key,
                v_row.job_type,
                v_row.call_id,
                'FAILED'::text,
                v_row.attempt_count,
                v_row.max_attempts,
                v_row.claimed_by,
                v_row.claim_token,
                v_row.lease_expires_at,
                v_row.result,
                v_row.last_error;
            RETURN;
        END IF;
    END IF;

    -- PROCESSING check: only takeover if lease has expired
    IF v_row.status = 'PROCESSING' THEN
        IF v_row.lease_expires_at IS NOT NULL AND v_row.lease_expires_at > v_now THEN
            -- Lease is still active
            RETURN QUERY SELECT 
                false,
                v_row.id,
                v_row.tenant_id,
                v_row.claim_key,
                v_row.job_type,
                v_row.call_id,
                v_row.status,
                v_row.attempt_count,
                v_row.max_attempts,
                v_row.claimed_by,
                v_row.claim_token,
                v_row.lease_expires_at,
                v_row.result,
                v_row.last_error;
            RETURN;
        END IF;
    END IF;

    -- Eligible for takeover / execution: atomically update row holding the lock
    UPDATE public.side_effect_claims
    SET status = 'PROCESSING',
        attempt_count = v_row.attempt_count + 1,
        claimed_by = p_claimed_by,
        claim_token = p_claim_token,
        claimed_at = v_now,
        lease_expires_at = v_lease_expiry,
        updated_at = v_now
    WHERE id = v_row.id
    RETURNING * INTO v_row;

    RETURN QUERY SELECT 
        true,
        v_row.id,
        v_row.tenant_id,
        v_row.claim_key,
        v_row.job_type,
        v_row.call_id,
        v_row.status,
        v_row.attempt_count,
        v_row.max_attempts,
        v_row.claimed_by,
        v_row.claim_token,
        v_row.lease_expires_at,
        v_row.result,
        v_row.last_error;
END;
$$;

-- 5. ATOMIC COMPLETE RPC FUNCTION
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
    UPDATE public.side_effect_claims
    SET status = 'SUCCEEDED',
        completed_at = clock_timestamp(),
        result = p_result,
        updated_at = clock_timestamp()
    WHERE tenant_id = p_tenant_id
      AND claim_key = p_claim_key
      AND (p_claim_token IS NULL OR claim_token = p_claim_token)
      AND status = 'PROCESSING';

    GET DIAGNOSTICS v_updated = ROW_COUNT;
    RETURN v_updated > 0;
END;
$$;

-- 6. ATOMIC FAIL RPC FUNCTION
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
    UPDATE public.side_effect_claims
    SET status = v_status,
        last_error = p_error,
        next_retry_at = v_next_retry,
        updated_at = clock_timestamp()
    WHERE tenant_id = p_tenant_id
      AND claim_key = p_claim_key
      AND (p_claim_token IS NULL OR claim_token = p_claim_token)
      AND status = 'PROCESSING';

    GET DIAGNOSTICS v_updated = ROW_COUNT;
    RETURN v_updated > 0;
END;
$$;

-- 7. ATOMIC BULK IMPORT RATE CARDS RPC (with FOR UPDATE lane locking and single audit event)
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

    -- 2. Check batch-internal overlap among ACTIVE cards [min, max)
    IF EXISTS (
        SELECT 1
        FROM jsonb_to_recordset(p_cards) AS a(
            origin TEXT, destination TEXT, vehicle_type TEXT,
            weight_min_tons NUMERIC, weight_max_tons NUMERIC,
            effective_from DATE, effective_to DATE, status TEXT
        )
        JOIN jsonb_to_recordset(p_cards) AS b(
            origin TEXT, destination TEXT, vehicle_type TEXT,
            weight_min_tons NUMERIC, weight_max_tons NUMERIC,
            effective_from DATE, effective_to DATE, status TEXT
        ) ON (
            lower(trim(a.origin)) = lower(trim(b.origin)) AND
            lower(trim(a.destination)) = lower(trim(b.destination)) AND
            lower(trim(a.vehicle_type)) = lower(trim(b.vehicle_type)) AND
            coalesce(a.status, 'DRAFT') = 'ACTIVE' AND
            coalesce(b.status, 'DRAFT') = 'ACTIVE' AND
            GREATEST(a.weight_min_tons, b.weight_min_tons) < LEAST(a.weight_max_tons, b.weight_max_tons) AND
            a.effective_from <= coalesce(b.effective_to, '9999-12-31'::date) AND
            b.effective_from <= coalesce(a.effective_to, '9999-12-31'::date) AND
            (a.weight_min_tons != b.weight_min_tons OR a.weight_max_tons != b.weight_max_tons OR a.effective_from != b.effective_from)
        )
    ) THEN
        RAISE EXCEPTION 'Batch-internal overlap detected among active cards for the same corridor';
    END IF;

    -- 3. Lock relevant lane scopes in public.rate_cards (FOR UPDATE)
    PERFORM 1
    FROM public.rate_cards r
    WHERE r.tenant_id = p_tenant_id
      AND r.status = 'ACTIVE'
      AND EXISTS (
          SELECT 1 FROM jsonb_to_recordset(p_cards) AS c(origin TEXT, destination TEXT, vehicle_type TEXT)
          WHERE lower(trim(r.origin)) = lower(trim(c.origin))
            AND lower(trim(r.destination)) = lower(trim(c.destination))
            AND lower(trim(r.vehicle_type)) = lower(trim(c.vehicle_type))
      )
    FOR UPDATE;

    -- 4. Check conflict with existing ACTIVE cards in database
    FOR v_card IN SELECT * FROM jsonb_to_recordset(p_cards) AS (
        origin TEXT,
        destination TEXT,
        vehicle_type TEXT,
        weight_min_tons NUMERIC,
        weight_max_tons NUMERIC,
        effective_from DATE,
        effective_to DATE,
        status TEXT
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

    -- 5. Insert all rows into public.rate_cards
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
            coalesce(v_card.minimum_charge_inr, 0),
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
        coalesce(p_actor_type, 'SYSTEM'),
        coalesce(p_actor_id, 'rate-engine'),
        'INFO',
        jsonb_build_object(
            'imported_count', array_length(v_inserted_ids, 1),
            'source', 'BULK_IMPORT_TRANSACTION'
        ),
        v_now
    );

    RETURN QUERY SELECT array_length(v_inserted_ids, 1), v_inserted_ids;
END;
$$;

-- 8. EXPAND FOLLOWUP STATUS CONSTRAINT & ATOMIC GET-OR-CREATE / UPSERT FOLLOWUP RPC
-- -------------------------------------------------------------------------
ALTER TABLE public.followups DROP CONSTRAINT IF EXISTS followups_status_check;
ALTER TABLE public.followups ADD CONSTRAINT followups_status_check
  CHECK (status = ANY (ARRAY['PENDING'::text, 'SENT'::text, 'DELIVERED'::text, 'FAILED'::text, 'SUPPRESSED'::text, 'UNCONFIGURED'::text, 'MOCK'::text, 'COMPLETED'::text, 'SKIPPED'::text, 'SKIPPED_NOT_ELIGIBLE'::text, 'UNKNOWN'::text]));

CREATE OR REPLACE FUNCTION public.upsert_followup(
    p_tenant_id UUID,
    p_call_id UUID,
    p_channel TEXT,
    p_recipient TEXT,
    p_status TEXT,
    p_customer_id UUID DEFAULT NULL,
    p_template_id TEXT DEFAULT NULL,
    p_message_content TEXT DEFAULT NULL,
    p_provider_message_id TEXT DEFAULT NULL,
    p_sent_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE (
    followup_id UUID,
    status TEXT,
    was_created BOOLEAN
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_row public.followups%ROWTYPE;
BEGIN
    SELECT * INTO v_row
    FROM public.followups
    WHERE tenant_id = p_tenant_id AND call_id = p_call_id
    FOR UPDATE;

    IF FOUND THEN
        -- If already in a terminal success state, do not overwrite to pending
        IF v_row.status IN ('SENT', 'DELIVERED') AND p_status = 'PENDING' THEN
            RETURN QUERY SELECT v_row.id, v_row.status, false;
            RETURN;
        END IF;

        UPDATE public.followups
        SET channel = coalesce(p_channel, v_row.channel),
            recipient = coalesce(p_recipient, v_row.recipient),
            status = p_status,
            customer_id = coalesce(p_customer_id, v_row.customer_id),
            template_id = coalesce(p_template_id, v_row.template_id),
            message_content = coalesce(p_message_content, v_row.message_content),
            provider_message_id = coalesce(p_provider_message_id, v_row.provider_message_id),
            sent_at = coalesce(p_sent_at, v_row.sent_at),
            updated_at = clock_timestamp()
        WHERE id = v_row.id
        RETURNING * INTO v_row;

        RETURN QUERY SELECT v_row.id, v_row.status, false;
    ELSE
        INSERT INTO public.followups (
            tenant_id,
            call_id,
            customer_id,
            channel,
            status,
            recipient,
            template_id,
            message_content,
            provider_message_id,
            sent_at,
            created_at,
            updated_at
        ) VALUES (
            p_tenant_id,
            p_call_id,
            p_customer_id,
            p_channel,
            p_status,
            p_recipient,
            p_template_id,
            p_message_content,
            p_provider_message_id,
            p_sent_at,
            clock_timestamp(),
            clock_timestamp()
        )
        RETURNING * INTO v_row;

        RETURN QUERY SELECT v_row.id, v_row.status, true;
    END IF;
END;
$$;

