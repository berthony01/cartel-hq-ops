-- ---------------------------------------------------------------------------
-- Hardening B — production official-contract registration: managed finality is
-- authoritative, observed confirmations are diagnostic.
--
-- STAGED, NOT APPLIED.
--
-- Intended filename when applied as an additive Supabase migration:
--   supabase/migrations/20260907050000_hardening_b_production_registration_managed_finality.sql
--
-- This file lives under docs/sql/ because this environment refuses direct
-- authoring of files under supabase/migrations/ (that directory is only
-- writable by the migration tool, which would APPLY the SQL in this turn —
-- explicitly prohibited by the Hardening B contract). The SQL below is the
-- exact text to apply, additively, after independent inspection and approval.
-- No historical migration is edited or replaced.
--
-- Source of truth: the current LIVE definition of
-- public.assert_launch_contract_evidence in Supabase project
-- ocoinbnjgstkmnwwvnhi. EVERY existing check and security property is
-- preserved verbatim EXCEPT the independent branch that rejected
-- coalesce(d.confirmations, 0) < 5, which is removed.
--
-- The confirmations column remains stored and diagnostic. It is neither
-- dropped nor reinterpreted. Managed finality evidence (FINALIZED, MANAGED
-- provider, confirmed finalized block hash, finalized_at, finalized block
-- number equal to the deployment block, finalized head at or beyond the
-- deployment block) remains mandatory and unchanged.
--
-- No table, column, grant, policy, trigger or function signature changes.
-- ---------------------------------------------------------------------------

create or replace function public.assert_launch_contract_evidence(
  _launch_id uuid,
  _workspace_id uuid,
  _declared_chain text,
  _deployment_id uuid
)
returns text
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  d public.launch_chain_deployments;
begin
  if _deployment_id is null then
    raise exception 'Official contract registration must be bound to verified deployment evidence.' using errcode = '22023';
  end if;

  select * into d from public.launch_chain_deployments where id = _deployment_id;
  if d.id is null then
    raise exception 'Deployment evidence record not found.' using errcode = 'P0002';
  end if;

  if d.launch_id is distinct from _launch_id or d.workspace_id is distinct from _workspace_id then
    raise exception 'Deployment evidence does not belong to this launch and workspace.' using errcode = '42501';
  end if;

  if d.deployment_kind is distinct from 'FIXED_SUPPLY_ERC20' then
    raise exception 'Only a fixed-supply token deployment can become an official contract.' using errcode = '22023';
  end if;

  if d.artifact_id is distinct from 'cartel-fixed-erc20-v1' then
    raise exception 'Deployment evidence does not carry the approved frozen artifact.' using errcode = '22023';
  end if;

  if d.network_environment is distinct from 'PRODUCTION' or d.chain_id is distinct from 4663 then
    raise exception 'Only a production Robinhood Chain (4663) deployment can become an official contract.' using errcode = '22023';
  end if;

  if not public.launch_chain_label_is_robinhood_mainnet(_declared_chain) then
    raise exception 'The declared launch chain does not clearly match Robinhood Chain mainnet.' using errcode = '22023';
  end if;

  if d.status is distinct from 'CONFIRMED' then
    raise exception 'Deployment evidence is not CONFIRMED.' using errcode = '22023';
  end if;

  if d.tx_hash is null or d.tx_hash !~ '^0x[0-9a-f]{64}$' then
    raise exception 'Deployment evidence has no well-formed transaction hash.' using errcode = '22023';
  end if;

  if d.contract_address is null or d.contract_address !~ '^0x[0-9a-f]{40}$' then
    raise exception 'Deployment evidence has no well-formed contract address.' using errcode = '22023';
  end if;

  -- Hardening B: the separate fixed confirmation-depth rejection is removed.
  -- d.confirmations remains stored and diagnostic for production; the managed
  -- finality checks below are the authoritative depth requirement.

  if d.block_number is null or d.verified_at is null then
    raise exception 'Deployment evidence is missing a mined block or verification timestamp.' using errcode = '22023';
  end if;

  if d.failure_code is not null or d.failure_detail is not null then
    raise exception 'Deployment evidence records a failure state.' using errcode = '22023';
  end if;

  if d.verified_token_name is distinct from d.token_name
     or d.verified_token_symbol is distinct from d.token_symbol
     or d.verified_token_decimals is distinct from d.token_decimals
     or d.verified_token_decimals is distinct from 18::smallint then
    raise exception 'Verified token identity does not match the recorded deployment intent.' using errcode = '22023';
  end if;

  if d.token_total_supply is null
     or d.verified_total_supply is distinct from d.token_total_supply
     or d.verified_recipient_balance is distinct from d.token_total_supply then
    raise exception 'Verified token supply or recipient balance does not match the recorded deployment intent.' using errcode = '22023';
  end if;

  -- P3A strengthening: managed production finality evidence is mandatory.
  if d.finality_state is distinct from 'FINALIZED' then
    raise exception 'Deployment evidence is not recorded as FINALIZED.' using errcode = '22023';
  end if;

  if d.finalized_block_hash_confirmed is not true then
    raise exception 'Deployment evidence has no confirmed finalized block hash.' using errcode = '22023';
  end if;

  if d.finality_provider_kind is distinct from 'MANAGED' then
    raise exception 'Finality evidence was not recorded by a managed provider.' using errcode = '22023';
  end if;

  if d.finalized_at is null then
    raise exception 'Deployment evidence is missing a finalization timestamp.' using errcode = '22023';
  end if;

  if d.finalized_block_number is null or d.finalized_block_number is distinct from d.block_number then
    raise exception 'Finalized block number does not match the recorded deployment block.' using errcode = '22023';
  end if;

  if d.finalized_head_block_number is null or d.finalized_head_block_number < d.block_number then
    raise exception 'Finalized head block is behind the recorded deployment block.' using errcode = '22023';
  end if;

  return d.contract_address;
end;
$function$;

revoke all on function public.assert_launch_contract_evidence(uuid, uuid, text, uuid) from public, anon;
grant execute on function public.assert_launch_contract_evidence(uuid, uuid, text, uuid) to authenticated;
