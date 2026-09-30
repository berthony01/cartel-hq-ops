# SP-B6 Missions — Audit and Plan (no edits)

Baseline: HEAD `9ec63ce9`. Live DB: 13 missions (all COMPLETED/CANCELLED, 0 ACTIVE), 13 targets, 13,684 metric snapshots, 67 schedule events, 0 `social_mission_settings` rows, 0 `partner_client_access`.

## 1. How Missions work today (verified)

- **Start (`/mission <link>` or link finder)** happens only in `telegram-webhook`. Steps: resolve the Telegram sender to exactly one CARTEL HQ user through `telegram_connections`, check the sender is a group admin live in Telegram, check the bot's permissions live, check Project Identity (`requireProjectToolAccess`), check the `x_missions` plan limit (`requireCommercialAccess`), then run `create_social_mission_from_telegram_link`. That database function is service-only and keyed on Telegram IDs, and it re-derives the actor from `telegram_connections.telegram_user_id`. After that, the webhook calls `social-mission-telegram` `send_mission` on its internal service path.
- **Close (`/mission close`)** runs `close_social_mission_from_telegram(_telegram_chat_id, _telegram_user_id)`, then `social-mission-telegram` `edit_mission`. `finalRefresh` is on only for the webhook caller, and it makes one final paid official X read.
- **Mission Control** (target, duration, end, cancel, panel, history) is a set of service-only functions. Every one takes `_telegram_user_id` and `_verified_chat_id` and is authorized through `social_mission_control_authorize`.
- **`social-mission-telegram`** (`verify_jwt=true`) has exactly three actions: send, edit, resurface. It hard-requires `workspace_members.role` of owner or admin for every caller, including internal ones. It loads `telegram_chat_id` server-side and holds the bot token.
- **`social-mission-runner`** (cron) does the paid X metric polling with `X_API_BEARER_TOKEN`, refreshes cards, sends pulse messages and completes missions. It works from trusted rows only.
- **X credentials** are one platform-wide bearer token stored as a secret. There is no per-workspace X account connection.
- **Plan limits:** `x_missions` is a monthly quota of 100, on `cartel_49` only. It is counted as missions created, through `commercial_feature_usage`. X polling after start is capped only by the runner's own cadence, not by a per-client cost limit.
- **Mission defaults** are stored in `social_mission_settings`. The table grants authenticated users SELECT, INSERT and UPDATE directly, controlled by member-read and operator-write policies. The web card is read-only for non-operators (`useIsWorkspaceOperator`). Saving defaults has no plan check. Defaults apply only to future missions, which snapshot them at start.
- **Why missions are read-only on the web:** creating, closing and controlling a mission is tied by design to a verified Telegram identity plus a live group-admin check. The web has no start or close path at all, even for owners.

## 2. Action classification

| Action | Class |
|---|---|
| List client missions, status, metrics summary, schedule timeline, group titles | A (via a new safe read function) |
| Read and edit future mission defaults | B (new partner wrapper; no table grant changes) |
| Start a mission from the web | D: defer |
| Close or end a mission from the web | D: defer |
| Resurface card | D: defer |
| Target, duration, cancel overrides (Mission Control) | C: owner-only (Telegram identity) |
| X bearer token, runner secret, cron, provider config | C |
| Telegram group connect/disconnect, bot admin, raw chat/user IDs | C |
| History deletion, billing, launcher, wallet, Affiliate | C |

**Why start and close are deferred, not delegated now:**
- A partner has no Telegram identity in the client's group. Telegram's "current group admin" rule would have to be replaced by a new web-only authority.
- Creation and closing live inside Telegram-keyed functions (create is about 9.6k characters). The transport function hard-codes an owner/admin membership check.
- Safe delegation would need all of the following:
  - a new shared creation core extracted from `create_social_mission_from_telegram_link`
  - a partner branch in `social-mission-telegram`
  - a re-implemented bot-permission preflight
  - a new paid final X read path
- That is a broad rewrite of a working engine, which hits the stop condition. It is proposed as a separate SP-B6.1 audit, not part of V1.

## 3. Recommended SP-B6 V1: read plus future defaults

The partner, on managed `/telegram` → Missions, can:
- see the client's missions: status, post link, group title, start and end times, latest metrics, milestone progress, and a schedule timeline of at most 50 events with state and time only
- view and edit future mission defaults with the same limits the owner has
- lose access immediately when revoked

The partner cannot start, close, end or resurface missions, use Mission Control, or reach any X or Telegram secret or ID.

**Plan limits and cost:**
- V1 makes no X or Telegram call and uses no `x_missions` quota.
- Saving defaults has no plan check today, matching the owner. It will need only Project Identity, checked against the client's workspace.
- There is no platform-owner bypass for partners.

## Technical details

### Database (staged file only: `docs/sql/SP_B6_partner_missions.sql`)
- `partner_list_mission_state(_workspace_id uuid)`:
  - checks `partner_has_scope(_workspace_id,'missions')` first
  - returns missions: id, status, canonical_url, author_handle, created_at, starts_at, ends_at, completed_at, and the snapshotted goal
  - returns latest metrics: views, likes, replies, reposts, bookmarks, observed_at
  - returns each target's `group_connection_id` and group title only
  - returns schedule events: kind, state, scheduled_for, finished_at
  - returns current defaults, or the system defaults when none are saved
  - never returns `telegram_chat_id`, `telegram_user_id`, `telegram_message_id`, raw metadata or availability payloads, `created_by`, idempotency keys, or errors carrying provider text
- `partner_save_mission_settings(_workspace_id uuid, _settings jsonb)`:
  - scope first, then Project Identity against the client
  - validates the same presets, milestone types and ranges as the table constraints and `validateMissionSettings`
  - upserts one row for the workspace; future missions only
- Both functions: SECURITY DEFINER, owner postgres, `SET search_path TO ''`, explicit `auth.uid()`, REVOKE from PUBLIC and anon, GRANT to authenticated and service_role.
- No table, RLS, grant, trigger or membership/operator helper changes.

### Edge
None. `social-mission-telegram`, `social-mission-runner` and `telegram-webhook` stay unchanged. Nothing is deployed, so no deployed-versus-repo comparison is needed for V1. That comparison becomes mandatory for SP-B6.1.

### Frontend
- New `src/lib/partner-missions.ts`
- New `src/components/cartel/PartnerMissionsPanel.tsx`: read-only list and timeline, plus a defaults editor that reuses `validateMissionSettings`
- Update `src/routes/_authenticated/telegram.tsx`: when the `missions` scope is active, show a Missions tab
- Update `src/lib/partner-client-access.ts`: add `missions` to `ACTIVE_PARTNER_SCOPES`
- Update only if required: `ManagedAccessGuard.tsx`, `SidebarNav.tsx`, `ServicePartnerAccessPanel.tsx`
- Owner `MissionSettingsCard` stays untouched.

### Strict allowlist
- The files above
- `scripts/sp-b6-partner-missions-regression.ts`
- `docs/SP_B6_PARTNER_MISSIONS_RUNBOOK.md`
- `roadmap.md`
- Expectation-only updates to prior-phase regressions and public discovery D-24, only if required

### Regression matrix
- Scope states: no scope, pending, declined, revoked, suspended and anon are all denied; revoke takes effect immediately
- Cross-workspace denial happens before any other check; mission and group rows are isolated by workspace
- Outputs contain no Telegram IDs, message IDs, provider payloads, secrets or `created_by`
- Settings limits match the table constraints at the edges, including invalid presets and milestone types
- The save needs client Project Identity; there is no owner bypass
- Every paid-cost check stays untouched: no `x_missions` usage change and no metric snapshot inserts
- No mission, target, schedule event or usage-ledger writes
- Edge files and the runner are byte-unchanged; no start, close, end or resurface path exists for partners; Mission Control functions keep authenticated execute = false
- No side effects on broadcasts, watchers, stickers, inbox or launches
- The owner path is unchanged: owner direct-table settings writes still work, and non-operator members stay read-only
- All prior suites, TypeScript, build and diff check pass

### Production smoke (after SQL approval; transactional, rolled back)
- In one transaction: seed a fixture partner grant, `SET LOCAL ROLE authenticated` with the partner's JWT claims, then call both functions
- Assert that outputs are safe and that denials work for the wrong workspace and for a revoked grant
- Assert that mission, snapshot and usage counts are unchanged, then ROLLBACK
- No X or Telegram calls

### Real two-account test (after all scopes are live, needs an approved active partner)
- The partner opens the client's `/telegram` Missions tab and sees history without IDs
- The partner edits defaults; the owner starts a test mission in the test group via `/mission` and confirms the new defaults were used
- Revoke, then confirm the partner is blocked

### Activation order and rollback
- Order: CP-SPB6-SQL (with smoke) → CP-SPB6-PUBLISH → types sync
- Rollback: drop both functions and revert the scope list in the frontend. No data is written except a settings row, which the owner can edit.

### Advisor delta
- 0028 stays at 9
- 0029 goes from 132 to 134
- Mutable search path stays at 1

### STOP conditions
Stop if safe delegation turns out to need any of:
- membership or operator changes
- the owner's Telegram identity
- X or bot secret exposure
- table or RLS grant changes
- an Edge change in V1
- `x_missions` usage or paid X calls

### SP-B6.1 (separate future audit)
Web start and close through a shared, auth.uid-authorized creation and close core. It would use client `x_missions` quota, reuse the existing transport through a narrow partner branch, and include a defined answer to replacing the "current group admin" check.
