CREATE OR REPLACE FUNCTION public.enforce_canonical_pcart_no_production_deployment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ev jsonb; r public.pcart_production_readiness_approvals;
BEGIN
  IF NEW.network_environment = 'PRODUCTION' OR NEW.chain_id = 4663 THEN
    IF private.is_canonical_pcart_launch(NEW.launch_id) THEN
      IF NEW.artifact_id IS DISTINCT FROM 'pepecartel-token-v1' THEN
        RAISE EXCEPTION 'The canonical PEPECARTEL launch only permits pepecartel-token-v1 in production' USING ERRCODE = '42501';
      END IF;
      SELECT * INTO r FROM public.pcart_production_readiness_approvals a
       WHERE a.launch_id = NEW.launch_id AND a.artifact_id = 'pepecartel-token-v1';
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Canonical PCART production rows require a production readiness approval' USING ERRCODE = '42501';
      END IF;
      ev := private.pcart_production_readiness_evidence(NEW.launch_id, false);
      IF NOT (ev->>'ok')::boolean OR r.readiness_fingerprint IS DISTINCT FROM ev->>'fingerprint' THEN
        RAISE EXCEPTION 'Canonical PCART production readiness evidence no longer matches (%)', COALESCE(ev->>'reason','FINGERPRINT') USING ERRCODE = '42501';
      END IF;
    ELSIF NEW.artifact_id = 'pepecartel-token-v1' THEN
      RAISE EXCEPTION 'pepecartel-token-v1 is reserved for the canonical PEPECARTEL launch' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.enforce_canonical_pcart_no_production_deployment() FROM PUBLIC, anon, authenticated;