-- ==============================================================================
-- PPR NADI Migration: Shared Atomic Demo Rate Limiter
-- ==============================================================================
-- 1. Creates public.demo_rate_limits table for cross-instance rate tracking.
-- 2. Strictly secures table: public/anon/authenticated have zero read/write access.
--    Only service_role / postgres may manage rate limit records.
-- 3. Provides check_and_increment_demo_rate_limit() atomic function
--    using INSERT ... ON CONFLICT DO UPDATE RETURNING to guarantee race-free serialization.
-- 4. Automatically purges stale records (> 30 minutes old) on write.
-- ==============================================================================

-- 1. Create rate limits table
CREATE TABLE IF NOT EXISTS public.demo_rate_limits (
  client_hash TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL DEFAULT 1 CHECK (attempts >= 0),
  window_start TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.demo_rate_limits IS 'Shared atomic rate limiter storage for demo actions. Stores one-way hashed client identifiers only.';

-- 2. Index on updated_at for fast cleanup
CREATE INDEX IF NOT EXISTS idx_demo_rate_limits_updated_at ON public.demo_rate_limits (updated_at);

-- 3. Row Level Security & Strict Privilege Revocation
ALTER TABLE public.demo_rate_limits ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.demo_rate_limits FROM PUBLIC;
GRANT ALL ON TABLE public.demo_rate_limits TO postgres;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE public.demo_rate_limits FROM anon, authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT ALL ON TABLE public.demo_rate_limits TO service_role;
  END IF;
END $$;

-- 4. Atomic check and increment stored procedure
CREATE OR REPLACE FUNCTION public.check_and_increment_demo_rate_limit(
  p_client_hash TEXT,
  p_max_attempts INTEGER DEFAULT 5,
  p_window_seconds INTEGER DEFAULT 60
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_now TIMESTAMPTZ := clock_timestamp();
  v_window_interval INTERVAL := (p_window_seconds || ' seconds')::INTERVAL;
  v_attempts INTEGER;
  v_window_start TIMESTAMPTZ;
  v_allowed BOOLEAN;
  v_retry_after INTEGER := 0;
BEGIN
  -- Strict validation of client hash format (must be 8 to 128 characters)
  IF p_client_hash IS NULL OR length(p_client_hash) < 8 OR length(p_client_hash) > 128 THEN
    RAISE EXCEPTION 'Invalid client hash format' USING ERRCODE = '22023';
  END IF;

  -- Atomic UPSERT with row-level serialization on conflict
  INSERT INTO public.demo_rate_limits (client_hash, attempts, window_start, updated_at)
  VALUES (p_client_hash, 1, v_now, v_now)
  ON CONFLICT (client_hash) DO UPDATE
  SET
    attempts = CASE
      -- If previous window has elapsed, reset attempts to 1
      WHEN demo_rate_limits.window_start + v_window_interval <= v_now THEN 1
      -- Otherwise increment attempts
      ELSE demo_rate_limits.attempts + 1
    END,
    window_start = CASE
      -- If previous window has elapsed, reset window_start to current timestamp
      WHEN demo_rate_limits.window_start + v_window_interval <= v_now THEN v_now
      -- Otherwise keep original window start
      ELSE demo_rate_limits.window_start
    END,
    updated_at = v_now
  RETURNING demo_rate_limits.attempts, demo_rate_limits.window_start
  INTO v_attempts, v_window_start;

  -- Evaluate threshold
  IF v_attempts <= p_max_attempts THEN
    v_allowed := true;
    v_retry_after := 0;
  ELSE
    v_allowed := false;
    v_retry_after := GREATEST(1, EXTRACT(EPOCH FROM (v_window_start + v_window_interval - v_now))::INTEGER);
  END IF;

  -- Opportunistic cleanup of stale records older than 30 minutes
  DELETE FROM public.demo_rate_limits
  WHERE updated_at < v_now - INTERVAL '30 minutes';

  RETURN jsonb_build_object(
    'allowed', v_allowed,
    'attempts', v_attempts,
    'retry_after_seconds', v_retry_after,
    'reset_at', EXTRACT(EPOCH FROM (v_window_start + v_window_interval))::BIGINT
  );
END;
$$;

-- Secure function permissions: browser/anon/authenticated cannot execute directly
REVOKE ALL ON FUNCTION public.check_and_increment_demo_rate_limit(TEXT, INTEGER, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_and_increment_demo_rate_limit(TEXT, INTEGER, INTEGER) TO postgres;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION public.check_and_increment_demo_rate_limit(TEXT, INTEGER, INTEGER) FROM anon, authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.check_and_increment_demo_rate_limit(TEXT, INTEGER, INTEGER) TO service_role;
  END IF;
END $$;
