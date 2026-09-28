-- PARTNER PROGRAM PHASE 1B-1 — VERSIONED POLICY DOCUMENTS + ACCEPTANCE
-- STAGED FOR REVIEW ONLY. NOT APPLIED. Do not run without explicit authorization.
-- Additive only: no DROP, no data seed, no active version, no IP collection.
-- Activation is owner-only, requires an exact typed confirmation phrase and
-- fails closed while any bracketed [PLACEHOLDER] remains in the content.

CREATE TABLE IF NOT EXISTS public.policy_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_type text NOT NULL CHECK (document_type IN ('terms','privacy','refunds','partner_agreement')),
  version integer NOT NULL CHECK (version >= 1),
  content text NOT NULL CHECK (length(content) BETWEEN 1 AND 200000),
  content_hash text NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','retired')),
  requires_acceptance boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL,
  activated_by uuid,
  activated_at timestamptz,
  retired_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_type, version),
  UNIQUE (document_type, version, content_hash)
);
CREATE UNIQUE INDEX IF NOT EXISTS policy_documents_one_active
  ON public.policy_documents (document_type) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS public.policy_acceptances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  document_type text NOT NULL,
  version integer NOT NULL,
  content_hash text NOT NULL,
  source text NOT NULL CHECK (source IN ('signup','checkout','prompt')),
  accepted_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (document_type, version, content_hash)
    REFERENCES public.policy_documents (document_type, version, content_hash),
  UNIQUE (user_id, document_type, version)
);
CREATE INDEX IF NOT EXISTS policy_acceptances_user_idx ON public.policy_acceptances (user_id);

GRANT SELECT ON public.policy_documents TO authenticated;
GRANT ALL ON public.policy_documents TO service_role;
GRANT SELECT ON public.policy_acceptances TO authenticated;
GRANT ALL ON public.policy_acceptances TO service_role;

ALTER TABLE public.policy_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.policy_acceptances ENABLE ROW LEVEL SECURITY;

-- Documents: owner sees all; everyone else sees only active rows. No client writes.
CREATE POLICY "policy_documents_read" ON public.policy_documents FOR SELECT TO authenticated
  USING (status = 'active' OR public.is_platform_owner((SELECT auth.uid())));
-- Acceptances: users read only their own. Writes only via RPC.
CREATE POLICY "policy_acceptances_read_own" ON public.policy_acceptances FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- Immutability: acceptances are append-only; document content/hash frozen.
CREATE OR REPLACE FUNCTION public.policy_guard_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_TABLE_NAME = 'policy_acceptances' THEN
    RAISE EXCEPTION 'POLICY_ACCEPTANCE_IMMUTABLE';
  END IF;
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'POLICY_DOCUMENT_IMMUTABLE'; END IF;
  IF NEW.content IS DISTINCT FROM OLD.content OR NEW.content_hash IS DISTINCT FROM OLD.content_hash
     OR NEW.document_type IS DISTINCT FROM OLD.document_type OR NEW.version IS DISTINCT FROM OLD.version THEN
    RAISE EXCEPTION 'POLICY_DOCUMENT_IMMUTABLE';
  END IF;
  IF OLD.status = 'retired' OR (OLD.status = 'active' AND NEW.status = 'draft') THEN
    RAISE EXCEPTION 'POLICY_STATUS_TRANSITION';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER policy_documents_immutable BEFORE UPDATE OR DELETE ON public.policy_documents
  FOR EACH ROW EXECUTE FUNCTION public.policy_guard_immutable();
CREATE TRIGGER policy_acceptances_immutable BEFORE UPDATE OR DELETE ON public.policy_acceptances
  FOR EACH ROW EXECUTE FUNCTION public.policy_guard_immutable();

-- Owner: save draft (hash computed server-side).
CREATE OR REPLACE FUNCTION public.owner_save_policy_draft(_document_type text, _version integer, _content text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL OR NOT public.is_platform_owner(v_uid) THEN RAISE EXCEPTION 'PLATFORM_OWNER_REQUIRED'; END IF;
  INSERT INTO public.policy_documents (document_type, version, content, content_hash, created_by)
  VALUES (_document_type, _version, _content, encode(extensions.digest(convert_to(_content, 'UTF8'), 'sha256'), 'hex'), v_uid);
  RETURN jsonb_build_object('ok', true);
END $$;

-- Owner: activate. Fails closed on any placeholder or wrong phrase.
CREATE OR REPLACE FUNCTION public.owner_activate_policy_version(_document_type text, _version integer, _confirm text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_doc public.policy_documents%ROWTYPE;
BEGIN
  IF v_uid IS NULL OR NOT public.is_platform_owner(v_uid) THEN RAISE EXCEPTION 'PLATFORM_OWNER_REQUIRED'; END IF;
  IF _confirm IS DISTINCT FROM ('ACTIVATE ' || upper(_document_type) || ' V' || _version) THEN
    RAISE EXCEPTION 'CONFIRMATION_MISMATCH';
  END IF;
  SELECT * INTO v_doc FROM public.policy_documents
    WHERE document_type = _document_type AND version = _version FOR UPDATE;
  IF NOT FOUND OR v_doc.status <> 'draft' THEN RAISE EXCEPTION 'POLICY_NOT_DRAFT'; END IF;
  IF v_doc.content ~ '\[[A-Z0-9][A-Z0-9 /&.,''-]*\]' THEN RAISE EXCEPTION 'POLICY_PLACEHOLDERS_REMAIN'; END IF;
  UPDATE public.policy_documents SET status = 'retired', retired_at = now()
    WHERE document_type = _document_type AND status = 'active';
  UPDATE public.policy_documents SET status = 'active', activated_by = v_uid, activated_at = now()
    WHERE id = v_doc.id;
  RETURN jsonb_build_object('ok', true, 'content_hash', v_doc.content_hash);
END $$;

-- Public read of effective versions (no content needed by clients).
CREATE OR REPLACE FUNCTION public.get_active_policy_versions()
RETURNS TABLE (document_type text, version integer, content_hash text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT d.document_type, d.version, d.content_hash FROM public.policy_documents d WHERE d.status = 'active';
$$;

-- Effective versions requiring acceptance that the caller has not accepted.
CREATE OR REPLACE FUNCTION public.get_my_pending_policy_acceptances()
RETURNS TABLE (document_type text, version integer, content_hash text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT d.document_type, d.version, d.content_hash
  FROM public.policy_documents d
  WHERE d.status = 'active' AND d.requires_acceptance AND auth.uid() IS NOT NULL
    AND d.document_type IN ('terms','privacy','refunds')
    AND NOT EXISTS (SELECT 1 FROM public.policy_acceptances a
      WHERE a.user_id = auth.uid() AND a.document_type = d.document_type AND a.version = d.version);
$$;

-- Record acceptance: server uid + server time; only exact ACTIVE version+hash.
CREATE OR REPLACE FUNCTION public.record_policy_acceptances(_acceptances jsonb, _source text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); r jsonb; n integer := 0;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'UNAUTHENTICATED'; END IF;
  IF _source NOT IN ('signup','checkout','prompt') THEN RAISE EXCEPTION 'INVALID_SOURCE'; END IF;
  IF jsonb_typeof(_acceptances) <> 'array' OR jsonb_array_length(_acceptances) > 4 THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  FOR r IN SELECT * FROM jsonb_array_elements(_acceptances) LOOP
    IF NOT EXISTS (SELECT 1 FROM public.policy_documents d
      WHERE d.status = 'active' AND d.document_type = r->>'document_type'
        AND d.version = (r->>'version')::integer AND d.content_hash = r->>'content_hash') THEN
      RAISE EXCEPTION 'POLICY_VERSION_NOT_EFFECTIVE';
    END IF;
    INSERT INTO public.policy_acceptances (user_id, document_type, version, content_hash, source)
    VALUES (v_uid, r->>'document_type', (r->>'version')::integer, r->>'content_hash', _source)
    ON CONFLICT (user_id, document_type, version) DO NOTHING;
    n := n + 1;
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'count', n);
END $$;

REVOKE ALL ON FUNCTION public.policy_guard_immutable() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.owner_save_policy_draft(text, integer, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.owner_activate_policy_version(text, integer, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_active_policy_versions() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_my_pending_policy_acceptances() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.record_policy_acceptances(jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owner_save_policy_draft(text, integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.owner_activate_policy_version(text, integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_active_policy_versions() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_pending_policy_acceptances() TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_policy_acceptances(jsonb, text) TO authenticated;
