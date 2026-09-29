# SP-B2 V1 — Partner Launch Watcher Communications Runbook

Status: STAGED IN REPOSITORY ONLY. Not applied to production `ocoinbnjgstkmnwwvnhi`. Not published.
Plan commit: `780f5e1ebaea8a603503a06823618e861aaa8f05`.

## What it enables
A Service Partner with an accepted, active client grant that includes `launch_watcher_comms` can, for that client project only:
- list the client's PROJECT launches (id, token name, ticker, status, launch time, whether sending is possible);
- see aggregate watcher counts (watching / will receive / muted);
- see the last 1–20 `WATCHER_UPDATE` messages with delivery-status counts;
- write a title (optional, up to 120 characters) and body (1–2200), preview and send a duplicate-safe update to existing, active, opted-in (`updates_enabled`) watchers.

Delivery uses the existing path, unchanged: `launch_events` → `enqueue_launch_event_deliveries` trigger → `launch_notification_deliveries` → `launch-notifications` worker.

## Kept owner-only / deferred
Official contract notification/correction, contract registration/verification, launch status transitions, schedule changes and schedule-change send/dismiss, watcher list/export or raw identifiers, adding watchers, deployment/authorization/transactions, treasury/wallet/signers, billing/subscription/platform admin, group broadcasts, reminder/lifecycle automation (stays automatic), all Affiliate functionality.

## Commercial decision (recorded)
SP-B2 V1 adds **no commercial gate**, matching the owner `create_launch_watcher_update`, which has none today. No plan, price or entitlement changes. If owner watcher updates become commercially gated later, the partner path must be updated in a separate controlled phase to the same CLIENT-workspace entitlement through the SP-B0 core.

## Database (docs/sql/SP_B2_partner_launch_watcher_comms.sql)
Four additive functions, all SECURITY DEFINER, owner postgres, `SET search_path TO ''`, explicit `auth.uid()`, `partner_has_scope(_workspace_id,'launch_watcher_comms')` before any launch read, `workspace_id = _workspace_id` and `launch_kind = 'PROJECT'` on every launch lookup, PUBLIC/anon revoked, authenticated + service_role granted:
- `partner_list_launches_for_comms(_workspace_id)` — needed: no existing partner-callable launch list exists (all owner launch reads use workspace membership).
- `partner_launch_watcher_stats(_workspace_id, _launch_id)`
- `partner_list_launch_watcher_updates(_workspace_id, _launch_id, _limit)`
- `partner_create_launch_watcher_update(_workspace_id, _launch_id, _client_request_id, _title, _body)` — copies every owner guard; inserts `WATCHER_UPDATE` / `source 'operator'` with extra payload `actor='service_partner'` and `partner_access_id`; locks but never updates the launch row. Partners share the owner's per-launch 60-second and 20-per-day limits.

No table, RLS, constraint, trigger, owner-function, membership-helper or Edge Function changes.

## Activation order
1. CP-SPB2-PUBLISH — publish frontend (fails closed: without the RPCs the panel shows "not available yet"). Explicit approval required.
2. CP-SPB2-SQL — apply the SQL file as one migration. Verify: 4 functions, prosecdef, owner postgres, `search_path=""`, ACL authenticated+service_role only; owner watcher functions byte-identical to pre-apply; transactional smoke (grant partner, list, stats, history, send, replay, cooldown, revoke denies) then ROLLBACK so no DM is sent; advisor lint.
3. Regenerate Supabase types (separate turn).
4. Real two-account browser smoke (needs an approved active Service Partner test account).

Expected advisor lint delta: 0028 unchanged (9); 0029 +4 (119 → 123).

## Rollback
`DROP FUNCTION` the four `partner_*` functions (or REVOKE EXECUTE from authenticated) and remove `launch_watcher_comms` from `ACTIVE_PARTNER_SCOPES`. Already-queued deliveries finish normally; no owner path depends on these functions.

## Known conflict with an older phase-scoped check
`scripts/sp-b1-partner-inbox-regression.ts` F-1 asserts that the only active scopes are project_identity and project_inbox ("other SP-B scopes still inactive"). Activating `launch_watcher_comms` makes that SP-B1-era assertion fail by design. The file is outside the SP-B2 allowlist and was not edited; a one-line update needs separate approval.
