CREATE TABLE public.pcart_policy_approval_revocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  launch_id uuid NOT NULL REFERENCES public.launches(id) ON DELETE RESTRICT,
  review_kind text NOT NULL CHECK (review_kind IN ('P8A','P8B')),
  review_id uuid NOT NULL,
  reason text NOT NULL CHECK (length(reason) BETWEEN 3 AND 500),
  revoked_by uuid NOT NULL,
  revoked_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (review_kind, review_id)
);
GRANT SELECT ON public.pcart_policy_approval_revocations TO authenticated;
GRANT ALL ON public.pcart_policy_approval_revocations TO service_role;
ALTER TABLE public.pcart_policy_approval_revocations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Platform owner reads policy revocations" ON public.pcart_policy_approval_revocations
  FOR SELECT TO authenticated USING (public.is_platform_owner(auth.uid()));

CREATE TABLE public.pcart_launch_day_plans (
  launch_id uuid PRIMARY KEY REFERENCES public.launches(id) ON DELETE RESTRICT,
  promotion_start_at timestamptz,
  intended_auction_start_at timestamptz,
  estimated_start_block bigint CHECK (estimated_start_block IS NULL OR estimated_start_block > 0),
  authoritative_start_block bigint CHECK (authoritative_start_block IS NULL OR authoritative_start_block > 0),
  end_block bigint CHECK (end_block IS NULL OR end_block > 0),
  observed_ms_per_block numeric CHECK (observed_ms_per_block IS NULL OR observed_ms_per_block > 0),
  cadence_observed_at timestamptz,
  auto_start boolean NOT NULL DEFAULT false CHECK (auto_start = false),
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.pcart_launch_day_plans TO authenticated;
GRANT ALL ON public.pcart_launch_day_plans TO service_role;
ALTER TABLE public.pcart_launch_day_plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Platform owner reads launch day plans" ON public.pcart_launch_day_plans
  FOR SELECT TO authenticated USING (public.is_platform_owner(auth.uid()));

CREATE OR REPLACE FUNCTION private.pcart_launch_day_plan_validate()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.promotion_start_at IS NOT NULL AND NEW.intended_auction_start_at IS NOT NULL
     AND NEW.intended_auction_start_at < NEW.promotion_start_at + interval '21 days' THEN
    RAISE EXCEPTION 'PCART_P9: auction start must be at least 21 days after promotion start.' USING errcode = '22023';
  END IF;
  IF NEW.authoritative_start_block IS NOT NULL AND NEW.end_block IS NOT NULL
     AND NEW.end_block <> NEW.authoritative_start_block + 5885000 THEN
    RAISE EXCEPTION 'PCART_P9: end block must equal start block + 5,885,000.' USING errcode = '22023';
  END IF;
  NEW.auto_start := false;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER pcart_launch_day_plan_validate BEFORE INSERT OR UPDATE ON public.pcart_launch_day_plans
  FOR EACH ROW EXECUTE FUNCTION private.pcart_launch_day_plan_validate();

CREATE TABLE public.pcart_launch_coordinator_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  launch_id uuid NOT NULL REFERENCES public.launches(id) ON DELETE RESTRICT,
  event_kind text NOT NULL CHECK (event_kind IN ('PLAN_UPDATED','POLICY_APPROVAL_REVOKED','STATE_OBSERVED')),
  coordinator_state text,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX pcart_launch_coordinator_events_launch_idx ON public.pcart_launch_coordinator_events (launch_id, created_at DESC);
GRANT SELECT ON public.pcart_launch_coordinator_events TO authenticated;
GRANT ALL ON public.pcart_launch_coordinator_events TO service_role;
ALTER TABLE public.pcart_launch_coordinator_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Platform owner reads coordinator events" ON public.pcart_launch_coordinator_events
  FOR SELECT TO authenticated USING (public.is_platform_owner(auth.uid()));

CREATE OR REPLACE FUNCTION private.pcart_p9_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'PCART_P9: append-only record.' USING errcode = '42501';
END $$;
CREATE TRIGGER pcart_p9_events_append_only BEFORE UPDATE OR DELETE ON public.pcart_launch_coordinator_events
  FOR EACH ROW EXECUTE FUNCTION private.pcart_p9_append_only();
CREATE TRIGGER pcart_p9_revocations_append_only BEFORE UPDATE OR DELETE ON public.pcart_policy_approval_revocations
  FOR EACH ROW EXECUTE FUNCTION private.pcart_p9_append_only();

-- Planning record only. Never mutates launches, deployments, controls, contracts or notifications.
CREATE OR REPLACE FUNCTION public.set_canonical_pcart_launch_day_plan(
  _launch_id uuid, _promotion_start_at timestamptz, _intended_auction_start_at timestamptz
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_platform_owner(auth.uid()) THEN
    RAISE EXCEPTION 'PCART_P9: platform owner only.' USING errcode = '42501';
  END IF;
  IF NOT private.is_canonical_pcart_launch(_launch_id) THEN
    RAISE EXCEPTION 'PCART_P9: not the canonical PEPECARTEL launch.' USING errcode = '42501';
  END IF;
  INSERT INTO public.pcart_launch_day_plans (launch_id, promotion_start_at, intended_auction_start_at, updated_by)
  VALUES (_launch_id, _promotion_start_at, _intended_auction_start_at, auth.uid())
  ON CONFLICT (launch_id) DO UPDATE SET promotion_start_at = EXCLUDED.promotion_start_at,
    intended_auction_start_at = EXCLUDED.intended_auction_start_at, updated_by = auth.uid();
  INSERT INTO public.pcart_launch_coordinator_events (launch_id, event_kind, detail, actor)
  VALUES (_launch_id, 'PLAN_UPDATED', jsonb_build_object('promotion_start_at', _promotion_start_at, 'intended_auction_start_at', _intended_auction_start_at), auth.uid());
END $$;
REVOKE ALL ON FUNCTION public.set_canonical_pcart_launch_day_plan(uuid, timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_canonical_pcart_launch_day_plan(uuid, timestamptz, timestamptz) TO authenticated;

CREATE OR REPLACE FUNCTION public.revoke_canonical_pcart_policy_approval(
  _launch_id uuid, _review_kind text, _review_id uuid, _reason text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; v_found boolean;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_platform_owner(auth.uid()) THEN
    RAISE EXCEPTION 'PCART_P9: platform owner only.' USING errcode = '42501';
  END IF;
  IF _review_kind = 'P8A' THEN
    SELECT EXISTS (SELECT 1 FROM public.pcart_auction_liquidity_plan_reviews WHERE id = _review_id AND launch_id = _launch_id) INTO v_found;
  ELSIF _review_kind = 'P8B' THEN
    SELECT EXISTS (SELECT 1 FROM public.pcart_auction_execution_rehearsal_reviews WHERE id = _review_id AND launch_id = _launch_id) INTO v_found;
  ELSE
    RAISE EXCEPTION 'PCART_P9: unknown review kind.' USING errcode = '22023';
  END IF;
  IF NOT v_found THEN RAISE EXCEPTION 'PCART_P9: review not found for launch.' USING errcode = '22023'; END IF;
  INSERT INTO public.pcart_policy_approval_revocations (launch_id, review_kind, review_id, reason, revoked_by)
  VALUES (_launch_id, _review_kind, _review_id, _reason, auth.uid()) RETURNING id INTO v_id;
  INSERT INTO public.pcart_launch_coordinator_events (launch_id, event_kind, detail, actor)
  VALUES (_launch_id, 'POLICY_APPROVAL_REVOKED', jsonb_build_object('review_kind', _review_kind, 'review_id', _review_id), auth.uid());
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.revoke_canonical_pcart_policy_approval(uuid, text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revoke_canonical_pcart_policy_approval(uuid, text, uuid, text) TO authenticated;