-- P3A runtime correction: verified_total_supply_text and verified_recipient_balance_text
-- are GENERATED ALWAYS columns, so the production verifier must not assign to them directly.
-- PostgreSQL derives them automatically from verified_total_supply / verified_recipient_balance.
-- This migration only replaces public.apply_launch_chain_production_token_deployment_verification.

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
        verified_recipient_balance = _verified_recipient_balance,
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
