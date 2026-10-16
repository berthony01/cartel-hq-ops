# PEPE CARTEL / Cartel HQ — G2E Conversational Guide Integration & Release Gates
**Date:** 2026-10-14 CDT
**Owner direction:** FINISH THE EXISTING Cartel HQ AI Guide, not an unrelated AI service, new application or endless testing program.
**Status:** Draft-only code integrated; NO DEPLOYMENT, NO MODEL CREDITS, NO PROD CHANGES.

## Exactly what this draft adds
- Reuses **existing** `src/components/cartel/GuideConversationPreview.tsx` (embedded within existing Setup Help) for a real submitted question, sourced from the current selected workspace and authenticated session. It calls **existing** `cartel-guide` Supabase function; plain-text answer and trusted public /docs links are displayed, max 5 recent questions in component memory, no private workspace details included in model prompt.
- Reuses **existing** `supabase/functions/cartel-guide/index.ts` to verify signed-in identity and selected tenant via the already tested G2A.1 authorization contract; then requires **both** `CARTEL_GUIDE_ENABLED=true` and a new independent `CARTEL_GUIDE_PAID_CALLS_ENABLED=true` config, before any provider or billable model step.
- The server chooses at most 3 public articles through the already committed G2B retrieval library, prepares a text-only request using the existing G2C Kie.ai chat contract, and NEVER sends private Telegram, wallet or billing/account records to Kie.ai.
- Calls the existing G2A.2 service-role-only atomic budget RPC **reserve**; requires exactly Kie provider `kie.ai` + model `gemini-3-8-flash-openai` with approved quote/input/output caps; **mark in flight** before single provider call; then **settle**, charging reserved maximum conservatively if provider outcome is ambiguous or missing usage. It does not automatically retry. Provider credit reporting can differ from reserved token pricing, requiring audit below.
- Reuses existing service-role key only inside server function, not client; CORS origin allowlist remains restricted. Kie secret name `KIE_API_KEY` matches existing production Sticker Lab Edge integration (read-only verification; no secret material read).
- Preserves `src/lib/cartel-guide-ui-gate.ts` exactly `CARTEL_GUIDE_PREVIEW_UI_ENABLED = false`, **so live G1 Setup Help stays fully available to Free customers**. No change to current billing or $49 Pro Checkout.

## Surgical allowlist this PR
1. `supabase/functions/cartel-guide/index.ts` (UPDATED; guarded provider flow, no deployment)
2. `src/components/cartel/GuideConversationPreview.tsx` (UPDATED; uses existing page)
3. `scripts/cartel-guide-g2e-offline-regression.mjs` (NEW; source + Kie parser offline safety checks)
4. `docs/plans/cartel-hq-g2e-guide-completion-gates.md` (NEW; this release gate)

**Forbidden:** Main/production merges, launch/PCART, Sticker Lab/Sticker Drops/Telegram, new AI provider, Lovable build credits without owner consent, staging/production SQL apply, model request, secrets or existing workspace permissions. Stacked on draft PR #11, which contains the approved Pro-only 100-questions-per-workspace candidate, UNAPPLIED.

## Proof already completed and NOT to repeat
- G2A.3 actual signed-in JWT and tenant isolation test 6/6 PASS; authorized workspace B accepted up to disabled status, foreign A denied, spoofed owner rejected, no-token denied, disallowed Origin denied. **Allowed browser Origin still untested.**
- G2D corrected quota `COUNT(*)` source tests 27/27; CTE simulated count 9/9; REAL STAGING sequential 99/100 allow, 101 deny, duplicate denial and unused-slot release; single transaction rollback and independent restoration checks PASS.
- G2D true two-session quota race NOT verified: old Supabase management path serialized two timing probes and Claude browser ran only one query. It remains a release-gate risk decision, NOT grounds to restart several investigations now.
- G2C Kie adapter offline requests/parser checks 31/31 previously passed; no authenticated, paid Kie compatibility proof.

## Before any merge, paid call or production release (minimal ordered gates)
1. **One real full dependency-installed build and typecheck** for the complete stacked G2E branch, ideally using existing GitHub/Lovable tooling without duplicative credit spending. Run `npm run build`, `npx tsc --noEmit` and `node scripts/cartel-guide-g2e-offline-regression.mjs`. Current tools have NOT run the full build, so it is not marked PASS. Review branch/main drift before merging.
2. **Reconcile Help Center freshness** with the current code. G2B citations still state `2026-09-30`; some product screens changed after that. Either review/correct article excerpts against current Cartel HQ behavior or limit the live AI Guide to verified articles. Do not invent functionality.
3. **Staging preparation, separate explicit approval:** after source/build review, apply the correct (stage-compatible) G2D quota migration in STAGING only, not the production-shape SQL against simplified staging tables; verify Pro feature gate and 100/month counter. Configure exact allowed front-end Origin only if needed for the browser stage test. Keep emergency stop ON and all provider flags OFF until approved pilot.
4. **Kie.ai paid compatibility smoke test**, separate explicit owner approval and small max credit cap: confirm exact endpoint/credentials, `max_tokens` compatibility, parsing, citation quality, actual `credits_consumed` vs token-based USD budget quote, overrun and error behavior. Kie docs: https://docs.kie.ai/market/gemini/gemini-3-8-flash-openai . This is chat-only, NOT an autonomous agent.
5. **Real hosted desktop/mobile authenticated UI QA** and Free-versus-Pro/owner access, safe message rendering, no raw secrets. Check 100 shared requests and global spending guard using existing evidence; decide on two-session race before any public charging.
6. **Explicit production-release approval:** merge reviewed staged branches in proper order, stage/test, deploy Guide Edge `verify_jwt=true`, set reviewed public Origin, approved server-only `KIE_API_KEY`, set verified price quote and Pro entitlement; keep global budget and emergency stop initially ON. Only then owner may separately authorize activation, followed by a small customer pilot and observed spend; Free Setup Help never disappears.

## Operational and cost
- This draft costs **$0 in Kie model calls**, no Lovable credits and no GitHub Actions triggered. No provider HTTP was sent.
- Provider posted promotional rates as reviewed on 2026-10-14 were approximately $0.225/M input and $1.125/M output for the proposed Gemini model, but actual request metering, minimums, reasoning and price changes remain unknown until the small controlled pilot.
- **Known reconciliation issue:** current budget settle RPC uses token usage and quote; provider also reports `credits_consumed` which is NOT yet reconciled to the precise provider charge. No public paid release before this is settled or documented with a conservative max cap and stop.
- Production `ocoinbnjgstkmnwwvnhi` and staging `llicojkxpzwylghptmkf` untouched by this draft. Current public site `pepecartelhq.com` still runs free deterministic Setup Help (G1), not paid conversational Guide.
- Supabase Oct 19 org egress warning priority is independent; latest verified current-cycle egress on Oct13 was 0.816/5 GB; refresh near Oct18 before any spending/production release.

**One next action:** Obtain owner approval for one bounded build/typecheck check and staging QA planning from the reviewed G2E draft. Stop before real paid calls, database migrations, merges or releases unless explicitly approved.
