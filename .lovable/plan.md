# SE-16.1 Recovery Audit (read-only) and proposed SE-16.1H hardening phase

No files were changed, nothing deployed, published, or written to Supabase/Telegram.

## 1. Authoritative state

- HEAD: `5ad273bd72392c92bcaeb4cf1347cf9a7f270181` ("Added SE-16.1 MiniApp UI"), working tree **clean** (`git status --porcelain` empty). Matches the stated project HEAD.
- Project remains unpublished; no HTTPS Mini App URL exists.
- Active workspace skills present: `controlled-surgical-build`, `release-verification`, `cartel-ui-system`, `read-only-audit`, `supabase-change-safety`, `onchain-mainnet-safety`.

## 2. What exists

- SE-15 Mission Control: `supabase/functions/telegram-webhook/index.ts` (bot panel, targets, duration, end/cancel, card edit, safe unpin), `social-mission-telegram`, `social-mission-runner`, shared `_shared/mission-resolved-config.ts`, prepared SQL `docs/sql/SE15_mission_control.sql`.
- SE-16.0 bridge: `src/lib/telegram-miniapp-auth.server.ts` (initData HMAC validator, bounded `getChatMember`), `src/lib/telegram-miniapp-bridge.functions.ts` (reads + `apply_targets` / `apply_duration`; end/cancel exposed only as `bot_finalize_required` / `not_enabled_in_bridge_v1`).
- SE-16.1 UI: `src/routes/tg.tsx`, `src/routes/tg.index.tsx`, `src/routes/tg.mission.$missionId.tsx`, `src/components/telegram-miniapp/MiniAppPieces.tsx`, `src/lib/telegram-miniapp-client.ts`, `scripts/se161-miniapp-ui-regression.ts`.
- No TODO/FIXME/phase markers anywhere in `src`, `scripts`, `docs`.

## 3. Verification of the five reported issues

| # | Claim | Verdict | Evidence |
|---|---|---|---|
| 1 | Telegram script `async` races the first effect | **CONFIRMED** | `src/routes/tg.tsx:29` loads the script with `async: true`; `tg.index.tsx:43-47` and `tg.mission.$missionId.tsx:59-63` read `readRawInitData()` once in a mount effect with no retry/poll. If the script has not executed, `window.Telegram` is undefined and the screen sticks permanently on the "Open Mission Control from Telegram" fallback. |
| 2 | Only browser safe-area, no Telegram insets | **CONFIRMED** | `MiniAppPieces.tsx:17-20` uses only `env(safe-area-inset-*)`. No `--tg-safe-area-inset-*`, `--tg-content-safe-area-inset-*`, `--tg-viewport-stable-height`, or `themeParams` usage anywhere in the Mini App files. |
| 3 | Auto-selects first workspace for any nonempty list | **CONFIRMED** | `tg.index.tsx:63-65`: `if (!workspaceId && workspaces.length > 0) setWorkspaceId(workspaces[0].workspaceId)`. Spec required auto-select only when exactly one workspace exists; with several, the first is silently chosen (the selector is still rendered, so impact is UX/spec, not security). |
| 4 | Failure-reason mapping mismatched | **CONFIRMED** | `telegram-miniapp-client.ts:42-62` maps `expired_init_data`, `future_init_data`, `invalid_hash` — none of which the validator can emit. Real reasons (`telegram-miniapp-auth.server.ts:49-63`) are `stale_auth_date`, `future_auth_date`, `bad_signature`, plus `missing_bot_token`, `init_data_too_large`, `duplicate_field`, `missing_hash`, `missing_auth_date`, `invalid_auth_date`, `missing_user`, `malformed_user`, `invalid_user_id`. Every expired/tampered session therefore falls to the generic "could not load this right now" copy instead of "reopen from the bot". |
| 5 | Full gate never run | **PARTIALLY WRONG — worse than reported** | Suites pass: SE-16.1 50/50, SE-16.0 117/117, SE-15 275/275, deploy-parity 43/43. But `bunx tsgo --noEmit` **FAILS**: `src/routes/tg.index.tsx(64,63) TS2532 Object is possibly 'undefined'` and `src/routes/tg.index.tsx(101,8) TS2375 exactOptionalPropertyTypes` on `subtitle`. HEAD does not currently typecheck, so `bun run build` is expected to fail too (not run in this read-only audit). |

## 4. Additional findings beyond the five

- **Synthesized mission status.** `social_mission_control_missions` (SQL line 333-341) returns `mission_id, telegram_chat_id, author_handle, canonical_url, started_at, ends_at, control_mode` — no `status` column. The bridge defaults `status: "LIVE"` (`bridge.functions.ts:249`) and the panel hardcodes `status: "LIVE"` (line 300). Semantically safe (the RPC filters `m.status = 'LIVE'`), but the badge is a constant, not observed state. Should be documented or derived honestly.
- **No error/retry affordance.** Every Mini App failure state is terminal — no "Try again" action and no `refetch`, which matters inside a Telegram WebView where the user cannot easily reload.
- **No reachability path.** Nothing registers the Mini App: no menu button, no `?startapp=` handling, no "Open Mission Control" WebApp button in `/mission manage`. The UI is currently unreachable from Telegram even if published.
- **No origin/CSP boundary decision.** Server functions are same-origin, so no CORS gap exists today, but no `frame-ancestors` / embedding review has been done for Telegram WebView.
- **Parity scope unchanged and correct.** Deploy-parity covers `_shared/mission-resolved-config.ts`, `social-mission-runner`, `social-mission-telegram` — all byte-identical (43/43). It does **not** cover `telegram-webhook`; the legacy `backend-source/edge-functions/telegram-webhook/index.ts` mirror still contains no Mission Control code. Repo-side parity for deployed functions cannot be proven beyond the last authorized deploys (SE-15 batch, then SE-15.1 `telegram-webhook`); no repo edits to those functions have happened since, so repo and production are consistent by absence of change, not by queried version evidence.
- **Mutation deferral is intentional and intact.** `apply_targets` / `apply_duration` exist in the bridge but are referenced nowhere in the UI (SE-16.1 regression section 5 enforces this). End/Cancel remain bot-only by design.
- **Knowledge/plan drift.** `.lovable/plan.md` currently holds the old SE-15 plan; project knowledge documents Phases 0–5.5 and lists "6 Public Cartel Network NEXT" with no SE-15/SE-16 entries at all. Not harmful, but knowledge is stale relative to shipped SE-15/SE-16 work.

## 5. Blockers before deploy / publish / Telegram registration / live test

1. Typecheck (and therefore build) fails at HEAD — hard blocker.
2. initData boot race — Mini App can fail closed for real users.
3. Telegram safe-area/viewport variables unused — layout may clip under the Telegram header/controls.
4. Failure-copy mismatch — expired-session users get unhelpful generic copy.
5. Workspace auto-select deviates from spec.
6. No HTTPS surface: app unpublished, no decision recorded on serving `/tg/*` from the stable preview host vs publishing.
7. No BotFather/menu/`startapp`/`/mission manage` button wiring (deliberately later phase).
8. No live proof: no real Telegram render, no real bot-token signature path exercised, deployed SQL state in `ocoinbnjgstkmnwwvnhi` never queried.

## 6. Release gate that should be used

```text
bun run scripts/se161-miniapp-ui-regression.ts
bun run scripts/se16-miniapp-auth-bridge-regression.ts
bun run scripts/se15-mission-control-regression.ts
bun run scripts/se14-multi-metric-mission-targets-regression.ts
bun run scripts/se13-social-mission-goal-regression.ts
bun run scripts/se6-step1-authoritative-regression.ts
bun run scripts/se5-social-mission-engine-regression.ts
bun run scripts/se4b-mission-lifecycle-pulse-regression.ts
bun run scripts/se4a-mission-command-regression.ts
bun run scripts/se3-social-mission-telegram-regression.ts
bun run scripts/se31-owner-social-mission-test-control-regression.ts
bun run scripts/se33l-branded-social-mission-test-control-regression.ts
bun run scripts/community-command-center-unification-regression.ts
bun run scripts/social-mission-deploy-parity-regression.ts
bunx tsgo --noEmit
bun run build
```

## 7. Recommended next controlled phase — SE-16.1H (repo-only)

Smallest safe unit, no production mutation.

Allowlist: `src/routes/tg.tsx`, `src/routes/tg.index.tsx`, `src/routes/tg.mission.$missionId.tsx`, `src/components/telegram-miniapp/MiniAppPieces.tsx`, `src/lib/telegram-miniapp-client.ts`, `scripts/se161-miniapp-ui-regression.ts`.
Prohibited: bridge/auth modules, SE-15 webhook/runner, SQL, `.env`, `supabase/config.toml`, packages, deploys, publish, BotFather.

1. Fix the two typecheck errors (safe indexing of `workspaces[0]`, `subtitle` optional-prop under `exactOptionalPropertyTypes`).
2. Replace the one-shot initData read with a bounded readiness wait (poll until `window.Telegram.WebApp` exists, short ceiling, then fall back) so the async script cannot strand the screen; keep `ready()`/`expand()` non-destructive.
3. Add Telegram `--tg-safe-area-inset-*` / content-safe-area variables with `env()` fallback in `MiniAppFrame`.
4. Re-pin `miniAppFailureMessage` to the validator's actual reason strings; add a regression assertion that every exported `InitDataFailureReason` plus the bridge's bounded reasons has non-default copy.
5. Auto-select a workspace only when exactly one is authorized.
6. Add a retry affordance on terminal failure states.
7. Extend the SE-16.1 regression for each of the above; loosen nothing.
8. Run the full gate in section 6 and report exact counts + resulting SHA. STOP.

## Then, only on separate authorization

- **SE-16.2** — mutation UX for targets/duration wired to the existing bridge functions (end/cancel stay bot-only). STOP.
- **SE-16.3** — production: publish/host decision for the HTTPS Mini App URL, BotFather menu button, `?startapp=` deep-link handling, and the "Open Mission Control" WebApp button in `/mission manage` (requires a `telegram-webhook` edit + deploy). STOP.
- **SE-16.4** — live QA inside real Telegram, with bot fallback verified. STOP.
