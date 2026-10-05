-- LOGIVOICE V1 — MIGRATION 20261005000000_rate_cards_atomic_concurrency.sql
-- Enforces deterministic advisory lane locks for manual rate card creation and updates

CREATE OR REPLACE FUNCTION public.create_rate_card_atomic(
    p_tenant_id UUID,
    p_card JSONB
)
RETURNS SETOF public.rate_cards
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_origin TEXT := lower(trim(p_card->>'origin'));
    v_destination TEXT := lower(trim(p_card->>'destination'));
    v_vehicle_type TEXT := lower(trim(p_card->>'vehicle_type'));
    v_weight_min NUMERIC := (p_card->>'weight_min_tons')::NUMERIC;
    v_weight_max NUMERIC := (p_card->>'weight_max_tons')::NUMERIC;
    v_eff_from DATE := (p_card->>'effective_from')::DATE;
    v_eff_to DATE := (p_card->>'effective_to')::DATE;
    v_status TEXT := coalesce(p_card->>'status', 'DRAFT');
    v_conflict_count INT;
    v_inserted public.rate_cards;
BEGIN
    IF v_weight_max <= v_weight_min THEN
        RAISE EXCEPTION 'Invalid rate interval: weight_max_tons must be strictly greater than weight_min_tons.';
    END IF;

    -- 1. Acquire deterministic advisory transaction lock per (tenant, corridor lane)
    PERFORM pg_advisory_xact_lock(hashtext(p_tenant_id::text || ':' || v_origin || ':' || v_destination || ':' || v_vehicle_type));

    -- 2. If creating an ACTIVE card, check for overlapping ACTIVE cards [min, max)
    IF v_status = 'ACTIVE' THEN
        SELECT count(*) INTO v_conflict_count
        FROM public.rate_cards r
        WHERE r.tenant_id = p_tenant_id
          AND r.status = 'ACTIVE'
          AND lower(trim(r.origin)) = v_origin
          AND lower(trim(r.destination)) = v_destination
          AND lower(trim(r.vehicle_type)) = v_vehicle_type
          AND GREATEST(r.weight_min_tons, v_weight_min) < LEAST(r.weight_max_tons, v_weight_max)
          AND r.effective_from <= coalesce(v_eff_to, '9999-12-31'::date)
          AND coalesce(v_eff_from, '1970-01-01'::date) <= coalesce(r.effective_to, '9999-12-31'::date);

        IF v_conflict_count > 0 THEN
            RAISE EXCEPTION 'Conflict: An overlapping ACTIVE rate card already exists for lane %->% (%).',
                p_card->>'origin', p_card->>'destination', p_card->>'vehicle_type';
        END IF;
    END IF;

    -- 3. Insert card preserving nulls
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
        surcharge_notes
    ) VALUES (
        coalesce((p_card->>'id')::UUID, gen_random_uuid()),
        p_tenant_id,
        trim(p_card->>'origin'),
        trim(p_card->>'destination'),
        trim(p_card->>'vehicle_type'),
        v_weight_min,
        v_weight_max,
        (p_card->>'price_inr')::NUMERIC,
        (p_card->>'minimum_charge_inr')::NUMERIC,
        (p_card->>'transit_time_hours')::INT,
        v_eff_from,
        v_eff_to,
        v_status,
        coalesce(p_card->>'quote_type', 'ESTIMATE'),
        coalesce((p_card->>'supports_confirmed_quote')::BOOLEAN, false),
        coalesce(p_card->>'source_version', 'v1.0'),
        p_card->>'surcharge_notes'
    ) RETURNING * INTO v_inserted;

    RETURN NEXT v_inserted;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_rate_card_atomic(
    p_tenant_id UUID,
    p_id UUID,
    p_updates JSONB
)
RETURNS SETOF public.rate_cards
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_existing public.rate_cards;
    v_origin TEXT;
    v_destination TEXT;
    v_vehicle_type TEXT;
    v_weight_min NUMERIC;
    v_weight_max NUMERIC;
    v_eff_from DATE;
    v_eff_to DATE;
    v_status TEXT;
    v_conflict_count INT;
    v_updated public.rate_cards;
BEGIN
    SELECT * INTO v_existing
    FROM public.rate_cards
    WHERE id = p_id AND tenant_id = p_tenant_id;

    IF NOT FOUND THEN
        RETURN;
    END IF;

    v_origin := lower(trim(coalesce(p_updates->>'origin', v_existing.origin)));
    v_destination := lower(trim(coalesce(p_updates->>'destination', v_existing.destination)));
    v_vehicle_type := lower(trim(coalesce(p_updates->>'vehicle_type', v_existing.vehicle_type)));
    v_weight_min := coalesce((p_updates->>'weight_min_tons')::NUMERIC, v_existing.weight_min_tons);
    v_weight_max := coalesce((p_updates->>'weight_max_tons')::NUMERIC, v_existing.weight_max_tons);
    v_eff_from := CASE WHEN p_updates ? 'effective_from' THEN (p_updates->>'effective_from')::DATE ELSE v_existing.effective_from END;
    v_eff_to := CASE WHEN p_updates ? 'effective_to' THEN (p_updates->>'effective_to')::DATE ELSE v_existing.effective_to END;
    v_status := coalesce(p_updates->>'status', v_existing.status);

    IF v_weight_max <= v_weight_min THEN
        RAISE EXCEPTION 'Invalid rate interval: weight_max_tons must be strictly greater than weight_min_tons.';
    END IF;

    -- 1. Acquire deterministic advisory transaction lock per lane
    PERFORM pg_advisory_xact_lock(hashtext(p_tenant_id::text || ':' || v_origin || ':' || v_destination || ':' || v_vehicle_type));

    -- 2. If target status is ACTIVE, check for conflicting cards [min, max)
    IF v_status = 'ACTIVE' THEN
        SELECT count(*) INTO v_conflict_count
        FROM public.rate_cards r
        WHERE r.tenant_id = p_tenant_id
          AND r.id <> p_id
          AND r.status = 'ACTIVE'
          AND lower(trim(r.origin)) = v_origin
          AND lower(trim(r.destination)) = v_destination
          AND lower(trim(r.vehicle_type)) = v_vehicle_type
          AND GREATEST(r.weight_min_tons, v_weight_min) < LEAST(r.weight_max_tons, v_weight_max)
          AND r.effective_from <= coalesce(v_eff_to, '9999-12-31'::date)
          AND coalesce(v_eff_from, '1970-01-01'::date) <= coalesce(r.effective_to, '9999-12-31'::date);

        IF v_conflict_count > 0 THEN
            RAISE EXCEPTION 'Conflict: An overlapping ACTIVE rate card already exists for lane %->% (%).',
                v_existing.origin, v_existing.destination, v_existing.vehicle_type;
        END IF;
    END IF;

    -- 3. Update the record
    UPDATE public.rate_cards
    SET
        origin = CASE WHEN p_updates ? 'origin' THEN trim(p_updates->>'origin') ELSE origin END,
        destination = CASE WHEN p_updates ? 'destination' THEN trim(p_updates->>'destination') ELSE destination END,
        vehicle_type = CASE WHEN p_updates ? 'vehicle_type' THEN trim(p_updates->>'vehicle_type') ELSE vehicle_type END,
        weight_min_tons = v_weight_min,
        weight_max_tons = v_weight_max,
        price_inr = CASE WHEN p_updates ? 'price_inr' THEN (p_updates->>'price_inr')::NUMERIC ELSE price_inr END,
        minimum_charge_inr = CASE WHEN p_updates ? 'minimum_charge_inr' THEN (p_updates->>'minimum_charge_inr')::NUMERIC ELSE minimum_charge_inr END,
        transit_time_hours = CASE WHEN p_updates ? 'transit_time_hours' THEN (p_updates->>'transit_time_hours')::INT ELSE transit_time_hours END,
        effective_from = v_eff_from,
        effective_to = v_eff_to,
        status = v_status,
        quote_type = CASE WHEN p_updates ? 'quote_type' THEN p_updates->>'quote_type' ELSE quote_type END,
        supports_confirmed_quote = CASE WHEN p_updates ? 'supports_confirmed_quote' THEN (p_updates->>'supports_confirmed_quote')::BOOLEAN ELSE supports_confirmed_quote END,
        surcharge_notes = CASE WHEN p_updates ? 'surcharge_notes' THEN p_updates->>'surcharge_notes' ELSE surcharge_notes END,
        updated_at = NOW()
    WHERE id = p_id AND tenant_id = p_tenant_id
    RETURNING * INTO v_updated;

    RETURN NEXT v_updated;
END;
$$;
