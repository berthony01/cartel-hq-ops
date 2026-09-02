CREATE TABLE public.launch_schedule_communications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  launch_id uuid NOT NULL REFERENCES public.launches(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING','SENT','DISMISSED','REVERTED')),
  baseline_launch_at timestamptz,
  baseline_window_start timestamptz,
  baseline_window_end timestamptz,
  baseline_timezone text NOT NULL,
  current_launch_at timestamptz,
  current_window_start timestamptz,
  current_window_end timestamptz,
  current_timezone text NOT NULL,
  change_count integer NOT NULL DEFAULT 1 CHECK (change_count >= 1),
  detected_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  detected_at timestamptz NOT NULL DEFAULT now(),
  resolved_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT launch_schedule_communications_resolution_shape
    CHECK ((status = 'PENDING') = (resolved_at IS NULL))
);

GRANT SELECT ON public.launch_schedule_communications TO authenticated;
GRANT ALL ON public.launch_schedule_communications TO service_role;

ALTER TABLE public.launch_schedule_communications ENABLE ROW LEVEL SECURITY;

CREATE POLICY launch_schedule_communications_select_member
  ON public.launch_schedule_communications
  FOR SELECT TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()));

CREATE UNIQUE INDEX launch_schedule_communications_one_pending_idx
  ON public.launch_schedule_communications (launch_id)
  WHERE status = 'PENDING';

CREATE INDEX launch_schedule_communications_launch_created_idx
  ON public.launch_schedule_communications (launch_id, created_at DESC);

CREATE TRIGGER launch_schedule_communications_set_updated_at
  BEFORE UPDATE ON public.launch_schedule_communications
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.record_launch_schedule_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_pending public.launch_schedule_communications%ROWTYPE;
  v_actor uuid := auth.uid();
  v_inserted integer;
  v_attempt integer := 0;
BEGIN
  -- Assigning the same values must not create history.
  IF (NEW.launch_at, NEW.launch_window_start, NEW.launch_window_end, NEW.timezone)
     IS NOT DISTINCT FROM
     (OLD.launch_at, OLD.launch_window_start, OLD.launch_window_end, OLD.timezone)
  THEN
    RETURN NULL;
  END IF;

  LOOP
    v_attempt := v_attempt + 1;

    SELECT * INTO v_pending
      FROM public.launch_schedule_communications
     WHERE launch_id = NEW.id
       AND status = 'PENDING'
     FOR UPDATE;

    IF FOUND THEN
      IF (NEW.launch_at, NEW.launch_window_start, NEW.launch_window_end, NEW.timezone)
         IS NOT DISTINCT FROM
         (v_pending.baseline_launch_at, v_pending.baseline_window_start,
          v_pending.baseline_window_end, v_pending.baseline_timezone)
      THEN
        -- Full revert across all four fields resolves the pending decision.
        UPDATE public.launch_schedule_communications
           SET current_launch_at   = NEW.launch_at,
               current_window_start = NEW.launch_window_start,
               current_window_end   = NEW.launch_window_end,
               current_timezone     = NEW.timezone,
               change_count         = change_count + 1,
               status               = 'REVERTED',
               resolved_at          = now(),
               resolved_by          = v_actor
         WHERE id = v_pending.id;
      ELSE
        UPDATE public.launch_schedule_communications
           SET current_launch_at   = NEW.launch_at,
               current_window_start = NEW.launch_window_start,
               current_window_end   = NEW.launch_window_end,
               current_timezone     = NEW.timezone,
               change_count         = change_count + 1
         WHERE id = v_pending.id;
      END IF;

      RETURN NULL;
    END IF;

    INSERT INTO public.launch_schedule_communications (
      launch_id, workspace_id, status,
      baseline_launch_at, baseline_window_start, baseline_window_end, baseline_timezone,
      current_launch_at, current_window_start, current_window_end, current_timezone,
      change_count, detected_by, detected_at
    ) VALUES (
      NEW.id, NEW.workspace_id, 'PENDING',
      OLD.launch_at, OLD.launch_window_start, OLD.launch_window_end, OLD.timezone,
      NEW.launch_at, NEW.launch_window_start, NEW.launch_window_end, NEW.timezone,
      1, v_actor, now()
    )
    ON CONFLICT (launch_id) WHERE status = 'PENDING' DO NOTHING;

    GET DIAGNOSTICS v_inserted = ROW_COUNT;
    IF v_inserted > 0 OR v_attempt >= 2 THEN
      RETURN NULL;
    END IF;
    -- Lost an insert race: loop once to update the winner's pending row.
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.record_launch_schedule_change() FROM PUBLIC;

CREATE TRIGGER launches_record_schedule_change
  AFTER UPDATE OF launch_at, launch_window_start, launch_window_end, timezone
  ON public.launches
  FOR EACH ROW EXECUTE FUNCTION public.record_launch_schedule_change();

CREATE OR REPLACE FUNCTION public.dismiss_launch_schedule_communication(_id uuid)
RETURNS public.launch_schedule_communications
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_row public.launch_schedule_communications%ROWTYPE;
  v_actor uuid := auth.uid();
BEGIN
  SELECT * INTO v_row
    FROM public.launch_schedule_communications
   WHERE id = _id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Schedule communication not found.' USING ERRCODE = 'P0002';
  END IF;

  IF v_actor IS NULL OR NOT public.is_workspace_operator(v_row.workspace_id, v_actor) THEN
    RAISE EXCEPTION 'Not authorized to dismiss this schedule communication.'
      USING ERRCODE = '42501';
  END IF;

  IF v_row.status <> 'PENDING' THEN
    RAISE EXCEPTION 'Schedule communication is already resolved (%).', v_row.status
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.launch_schedule_communications
     SET status      = 'DISMISSED',
         resolved_at = now(),
         resolved_by = v_actor
   WHERE id = v_row.id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.dismiss_launch_schedule_communication(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.dismiss_launch_schedule_communication(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dismiss_launch_schedule_communication(uuid) TO service_role;