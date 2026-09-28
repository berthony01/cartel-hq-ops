
CREATE INDEX IF NOT EXISTS partner_applications_terms_version_idx
  ON public.partner_applications (terms_version);
CREATE INDEX IF NOT EXISTS partner_acceptances_terms_version_idx
  ON public.partner_agreement_acceptances (terms_version);
CREATE INDEX IF NOT EXISTS partner_referrals_terms_version_idx
  ON public.partner_referrals (terms_version);
CREATE INDEX IF NOT EXISTS partner_payout_requests_terms_version_idx
  ON public.partner_payout_requests (terms_version);
CREATE INDEX IF NOT EXISTS partner_ledger_referral_idx
  ON public.partner_commission_ledger (referral_id);
CREATE INDEX IF NOT EXISTS partner_ledger_workspace_idx
  ON public.partner_commission_ledger (workspace_id);
CREATE INDEX IF NOT EXISTS partner_ledger_terms_version_idx
  ON public.partner_commission_ledger (terms_version);

ALTER POLICY partner_terms_read_active_or_owner ON public.partner_program_terms
  USING (status = 'active' OR public.is_platform_owner((SELECT auth.uid())));
ALTER POLICY partners_read_own_or_owner ON public.partners
  USING (user_id = (SELECT auth.uid()) OR public.is_platform_owner((SELECT auth.uid())));
ALTER POLICY partner_applications_read_own_or_owner ON public.partner_applications
  USING (user_id = (SELECT auth.uid()) OR public.is_platform_owner((SELECT auth.uid())));
ALTER POLICY partner_acceptances_read_own_or_owner ON public.partner_agreement_acceptances
  USING (
    EXISTS (
      SELECT 1 FROM public.partners p
      WHERE p.id = partner_id AND p.user_id = (SELECT auth.uid())
    )
    OR public.is_platform_owner((SELECT auth.uid()))
  );
ALTER POLICY partner_referrals_read_own_or_owner ON public.partner_referrals
  USING (
    EXISTS (
      SELECT 1 FROM public.partners p
      WHERE p.id = partner_id AND p.user_id = (SELECT auth.uid())
    )
    OR public.is_platform_owner((SELECT auth.uid()))
  );
ALTER POLICY partner_payouts_read_own_or_owner ON public.partner_payout_requests
  USING (
    EXISTS (
      SELECT 1 FROM public.partners p
      WHERE p.id = partner_id AND p.user_id = (SELECT auth.uid())
    )
    OR public.is_platform_owner((SELECT auth.uid()))
  );
ALTER POLICY partner_ledger_read_own_or_owner ON public.partner_commission_ledger
  USING (
    EXISTS (
      SELECT 1 FROM public.partners p
      WHERE p.id = partner_id AND p.user_id = (SELECT auth.uid())
    )
    OR public.is_platform_owner((SELECT auth.uid()))
  );
