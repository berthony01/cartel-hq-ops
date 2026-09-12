-- PARITY COPY ONLY - ALREADY APPLIED TO AUTHORITATIVE SUPABASE AS 20260912222700_se1_social_engine_target_integrity_hardening - DO NOT REAPPLY BLINDLY
-- Source-of-truth for this migration is the Supabase project; this file exists only for repository audit/parity.
-- Corrects the intermediate mission-target policies from 20260912222624 and moves
-- workspace + exact Telegram chat integrity into a composite foreign key.

alter table public.telegram_group_connections
  add constraint telegram_group_connections_id_workspace_chat_unique
  unique (id, workspace_id, telegram_chat_id);

alter table public.social_mission_targets
  drop constraint social_mission_targets_group_workspace_fkey;

alter table public.social_mission_targets
  add constraint social_mission_targets_group_workspace_chat_fkey
  foreign key (group_connection_id, workspace_id, telegram_chat_id)
  references public.telegram_group_connections(id, workspace_id, telegram_chat_id)
  on delete set null (group_connection_id);

drop policy social_mission_targets_insert_operator on public.social_mission_targets;
drop policy social_mission_targets_update_operator on public.social_mission_targets;
drop policy social_mission_targets_delete_draft_operator on public.social_mission_targets;

create policy social_mission_targets_insert_operator
on public.social_mission_targets for insert to authenticated
with check (
  public.is_workspace_operator(social_mission_targets.workspace_id, (select auth.uid()))
  and social_mission_targets.group_connection_id is not null
);

create policy social_mission_targets_update_operator
on public.social_mission_targets for update to authenticated
using (public.is_workspace_operator(social_mission_targets.workspace_id, (select auth.uid())))
with check (public.is_workspace_operator(social_mission_targets.workspace_id, (select auth.uid())));

create policy social_mission_targets_delete_draft_operator
on public.social_mission_targets for delete to authenticated
using (
  public.is_workspace_operator(social_mission_targets.workspace_id, (select auth.uid()))
  and exists (
    select 1 from public.social_missions m
    where m.id = social_mission_targets.mission_id
      and m.workspace_id = social_mission_targets.workspace_id
      and m.status = 'DRAFT'
  )
);
