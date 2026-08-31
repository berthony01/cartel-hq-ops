# Phase 7A — My Watchlist (foundation) + Cartel Signals (read-only feed)

Planning only. Gate verified: HEAD `0776c808c694f3b468401efb95f3f2e4dfacbdf7`, clean tree. No files edited, no Supabase change made.

## Current-state findings (verified this turn)

- `launch_events` is a **notification delivery queue, not a project-event log**. Its CHECK constraint allows only `REMINDER_24H`, `REMINDER_1H`, `OFFICIAL_CONTRACT_REGISTERED`, `LAUNCH_LIVE`, `source` only `reminder_runner` / `lifecycle`. Rows are written by the lifecycle trigger and reminder runner, consumed by delivery, and the table is currently **empty** (0 rows) after prior QA cleanup. It cannot back a trustworthy Signals feed: no `ANNOUNCED`, no `WATCHLIST_OPEN`, no project-published event, and rows are operational/prunable.
- `public.launches` already carries authoritative lifecycle timestamps: `announced_at`, `watchlist_opened_at`, `launch_approaching_at`, `contract_pending_at`, `contract_registered_at`, `live_at`, `completed_at`. These are durable, project-authenticated, and enough to derive Signals **without any new table**.
- `project_profiles` has **no `published_at` column** — only `created_at` / `updated_at`. A truthful "Project published" signal is therefore not derivable today.
- Public read model is already established: six `get_cartel_network_*` SECURITY DEFINER RPCs + `src/lib/cartel-network.ts` + shared cards in `src/components/cartel-network/NetworkPieces.tsx`. Signals should extend this pattern exactly, not create a parallel one.
- `telegram_connections` maps `user_id → telegram_user_id` (1 row live). `launch_watch_subscriptions` has 2 rows, both active, and is fully locked to service-role (0 policies, all operations denied) — so browser access must go through a new SECURITY DEFINER RPC.
- Hosting surfaces exist already: authenticated sidebar sections in `src/lib/nav.ts` (`Network` section) and the public `NetworkShell` nav.

## Recommendation: build BOTH, but as two independent read-only surfaces

They share no state and no risk surface: My Watchlist is authenticated + user-scoped; Signals is public + derived from already-public data. Coupling them into one dashboard would mix privacy tiers. Ship them as two routes in one phase.

## Authoritative data flow

```text
My Watchlist (authenticated)
  browser (session) -> rpc get_my_launch_watchlist()
      auth.uid() -> telegram_connections.telegram_user_id
                 -> launch_watch_subscriptions (is_active)
                 -> launches + project_profiles (published only)
      returns launch cards + this user's own reminders_enabled flag
      NEVER returns telegram_user_id, subscription id, other watchers, delivery rows

Cartel Signals (public)
  browser (anon or session) -> rpc get_cartel_network_signals(_limit,_offset,_chain)
      launches join project_profiles where discovery_status='published'
      unpivot lifecycle timestamps -> signal rows ordered by occurred_at desc
      returns same public fields the Phase 6 RPCs already return
```

## Proposed DB changes (two new functions, no new tables, no RLS edits)

1. `public.get_my_launch_watchlist()` — SECURITY DEFINER, `SET search_path = public`, `STABLE`, `GRANT EXECUTE TO authenticated` only.
   Returns per active subscription: `launch_public_slug, token_name, ticker, chain, status, launch_at, launch_window_start, launch_window_end, timezone, official_contract_address, contract_registered_at, live_at, project_public_slug, project_name, project_primary_chain, has_logo, reminders_enabled, subscribed_at`.
   Filtered to `is_active = true` and published project profiles. No `_user_id` parameter — identity comes from `auth.uid()` inside the function (no actor override).
2. `public.get_cartel_network_signals(_limit int, _offset int, _chain text DEFAULT NULL)` — SECURITY DEFINER, `STABLE`, `GRANT EXECUTE TO anon, authenticated`, mirroring the existing network RPCs.
   Signal types in 7A: `LAUNCH_ANNOUNCED`, `WATCHLIST_OPENED`, `OFFICIAL_CONTRACT_REGISTERED`, `LAUNCH_LIVE`, `LAUNCH_COMPLETED`, each with `occurred_at` from the corresponding launches timestamp, plus launch/project public identity fields and `total_count`.
   **Excluded from 7A:** "Project published" (no truthful timestamp exists). Adding `project_profiles.published_at` is a separate, later change.

No changes to `launch_events`, `launch_notification_deliveries`, `launch_watch_subscriptions`, any RLS policy, any grant on an existing object, any Edge Function, cron, or secret.

## Files likely to change

- `supabase/migrations/<new>.sql` (via migration tool, one migration, two functions)
- `src/integrations/supabase/types.ts` (regenerated after migration)
- `src/lib/cartel-network.ts` — add signals types/keys/fetcher, reuse existing formatters
- new `src/lib/watchlist.ts` — watchlist types/key/fetcher
- new `src/routes/network.signals.tsx` — public Signals feed
- new `src/routes/_authenticated/watchlist.tsx` — My Watchlist
- `src/components/cartel-network/NetworkShell.tsx` — add `Signals` nav item
- `src/lib/nav.ts` — add `My Watchlist` under the Network section (not mobile-primary)
- `src/components/cartel-network/NetworkPieces.tsx` — add a `SignalRow` presentational piece (reuse `StatusPill`, `ProjectLogo`, `formatSchedule`)

## Navigation

- Public: `/network/signals`, added to `NetworkShell` nav after `Upcoming Launches`.
- Authenticated: `/watchlist`, sidebar `Network` section, label `My Watchlist`.
- Both are leaf routes with their own `head()` metadata; Signals is a public SSR route calling a public RPC (no bearer needed).

## Privacy and security rules

- No Telegram user IDs, subscription IDs, chat IDs, workspace IDs, user IDs, delivery/confirmation rows, or storage paths in any browser response.
- My Watchlist shows only the caller's own subscriptions; there is no parameter that can name another user.
- No cross-user watcher counts on the watchlist cards (aggregates stay in Launch Control).
- Signals reads only published project profiles, same visibility rule as Phase 6.
- Copy rules: Signals is described as "official project and launch events published by authenticated projects." No buy/sell/pump/price/market language, no safety or endorsement claim; reuse `NETWORK_TRUST_COPY`.
- Telegram Launch Watch opt-in stays canonical — 7A adds **no** web watch/favorite/follow mechanism. Empty watchlist directs the user to the Cartel Network to watch via the bot.

## Loading / error / empty states (truthfulness rules from 6.5Q)

- Distinct `isLoading`, `isError` (message + Retry calling `refetch()`), and genuine-zero branches on every query. Never render "nothing here" while a query is loading or failed.
- My Watchlist has a distinct **"No Telegram account connected"** state (linking to Community Command / connection flow) separate from **"Connected, but not watching any launch yet."**
- Signals paginates with the existing `NETWORK_PAGE_SIZE`/`total_count` pattern; filtered-zero says "No signals match this filter," not "No signals yet."

## Verification

- `bunx tsgo --noEmit` and `bun run build`.
- Read-only SQL: confirm both functions are `SECURITY DEFINER` with pinned `search_path`, and that EXECUTE grants are exactly `authenticated` (watchlist) and `anon, authenticated` (signals).
- Live data check against the one real connected user: `get_my_launch_watchlist()` returns their active subscriptions and no identity columns; confirm the returned column list contains no `telegram_user_id`.
- Negative check: calling `get_my_launch_watchlist()` with no session returns zero rows (fail-closed, not an error leak).
- Browser check of `/network/signals` and `/watchlist` including loading, error (forced), and empty states.
- CARTEL HQ stays unpublished; no Edge Function deploy.

## Prohibited scope

No new tables; no changes to Launch Watch subscribe/unsubscribe, notifications, deliveries, Telegram webhook, cron, or secrets; no RLS/grant changes to existing objects; no web-based watch button; no verification badges; no Owner Console work; no publish/deploy.

## Stop point

Stop after the migration is applied, the two routes build clean, and verification output is reported. Phase 7B (project-published signals, watchlist reminder controls from the web, signal detail pages) is a separate contract.

## Risks / unknowns to verify before implementation

1. **Empty `launch_events`** confirms it is prunable operational state — please confirm you agree Signals must be derived from `launches` timestamps rather than that queue.
2. **No `published_at` on `project_profiles`** — confirm omitting "Project published" from 7A is acceptable versus adding the column now.
3. **Anonymous `auth.uid()`** inside a SECURITY DEFINER function returns NULL; the function must be written to return zero rows rather than error. To be asserted in tests.
4. Only one Telegram connection and two subscriptions exist live, so real-data coverage of the multi-launch watchlist case is thin; may need a controlled QA subscription to exercise it.
5. Signals ordering across many launches has no index on the individual lifecycle timestamp columns; at current volume this is a non-issue, but a sort/limit index may be needed later.
