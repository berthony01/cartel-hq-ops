# Roadmap
- [x] Partner 1B-1: legal pages, policy acceptance foundation, consent UI, staged SQL (accepted)
- [x] Partner 1B-2: referral click tokens (accepted)
- [x] Partner 1B-3: commission accounting SQL (accepted)
- [x] Partner 1B-4: webhook commission source + partner/owner UI (accepted, staged, not deployed)
- [x] Partner 1B-5: regression reconciliation, release checklist, rollback runbook (repository only)
- [x] Legal identity + limited U.S.-beta policy drafts completed (repository only; not effective or activated)
- [x] Partner G12a-A: local rollback-gap reconciliation utility built and mock-tested (repository only)
- [ ] Partner G12a-B: validate reconciliation against non-production Supabase + Stripe test environment — BLOCKED / NOT DONE
- [ ] Production activation — BLOCKED / NOT DONE (email DNS, attorney, CPA and privacy reviews; promotional email lacks a valid physical postal address; G12a-B non-production validation; explicit approvals for SQL, Edge, Stripe events, terms)
- [ ] Publication — BLOCKED / NOT DONE (separate explicit owner approval)
- [x] Service Partner-only launch staging: track-separation SQL staged, UI/legal/docs/tests (repository only; Affiliate closed)
- [ ] Service Partner production activation — BLOCKED: needs CP-SVC-SQL, CP-SVC-TERMS, CP-SVC-PUBLISH owner approvals
- [x] Public Partner Program discovery, CARTEL HQ documentation hub, and foundational SEO corrections (repository and preview only)
- [x] SP-A Managed Client Access staged: separate partner access table + RPCs (docs/sql only, not applied), owner panel, partner invites/managed projects, managed switcher, project_identity editor, guard, regression (repository only)
- [x] SP-A production migration `20260929130813` applied and security verified: table live with RLS, SELECT-only for authenticated, anon EXECUTE revoked, service_role-only helpers, advisor lint 0028 unchanged (9) / 0029 exactly +10 (102 → 112), types regenerated, transactional backend smoke passed and rolled back clean
- [ ] SP-A real two-account UI smoke (S1–S8) — PENDING: needs an approved active Service Partner test account; production has none and partner status must not be altered to create one
- [x] SP-B0 commercial workspace entitlement core staged (docs/sql only, not applied): steps 5–10 extracted verbatim, evaluator output proven byte-equal in local equivalence regression
- [x] SP-B1 partner Project Inbox staged (docs/sql only, not applied): seven partner_inbox_* RPCs, partner-only /telegram Inbox, settings + block/unblock owner-only (repository only)
- [x] SP-B0/SP-B1 production activation complete: migrations `20260929154656` (SP-B0) and `20260929154741` (SP-B1) applied; evaluator outputs identical pre/post; advisor 0028 unchanged (9), 0029 exactly +7 (112 → 119); transactional backend smoke 12/12 passed and rolled back; types regenerated
- [ ] SP-B1 real two-account browser smoke — PENDING: needs an approved active Service Partner test account; production has none and partner status must not be altered to create one
- [x] SP-B2 V1 partner Launch Watcher messages LIVE in production (migration 20260929161346): four partner RPCs (launch list, counts, history, send), managed /telegram panel, no commercial gate (matches owner); backend transactional smoke 12/12 rolled back, owner function md5 unchanged, advisor 0028=9 / 0029=123 as expected
- [ ] SP-B2 real two-account browser + committed Telegram DM rendering test — PENDING: needs an approved active Service Partner test account; CP-SPB2-PUBLISH was authorized and initiated (deployment request `7187debc-aff1-4a59-8ce9-94973d105e3a`, project reports published=true/ready), but browser propagation of that deployment is not yet independently verified
- [x] SP-B3 V1 partner community broadcasts STAGED: identity core extraction, 3 partner RPCs, telegram-group partner fall-through, managed /telegram Broadcasts panel
- [x] SP-B3 SQL live (migration 20260929172116); backend smoke 11/11 rolled back; advisor 0029 123→126, 0028 9
- [x] SP-B3 Edge telegram-group v49 ACTIVE (verify_jwt=true)
- [x] SP-B3 frontend publish authorized/initiated; project reports published/ready; types synced
- [ ] SP-B3 browser propagation + real two-account/test-group broadcast — BLOCKED: needs an approved active Service Partner account
- [x] Scope missions — implemented (SP-B6 V1); all seven Service Partner scopes implemented
- [x] SP-B4 V1 partner community management STAGED (repository only): 3 partner RPCs (docs/sql), telegram-group save/test fall-through with forced owner Launch Watch values, managed /telegram Community tab
- [x] SP-B4 SQL live (migration 20260929180205): three authenticated partner RPCs, transactional backend smoke 12/12 rolled back, advisor 0028=9 / 0029 126→129, mutable search path 1; types regenerated at `83335e24`
- [x] SP-B4 Edge telegram-group v50 ACTIVE (verify_jwt=true); frontend publish authorized/initiated (deployment `a14e3113-6ef9-4197-a97e-bec6d5c8b67a`), project reports published/ready
- [ ] SP-B4 browser propagation + real two-account/test-group welcome test — BLOCKED: needs an approved active Service Partner account
- [x] SP-B5 V1 partner Sticker Drops management STAGED (repository only): 3 partner RPCs (docs/sql), sticker-drop-config save/enable/disable/delete fall-through, managed /telegram Sticker Drops tab; AI, pack publish/test-send, uploads and kill switch stay owner-only
- [x] SP-B5 production activation complete: migration `20260929192440` live (three authenticated RPCs incl. `_enabled` discriminator); transactional DB smoke 15/15 rolled back with no side effects; advisor 0028=9 / 0029 129→132, mutable search path 1; Edge `sticker-drop-config` v30 ACTIVE (verify_jwt=true, exact staged source); frontend publish `a7635945-3bc9-4cbc-9091-ed682e04f5a3` initiated, project reports published/ready; types synced and grants verified
- [x] SP-B6 V1 partner Missions STAGED (repository only): 2 partner RPCs (read-only mission state + future defaults save), managed /telegram Missions tab; start/close/end/resurface/Mission Control deferred to SP-B6.1; no Edge change
- [x] SP-B6 SQL activation complete: migration `20260929194609` live (partner_list_mission_state, partner_save_mission_settings; authenticated+service_role only); transactional smoke 10/10 rolled back; advisor 0028=9 / 0029=134 / mutable search path 1; NO Edge change, NO X or Telegram call; types synced
- [ ] SP-B6 frontend publish — final deployment alignment after this sync (needs explicit approval)
- [ ] SP-B6 real two-account E2E — BLOCKED: 0 approved active Service Partners
- [ ] SP-B6.1 web mission start/close/end/resurface/Mission Control — DEFERRED (owner-only)
- [ ] SP-B5 browser propagation + real two-account scheduled-drop test — BLOCKED: needs an approved active Service Partner account

## Current status summary — 30 September 2026
Historical items above are preserved as technical evidence; staged vs production distinctions still apply. Public product roadmap: https://pepecartelhq.com/docs?article=roadmap (Help Center article `roadmap`, mirrored by Telegram `/roadmap`).
- Delivered foundation: public site/onboarding; Telegram/groups/welcomes; broadcasts, Project Inbox, Launch Watch; missions; stickers, Brand Kit, Asset Vault, motion, Sticker Drops; Free/Pro billing interfaces; Service Partner applications (limited U.S. beta); Cartel Network; Help Center. Runtime closeout (two-account partner tests, delivery proofs) tracked separately.
- Next: Mini App organization/routing; Pro custom static/motion message media (planned, not live); new-customer/billing/partner/Mini App verification; identity/ownership, UX/PWA; advanced mission lifecycle proof.
- Planned: Cartel Social/Connect X, analytics, scheduled announcements/polls/giveaways, Cartel Shield/reputation, Protected Launch/Launch Passport, Quick Launch/custom contracts, PCART readiness/utility, AI Operator foundation + conversational setup, controlled public launchpad after PCART. Ordering of AI/public launchpad pending; no fixed dates.
- Deferred/exploratory: Affiliate CLOSED; contributor recognition; credits/usage wallet; NFT Studio; additional sign-in; member Mini App; community website V2/V3; member-risk screening.
- [x] MINI-HQ Batch A staged (repository only): webhook copies byte-identical (1B.1 + 1C kept), compact operator Inbox alerts, dated /roadmap, Help Center roadmap article
- [x] MINI-HQ Batch A telegram-webhook deployed by owner as v109 ACTIVE (exact checked source; shared dependency diff trailing newline only); website publish initiated 8cb3e9d8-159b-44b5-86d6-3eb553b2ac40 (browser propagation not independently verified); real Telegram rendering of compact alert and /roadmap not yet observed
- [x] MINI-HQ B1 staged (repository only): Brand tab Pro/owner PNG/JPEG/GIF upload (<=2 MiB, <=4096 px, magic-byte validated) into existing private workspace-assets, previews, per-workspace mission/broadcast PREPARED media selection; staged service-only SQL docs/sql/MINI_HQ_B1_custom_message_media.sql (not applied) — selection save returns unavailable until applied; no sender reads it
- [x] MINI-HQ B1 review correction (30 Sep): positive-only Pro gate on live RPC schema (FEATURE_INCLUDED + would_block false + active/trialing + enabled + official_broadcasts; UNRESTRICTED preserved), mirrored SQL helper custom_media_gate_ok, exact generated asset path/extension + non-null dimension/size checks; STRUCTURAL (not full-decode) PNG/JPEG/GIF validation (CRC/IDAT/IEND, SOF→SOS→data→EOI, per-frame bounds + trailer); selected assets always listed + explicit Clear; load error shows Retry. Tests: TS 82/82, local throwaway-Postgres SQL 41/41, 390px mocked-fixture panel check. Production smoke staged at docs/sql/MINI_HQ_B1_custom_message_media_smoke.sql (run only after apply, rolled back). Still NOT applied/published.
- [ ] MINI-HQ B2–B4 — pending sequenced implementation: B2 custom photo/GIF in website broadcasts (ledger fingerprint incl. media); B3 Mini App broadcast composer via service-authenticated signed-identity branch in telegram-group; B4 ANIMATION mission cards in social-mission-telegram + runner with staged constraint
- [ ] Watcher update and Inbox reply custom media — not started (explicit later scope)
- [x] L-S1 + L-S2 PCART launcher simplification (presentation + pure readiness only): five-step guide (Token, Auction, Treasury, Review, Launch) on Launch Control Overview, plain-English blocked notice and test-launch panel, advanced-testing note on chain launcher; no backend, SQL, deploy or safety-switch change
- [x] L-S3 current-source research + doc alignment (2026-10-01): compatibility manifest v2 and master plan section 0 updated (public CCA, ~96h, no extension, Target Raise separate from Graduation Floor, old 24h/10 ETH/12-month SUPERSEDED). Docs only; nothing implemented
- [x] Direct managed-RPC on-chain code-hash verification of in-scope addresses — done 2026-10-01 (see dependency A)
- [x] L-S5 economic/auction design lock (2026-10-01, docs only): ~96h public CCA in ETH, Graduation Floor 5 ETH, Target Raise 30 ETH (not a gate), 150M/200M/150M final, 100/90/80 LP brackets, 0.25% static v4 pool, fees-off FeeSplitter LP custody, creator-fee revenue not launch-critical, team 24-month linear no cliff, partners 6m delay + 24m linear
- [x] A. Managed-RPC ABI/config verification + pinned observed hashes/configs (2026-10-01, block 77,685,829; all checks passed; manifest section 9) — pre-send recheck still mandatory
- [ ] B. Treasury Safe creation + signer recording — NOT DONE
- [ ] C. Exact PCART testnet rehearsal — NOT DONE
- [ ] D. L-S6 testnet auction integration, then L-S7 liquidity/vesting integration — NOT STARTED (after A–C)

## PCART treasury Safe creation — 1 October 2026
- [x] Built (not live): in-app "Create treasury Safe" card in Launch Control, canonical Safe v1.4.1 plan (CompatibilityFallbackHandler, deterministic salt, CREATE2 prediction), managed-RPC preflight, one wallet send without retry, exact-owner + fallback-handler verification, readiness from fresh verification only.
- [x] Treasury Safe evidence SQL `docs/sql/PCART_TREASURY_SAFE_EVIDENCE.sql` — APPLIED 2026-10-01 (owner-authorized migration).
- [ ] Create the Safe with a signer wallet — waiting on owner authorization; no transaction sent yet.

## Mission Control group launcher — 3 October 2026
- [ ] /missioncontrol group command -> community Mission Control — bot code LIVE, feature NOT complete
- [x] Correction: live telegram-webhook observed ACTIVE v112 (updated 2026-10-03 15:00:34 UTC) with the /missioncontrol launcher. No manual deploy was run by the agent; the saves at 14:56:03/14:56:41 UTC were followed ~4 min later by v112, consistent with automatic platform sync (cause UNPROVEN). Limitation: saving bot code can push it live without a separate deploy step.
- [x] Read-only Telegram check (3 Oct 15:08): getMe OK, username matches, has_main_web_app = false; private menu button = commands (no Mini App URL)
- [ ] Owner: enable Main Mini App in BotFather (currently OFF per getMe) and add MISSION_CONTROL_MINIAPP_LINK to bot backend secrets (not in project secrets; bot-backend value unverifiable here). Until then live /missioncontrol shows the safe "link not available" message
- [ ] Publish site (Mini App community-binding fix is app code, not yet published) — waiting on owner approval
- [ ] Real Telegram end-to-end check (admin, non-admin, copied link)
- [x] Community sessions: opening/changing/ending a mission binds exactly to the launching group via a direct mission read (no 10-mission list limit, no SQL) — app code, not published
- [ ] Known limit (private sessions only): opening a mission from the private, project-wide Mission Control still uses the 10-newest list; unchanged by request

## Telegram presentation + launcher cleanup — staged for review
- [x] Shared PepeCartel presentation helper staged across audited bot send/edit transports; validated animated custom-emoji IDs keep visible Unicode fallback, native button styles only, tenant-authored/frozen bodies unchanged
- [x] Explicit Mini App “Close & clear” UI and signed exact-launch routing staged; legacy unbound links safely close without deletion authority
- [ ] Apply `docs/sql/MC_BRANDING_LAUNCHER_CLEANUP.sql` — BLOCKED pending independent review and explicit owner approval; until applied, launcher cleanup stays unavailable and legacy behavior remains
- [ ] Deploy/synchronize backend sender sources and publish `/tg` — BLOCKED pending independent review and explicit owner approval
- [ ] Real Telegram E2E for animated emoji eligibility, native button rendering, exact launcher cleanup, non-admin denial, copied-link denial, and abandoned-prompt expiry — PENDING after activation

## Pre-start Mission Setup — staged for root review
- [ ] Complete candidate-scoped setup, authenticated Auto-select, atomic reviewed-target start, and legacy command compatibility; SQL remains staged and unapplied
- [ ] Root review/application, backend deployment, frontend publication, and real admin/non-admin Telegram acceptance — PENDING after source verification
