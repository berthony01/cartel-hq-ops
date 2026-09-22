ALTER TABLE public.usage_ledger
  ADD COLUMN IF NOT EXISTS provider text NULL,
  ADD COLUMN IF NOT EXISTS provider_model text NULL,
  ADD COLUMN IF NOT EXISTS unit_type text NULL,
  ADD COLUMN IF NOT EXISTS currency text NULL,
  ADD COLUMN IF NOT EXISTS pricing_source text NULL,
  ADD COLUMN IF NOT EXISTS pricing_version text NULL,
  ADD COLUMN IF NOT EXISTS pricing_effective_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS idempotency_key text NULL,
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS usage_ledger_idempotency_key_uniq
  ON public.usage_ledger (idempotency_key);

COMMENT ON COLUMN public.usage_ledger.units IS 'Raw provider-reported quantity for this event (never a dollar amount).';
COMMENT ON COLUMN public.usage_ledger.unit_type IS 'Discriminator for units, e.g. provider_credit.';
COMMENT ON COLUMN public.usage_ledger.idempotency_key IS 'Stable key per real provider charge/event; uniqueness is enforced by usage_ledger_idempotency_key_uniq.';