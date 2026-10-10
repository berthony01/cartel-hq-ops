CREATE OR REPLACE FUNCTION private.pcart_p93b_option1_sig_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.owner_account_kind IS DISTINCT FROM 'EOA' THEN
    RAISE EXCEPTION 'PCART_P9_3B: only plain-EOA Treasury owners are eligible launch signers (Option 1).' USING errcode = '22023';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS pcart_p93b_option1_sig_guard ON public.pcart_launch_coordinator_signatures;
CREATE TRIGGER pcart_p93b_option1_sig_guard BEFORE INSERT OR UPDATE OF owner_account_kind ON public.pcart_launch_coordinator_signatures
  FOR EACH ROW EXECUTE FUNCTION private.pcart_p93b_option1_sig_guard();

CREATE OR REPLACE FUNCTION private.pcart_p93b_option1_permit_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF (SELECT count(*) FROM public.pcart_launch_coordinator_signatures
       WHERE action_id = NEW.action_id AND status = 'VALID' AND owner_account_kind = 'EOA'
         AND signer_address IN (NEW.signer_1, NEW.signer_2) AND safe_tx_hash = NEW.safe_tx_hash) <> 2 THEN
    RAISE EXCEPTION 'PCART_P9_3B: permit requires two plain-EOA owner signatures (Option 1).' USING errcode = '22023';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS pcart_p93b_option1_permit_guard ON public.pcart_launch_coordinator_action_permits;
CREATE TRIGGER pcart_p93b_option1_permit_guard BEFORE INSERT ON public.pcart_launch_coordinator_action_permits
  FOR EACH ROW EXECUTE FUNCTION private.pcart_p93b_option1_permit_guard();