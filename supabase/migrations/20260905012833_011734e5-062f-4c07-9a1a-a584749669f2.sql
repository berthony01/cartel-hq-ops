-- C8.7B closeout security hardening.
-- Narrow ACL/privilege corrections only. No table, trigger, policy, function
-- body, or registration semantics are changed here.

-- The registration guard must be able to re-derive evidence regardless of the
-- caller's direct privileges on the internal helpers revoked below.
ALTER FUNCTION public.enforce_launch_contract_update() SECURITY DEFINER;

-- Internal evidence derivation is reachable only through the owner-facing
-- register_verified_launch_contract path and the guard trigger, never directly.
REVOKE EXECUTE ON FUNCTION public.assert_launch_contract_evidence(uuid, uuid, text, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.assert_launch_contract_evidence(uuid, uuid, text, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.assert_launch_contract_evidence(uuid, uuid, text, uuid) FROM authenticated;

REVOKE EXECUTE ON FUNCTION public.launch_chain_label_is_robinhood_mainnet(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.launch_chain_label_is_robinhood_mainnet(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.launch_chain_label_is_robinhood_mainnet(text) FROM authenticated;