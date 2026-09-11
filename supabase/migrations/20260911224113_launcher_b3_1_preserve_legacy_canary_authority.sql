do $$
declare
  rec record;
  v_oid oid;
  v_def text;
  v_count integer;
begin
  for rec in
    select * from (values
      ('public.arm_launch_chain_production_canary_execution(uuid,uuid,uuid,bigint,text)',
       'private\.can_operate_launch_production_request\(d\.workspace_id, d\.launch_id, _operator_user_id\)',
       '(public.is_workspace_operator(d.workspace_id, _operator_user_id) or private.can_operate_launch_production_request(d.workspace_id, d.launch_id, _operator_user_id))'),
      ('public.authorize_launch_chain_production_send_window_issuance(uuid,uuid,uuid)',
       'private\.can_operate_launch_production_request\(d\.workspace_id, d\.launch_id, _operator_user_id\)',
       '(public.is_workspace_operator(d.workspace_id, _operator_user_id) or private.can_operate_launch_production_request(d.workspace_id, d.launch_id, _operator_user_id))'),
      ('public.cancel_claimed_launch_chain_production_presign_authorization(uuid,uuid,text)',
       'private\.can_operate_launch_production_request\(d\.workspace_id, d\.launch_id, _operator_user_id\)',
       '(public.is_workspace_operator(d.workspace_id, _operator_user_id) or private.can_operate_launch_production_request(d.workspace_id, d.launch_id, _operator_user_id))'),
      ('public.get_launch_chain_production_reconciliation_snapshot(uuid,uuid)',
       'private\.can_operate_launch_production_request\(d\.workspace_id, d\.launch_id, _operator_user_id\)',
       '(public.is_workspace_operator(d.workspace_id, _operator_user_id) or private.can_operate_launch_production_request(d.workspace_id, d.launch_id, _operator_user_id))'),
      ('public.submit_launch_chain_production_deployment_tx(uuid,uuid,uuid,text)',
       'private\.can_operate_launch_production_request\(d\.workspace_id, d\.launch_id, _operator_user_id\)',
       '(public.is_workspace_operator(d.workspace_id, _operator_user_id) or private.can_operate_launch_production_request(d.workspace_id, d.launch_id, _operator_user_id))'),
      ('public.enforce_launch_chain_production_presign()',
       'private\.can_operate_launch_production_request\(d\.workspace_id, d\.launch_id, NEW\.operator_user_id\)',
       '(public.is_workspace_operator(d.workspace_id, NEW.operator_user_id) or private.can_operate_launch_production_request(d.workspace_id, d.launch_id, NEW.operator_user_id))')
    ) as t(signature, pattern, replacement)
  loop
    v_oid := to_regprocedure(rec.signature);
    if v_oid is null then
      raise exception 'Required function missing: %', rec.signature;
    end if;
    select pg_get_functiondef(v_oid) into v_def;
    select count(*) into v_count from regexp_matches(v_def, rec.pattern, 'gi');
    if v_count <> 1 then
      raise exception 'Expected exactly one request-only predicate in %, found %', rec.signature, v_count;
    end if;
    execute regexp_replace(v_def, rec.pattern, rec.replacement, 'gi');
  end loop;
end;
$$;

do $$
declare
  rec record;
begin
  for rec in
    select p.oid::regprocedure::text as signature, pg_get_functiondef(p.oid) as definition
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname='public'
      and p.proname in (
        'arm_launch_chain_production_canary_execution',
        'authorize_launch_chain_production_send_window_issuance',
        'cancel_claimed_launch_chain_production_presign_authorization',
        'get_launch_chain_production_reconciliation_snapshot',
        'submit_launch_chain_production_deployment_tx',
        'enforce_launch_chain_production_presign'
      )
  loop
    if position('public.is_workspace_operator' in rec.definition) = 0
       or position('private.can_operate_launch_production_request' in rec.definition) = 0 then
      raise exception 'Authority parity missing in %', rec.signature;
    end if;
  end loop;
end;
$$;