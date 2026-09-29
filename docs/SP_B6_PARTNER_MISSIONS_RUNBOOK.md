# SP-B6 V1 — Service Partner Missions (read + future defaults)

Status: SQL ACTIVE IN PRODUCTION.
- Migration `20260929194609` sp_b6_partner_missions live; two authenticated RPCs (SECURITY DEFINER, postgres owner, empty search_path, authenticated+service_role execute, no PUBLIC/anon).
- Advisor: 0028=9 unchanged, 0029=134, mutable search path=1.
- Transactional smoke 10/10 passed and rolled back; production counts unchanged (missions 13, targets 13, snapshots 13684, schedule_events 67, settings 0).
- NO Edge change; NO X or Telegram call; no mission create/close, snapshot insert or x_missions usage.
- All seven Service Partner scopes implemented. Types synced.
- Pending: frontend publish final deployment alignment (explicit approval); real two-account E2E blocked on 0 approved active Service Partners.
- SP-B6.1 (web start/close/end/resurface/Mission Control) remains deferred, owner-only.

## Scope
Activates the final partner scope `missions` with a safe V1:
- Read client missions: status, X link/handle, timestamps, snapshotted goal, latest stored metrics, target group titles (opaque connection id), schedule timeline (max 50 per mission; missions capped at 50).
- Read/edit FUTURE mission defaults (`social_mission_settings`, one row per workspace).

Deferred to SP-B6.1 (owner-only today): mission start, close/end, resurface, all Mission Control (target/duration override, cancel). These are bound to verified Telegram user/chat identity, live group-admin checks, Telegram-keyed service functions and paid X reads.

## Database (docs/sql/SP_B6_partner_missions.sql)
- `partner_list_mission_state(_workspace_id)` — STABLE, SECURITY DEFINER, `search_path ''`, `auth.uid()`, `partner_has_scope(...,'missions')` first. No Telegram chat/user/message ids, metadata, availability, provider payloads, created_by, request ids or error text.
- `partner_save_mission_settings(_workspace_id, _settings jsonb)` — scope first, then `project_identity_ready`. Validation mirrors `validateMissionSettings` and table CHECKs: preset in STANDARD/QUICK/MAJOR_ANNOUNCEMENT/LAUNCH; milestone type in NONE/VIEWS/LIKES/REPLIES/REPOSTS/TOTAL_INTERACTIONS; NONE requires null target; otherwise whole integer 1..2147483647; four toggles must be booleans. Upserts only that workspace's settings row. Returns `{saved, settings}`.
- No commercial / `x_missions` check: the owner defaults save has none, and this makes no provider call and consumes no quota. No platform-owner bypass concept.
- REVOKE PUBLIC/anon; GRANT authenticated, service_role; owner postgres. No table/RLS/grant/trigger/helper changes.

## Edge
None. `social-mission-telegram`, `social-mission-runner`, `telegram-webhook` and `_shared` untouched. Runner unchanged.

## Frontend
`src/lib/partner-missions.ts`, `src/components/cartel/PartnerMissionsPanel.tsx`; managed `/telegram` gains a Missions tab when `missions` is granted (missions-only grant sees only Missions). `ACTIVE_PARTNER_SCOPES` now contains all seven scopes. Owner `MissionSettingsCard` and settings lib unchanged.

## Activation order
1. CP-SPB6-SQL — apply the staged SQL; transactional smoke (seed fixture grant, call as partner, assert safe output + denials + unchanged mission/snapshot/usage counts, ROLLBACK). No X/Telegram call.
2. CP-SPB6-PUBLISH — frontend publish.
3. Types sync.

Rollback: `DROP FUNCTION public.partner_list_mission_state(uuid); DROP FUNCTION public.partner_save_mission_settings(uuid, jsonb);` and remove `missions` from `ACTIVE_PARTNER_SCOPES`.

## Expected advisor delta
0028 = 9 unchanged; 0029 132 → 134; mutable search path = 1.

## Real two-account test (after activation; needs an approved active partner)
Partner opens client `/telegram` → Missions, sees history without ids, saves defaults; owner starts a test mission with `/mission` and confirms the new defaults applied; revoke blocks the partner.
