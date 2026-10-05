-- PCART P7: canonical PCART branch in shared contract evidence + owner-only registration RPC.
CREATE OR REPLACE FUNCTION public.assert_launch_contract_evidence(_launch_id uuid, _workspace_id uuid, _declared_chain text, _deployment_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  d public.launch_chain_deployments;
  c public.pcart_production_send_claims;
  r public.pcart_production_readiness_approvals;
  s public.launch_treasury_signer_configs;
  k public.launch_chain_production_execution_controls;
  l public.launches;
  n_claims integer;
  v_supply constant text := '1000000000000000000000000000';
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

  -- ===================== CANONICAL PCART BRANCH (P7) =====================
  if private.is_canonical_pcart_launch(_launch_id) or d.artifact_id = 'pepecartel-token-v1' then
    if not private.is_canonical_pcart_launch(_launch_id)
       or d.artifact_id is distinct from 'pepecartel-token-v1'
       or d.deployment_kind is distinct from 'FIXED_SUPPLY_ERC20'
       or d.network_environment is distinct from 'PRODUCTION'
       or d.chain_id is distinct from 4663 then
      raise exception 'PCART_P7: not the exact canonical PCART production deployment.' using errcode = '42501';
    end if;
    if not public.launch_chain_label_is_robinhood_mainnet(_declared_chain) then
      raise exception 'PCART_P7: declared launch chain is not Robinhood Chain mainnet.' using errcode = '22023';
    end if;
    if d.status is distinct from 'CONFIRMED' or d.finality_state is distinct from 'FINALIZED' then
      raise exception 'PCART_P7: deployment must be CONFIRMED and FINALIZED.' using errcode = '22023';
    end if;
    if d.verified_at is null or d.finalized_at is null or d.block_number is null
       or d.block_hash is null or d.block_hash !~ '^0x[0-9a-f]{64}$' then
      raise exception 'PCART_P7: verification/finality/block evidence missing.' using errcode = '22023';
    end if;
    if d.finality_provider_kind is distinct from 'MANAGED'
       or d.finalized_block_hash_confirmed is not true
       or d.finalized_block_number is distinct from d.block_number
       or d.finalized_head_block_number is null or d.finalized_head_block_number < d.block_number then
      raise exception 'PCART_P7: managed finality evidence does not prove the deployment block.' using errcode = '22023';
    end if;
    if d.tx_hash is null or d.tx_hash !~ '^0x[0-9a-f]{64}$' then
      raise exception 'PCART_P7: no well-formed transaction hash.' using errcode = '22023';
    end if;
    select count(*) into n_claims from public.pcart_production_send_claims
     where deployment_id = d.id and claim_status = 'BROADCAST';
    select * into c from public.pcart_production_send_claims
     where deployment_id = d.id and claim_status = 'BROADCAST' and tx_hash = d.tx_hash;
    if n_claims <> 1 or c.id is null
       or c.wallet_account is distinct from lower(d.deployer_address)
       or c.deployer_nonce is distinct from d.deployer_nonce_before
       or c.chain_id is distinct from 4663 then
      raise exception 'PCART_P7: exactly one matching BROADCAST send claim is required.' using errcode = '42501';
    end if;
    if d.contract_address is null or d.contract_address !~ '^0x[0-9a-f]{40}$'
       or d.contract_address is distinct from lower(c.predicted_contract_address) then
      raise exception 'PCART_P7: contract address does not equal the bound predicted CREATE address.' using errcode = '22023';
    end if;
    select * into s from public.launch_treasury_signer_configs where launch_id = d.launch_id;
    if s.launch_id is null or s.threshold is distinct from 2
       or lower(s.safe_address) is distinct from lower(d.token_recipient)
       or lower(d.deployer_address) = lower(d.token_recipient)
       or lower(d.deployer_address) not in (lower(s.signer_1), lower(s.signer_2), lower(s.signer_3)) then
      raise exception 'PCART_P7: deployer/Treasury Safe signer evidence mismatch.' using errcode = '42501';
    end if;
    select * into r from public.pcart_production_readiness_approvals
     where launch_id = d.launch_id and artifact_id = 'pepecartel-token-v1';
    if r.id is null or lower(r.safe_address) is distinct from lower(d.token_recipient) then
      raise exception 'PCART_P7: readiness approval Safe does not equal the token recipient.' using errcode = '42501';
    end if;
    if d.token_name is distinct from 'PEPECARTEL' or d.token_symbol is distinct from 'PCART'
       or d.token_decimals is distinct from 18::smallint
       or d.token_total_supply is distinct from v_supply::numeric
       or d.token_total_supply_text is distinct from v_supply
       or d.verified_token_name is distinct from 'PEPECARTEL' or d.verified_token_symbol is distinct from 'PCART'
       or d.verified_token_decimals is distinct from 18::smallint
       or d.verified_total_supply is distinct from v_supply::numeric
       or d.verified_total_supply_text is distinct from v_supply then
      raise exception 'PCART_P7: token identity/supply evidence mismatch.' using errcode = '22023';
    end if;
    -- P6 persists the Treasury Safe balance AT THE DEPLOYMENT BLOCK as verified_recipient_balance;
    -- P6's CONFIRMED write is only reachable when the deployer balance at that block was exactly 0.
    if d.verified_recipient_balance is distinct from v_supply::numeric
       or d.verified_recipient_balance_text is distinct from v_supply then
      raise exception 'PCART_P7: Treasury Safe did not hold the full supply at the deployment block.' using errcode = '22023';
    end if;
    if nullif(btrim(coalesce(d.failure_code, '')), '') is not null
       or nullif(btrim(coalesce(d.failure_detail, '')), '') is not null then
      raise exception 'PCART_P7: deployment evidence records a failure state.' using errcode = '22023';
    end if;
    if d.init_code_hash is null or d.review_fingerprint is null then
      raise exception 'PCART_P7: init code hash / review fingerprint missing.' using errcode = '22023';
    end if;
    select * into l from public.launches where id = _launch_id;
    if (l.official_contract_deployment_id is not null and l.official_contract_deployment_id is distinct from d.id)
       or (l.official_contract_address is not null and lower(l.official_contract_address) is distinct from d.contract_address) then
      raise exception 'PCART_P7: a different official contract is already registered.' using errcode = '42501';
    end if;
    select * into k from public.launch_chain_production_execution_controls where control_key = 'ROBINHOOD_MAINNET_DEPLOYMENT';
    if k.control_key is null or k.execution_enabled is distinct from false or k.emergency_stop_engaged is distinct from true then
      raise exception 'PCART_P7: global execution must remain OFF with the emergency stop ON.' using errcode = '42501';
    end if;
    return d.contract_address;
  end if;

  -- ===================== GENERIC BRANCH (unchanged) =====================
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

-- Generic registration: explicitly refuse canonical PCART, otherwise unchanged.
CREATE OR REPLACE FUNCTION public.register_verified_launch_contract(_launch_id uuid, _deployment_id uuid, _expected_contract_address text)
 RETURNS launches
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  launch_row public.launches;
  derived_address text;
  expected_address text;
  d public.launch_chain_deployments;
begin
  if private.is_canonical_pcart_launch(_launch_id)
     or exists (select 1 from public.launch_chain_deployments x where x.id = _deployment_id and x.artifact_id = 'pepecartel-token-v1') then
    raise exception 'Canonical PCART must use register_canonical_pcart_official_contract.' using errcode = '42501';
  end if;

  select * into launch_row from public.launches where id = _launch_id for update;
  if launch_row.id is null then
    raise exception 'Launch not found.' using errcode = 'P0002';
  end if;
  if not public.is_workspace_owner(launch_row.workspace_id, auth.uid()) then
    raise exception 'Only the project owner can register the official contract.' using errcode = '42501';
  end if;
  expected_address := lower(nullif(btrim(coalesce(_expected_contract_address, '')), ''));
  if expected_address is null then
    raise exception 'Type the exact contract address to confirm registration.' using errcode = '22023';
  end if;
  derived_address := public.assert_launch_contract_evidence(launch_row.id, launch_row.workspace_id, launch_row.chain, _deployment_id);
  if expected_address <> lower(derived_address) then
    raise exception 'The confirmation address does not match the selected deployment evidence.' using errcode = '22023';
  end if;
  if launch_row.official_contract_address is not null
     or launch_row.official_contract_deployment_id is not null
     or launch_row.contract_registered_at is not null then
    if launch_row.official_contract_deployment_id = _deployment_id
       and lower(launch_row.official_contract_address) = lower(derived_address) then
      return launch_row;
    end if;
    raise exception 'A registered official contract cannot be replaced.' using errcode = '42501';
  end if;
  if launch_row.status <> 'CONTRACT_PENDING' then
    raise exception 'An official contract can only be registered while the launch is Contract Pending.' using errcode = '22023';
  end if;
  update public.launches set official_contract_deployment_id = _deployment_id
   where id = _launch_id returning * into launch_row;
  if exists (select 1 from public.launch_contract_registration_events e where e.launch_id = launch_row.id and e.action = 'ACCEPTED') then
    raise exception 'A registration decision already exists for this launch.' using errcode = '42501';
  end if;
  select * into d from public.launch_chain_deployments where id = _deployment_id;
  insert into public.launch_contract_registration_events (
    workspace_id, launch_id, action, deployment_id, contract_address, evidence_snapshot, actor_id
  ) values (
    launch_row.workspace_id, launch_row.id, 'ACCEPTED', d.id,
    coalesce(launch_row.official_contract_address, derived_address),
    jsonb_build_object(
      'deployment_id', d.id, 'chain_id', d.chain_id, 'network_environment', d.network_environment,
      'deployment_kind', d.deployment_kind, 'artifact_id', d.artifact_id, 'tx_hash', d.tx_hash,
      'contract_address', d.contract_address, 'status', d.status, 'block_number', d.block_number,
      'block_hash', d.block_hash, 'confirmations', d.confirmations, 'verified_at', d.verified_at,
      'deployer_address', d.deployer_address, 'token_name', d.token_name, 'token_symbol', d.token_symbol,
      'token_decimals', d.token_decimals, 'token_recipient', d.token_recipient,
      'token_total_supply_text', d.token_total_supply_text, 'verified_token_name', d.verified_token_name,
      'verified_token_symbol', d.verified_token_symbol, 'verified_token_decimals', d.verified_token_decimals,
      'verified_total_supply_text', d.verified_total_supply_text,
      'verified_recipient_balance_text', d.verified_recipient_balance_text
    ),
    auth.uid()
  );
  return launch_row;
end;
$function$;

-- PCART P7 registration. Never LIVE, never notifies, never corrects.
CREATE OR REPLACE FUNCTION public.register_canonical_pcart_official_contract(_launch_id uuid, _deployment_id uuid, _expected_contract_address text)
 RETURNS public.launches
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  l public.launches;
  d public.launch_chain_deployments;
  c public.pcart_production_send_claims;
  v_addr text;
  v_expected text := lower(nullif(btrim(coalesce(_expected_contract_address, '')), ''));
  v_existing public.launch_contract_registration_events;
begin
  if auth.uid() is null or not public.is_platform_owner(auth.uid()) then
    raise exception 'PCART_P7: only the platform owner can register the official PCART contract.' using errcode = '42501';
  end if;
  if not private.is_canonical_pcart_launch(_launch_id) then
    raise exception 'PCART_P7: not the canonical PEPECARTEL launch.' using errcode = '42501';
  end if;
  select * into l from public.launches where id = _launch_id for update;
  select * into d from public.launch_chain_deployments where id = _deployment_id for update;
  if d.id is null or d.launch_id is distinct from l.id or d.artifact_id is distinct from 'pepecartel-token-v1'
     or d.network_environment is distinct from 'PRODUCTION' or d.chain_id is distinct from 4663 then
    raise exception 'PCART_P7: not the canonical PCART production deployment.' using errcode = '42501';
  end if;
  if v_expected is null or v_expected !~ '^0x[0-9a-f]{40}$' then
    raise exception 'PCART_P7: type the exact verified contract address to confirm.' using errcode = '22023';
  end if;

  v_addr := public.assert_launch_contract_evidence(l.id, l.workspace_id, l.chain, d.id);
  if v_expected <> lower(v_addr) then
    raise exception 'PCART_P7: confirmation address does not match the verified contract.' using errcode = '22023';
  end if;

  -- Idempotent exact rerun.
  if l.official_contract_address is not null or l.official_contract_deployment_id is not null or l.contract_registered_at is not null then
    select * into v_existing from public.launch_contract_registration_events
     where launch_id = l.id and action = 'ACCEPTED';
    if l.status = 'OFFICIAL_CONTRACT_REGISTERED' and l.official_contract_deployment_id = d.id
       and lower(l.official_contract_address) = lower(v_addr) and v_existing.deployment_id = d.id then
      return l;
    end if;
    raise exception 'PCART_P7: a different or incomplete official binding exists; P7 never corrects.' using errcode = '42501';
  end if;
  if exists (select 1 from public.launch_contract_registration_events e where e.launch_id = l.id) then
    raise exception 'PCART_P7: a registration decision already exists for this launch.' using errcode = '42501';
  end if;
  if l.status not in ('LAUNCH_APPROACHING', 'CONTRACT_PENDING') then
    raise exception 'PCART_P7: launch must be LAUNCH_APPROACHING or CONTRACT_PENDING (is %).', l.status using errcode = '22023';
  end if;

  if l.status = 'LAUNCH_APPROACHING' then
    update public.launches set status = 'CONTRACT_PENDING' where id = l.id returning * into l;
  end if;

  -- Guarded contract-field path: trigger re-derives address and stamps registered_at/by.
  update public.launches set official_contract_deployment_id = d.id where id = l.id returning * into l;

  select * into c from public.pcart_production_send_claims
   where deployment_id = d.id and claim_status = 'BROADCAST' and tx_hash = d.tx_hash;

  insert into public.launch_contract_registration_events (
    workspace_id, launch_id, action, deployment_id, contract_address, evidence_snapshot, actor_id
  ) values (
    l.workspace_id, l.id, 'ACCEPTED', d.id, v_addr,
    jsonb_build_object(
      'path', 'PCART_P7',
      'deployment_id', d.id, 'chain_id', d.chain_id, 'network_environment', d.network_environment,
      'deployment_kind', d.deployment_kind, 'artifact_id', d.artifact_id,
      'tx_hash', d.tx_hash, 'contract_address', d.contract_address,
      'p5_broadcast_claim_id', c.id, 'p5_predicted_contract_address', c.predicted_contract_address,
      'deployer_address', d.deployer_address, 'deployer_nonce', d.deployer_nonce_before,
      'treasury_safe', d.token_recipient,
      'block_number', d.block_number, 'block_hash', d.block_hash,
      'runtime_code_hash_expected', '0x69ef7ad36b6c4b900d390bc4977eb61a518e9d35e506a6f83712192c7e7d03e4',
      'init_code_hash', d.init_code_hash, 'review_fingerprint', d.review_fingerprint,
      'verified_token_name', d.verified_token_name, 'verified_token_symbol', d.verified_token_symbol,
      'verified_token_decimals', d.verified_token_decimals, 'verified_total_supply_text', d.verified_total_supply_text,
      'safe_balance_at_deployment_block_text', d.verified_recipient_balance_text,
      'deployer_balance_at_deployment_block_text', '0',
      'deployer_balance_source', 'P6_CONFIRMED_WRITE_GATE',
      'verified_at', d.verified_at, 'finality_state', d.finality_state, 'finalized_at', d.finalized_at,
      'finalized_block_number', d.finalized_block_number, 'finalized_head_block_number', d.finalized_head_block_number,
      'finalized_block_hash_confirmed', d.finalized_block_hash_confirmed, 'finality_provider_kind', d.finality_provider_kind
    ),
    auth.uid()
  );

  update public.launches set status = 'OFFICIAL_CONTRACT_REGISTERED' where id = l.id returning * into l;
  return l;
end;
$function$;

REVOKE ALL ON FUNCTION public.register_canonical_pcart_official_contract(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_canonical_pcart_official_contract(uuid, uuid, text) TO authenticated;