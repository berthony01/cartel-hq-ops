# C3 Pre-Build Architecture Check — Community Command > Audience

Read-only inspection at gate `94fb1674b7eb904305824a44bf9508eda60543ec` (repo HEAD confirmed). No files, DB, functions, or Telegram state were changed.

## 1. Verified current state (live DB)

Active-watcher fields on `launch_watch_subscriptions`: `is_active`, `updates_enabled`, `reminders_enabled`, `subscribed_at`, `unsubscribed_at`, `last_interaction_at`, `confirmation_status` (`null|sent|failed|ambiguous`), `confirmation_attempt_count`, `source` (always `telegram_deep_link`). Constraint guarantees `is_active=true` implies `unsubscribed_at IS NULL`.

Existing RPCs (all `STABLE SECURITY DEFINER`, all gate on `is_workspace_member(workspace_id, auth.uid())`, all counts-only):
- `get_launch_watch_summary(_launch_id)` -> `active_count`, `total_count`
- `get_launch_watcher_update_stats(_launch_id)` -> `active_watchers`, `updates_enabled_watchers`, `updates_muted_watchers`
- `get_launch_notification_summary(_launch_id)` -> `event_count`, `pending_count` (pending+processing+retry), `sent_count`, `failed_count`, `ambiguous_count`, `skipped_count`, `reminder_enabled_watchers` (active AND reminders_enabled)
- `get_launch_watch_confirmation_summary(_launch_id)` -> `delivered/failed/ambiguous/untracked/attempted` over ACTIVE watchers

Wrappers already exist in `src/lib/launch-control.ts` for all four.

`launch_notification_deliveries`: RLS on, 0 policies, no anon/authenticated grants (service-role only). `status` CHECK = `pending|processing|retry|sent|failed|ambiguous|skipped`. `error_class` is free text; only two producers exist in live code: `mark_stale_launch_notification_claims` writes `stale_processing_claim`, and `telegram-webhook` writes a per-outcome class on confirmation DMs. Live table today holds exactly 1 row (`sent`, `error_class` null). **CORRECTION: `error_class` cannot carry a dashboard taxonomy — it is unenumerated, sparsely populated, and does not distinguish a blocked bot. C3 must classify on `status` only.**

## 2. Classification contract (MECE over ACTIVE watchers)

Per ACTIVE watcher, take its single most recent delivery row (`launch_notification_deliveries` joined via `subscription_id`, for this launch), ordered `updated_at DESC, created_at DESC, id DESC`. Bucket by that row's `status`:

| Bucket | Rule | Label |
| --- | --- | --- |
| Last known: delivered | latest status = `sent` | "Last delivery succeeded" |
| Last known: rejected by Telegram | latest status = `failed` | "Telegram rejected the last delivery" |
| Outcome uncertain | latest status = `ambiguous` | "Last delivery outcome unconfirmed" |
| In flight | latest status in `pending|processing|retry` | "Delivery in progress" |
| Not sent to | latest status = `skipped` | "Last message was not sent (preferences)" |
| Never contacted | no delivery row at all | "No message attempted yet" |

Exactly one bucket per active watcher; buckets sum to `active_watchers`. **CORRECTION: drop "Reached recently" and "Blocked bot"** — no window is defensible and blocking is not observable. Use "last known outcome" wording with an "as of latest attempt" caption.

Answer to Q4: in-flight (`pending|processing|retry`) must NOT be folded into reachable or unreachable — it gets its own bucket, otherwise the dashboard flips values as the runner drains the queue. `skipped` is a preference/eligibility outcome, not a reachability signal, and gets its own bucket.

## 3. Preferences (Q5)

Show project-update eligibility and reminder eligibility separately — the enqueue trigger filters on `updates_enabled` for `WATCHER_UPDATE` and on `reminders_enabled` for `REMINDER_24H|REMINDER_1H`, so they are genuinely different audiences. Counts needed: `active_watchers`, `updates_enabled_watchers`, `updates_muted_watchers`, `reminders_enabled_watchers`, `reminders_muted_watchers`. The last two are not exposed together today; fold them into the new RPC rather than composing three calls.

## 4. New RPC (Q6, Q7)

Existing RPCs cannot express latest-delivery-per-watcher, so one new read-only RPC is required. Migration + thin wrapper is safer than client-side composition (no delivery rows reach the browser, one round trip, one auth gate).

```
public.get_launch_audience_summary(_launch_id uuid)
returns table (
  active_watchers            bigint,
  total_watchers             bigint,
  updates_enabled_watchers   bigint,
  updates_muted_watchers     bigint,
  reminders_enabled_watchers bigint,
  reminders_muted_watchers   bigint,
  last_sent_watchers         bigint,
  last_failed_watchers       bigint,
  last_ambiguous_watchers    bigint,
  last_inflight_watchers     bigint,
  last_skipped_watchers      bigint,
  never_contacted_watchers   bigint,
  last_delivery_at           timestamptz
)
language plpgsql stable security definer set search_path = public
```
Body: resolve `launches.workspace_id` (raise `P0002` if missing), require `is_workspace_member(workspace_id, auth.uid())` else `42501` — matching the four existing RPCs verbatim. Then `LEFT JOIN LATERAL` the newest delivery per active subscription and aggregate with `count(*) filter (...)`. Returns counts and one timestamp only; no `telegram_user_id`, no `subscription_id`, no message text. Grant `EXECUTE` to `authenticated` only (mirror existing RPC grants); no anon.

## 5. UI contract (Q8, Q9)

`src/components/cartel/AudiencePanel.tsx`, rendered in the existing `audience` tab of `/telegram`, reusing the same `?launch=` search param and the same launch-selector behaviour already implemented in `BroadcastsPanel` (selection writes the param with `replace: true`; invalid/absent param falls back to the primary launch). Sections and labels:
1. **Watchers** — Active watchers / All-time opt-ins, caption "Aggregate only. CARTEL HQ never shows watcher identities."
2. **What they receive** — Project updates: allowed / muted; Countdown reminders: allowed / muted.
3. **Last known delivery outcome** — the six buckets above, with caption "Based on each active watcher's most recent message attempt" and "as of <last_delivery_at>".
4. **Onboarding confirmation** — reuse existing `get_launch_watch_confirmation_summary`, keeping the existing "untracked" wording (pre-tracking opt-ins are never reported as failures).

No per-person rows, no exports, no send controls in this tab. Empty state when `total_watchers = 0`: explain Launch Watch opt-in and link to Launch Control. Loading: skeletons, never zeros. Error: inline retry with the RPC message; `42501` renders "You do not have access to this launch." Normal workspace members see the identical dashboard (member-level gate, matching every other summary RPC); send permissions stay unchanged.

## 6. Privacy / performance (Q10, Q11)

Privacy: PASS as designed — deliveries and subscriptions stay service-role only; the browser sees counts and one timestamp. Only risk is a future per-bucket drill-down; C3 must forbid it.

Performance: existing indexes are `launch_notification_deliveries_subscription_id_idx` and `launch_watch_subscriptions_active_launch_idx`. The lateral "newest per subscription" probe sorts within each subscription's rows. Include in the same migration:
`CREATE INDEX IF NOT EXISTS launch_notification_deliveries_sub_recent_idx ON public.launch_notification_deliveries (subscription_id, updated_at DESC, created_at DESC);`
Current volume is 1 delivery row, so this is pre-emptive, not corrective.

## 7. C3 allowlist / prohibited (Q12)

Allowed: one migration (the RPC + grant + index above); `src/lib/launch-control.ts` (types + one wrapper); new `src/components/cartel/AudiencePanel.tsx`; `src/routes/_authenticated/telegram.tsx` (swap the audience placeholder only). Generated `src/integrations/supabase/types.ts` may change only via the platform regeneration.

Prohibited: any change to existing RPCs, triggers, RLS, grants beyond the one new EXECUTE; any Edge Function deploy or Telegram call; any change to `BroadcastsPanel.tsx`, `launch-control.tsx` route, or notification runtime; any exposure of `telegram_user_id`/`subscription_id`/per-row delivery data; any "blocked bot", "reached recently", "safe/verified token" wording; any publish; any data mutation.

## 8. Post-build audit checklist (Q13)

1. Confirm the diff is exactly the allowlisted files plus the migration.
2. `pg_get_functiondef` of the new RPC: member gate present, `stable security definer`, `search_path=public`, no identity columns in the return type.
3. `SELECT has_function_privilege('anon', ...)` is false; `authenticated` is true.
4. Non-member call returns `42501`; unknown launch returns `P0002`.
5. Bucket sum equals `active_watchers` on live data, verified by an independent SQL cross-check.
6. Network tab on `/telegram?tab=audience&launch=<id>`: response body contains no `telegram_user_id` and no delivery rows.
7. `?launch=` round-trips between Broadcasts and Audience tabs.
8. `bunx tsgo --noEmit` and production build pass.
9. Preview only — not published.

**Verdict: PASS WITH CORRECTIONS** — proceed with the contract above; the two corrections are (a) drop the `error_class`-based taxonomy and "blocked bot"/"reached recently" labels, and (b) add explicit in-flight and skipped buckets so the classification is mutually exclusive and exhaustive.
