# Cost Accounting Foundation — Read-Only Audit

No file was edited. No migration, deploy, publish, secret, billing, chain, wallet, PCART or launcher action occurred.

## A. Verification report

- **HEAD at time of verification:** `c105f7c21f47933fc93f723c1213d04132ba7754` (platform auto-commit; not the `2eb8bf5c` previously reported). Working tree clean.
- **Diff vs `66b8cd6877442d7be92819a3c4dba6cbf0c0d952` — 3 files, +12/−5:**
  - `scripts/pcart-l1-closure-regression.ts` (+9/−2) — the authorized L1C-10 narrowing
  - `package.json` (+1/−1) — platform drift (`@lovable.dev/vite-tanstack-config` `^2.15.0` → `2.23.1`)
  - `bun.lock` (+2/−2) — matching platform lock drift

| Suite | Result |
|---|---|
| pcart-l1-closure | PASS (all, incl. narrowed L1C-10, migrations pinned 84) |
| pcart-l2-frozen-artifact | **1 FAIL — L2F-I:package.json** (see exception below); all substantive checks PASS |
| pcart-l2-draft-artifact | PASS |
| pcart-l1b-treasury-safe-verify | PASS |
| pcart-treasury-signers | PASS |
| hardening-b | PASS |
| p1a-project-journey | PASS |
| p2c2-launch-isolation | PASS |
| p3c-f / f1 / f2 | PASS |
| launcher-b-handoff | PASS (129) |
| launcher-b3-platform-execution | PASS (69) |
| verifier-state-write-activation | PASS |
| wallet-connector | PASS |
| `bunx tsgo --noEmit` | clean, no output |
| `bun run build` | succeeded |

### Documented baseline-drift exception (temporary, this turn only)

`FAIL L2F-I:package.json — package.json is byte-for-byte unchanged from the start gate`.

Accepted as a **known baseline-drift exception for this read-only audit turn only**, on your explicit instruction, because the `package.json`/`bun.lock` change was platform-generated before this phase, the tree is clean, and every substantive PCART assertion (artifact hashes, compiler settings, protected-file integrity, migration count 84, liquidity flag false, approved artifact `cartel-fixed-erc20-v1`) passed. **This is NOT an accepted permanent baseline.** The tripwire remains failing in the repository and must be resolved in a separate, explicitly authorized turn — either by reverting the platform bump or by a one-file re-pin of `scripts/pcart-l2-frozen-artifact-regression.ts`. No regression, `package.json` or `bun.lock` was modified.

## B. Audit findings by provider / feature

Live read-only evidence (external Supabase `ocoinbnjgstkmnwwvnhi`): `usage_ledger` holds 4 action types only — `social_x_tracked_post_read` (13,173 rows), `sticker_generate` (15), `remove_background` (12), `sticker_motion_generate` (7). **`provider_cost` is populated on 0 of 13,207 rows. `ai_jobs.provider_cost` is populated on 0 of 49 rows.** No monetary value has ever been recorded.

| Feature | Provider / model | ai_jobs | usage_ledger | Monetary | Idempotency |
|---|---|---|---|---|---|
| Static sticker generation | Kie `flux-2/pro-image-to-image` (`sticker-ai/index.ts:770`) | yes | yes, `units` = raw Kie credits, `action_type='sticker_generate'` | none | app-level `select…maybeSingle()` on `ai_job_id` (`:491`) — **no DB unique constraint**, race-able |
| Background removal | Kie `recraft/remove-background` (`sticker-ai/index.ts:948,1055`) | yes (child job) | yes, `remove_background` | none | same app-level guard |
| Sticker concept suggestions | Gemini 2.5 Flash via Kie (`sticker-concepts/index.ts:480`) | **no** | **no** | none | single synchronous call, no retries |
| Kling motion generation | Kie `kling-2.6/image-to-video` (`sticker-motion-ai/index.ts:645`) | yes | yes, `sticker_motion_generate` | none | partial unique index on active job + app-level ledger guard |
| Motion background prep | fal.ai `veed/video-background-removal/fast` (`sticker-motion-telegram/index.ts:491`) | yes (`sticker_motion_telegram_prepare`) | **no** | none; no fal credit value captured at all | partial unique index on active job; `X-Fal-No-Retry: 1` |
| Normalization | CloudConvert `/v2/jobs` (`sticker-motion-telegram/index.ts:245`) | yes (same parent job) | **no**; credits only in `ai_jobs.output_json.cloudconvert_credits` | none | CC job tag `cartelhq-motion-telegram-<aiJobId>`; scoped retry path |
| X social mission reads | X API v2 (`social-read-x.server.ts:394,419,439`; runner `:293`; telegram `:126,198`) | no | yes — but written **in SQL**, not in the read path: `INSERT … 'social_x_tracked_post_read', 1` inside the mission RPC (`docs/sql/SE14_multi_metric_mission_targets.sql:230`) | none | snapshot dedupe `ON CONFLICT (mission_id, provider, poll_bucket) DO NOTHING`; telegram pre-checks the minute bucket before paying |
| YouTube reads | YouTube Data API v3 | no | **no** | none | marked `billable:false` (quota, not money) |
| Sticker Drops / auto-posting | Telegram `sendSticker` (`backend-source/edge-functions/sticker-drops/index.ts:213`) | no | **no** | n/a (zero provider cost) | app-level `recovered_prior_send` window guard; daily cap counted from `sticker_drop_events`; **564 executed events exist, none counted as usage** |

**Platform-owner bypass (verified live):** `public.is_platform_owner(_user_id)` = `platform_user_roles.role='owner'` with an `auth.uid()` self-check; `has_platform_unrestricted_access` simply delegates to it. It is used purely as an authorization gate — **no usage-recording or usage-limit path skips it today**, because no limit enforcement exists yet. Any future bypass must be added at the *enforcement* layer, never at the recording layer, so owner usage stays truthfully logged.

## C. Schema gaps

`usage_ledger` today: `id, workspace_id, user_id, ai_job_id, action_type, units numeric(14,4), provider_cost numeric(12,6), internal_cost numeric(12,6), created_at`. Indexes: PK + `(workspace_id, created_at)`.

1. **No provider column.** `action_type` conflates feature and provider; a `sticker_motion_telegram_prepare` spans fal.ai *and* CloudConvert and cannot be split.
2. **No model/operation column.** Model lives only on `ai_jobs`, and unmapped rows (X reads, drops) have no job at all.
3. **No unit type.** `units` mixes Kie credits, CloudConvert credits, seconds of video and API request counts in one numeric with no discriminator.
4. **No currency.** `provider_cost`/`internal_cost` are bare numerics with an explicit "no currency is asserted here" note (`src/lib/platform.ts:360`), and are never written.
5. **No pricing provenance.** No pricing source, rate version or effective date, so a later rate change would rewrite history rather than being applied forward.
6. **No idempotency key + no unique constraint.** The `ai_job_id` guard is app-level only and race-able; and rows without a job (X reads, drops) have no dedupe anchor at all.
7. **No operation metadata.** No jsonb column for the non-monetary detail (group, schedule, mission, bucket) needed to attribute operational usage.
8. **Missing writers.** Concept generation, fal.ai and CloudConvert never write the ledger; Sticker Drops never write it.
9. **Dead column.** `ai_jobs.provider_cost` is declared but written nowhere — currently misleading.

## D. Proposed minimal implementation allowlist (for a LATER, separately authorized phase)

Schema shape (additive only, no rewrite, no data migration):

```
ALTER TABLE public.usage_ledger ADD COLUMN
  provider text,                    -- 'kie' | 'fal' | 'cloudconvert' | 'x' | 'telegram' | 'internal'
  provider_model text,              -- model/endpoint identifier, nullable
  unit_type text,                   -- 'provider_credit' | 'api_request' | 'operation' | 'second'
  currency text,                    -- ISO code, nullable until pricing exists
  pricing_source text,              -- where the rate came from
  pricing_version text,             -- rate-card version
  pricing_effective_at timestamptz, -- rate validity date
  idempotency_key text,             -- stable per billable event
  metadata jsonb NOT NULL DEFAULT '{}';
CREATE UNIQUE INDEX usage_ledger_idempotency_key_uniq
  ON public.usage_ledger (idempotency_key) WHERE idempotency_key IS NOT NULL;
```

`units` stays the raw provider quantity, never overwritten; dollars are derived later from `unit_type` + rate card, so rate changes never rewrite history. Existing columns and existing rows are untouched; all new columns nullable except `metadata`.

Files (maximum scope; each later phase should take a strict subset):

1. one new migration — the additive columns + partial unique index + grants unchanged
2. `src/lib/usage-accounting.ts` — NEW shared helper: build idempotency key, normalize provider/unit fields
3. `backend-source/edge-functions/sticker-ai/index.ts` + its `supabase/functions` parity copy — populate new fields in `logCredits`
4. `backend-source/edge-functions/sticker-motion-ai/index.ts` (+ parity copy) — same
5. `backend-source/edge-functions/sticker-motion-telegram/index.ts` (+ parity copy) — add the two missing ledger writes (fal request unit, CloudConvert credits)
6. `backend-source/edge-functions/sticker-concepts/index.ts` (+ parity copy) — add one ledger write per concept call
7. `backend-source/edge-functions/sticker-drops/index.ts` (+ parity copy) — one `operation` row per successful send only
8. one migration updating the mission SQL function to fill the new fields on the existing X read insert
9. `src/integrations/supabase/types.ts` — platform-regenerated only
10. new regression script `scripts/cost-accounting-foundation-regression.ts`
11. documentation file for the cost-accounting contract

Explicitly out of scope: any billing, Stripe, entitlement, quota, plan-gate or UI pricing change; any PCART/chain/wallet/launcher/treasury file; any provider behavior change beyond the instrumentation write.

## E. Regression / verification plan

New `cost-accounting-foundation-regression.ts` asserts: the migration is additive only and adds no NOT NULL without default; the unique idempotency index exists; every cost-bearing provider call site writes exactly one ledger row with provider + unit_type set; no dollar rate is hardcoded in any source file; `units` is never derived from a price; Sticker Drops write `unit_type='operation'` on success only and never on failure; no owner bypass exists in the recording path; migration count re-pinned; `MAINNET_LIQUIDITY_TX_ENABLED` still false; approved artifact still `cartel-fixed-erc20-v1`; no PCART or treasury file changed.

Re-run: `pcart-l1-closure`, `pcart-l2-frozen-artifact`, `pcart-l2-draft-artifact`, `pcart-l1b-treasury-safe-verify`, `pcart-treasury-signers`, `se1-social-engine-schema`, `se2-social-read-provider`, `se6-step1-authoritative`, `se14-multi-metric-mission-targets`, `se21-direct-first-provider`, `p1a-project-journey`, `p2c2-launch-isolation`, `launcher-b-handoff`, `launcher-b3-platform-execution`, `wallet-connector`, plus `bunx tsgo --noEmit` and `bun run build`. Live read-only post-checks: new columns present, index present, and one ledger row per new job with no duplicate `idempotency_key`.

## F. Recommended stop point

Stop here. Before any implementation, two things need separate authorization, in this order:

1. **Resolve the `package.json` tripwire** in its own one-file turn — it must not carry forward as an accepted baseline.
2. **Authorize Cost Accounting Phase 1** — the additive migration plus `src/lib/usage-accounting.ts` plus the two existing Kie writers only (items 1–4 above), verified live, before touching the missing writers (fal, CloudConvert, concepts, drops, X SQL) in a Phase 2.

Dollar rate cards, plan limits and the $49 packaging remain deliberately unaddressed; this foundation only makes usage truthful enough to price later.
