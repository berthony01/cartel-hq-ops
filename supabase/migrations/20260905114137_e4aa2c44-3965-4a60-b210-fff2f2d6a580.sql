ALTER TABLE public.telegram_group_announcements
  ADD COLUMN announcement_kind text NOT NULL DEFAULT 'OPERATOR_TEXT',
  ADD COLUMN launch_id uuid NULL REFERENCES public.launches(id);

CREATE UNIQUE INDEX telegram_group_announcements_official_contract_idx
  ON public.telegram_group_announcements (launch_id, group_connection_id)
  WHERE announcement_kind = 'OFFICIAL_CONTRACT';