# Step 1C — Community Command Center product/UI unification

Frontend-only phase. No SQL, no migration, no RPC, no RLS/grant, no secret, no
cron, no Edge Function, no deploy and no publish. The authoritative external
Supabase project was not modified.

## Product shape

`/telegram` is now the workspace-scoped **Community Command Center**: one
umbrella for Telegram community health, Social Missions, broadcasts, the member
Inbox, Launch Watch and a compact Analytics summary.

Visible tab order:

```text
Overview | Telegram | Missions | Broadcasts | Inbox | Launch Watch | Analytics
```

Tab-key mapping (URLs are preserved, only presentation changed):

| Visible label | Search-param key | Notes |
|---|---|---|
| Overview | `overview` | default; adds a read-only Social Missions strip |
| Telegram | `communities` | unchanged content and `forceMount` behaviour |
| Missions | `missions` | NEW, read-only |
| Broadcasts | `broadcasts` | `BroadcastsPanel` unchanged |
| Inbox | `inbox` | `ProjectInboxPanel` unchanged |
| Launch Watch | `audience` | `AudiencePanel` unchanged |
| Analytics | `analytics` | NEW, current-state summary |

Backward compatibility: `?tab=communities` and `?tab=audience` still resolve to
their tabs because their keys did not change. The retired `?tab=history` is
remapped to Overview through `LEGACY_TAB_ALIASES` instead of being dropped
silently.

## Social Missions surface — read-only by contract

`src/lib/social-missions.ts` contains `select` statements only. There is no
insert, update, upsert, delete, `rpc` or `functions.invoke` in the module, no
service-role usage, no provider or Telegram call, and no `refetchInterval`
(this phase does not poll). Every read is explicitly filtered with
`.eq("workspace_id", workspaceId)` in addition to the workspace-member RLS
policies already installed on these tables.

Tables read (existing, already live):

- `social_missions` — status, `started_at`, `ends_at`, `completed_at`
- `social_mission_targets` — `delivery_state`, `edit_state`, chat id
- `social_mission_schedule_events` — event type, `sequence_no`, `due_at`, state
- `social_posts` — `canonical_url`, `author_handle`
- `telegram_group_connections` — community title for the target chat
- `social_metric_snapshots` — most recent stored snapshot only

Remaining/expired state is derived client-side from `ends_at` and
`completed_at`. Unknown metrics render as an em dash and are never zero-filled.

Operator guidance is stated in the panel: `Start: /mission <X link>` and
`Close: /mission close`, run in the connected Telegram community. Mission
creation and closing remain Telegram-only. The Owner Console fixture controls
are untouched and are not reachable from this surface.

## Files changed

- `src/routes/_authenticated/telegram.tsx`
- `src/components/cartel/SocialMissionsPanel.tsx` (new)
- `src/components/cartel/CommunityAnalyticsPanel.tsx` (new)
- `src/lib/social-missions.ts` (new)
- `src/lib/nav.ts` (label only)
- `scripts/community-command-center-unification-regression.ts` (new)
- `docs/COMMUNITY_COMMAND_CENTER_UNIFICATION.md` (new)

## Out of scope for this phase

Connect X / OAuth, provider polling, Contributors, points/rewards,
pricing/billing, any new Telegram send, any mission mutation from the browser,
and historical analytics reporting.
