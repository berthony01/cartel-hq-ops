-- =====================================================================
-- P3C-F2 — ONE-TIME PEPECARTEL LAUNCH CHAIN METADATA RECONCILIATION
-- =====================================================================
-- APPLIED. This is the reviewed reference copy. The reconciliation it
-- describes was deliberately applied to the live CARTEL HQ database
-- (Supabase project ocoinbnjgstkmnwwvnhi).
--
--   live migration version : 20260907135738
--   live migration name    : reconcile_pepecartel_launch_chain_to_robinhood
--   parity record in repo  : supabase/migrations/20260907135738_reconcile_pepecartel_launch_chain_to_robinhood.sql
--
-- This reference copy is NOT executed by the migration runner; the parity
-- file above is the executable record. The SQL body below is unchanged.

--
-- It performs a single auditable correction of ONE column on ONE row:
--
--   public.launches.chain : 'Solana' -> 'Robinhood Chain'
--   for the stable slug   : 'pepecartel-launch'
--
-- WHY: the project was created historically under Solana, before the
-- launcher pivoted to Robinhood Chain. The linked project profile already
-- records primary_chain = 'Robinhood Chain'; the launch row is the stale
-- side of that pair. Nothing else about the launch is wrong.
--
-- WHAT THIS DOES NOT DO
--   - does not create, alter, drop or replace any function, trigger
--     definition, policy, grant, RPC, schema object or type;
--   - does not weaken the permanent identity-lock invariant. The
--     enforce_launch_update_rules trigger is disabled for the duration of
--     this single statement ONLY, under an ACCESS EXCLUSIVE lock, and is
--     re-enabled and re-asserted before completion;
--   - does not touch ticker, token_name, public_slug, status, ownership,
--     schedule, watch token or any contract field. `updated_at` may move
--     only through the pre-existing normal trigger;
--   - does not arm execution, clear the emergency stop, register a
--     contract, create a deployment/presign/permit/send window, or move
--     any value;
--   - contains NO reverse migration. Silently restoring 'Solana' would
--     re-introduce the defect; any future change must be its own audited
--     migration.
--
-- FAILURE MODE: every precondition RAISEs. PostgreSQL DDL is
-- transactional, so ANY exception rolls back the entire migration,
-- including the temporary trigger state.
-- =====================================================================

DO $p3c_f2$
DECLARE
  v_launch            public.launches%ROWTYPE;
  v_after             public.launches%ROWTYPE;
  v_count             integer;
  v_trigger_name      text;
  v_trigger_enabled   "char";
  v_rows              integer;
BEGIN
  -- -----------------------------------------------------------------
  -- 1. Serialize against every concurrent writer BEFORE any bypass.
  --    Taking the strongest table lock first means the trigger is never
  --    disabled while another session could be updating a launch.
  -- -----------------------------------------------------------------
  LOCK TABLE public.launches IN ACCESS EXCLUSIVE MODE;

  -- -----------------------------------------------------------------
  -- 2. Preconditions. FAIL CLOSED on anything unexpected.
  -- -----------------------------------------------------------------

  -- 2.1 Exactly one target row, by STABLE SLUG (no hardcoded UUIDs).
  SELECT count(*) INTO v_count
  FROM public.launches
  WHERE public_slug = 'pepecartel-launch';

  IF v_count <> 1 THEN
    RAISE EXCEPTION
      'P3C-F2 ABORT: expected exactly 1 launch with public_slug=%, found %',
      'pepecartel-launch', v_count;
  END IF;

  SELECT * INTO v_launch
  FROM public.launches
  WHERE public_slug = 'pepecartel-launch';

  -- 2.2 Exact expected identity of the row being repaired.
  IF v_launch.token_name <> 'PEPECARTEL' THEN
    RAISE EXCEPTION 'P3C-F2 ABORT: unexpected token_name %', v_launch.token_name;
  END IF;

  IF v_launch.ticker <> '$PCART' THEN
    RAISE EXCEPTION 'P3C-F2 ABORT: unexpected ticker %', v_launch.ticker;
  END IF;

  IF v_launch.chain <> 'Solana' THEN
    RAISE EXCEPTION
      'P3C-F2 ABORT: chain is %, not the expected stale value Solana (already repaired?)',
      v_launch.chain;
  END IF;

  IF v_launch.status <> 'WATCHLIST_OPEN' THEN
    RAISE EXCEPTION 'P3C-F2 ABORT: unexpected status %', v_launch.status;
  END IF;

  IF v_launch.official_contract_address IS NOT NULL THEN
    RAISE EXCEPTION 'P3C-F2 ABORT: launch already has an official contract address';
  END IF;

  IF v_launch.official_contract_deployment_id IS NOT NULL THEN
    RAISE EXCEPTION 'P3C-F2 ABORT: launch already has an official contract deployment';
  END IF;

  -- 2.3 The linked project profile must already be Robinhood Chain, so
  --     this repair converges the pair rather than inventing a value.
  SELECT count(*) INTO v_count
  FROM public.project_profiles pp
  WHERE pp.id = v_launch.project_profile_id
    AND pp.primary_chain = 'Robinhood Chain';

  IF v_count <> 1 THEN
    RAISE EXCEPTION
      'P3C-F2 ABORT: linked project profile is missing or its primary_chain is not Robinhood Chain';
  END IF;

  -- 2.4 No PRODUCTION chain deployment may exist for this launch.
  SELECT count(*) INTO v_count
  FROM public.launch_chain_deployments d
  WHERE d.launch_id = v_launch.id
    AND d.network_environment = 'PRODUCTION';

  IF v_count <> 0 THEN
    RAISE EXCEPTION
      'P3C-F2 ABORT: % production deployment row(s) already exist for this launch', v_count;
  END IF;

  -- 2.5 Global production runtime execution control must be STOPPED.
  SELECT count(*) INTO v_count
  FROM public.launch_chain_production_execution_controls c
  WHERE c.control_key = 'ROBINHOOD_MAINNET_DEPLOYMENT'
    AND c.execution_enabled = false
    AND c.emergency_stop_engaged = true;

  IF v_count <> 1 THEN
    RAISE EXCEPTION
      'P3C-F2 ABORT: ROBINHOOD_MAINNET_DEPLOYMENT control is missing or not fully stopped';
  END IF;

  -- 2.6 No open (issued/claimed and unexpired, not consumed or
  --     invalidated) production presign authorization for this launch.
  SELECT count(*) INTO v_count
  FROM public.launch_chain_production_presign_authorizations a
  WHERE a.launch_id = v_launch.id
    AND a.network_environment = 'PRODUCTION'
    AND a.status IN ('ISSUED', 'CLAIMED')
    AND a.consumed_at IS NULL
    AND a.invalidated_at IS NULL
    AND a.expires_at > now();

  IF v_count <> 0 THEN
    RAISE EXCEPTION 'P3C-F2 ABORT: % open production presign authorization(s)', v_count;
  END IF;

  -- 2.7 No unexpired production canary permit for this launch.
  SELECT count(*) INTO v_count
  FROM public.launch_chain_production_canary_permits p
  WHERE p.launch_id = v_launch.id
    AND p.network_environment = 'PRODUCTION'
    AND p.expires_at > now();

  IF v_count <> 0 THEN
    RAISE EXCEPTION 'P3C-F2 ABORT: % unexpired production canary permit(s)', v_count;
  END IF;

  -- 2.8 No production send-window issuance for this launch, ever.
  SELECT count(*) INTO v_count
  FROM public.launch_chain_production_send_window_issuances w
  WHERE w.launch_id = v_launch.id
    AND w.network_environment = 'PRODUCTION';

  IF v_count <> 0 THEN
    RAISE EXCEPTION 'P3C-F2 ABORT: % production send-window issuance(s)', v_count;
  END IF;

  -- 2.9 No contract registration event for this launch, ever.
  SELECT count(*) INTO v_count
  FROM public.launch_contract_registration_events e
  WHERE e.launch_id = v_launch.id;

  IF v_count <> 0 THEN
    RAISE EXCEPTION 'P3C-F2 ABORT: % contract registration event(s) for this launch', v_count;
  END IF;

  -- -----------------------------------------------------------------
  -- 3. Resolve the identity-lock trigger EXACTLY. Never USER/ALL, never
  --    the status, contract or schedule triggers.
  -- -----------------------------------------------------------------
  SELECT t.tgname, t.tgenabled
    INTO v_trigger_name, v_trigger_enabled
  FROM pg_trigger t
  WHERE t.tgrelid = 'public.launches'::regclass
    AND NOT t.tgisinternal
    AND t.tgfoid = 'public.enforce_launch_update_rules'::regproc;

  IF v_trigger_name IS NULL THEN
    RAISE EXCEPTION
      'P3C-F2 ABORT: enforce_launch_update_rules trigger not found on public.launches';
  END IF;

  IF v_trigger_name <> 'enforce_launch_update_rules_trigger' THEN
    RAISE EXCEPTION 'P3C-F2 ABORT: unexpected identity-lock trigger name %', v_trigger_name;
  END IF;

  IF v_trigger_enabled <> 'O' THEN
    RAISE EXCEPTION
      'P3C-F2 ABORT: identity-lock trigger is not in the normal enabled state (tgenabled=%)',
      v_trigger_enabled;
  END IF;

  -- Disable ONE named trigger only, for one statement.
  EXECUTE format('ALTER TABLE public.launches DISABLE TRIGGER %I', v_trigger_name);

  -- -----------------------------------------------------------------
  -- 4. The single, narrow repair. Only `chain`, only the stale value.
  -- -----------------------------------------------------------------
  UPDATE public.launches
     SET chain = 'Robinhood Chain'
   WHERE public_slug = 'pepecartel-launch'
     AND chain = 'Solana';

  GET DIAGNOSTICS v_rows = ROW_COUNT;

  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'P3C-F2 ABORT: repair affected % row(s), expected exactly 1', v_rows;
  END IF;

  -- -----------------------------------------------------------------
  -- 5. Restore the permanent invariant.
  -- -----------------------------------------------------------------
  EXECUTE format('ALTER TABLE public.launches ENABLE TRIGGER %I', v_trigger_name);

  -- -----------------------------------------------------------------
  -- 6. Postconditions. Anything short of this rolls the whole thing back.
  -- -----------------------------------------------------------------
  SELECT count(*) INTO v_count
  FROM public.launches
  WHERE public_slug = 'pepecartel-launch'
    AND chain = 'Robinhood Chain';

  IF v_count <> 1 THEN
    RAISE EXCEPTION 'P3C-F2 ABORT: postcondition failed, % repaired row(s)', v_count;
  END IF;

  SELECT * INTO v_after
  FROM public.launches
  WHERE public_slug = 'pepecartel-launch';

  IF v_after.id                                 IS DISTINCT FROM v_launch.id
     OR v_after.token_name                      IS DISTINCT FROM v_launch.token_name
     OR v_after.ticker                          IS DISTINCT FROM v_launch.ticker
     OR v_after.public_slug                     IS DISTINCT FROM v_launch.public_slug
     OR v_after.status                          IS DISTINCT FROM v_launch.status
     OR v_after.workspace_id                    IS DISTINCT FROM v_launch.workspace_id
     OR v_after.project_profile_id              IS DISTINCT FROM v_launch.project_profile_id
     OR v_after.created_by                      IS DISTINCT FROM v_launch.created_by
     OR v_after.launch_at                       IS DISTINCT FROM v_launch.launch_at
     OR v_after.launch_window_start             IS DISTINCT FROM v_launch.launch_window_start
     OR v_after.launch_window_end               IS DISTINCT FROM v_launch.launch_window_end
     OR v_after.timezone                        IS DISTINCT FROM v_launch.timezone
     OR v_after.status_changed_at               IS DISTINCT FROM v_launch.status_changed_at
     OR v_after.watchlist_opened_at             IS DISTINCT FROM v_launch.watchlist_opened_at
     OR v_after.launch_watch_token              IS DISTINCT FROM v_launch.launch_watch_token
     OR v_after.launch_watch_token_created_at   IS DISTINCT FROM v_launch.launch_watch_token_created_at
     OR v_after.official_contract_address       IS DISTINCT FROM v_launch.official_contract_address
     OR v_after.official_contract_deployment_id IS DISTINCT FROM v_launch.official_contract_deployment_id
     OR v_after.contract_registered_at          IS DISTINCT FROM v_launch.contract_registered_at
     OR v_after.contract_registered_by          IS DISTINCT FROM v_launch.contract_registered_by
  THEN
    RAISE EXCEPTION 'P3C-F2 ABORT: postcondition failed, a field other than chain changed';
  END IF;

  SELECT t.tgenabled INTO v_trigger_enabled
  FROM pg_trigger t
  WHERE t.tgrelid = 'public.launches'::regclass
    AND t.tgname = v_trigger_name;

  IF v_trigger_enabled IS DISTINCT FROM 'O'::"char" THEN
    RAISE EXCEPTION
      'P3C-F2 ABORT: identity-lock trigger did not return to the enabled state (tgenabled=%)',
      v_trigger_enabled;
  END IF;

  RAISE NOTICE
    'P3C-F2 OK: pepecartel-launch chain reconciled Solana -> Robinhood Chain; identity lock intact.';
END
$p3c_f2$;
