-- P3C-C3: server-authoritative runtime emergency stop (default deny, one-way stop only)

CREATE TABLE public.launch_chain_production_execution_controls (
  control_key text PRIMARY KEY
    CONSTRAINT launch_chain_production_execution_controls_key_fixed
    CHECK (control_key = 'ROBINHOOD_MAINNET_DEPLOYMENT'),
  execution_enabled boolean NOT NULL DEFAULT false,
  emergency_stop_engaged boolean NOT NULL DEFAULT true,
  revision bigint NOT NULL DEFAULT 1
    CONSTRAINT launch_chain_production_execution_controls_revision_positive
    CHECK (revision >= 1),
  reason text NOT NULL
    CONSTRAINT launch_chain_production_execution_controls_reason_bounded
    CHECK (char_length(btrim(reason)) BETWEEN 1 AND 2000),
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);

REVOKE ALL ON TABLE public.launch_chain_production_execution_controls FROM PUBLIC;
REVOKE ALL ON TABLE public.launch_chain_production_execution_controls FROM anon;
REVOKE ALL ON TABLE public.launch_chain_production_execution_controls FROM authenticated;
REVOKE ALL ON TABLE public.launch_chain_production_execution_controls FROM service_role;

ALTER TABLE public.launch_chain_production_execution_controls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.launch_chain_production_execution_controls FORCE ROW LEVEL SECURITY;

CREATE TABLE public.launch_chain_production_execution_control_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  revision bigint NOT NULL UNIQUE
    CONSTRAINT launch_chain_production_execution_control_events_revision_positive
    CHECK (revision >= 1),
  previous_execution_enabled boolean,
  new_execution_enabled boolean NOT NULL,
  previous_emergency_stop_engaged boolean,
  new_emergency_stop_engaged boolean NOT NULL,
  reason text NOT NULL
    CONSTRAINT launch_chain_production_execution_control_events_reason_bounded
    CHECK (char_length(btrim(reason)) BETWEEN 1 AND 2000),
  changed_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

REVOKE ALL ON TABLE public.launch_chain_production_execution_control_events FROM PUBLIC;
REVOKE ALL ON TABLE public.launch_chain_production_execution_control_events FROM anon;
REVOKE ALL ON TABLE public.launch_chain_production_execution_control_events FROM authenticated;
REVOKE ALL ON TABLE public.launch_chain_production_execution_control_events FROM service_role;

ALTER TABLE public.launch_chain_production_execution_control_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.launch_chain_production_execution_control_events FORCE ROW LEVEL SECURITY;

-- Append-only enforcement: history can never be rewritten or erased.
CREATE OR REPLACE FUNCTION public.reject_launch_chain_production_control_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  RAISE EXCEPTION 'Production execution control history is append-only' USING ERRCODE = '42501';
END;
$function$;

REVOKE ALL ON FUNCTION public.reject_launch_chain_production_control_event_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reject_launch_chain_production_control_event_mutation() FROM anon;
REVOKE ALL ON FUNCTION public.reject_launch_chain_production_control_event_mutation() FROM authenticated;
REVOKE ALL ON FUNCTION public.reject_launch_chain_production_control_event_mutation() FROM service_role;

CREATE TRIGGER launch_chain_production_control_events_append_only
BEFORE UPDATE OR DELETE ON public.launch_chain_production_execution_control_events
FOR EACH ROW EXECUTE FUNCTION public.reject_launch_chain_production_control_event_mutation();

-- Bootstrap: default OFF + emergency stop already engaged, with matching history.
INSERT INTO public.launch_chain_production_execution_controls
  (control_key, execution_enabled, emergency_stop_engaged, revision, reason, updated_by, updated_at)
VALUES
  ('ROBINHOOD_MAINNET_DEPLOYMENT', false, true, 1, 'INITIAL_DEFAULT_OFF', NULL, now());

INSERT INTO public.launch_chain_production_execution_control_events
  (revision, previous_execution_enabled, new_execution_enabled,
   previous_emergency_stop_engaged, new_emergency_stop_engaged, reason, changed_by)
VALUES
  (1, NULL, false, NULL, true, 'INITIAL_DEFAULT_OFF', NULL);

-- Read path: service role only, fails closed when state is missing or ambiguous.
CREATE OR REPLACE FUNCTION public.get_launch_chain_production_execution_state()
RETURNS TABLE (
  control_key text,
  execution_enabled boolean,
  emergency_stop_engaged boolean,
  revision bigint,
  reason text,
  updated_by uuid,
  updated_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_count integer;
  c public.launch_chain_production_execution_controls%ROWTYPE;
BEGIN
  SELECT count(*) INTO v_count FROM public.launch_chain_production_execution_controls;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Production execution control state is invalid' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO c
    FROM public.launch_chain_production_execution_controls
   WHERE launch_chain_production_execution_controls.control_key = 'ROBINHOOD_MAINNET_DEPLOYMENT';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Production execution control state is missing' USING ERRCODE = '22023';
  END IF;

  control_key := c.control_key;
  execution_enabled := c.execution_enabled;
  emergency_stop_engaged := c.emergency_stop_engaged;
  revision := c.revision;
  reason := c.reason;
  updated_by := c.updated_by;
  updated_at := c.updated_at;
  RETURN NEXT;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_launch_chain_production_execution_state() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_launch_chain_production_execution_state() FROM anon;
REVOKE ALL ON FUNCTION public.get_launch_chain_production_execution_state() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_launch_chain_production_execution_state() TO service_role;

-- One-way emergency stop. Can only move stop false -> true.
-- It can never clear the stop and never touches execution_enabled.
CREATE OR REPLACE FUNCTION public.engage_launch_chain_production_emergency_stop(
  _operator_user_id uuid,
  _reason text
)
RETURNS TABLE (
  control_key text,
  execution_enabled boolean,
  emergency_stop_engaged boolean,
  revision bigint,
  reason text,
  updated_by uuid,
  updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  c public.launch_chain_production_execution_controls%ROWTYPE;
  v_reason text := btrim(coalesce(_reason, ''));
BEGIN
  IF _operator_user_id IS NULL OR NOT public.is_platform_owner(_operator_user_id) THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;
  IF char_length(v_reason) < 8 OR char_length(v_reason) > 2000 THEN
    RAISE EXCEPTION 'Invalid emergency stop reason' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO c
    FROM public.launch_chain_production_execution_controls
   WHERE launch_chain_production_execution_controls.control_key = 'ROBINHOOD_MAINNET_DEPLOYMENT'
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Production execution control state is missing' USING ERRCODE = '22023';
  END IF;

  IF c.emergency_stop_engaged THEN
    -- Already stopped: idempotent, no revision bump, no new history entry.
    control_key := c.control_key;
    execution_enabled := c.execution_enabled;
    emergency_stop_engaged := c.emergency_stop_engaged;
    revision := c.revision;
    reason := c.reason;
    updated_by := c.updated_by;
    updated_at := c.updated_at;
    RETURN NEXT;
    RETURN;
  END IF;

  UPDATE public.launch_chain_production_execution_controls AS t
     SET emergency_stop_engaged = true,
         revision = t.revision + 1,
         reason = v_reason,
         updated_by = _operator_user_id,
         updated_at = now()
   WHERE t.control_key = 'ROBINHOOD_MAINNET_DEPLOYMENT'
     AND t.emergency_stop_engaged = false
  RETURNING * INTO c;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.launch_chain_production_execution_control_events
    (revision, previous_execution_enabled, new_execution_enabled,
     previous_emergency_stop_engaged, new_emergency_stop_engaged, reason, changed_by)
  VALUES
    (c.revision, c.execution_enabled, c.execution_enabled, false, true, v_reason, _operator_user_id);

  control_key := c.control_key;
  execution_enabled := c.execution_enabled;
  emergency_stop_engaged := c.emergency_stop_engaged;
  revision := c.revision;
  reason := c.reason;
  updated_by := c.updated_by;
  updated_at := c.updated_at;
  RETURN NEXT;
END;
$function$;

REVOKE ALL ON FUNCTION public.engage_launch_chain_production_emergency_stop(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.engage_launch_chain_production_emergency_stop(uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.engage_launch_chain_production_emergency_stop(uuid, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.engage_launch_chain_production_emergency_stop(uuid, text) TO service_role;