-- P3A: Robinhood Chain (4663) PRODUCTION finality / evidence foundation.
-- Additive only. Replaces exactly one existing function (assert_launch_contract_evidence)
-- to strengthen it. No testnet behavior is changed, no data is deleted,
-- no transaction / broadcast / liquidity capability is created here.

-- ---------------------------------------------------------------------------
-- A) Additive finality evidence columns on public.launch_chain_deployments
-- ---------------------------------------------------------------------------

alter table public.launch_chain_deployments
  add column if not exists finality_state text not null default 'NOT_APPLICABLE',
  add column if not exists finalized_at timestamptz null,
  add column if not exists finalized_block_number bigint null,
  add column if not exists finalized_head_block_number bigint null,
  add column if not exists finalized_block_hash_confirmed boolean null,
  add column if not exists finality_provider_kind text null,
  add column if not exists finality_last_checked_at timestamptz null,
  add column if not exists finality_notice text null;

alter table public.launch_chain_deployments
  drop constraint if exists launch_chain_deployments_finality_state_allowed;
alter table public.launch_chain_deployments
  add constraint launch_chain_deployments_finality_state_allowed
  check (finality_state in ('NOT_APPLICABLE', 'FINALITY_PENDING', 'FINALIZED', 'PROVIDER_INCONSISTENT'));

alter table public.launch_chain_deployments
  drop constraint if exists launch_chain_deployments_finality_provider_kind_allowed;
alter table public.launch_chain_deployments
  add constraint launch_chain_deployments_finality_provider_kind_allowed
  check (finality_provider_kind is null or finality_provider_kind = 'MANAGED');

alter table public.launch_chain_deployments
  drop constraint if exists launch_chain_deployments_finality_block_numbers_nonneg;
alter table public.launch_chain_deployments
  add constraint launch_chain_deployments_finality_block_numbers_nonneg
  check (
    (finalized_block_number is null or finalized_block_number >= 0)
    and (finalized_head_block_number is null or finalized_head_block_number >= 0)
  );

alter table public.launch_chain_deployments
  drop constraint if exists launch_chain_deployments_finality_notice_len;
alter table public.launch_chain_deployments
  add constraint launch_chain_deployments_finality_notice_len
  check (finality_notice is null or char_length(finality_notice) <= 2000);

-- Any non-default finality state is legal only for production Robinhood Chain rows.
-- This also enforces that TESTNET / 46630 rows remain NOT_APPLICABLE.
alter table public.launch_chain_deployments
  drop constraint if exists launch_chain_deployments_finality_production_only;
alter table public.launch_chain_deployments
  add constraint launch_chain_deployments_finality_production_only
  check (
    finality_state = 'NOT_APPLICABLE'
    or (chain_id = 4663 and network_environment = 'PRODUCTION')
  );

-- FINALIZED requires complete, self-consistent managed finality evidence.
alter table public.launch_chain_deployments
  drop constraint if exists launch_chain_deployments_finalized_requires_evidence;
alter table public.launch_chain_deployments
  add constraint launch_chain_deployments_finalized_requires_evidence
  check (
    finality_state <> 'FINALIZED'
    or (
      chain_id = 4663
      and network_environment = 'PRODUCTION'
      and block_number is not null
      and block_hash is not null
      and finalized_at is not null
      and finalized_block_number is not null
      and finalized_block_number = block_number
      and finalized_head_block_number is not null
      and finalized_head_block_number >= finalized_block_number
      and finalized_block_hash_confirmed is true
      and finality_provider_kind = 'MANAGED'
    )
  );

comment on column public.launch_chain_deployments.finality_state is
  'Production (4663) finality evidence state. Testnet rows remain NOT_APPLICABLE.';
comment on column public.launch_chain_deployments.finality_provider_kind is
  'Only MANAGED provider observations may establish production finality.';

-- ---------------------------------------------------------------------------
-- B) Production token deployment verification apply function (service_role only)
-- ---------------------------------------------------------------------------

create or replace function public.apply_launch_chain_production_token_deployment_verification(
  _deployment_id uuid,
  _status text,
  _observed_confirmations integer default 0,
  _contract_address text default null,
  _block_number bigint default null,
  _block_hash text default null,
  _failure_code text default null,
  _failure_detail text default null,
  _verified_token_name text default null,
  _verified_token_symbol text default null,
  _verified_token_decimals smallint default null,
  _verified_total_supply numeric default null,
  _verified_recipient_balance numeric default null
)
returns public.launch_chain_deployments
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  d public.launch_chain_deployments;
  requested_status text;
  addr text;
  bhash text;
  fcode text;
  fdetail text;
  next_finality text;
begin
  select * into d from public.launch_chain_deployments where id = _deployment_id for update;
  if d.id is null then
    raise exception 'Deployment record not found.' using errcode = 'P0002';
  end if;

  if d.chain_id is distinct from 4663 or d.network_environment is distinct from 'PRODUCTION' then
    raise exception 'This function only operates on production Robinhood Chain (4663) deployments.' using errcode = '22023';
  end if;

  if d.deployment_kind is distinct from 'FIXED_SUPPLY_ERC20'
     or d.artifact_id is distinct from 'cartel-fixed-erc20-v1' then
    raise exception 'Deployment record does not carry the approved frozen artifact.' using errcode = '22023';
  end if;

  requested_status := upper(btrim(coalesce(_status, '')));
  if requested_status not in ('PENDING', 'CONFIRMED', 'FAILED') then
    raise exception 'Unsupported verification status.' using errcode = '22023';
  end if;

  -- DRAFT is a safe no-op; terminal rows are immutable here.
  if d.status in ('DRAFT', 'ABANDONED', 'FAILED', 'CONFIRMED') then
    return d;
  end if;

  if coalesce(_observed_confirmations, 0) < 0 then
    raise exception 'Observed confirmations cannot be negative.' using errcode = '22023';
  end if;

  if _block_number is not null and _block_number < 0 then
    raise exception 'Block number cannot be negative.' using errcode = '22023';
  end if;

  addr := lower(nullif(btrim(coalesce(_contract_address, '')), ''));
  if addr is not null and addr !~ '^0x[0-9a-f]{40}$' then
    raise exception 'Contract address is not well formed.' using errcode = '22023';
  end if;

  bhash := lower(nullif(btrim(coalesce(_block_hash, '')), ''));
  if bhash is not null and bhash !~ '^0x[0-9a-f]{64}$' then
    raise exception 'Block hash is not well formed.' using errcode = '22023';
  end if;

  if requested_status = 'FAILED' then
    fcode := nullif(btrim(coalesce(_failure_code, '')), '');
    fdetail := nullif(btrim(coalesce(_failure_detail, '')), '');
    if fcode is null then
      raise exception 'A failure code is required to record a failed production deployment.' using errcode = '22023';
    end if;
    fcode := left(fcode, 64);
    if fdetail is not null then
      fdetail := left(fdetail, 2000);
    end if;

    update public.launch_chain_deployments
    set status = 'FAILED',
        failure_code = fcode,
        failure_detail = fdetail,
        last_checked_at = now()
    where id = d.id
    returning * into d;

    return d;
  end if;

  -- PENDING and CONFIRMED both require complete mined + token state evidence.
  if addr is null or bhash is null or _block_number is null then
    raise exception 'Mined production evidence requires a contract address, block number and block hash.' using errcode = '22023';
  end if;

  if _verified_token_name is distinct from d.token_name
     or _verified_token_symbol is distinct from d.token_symbol
     or _verified_token_decimals is distinct from d.token_decimals
     or _verified_token_decimals is distinct from 18::smallint then
    raise exception 'Verified token identity does not match the recorded deployment intent.' using errcode = '22023';
  end if;

  if d.token_total_supply is null
     or _verified_total_supply is distinct from d.token_total_supply
     or _verified_recipient_balance is distinct from d.token_total_supply then
    raise exception 'Verified token supply or recipient balance does not match the recorded deployment intent.' using errcode = '22023';
  end if;

  -- Immutable mined evidence: once recorded, address/block/hash cannot change.
  if d.contract_address is not null and lower(d.contract_address) is distinct from addr then
    raise exception 'Mined contract address cannot change.' using errcode = '22023';
  end if;
  if d.block_number is not null and d.block_number is distinct from _block_number then
    raise exception 'Mined deployment block number cannot change.' using errcode = '22023';
  end if;
  if d.block_hash is not null and lower(d.block_hash) is distinct from bhash then
    raise exception 'Mined deployment block hash cannot change.' using errcode = '22023';
  end if;

  if requested_status = 'PENDING' then
    -- FINALIZED evidence is immutable; do not rewrite mined/token evidence or revert status.
    if d.finality_state = 'FINALIZED' then
      return d;
    end if;

    -- Never downgrade an existing finality observation.
    if d.finality_state = 'NOT_APPLICABLE' then
      next_finality := 'FINALITY_PENDING';
    else
      next_finality := d.finality_state;
    end if;

    update public.launch_chain_deployments
    set status = 'PENDING',
        contract_address = addr,
        block_number = _block_number,
        block_hash = bhash,
        confirmations = coalesce(_observed_confirmations, 0),
        verified_token_name = _verified_token_name,
        verified_token_symbol = _verified_token_symbol,
        verified_token_decimals = _verified_token_decimals,
        verified_total_supply = _verified_total_supply,
        verified_total_supply_text = _verified_total_supply::text,
        verified_recipient_balance = _verified_recipient_balance,
        verified_recipient_balance_text = _verified_recipient_balance::text,
        failure_code = null,
        failure_detail = null,
        verified_at = null,
        finality_state = next_finality,
        last_checked_at = now()
    where id = d.id
    returning * into d;

    return d;
  end if;

  -- requested_status = 'CONFIRMED'
  -- Require complete, matching mined evidence already stored.
  if d.contract_address is null or lower(d.contract_address) is distinct from addr
     or d.block_number is null or d.block_number is distinct from _block_number
     or d.block_hash is null or lower(d.block_hash) is distinct from bhash then
    raise exception 'Confirmed production deployment requires matching mined evidence.' using errcode = '22023';
  end if;

  if d.finality_state is distinct from 'FINALIZED'
     or d.finalized_block_hash_confirmed is not true
     or d.finality_provider_kind is distinct from 'MANAGED'
     or d.finalized_block_number is null
     or d.finalized_block_number is distinct from d.block_number
     or d.finalized_head_block_number is null
     or d.finalized_head_block_number < _block_number then
    raise exception 'Production deployment cannot be confirmed without managed finalized evidence.' using errcode = '22023';
  end if;

  -- Confirmation only updates status/confirmations/failure null timestamps;
  -- mined and verified token evidence remain immutable.
  update public.launch_chain_deployments
  set status = 'CONFIRMED',
      confirmations = coalesce(_observed_confirmations, 0),
      failure_code = null,
      failure_detail = null,
      verified_at = now(),
      last_checked_at = now()
  where id = d.id
  returning * into d;

  return d;
end;
$function$;

revoke all on function public.apply_launch_chain_production_token_deployment_verification(
  uuid, text, integer, text, bigint, text, text, text, text, text, smallint, numeric, numeric
) from public, anon, authenticated;
grant execute on function public.apply_launch_chain_production_token_deployment_verification(
  uuid, text, integer, text, bigint, text, text, text, text, text, smallint, numeric, numeric
) to service_role;

-- ---------------------------------------------------------------------------
-- C) Production finality apply function (service_role only)
-- ---------------------------------------------------------------------------

create or replace function public.apply_launch_chain_production_finality(
  _deployment_id uuid,
  _finality_state text,
  _finalized_block_number bigint default null,
  _finalized_head_block_number bigint default null,
  _finalized_block_hash_confirmed boolean default null,
  _finality_provider_kind text default null,
  _finality_notice text default null
)
returns public.launch_chain_deployments
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  d public.launch_chain_deployments;
  requested_state text;
  provider text;
  notice text;
  head bigint;
begin
  select * into d from public.launch_chain_deployments where id = _deployment_id for update;
  if d.id is null then
    raise exception 'Deployment record not found.' using errcode = 'P0002';
  end if;

  if d.chain_id is distinct from 4663 or d.network_environment is distinct from 'PRODUCTION' then
    raise exception 'This function only operates on production Robinhood Chain (4663) deployments.' using errcode = '22023';
  end if;

  if d.deployment_kind is distinct from 'FIXED_SUPPLY_ERC20'
     or d.artifact_id is distinct from 'cartel-fixed-erc20-v1' then
    raise exception 'Deployment record does not carry the approved frozen artifact.' using errcode = '22023';
  end if;

  -- FINALIZED is immutable. No demotion path exists.
  if d.finality_state = 'FINALIZED' then
    return d;
  end if;

  if d.status is distinct from 'PENDING' then
    raise exception 'Finality can only be recorded for a mined, pending production deployment.' using errcode = '22023';
  end if;

  if d.contract_address is null or d.contract_address !~ '^0x[0-9a-f]{40}$'
     or d.block_number is null
     or d.block_hash is null or d.block_hash !~ '^0x[0-9a-f]{64}$' then
    raise exception 'Deployment record has no complete mined evidence.' using errcode = '22023';
  end if;

  if d.verified_token_name is distinct from d.token_name
     or d.verified_token_symbol is distinct from d.token_symbol
     or d.verified_token_decimals is distinct from d.token_decimals
     or d.verified_token_decimals is distinct from 18::smallint
     or d.token_total_supply is null
     or d.verified_total_supply is distinct from d.token_total_supply
     or d.verified_recipient_balance is distinct from d.token_total_supply then
    raise exception 'Deployment record does not carry verified token evidence matching the recorded intent.' using errcode = '22023';
  end if;

  requested_state := upper(btrim(coalesce(_finality_state, '')));
  if requested_state not in ('FINALITY_PENDING', 'FINALIZED', 'PROVIDER_INCONSISTENT') then
    raise exception 'Unsupported finality state.' using errcode = '22023';
  end if;

  provider := upper(btrim(coalesce(_finality_provider_kind, '')));
  if provider is distinct from 'MANAGED' then
    raise exception 'Only a MANAGED provider observation may record production finality.' using errcode = '22023';
  end if;

  notice := nullif(btrim(coalesce(_finality_notice, '')), '');
  if notice is not null then
    notice := left(notice, 2000);
  end if;

  head := _finalized_head_block_number;
  if head is not null and head < 0 then
    head := null;
  end if;

  if requested_state = 'FINALIZED' then
    if _finalized_block_hash_confirmed is not true then
      raise exception 'Finalization requires a confirmed deployment block hash re-read.' using errcode = '22023';
    end if;
    if _finalized_block_number is null or _finalized_block_number is distinct from d.block_number then
      raise exception 'Finalized block number must equal the recorded deployment block number.' using errcode = '22023';
    end if;
    if head is null or head < d.block_number then
      raise exception 'Finalized head must be at or beyond the deployment block.' using errcode = '22023';
    end if;

    update public.launch_chain_deployments
    set finality_state = 'FINALIZED',
        finalized_at = now(),
        finalized_block_number = _finalized_block_number,
        finalized_head_block_number = head,
        finalized_block_hash_confirmed = true,
        finality_provider_kind = 'MANAGED',
        finality_last_checked_at = now(),
        finality_notice = notice
    where id = d.id
    returning * into d;

    return d;
  end if;

  if requested_state = 'PROVIDER_INCONSISTENT' then
    update public.launch_chain_deployments
    set finality_state = 'PROVIDER_INCONSISTENT',
        finalized_at = null,
        finalized_block_number = null,
        finalized_head_block_number = head,
        finalized_block_hash_confirmed = _finalized_block_hash_confirmed,
        finality_provider_kind = 'MANAGED',
        finality_last_checked_at = now(),
        finality_notice = notice
    where id = d.id
    returning * into d;

    return d;
  end if;

  -- requested_state = 'FINALITY_PENDING'
  if _finalized_block_hash_confirmed is not true then
    raise exception 'Returning to finality pending requires a clean managed block hash re-read.' using errcode = '22023';
  end if;

  update public.launch_chain_deployments
  set finality_state = 'FINALITY_PENDING',
      finalized_at = null,
      finalized_block_number = null,
      finalized_head_block_number = head,
      finalized_block_hash_confirmed = true,
      finality_provider_kind = 'MANAGED',
      finality_last_checked_at = now(),
      finality_notice = notice
  where id = d.id
  returning * into d;

  return d;
end;
$function$;

revoke all on function public.apply_launch_chain_production_finality(
  uuid, text, bigint, bigint, boolean, text, text
) from public, anon, authenticated;
grant execute on function public.apply_launch_chain_production_finality(
  uuid, text, bigint, bigint, boolean, text, text
) to service_role;

-- ---------------------------------------------------------------------------
-- D) Strengthen public.assert_launch_contract_evidence (no existing check removed)
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

  if coalesce(d.confirmations, 0) < 5 then
    raise exception 'Deployment evidence has fewer than 5 confirmations.' using errcode = '22023';
  end if;

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
