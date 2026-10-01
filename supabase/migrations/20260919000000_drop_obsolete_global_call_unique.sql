-- ====================================================================
-- LOGIVOICE V1 — FORWARD MIGRATION: DROP OBSOLETE GLOBAL CALL UNIQUE CONSTRAINT
-- Migration: 20260919000000_drop_obsolete_global_call_unique.sql
-- ====================================================================

-- Safely drop obsolete global UNIQUE(external_call_id) constraint if present,
-- preserving the tenant-scoped UNIQUE(tenant_id, external_call_id) constraint (uq_calls_tenant_external_id).
DO $$
BEGIN
    -- Check for default Postgres generated unique constraint on calls(external_call_id)
    IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.calls'::regclass
          AND contype = 'u'
          AND conname = 'calls_external_call_id_key'
    ) THEN
        ALTER TABLE public.calls DROP CONSTRAINT calls_external_call_id_key;
    END IF;
END $$;
