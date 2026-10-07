<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- Keep Telegram delivery state machines transport-owned; presentation helpers may only transform a payload immediately before the existing single send/edit call, never add fallback sends.
- Keep Mission Setup Auto-select provider reads in the external Supabase function where the existing X credential lives; the app bridge may only forward signed initData and return bounded suggestions.
- PCART auction/liquidity plan (P8A, current manifest version only; reviews of older versions never count) lives only in `src/lib/pcart-auction-liquidity-plan.ts` (declarative manifest + pure wei math + inert intents) with reviews in immutable owner-only `pcart_auction_liquidity_plan_reviews`; why: one pinned source for addresses/hashes and no execution capability until a separately authorized P8B+.
- PCART auction execution parameters (P8B, current manifest version only) live only in `src/lib/pcart-auction-execution-p8b.ts` (manifest bound to the P8A version/fingerprint, fork evidence, PREPARE-ONLY Safe/migrate templates that are never executable) with reviews in immutable owner-only `pcart_auction_execution_rehearsal_reviews` whose RPC pins the exact manifest fingerprint; fork harness lives only in `fork-tests/p8b` (test-only, never bundled or CI-run); why: one pinned, reproducible source for live calldata with no signing/sending capability until a separately authorized coordinator phase.
- PCART Launch Day coordinator (P9) state derivation lives only in `src/lib/pcart-launch-coordinator-p9.ts` (pure, read-only), live-read interpretation only in `pcart-launch-coordinator-p9-live.ts` (pure) and chain RPC reads only in `pcart-launch-coordinator-p9-readers.server.ts` (server-only, view calls) with owner-only planning/revocation/activity tables; P8A/P8B policy approval is manifest-fingerprint based (latest review, not revoked), while review `expires_at` is attestation freshness only; why: a 21-day runway must not force daily re-review, and the coordinator must never gain execution capability without a separately authorized phase.
- Canonical PCART send permits are issued/claimed only through the service-role-only `issue_canonical_pcart_execution_permit_v2` / `claim_canonical_pcart_mainnet_send_v2`, called by server functions after a fresh server-side live attestation (`pcart-p9-2-attestation.server.ts`); permits bind P8A/P8B review, dependency + Safe attestation fingerprints (rules in `pcart-p9-2-permit-binding.ts`, preimages byte-identical to SQL) and the control revision, and are valid only while global execution stays OFF with emergency stop ON (CANONICAL_PCART_PROTECTED); why: the browser cannot skip live re-attestation and the general mainnet path never opens for PCART.
