-- =========================================================================
-- LOGIVOICE V1 — SIDE-EFFECT CLAIMS & TRANSCRIPT RUNTIME INTEGRITY ALIGNMENT
-- Migration: 20261003000000_side_effect_claims_and_transcript_alignment.sql
-- 
-- 1. Hardens public.side_effect_claims schema to unify TypeScript & SQL models:
--    - Adds call_id (UUID), lease_expires_at (TIMESTAMPTZ), next_retry_at (TIMESTAMPTZ), max_attempts (INT)
--    - Synchronizes job_type and last_error columns
--    - Enforces canonical statuses ('PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'RETRYABLE', 'UNKNOWN')
-- 2. Hardens public.transcript_segments schema:
--    - Adds segment_key TEXT column
--    - Establishes unique constraint uq_transcript_segments_call_key on (call_id, segment_key)
--    - Ensures valid UUID primary keys without truncating SHA256 hex strings into malformed UUIDs
-- =========================================================================

-- 1. SIDE_EFFECT_CLAIMS COLUMN & CONSTRAINT ALIGNMENT
-- -------------------------------------------------------------------------
DO $$
BEGIN
    -- Add call_id if not present
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'side_effect_claims' AND column_name = 'call_id'
    ) THEN
        ALTER TABLE public.side_effect_claims ADD COLUMN call_id UUID REFERENCES public.calls(id) ON DELETE SET NULL;
    END IF;

    -- Add lease_expires_at if not present
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'side_effect_claims' AND column_name = 'lease_expires_at'
    ) THEN
        ALTER TABLE public.side_effect_claims ADD COLUMN lease_expires_at TIMESTAMPTZ;
    END IF;

    -- Add next_retry_at if not present
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'side_effect_claims' AND column_name = 'next_retry_at'
    ) THEN
        ALTER TABLE public.side_effect_claims ADD COLUMN next_retry_at TIMESTAMPTZ;
    END IF;

    -- Add max_attempts if not present
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'side_effect_claims' AND column_name = 'max_attempts'
    ) THEN
        ALTER TABLE public.side_effect_claims ADD COLUMN max_attempts INT NOT NULL DEFAULT 3;
    END IF;

    -- Add last_error if not present (mirroring error)
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'side_effect_claims' AND column_name = 'last_error'
    ) THEN
        ALTER TABLE public.side_effect_claims ADD COLUMN last_error TEXT;
    END IF;

    -- Ensure job_type default exists
    ALTER TABLE public.side_effect_claims ALTER COLUMN job_type SET DEFAULT 'GENERIC_SIDE_EFFECT';

    -- Migrate legacy status values if any
    UPDATE public.side_effect_claims SET status = 'SUCCEEDED' WHERE status = 'COMPLETED';
    UPDATE public.side_effect_claims SET status = 'FAILED' WHERE status = 'REJECTED';

    -- Re-enforce canonical status check constraint
    ALTER TABLE public.side_effect_claims DROP CONSTRAINT IF EXISTS side_effect_claims_status_check;
    ALTER TABLE public.side_effect_claims ADD CONSTRAINT side_effect_claims_status_check 
        CHECK (status IN ('PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'RETRYABLE', 'UNKNOWN'));
END $$;

-- Indexes for side_effect_claims
CREATE INDEX IF NOT EXISTS idx_claims_tenant_job ON public.side_effect_claims (tenant_id, job_type);
CREATE INDEX IF NOT EXISTS idx_claims_status_retry ON public.side_effect_claims (status, next_retry_at);
CREATE INDEX IF NOT EXISTS idx_claims_call_id ON public.side_effect_claims (call_id) WHERE call_id IS NOT NULL;

-- 2. TRANSCRIPT_SEGMENTS DETERMINISTIC IDENTITY ALIGNMENT
-- -------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'transcript_segments' AND column_name = 'segment_key'
    ) THEN
        ALTER TABLE public.transcript_segments ADD COLUMN segment_key TEXT;
    END IF;

    -- Backfill segment_key for legacy rows if any
    UPDATE public.transcript_segments 
    SET segment_key = md5(call_id::text || ':' || coalesce(timestamp::text, '0') || ':' || speaker || ':' || text)
    WHERE segment_key IS NULL;
END $$;

-- Enforce unique constraint for transcript deduplication
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'uq_transcript_segments_call_key'
    ) THEN
        ALTER TABLE public.transcript_segments 
            ADD CONSTRAINT uq_transcript_segments_call_key UNIQUE (call_id, segment_key);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_transcript_call_key ON public.transcript_segments (call_id, segment_key);

-- 3. AUDIT_EVENTS ACTOR ROLES ALIGNMENT
-- -------------------------------------------------------------------------
DO $$
BEGIN
    ALTER TABLE public.audit_events DROP CONSTRAINT IF EXISTS audit_events_actor_type_check;
    ALTER TABLE public.audit_events ADD CONSTRAINT audit_events_actor_type_check
        CHECK (actor_type IN ('AI_AGENT', 'DISPATCHER', 'OPS_MANAGER', 'ADMIN', 'SYSTEM', 'WEBHOOK', 'USER'));
END $$;
