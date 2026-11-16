-- SOURCE-ONLY DRAFT. NOT APPLIED.
-- Telegram join-request admission is independent of welcome messages.
-- Group owners must opt in; all existing settings remain disabled.
ALTER TABLE public.telegram_community_settings
  ADD COLUMN IF NOT EXISTS verification_enabled boolean NOT NULL DEFAULT false;

-- Keep bot-created invite URLs out of workspace-member direct table SELECT.
CREATE TABLE public.telegram_member_verification_invites (
  group_connection_id uuid PRIMARY KEY REFERENCES public.telegram_group_connections(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  invite_link text NOT NULL CHECK (char_length(invite_link) BETWEEN 10 AND 2048),
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  rotated_at timestamptz,
  CHECK (invite_link LIKE 'https://t.me/%' OR invite_link LIKE 'https://telegram.me/%')
);

CREATE TABLE public.telegram_member_verification_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_connection_id uuid NOT NULL REFERENCES public.telegram_group_connections(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  telegram_user_id bigint NOT NULL CHECK (telegram_user_id > 0),
  user_chat_id bigint CHECK (user_chat_id > 0),
  telegram_update_id bigint NOT NULL UNIQUE,
  answer_hash text NOT NULL CHECK (answer_hash ~ '^[a-f0-9]{64}$'),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN
    ('pending','approving','approved','expired','delivery_failed','needs_review','incorrect_limit')),
  attempts smallint NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 3),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  resolved_at timestamptz,
  last_error_code text CHECK (last_error_code IS NULL OR char_length(last_error_code) <= 64),
  CHECK (expires_at > created_at AND expires_at <= created_at + interval '5 minutes')
);
CREATE UNIQUE INDEX telegram_member_verification_one_open_request
  ON public.telegram_member_verification_challenges(group_connection_id, telegram_user_id)
  WHERE status IN ('pending','approving','delivery_failed','needs_review');
CREATE INDEX telegram_member_verification_pending_expiry
  ON public.telegram_member_verification_challenges(expires_at)
  WHERE status IN ('pending','approving');

-- Reject cross-workspace group references even if a server caller has service role.
CREATE FUNCTION public.member_verification_check_group_scope()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.telegram_group_connections g
    WHERE g.id = NEW.group_connection_id AND g.workspace_id = NEW.workspace_id
  ) THEN
    RAISE EXCEPTION 'Member verification group/workspace mismatch';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER member_verification_invite_scope
  BEFORE INSERT OR UPDATE ON public.telegram_member_verification_invites
  FOR EACH ROW EXECUTE FUNCTION public.member_verification_check_group_scope();
CREATE TRIGGER member_verification_challenge_scope
  BEFORE INSERT OR UPDATE ON public.telegram_member_verification_challenges
  FOR EACH ROW EXECUTE FUNCTION public.member_verification_check_group_scope();

ALTER TABLE public.telegram_member_verification_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.telegram_member_verification_challenges ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.telegram_member_verification_invites FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.telegram_member_verification_challenges FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.telegram_member_verification_invites TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.telegram_member_verification_challenges TO service_role;

-- Atomic callback decision; concurrent/replayed callbacks can claim approval once.
-- Only the trusted webhook service role may invoke it.
CREATE FUNCTION public.member_verification_attempt(
  _challenge_id uuid, _telegram_user_id bigint, _choice_hash text
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  row_ public.telegram_member_verification_challenges%ROWTYPE;
  is_enabled boolean;
BEGIN
  SELECT * INTO row_ FROM public.telegram_member_verification_challenges
  WHERE id = _challenge_id FOR UPDATE;
  IF NOT FOUND OR row_.telegram_user_id <> _telegram_user_id THEN RETURN 'not_found'; END IF;
  IF row_.status <> 'pending' THEN RETURN 'already_processed'; END IF;
  SELECT COALESCE(s.verification_enabled,false) INTO is_enabled
  FROM public.telegram_community_settings s
  WHERE s.group_connection_id = row_.group_connection_id
    AND s.workspace_id = row_.workspace_id;
  IF NOT COALESCE(is_enabled,false) THEN
    UPDATE public.telegram_member_verification_challenges
      SET status='needs_review', last_error_code='disabled', resolved_at=now()
      WHERE id=row_.id;
    RETURN 'disabled';
  END IF;
  IF row_.expires_at <= now() THEN
    UPDATE public.telegram_member_verification_challenges
      SET status='expired', resolved_at=now() WHERE id=row_.id;
    RETURN 'expired';
  END IF;
  IF row_.attempts >= 3 THEN RETURN 'incorrect_limit'; END IF;
  IF _choice_hash = row_.answer_hash THEN
    UPDATE public.telegram_member_verification_challenges
      SET status='approving', resolved_at=now() WHERE id=row_.id;
    RETURN 'correct';
  END IF;
  UPDATE public.telegram_member_verification_challenges
    SET attempts=attempts+1,
      status=CASE WHEN attempts >= 2 THEN 'incorrect_limit' ELSE 'pending' END,
      last_error_code='incorrect_answer',
      resolved_at=CASE WHEN attempts >= 2 THEN now() ELSE NULL END
    WHERE id=row_.id;
  RETURN CASE WHEN row_.attempts >= 2 THEN 'incorrect_limit' ELSE 'incorrect'; END;
END;
$$;
REVOKE ALL ON FUNCTION public.member_verification_attempt(uuid,bigint,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.member_verification_attempt(uuid,bigint,text) TO service_role;

COMMENT ON COLUMN public.telegram_community_settings.verification_enabled IS
  'Owner opt-in for managed join-request verification. Defaults false; not proof that all group entry routes require approval.';
