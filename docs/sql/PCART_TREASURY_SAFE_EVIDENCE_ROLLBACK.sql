-- Rollback for docs/sql/PCART_TREASURY_SAFE_EVIDENCE.sql — STAGED, NOT APPLIED.
-- WARNING: drops any recorded Safe evidence columns. Signer rows are preserved.
DROP FUNCTION IF EXISTS public.save_launch_treasury_safe_evidence(uuid, text, text, text, bigint);
DROP TRIGGER IF EXISTS guard_launch_treasury_safe_evidence ON public.launch_treasury_signer_configs;
DROP FUNCTION IF EXISTS public.guard_launch_treasury_safe_evidence();
ALTER TABLE public.launch_treasury_signer_configs
  DROP CONSTRAINT IF EXISTS launch_treasury_signer_configs_safe_evidence_complete,
  DROP CONSTRAINT IF EXISTS launch_treasury_signer_configs_safe_block_positive,
  DROP CONSTRAINT IF EXISTS launch_treasury_signer_configs_safe_tx_shape,
  DROP CONSTRAINT IF EXISTS launch_treasury_signer_configs_safe_salt_shape,
  DROP CONSTRAINT IF EXISTS launch_treasury_signer_configs_safe_address_shape,
  DROP COLUMN IF EXISTS safe_verified_block,
  DROP COLUMN IF EXISTS safe_verified_at,
  DROP COLUMN IF EXISTS safe_creation_tx_hash,
  DROP COLUMN IF EXISTS safe_salt_nonce,
  DROP COLUMN IF EXISTS safe_address;
