# SE-16 — Telegram Mini App Foundation: Read-Only Architecture Audit + Recommended Plan

Audited at HEAD `728bbfecc369803f41904a891fdd038af183cb72`. No code edited, no SQL applied, nothing deployed or published.

## What the repo actually shows

- The whole operator app sits behind one gate: `src/routes/_authenticated/route.tsx` (`ssr: false`, `beforeLoad` reads `supabase.auth.getSession()` and redirects to `/auth`). `/auth` is sign-in only — no self-registration path (`src/routes/auth.tsx:45-53`). There is no `src/routes/api` directory today.
- Router context carries only `queryClient` (`src/router.tsx:5-14`, `src/routes/__root.tsx:99-101`). Auth is read per-gate, not injected — so a new top-level route can have entirely different auth without touching the existing gate.
- Roles: workspace owner/admin resolved through `workspace_members` and RPC `is_workspace_operator`; platform owner through the `platform-admin` Edge Function / `is_platform_owner`, failing closed (`src/hooks/usePlatformAccess.ts:25-72`).
- Shell/nav: `AppShell.tsx` + `SidebarNav` + `MobileTabBar` are mounted only inside `_authenticated`, driven by `src/lib/nav.ts`. A Mini App route can opt out of this shell entirely.
- Telegram identity: the browser never writes `telegram_connections`; the webhook is the authoritative writer (`src/lib/telegram-link.ts:6-11`). Group state lives in `telegram_group_connections` / `telegram_community_settings`.
- **The decisive finding — SE-15 is already Mini-App-shaped.** Every Mission Control RPC in `docs/sql/SE15_mission_control.sql` is keyed on `(_telegram_user_id bigint, _mission_id uuid, _verified_chat_id bigint)`, is `SECURITY DEFINER` with `search_path` pinned, and is `REVOKE`d from `PUBLIC/anon/authenticated`, granted only to `service_role, postgres` (lines 111-114, 183-184, 420-425, …). `social_mission_control_authorize` (line 124) does the full chain itself: telegram user → `telegram_connections` → HQ user → `is_workspace_operator(workspace)` → mission target chat must equal the caller-proven `_verified_chat_id`. The live Telegram-admin proof is supplied by the caller (today: the webhook's `getChatMember`).

Consequence: a Mini App needs **no new business logic and no new tables**. It needs one trusted-caller bridge that produces the same two proven inputs the webhook produces.

## Answers

**1) Same codebase, dedicated route — not a separate project.** The Mini App needs the same design tokens, the same Supabase project, and eventually the same panels (Inbox, Launch Watch). A second frontend duplicates build, deploy, schema types, and auth surface for zero gain. Put it at a top-level `/tg/*` route tree that is *outside* `_authenticated` — no Supabase session, no `AppShell`, its own Telegram-session gate. One role-aware Mini App, as preferred.

**2) HTTPS reachability without publishing.** Telegram requires a public HTTPS URL. Options: (a) publish the whole app — rejected, exposes the operator app; (b) a second hosted deployment — duplicate architecture; (c) **recommended: publish nothing, and serve the Mini App from the stable preview host `project--469fb83c-0f27-4aa7-bb99-c4125279c565-dev.lovable.app`, which is already HTTPS and already used for the Telegram webhook contract.** Safety comes from the route itself, not from obscurity: `/tg/*` renders nothing without valid `initData`, and every mutation re-authorizes server-side. `/` and `/_authenticated/*` stay exactly as they are — unpublished, session-gated. Decision on the eventual production host is a later, explicitly authorized step.

**3) The auth bridge.** One new TanStack server route, `POST /api/public/tg/session` plus `POST /api/public/tg/mission/*`, each doing:
- Read raw `Telegram.WebApp.initData`, verify the HMAC-SHA256 against a key derived from the bot token (`HMAC(key="WebAppData", botToken)`), server-side only — bot token never leaves the server.
- Reject `auth_date` older than a short window (e.g. 15 min) and store the exact `hash` in a short-TTL replay set so a captured `initData` cannot be reused for a mutation.
- Never trust `initDataUnsafe`, never trust any client-sent workspace/mission/chat id for authorization — ids are inputs to re-authorization, not evidence.
- Take `user.id` from the *verified* payload, then do exactly what the webhook does: live `getChatMember` on the mission's own target chat, require `administrator|creator`, and pass that chat id as `_verified_chat_id` into the existing RPCs. Anonymous-admin cases keep bot-side semantics; no Mini App bypass.
- Mini App requests are stateless per call — no long-lived cookie that outlives the admin check.

**4) Reuse unchanged.** All of `social_mission_control_workspaces`, `_missions`, `_panel`, `social_mission_effective_config_resolved`, `social_mission_apply_target_override`, `social_mission_apply_duration_override`, `end_social_mission_from_control`, `cancel_social_mission_from_control`, plus the merge/history/idempotency helpers. **Zero new RPCs.** The only new layer is thin HTTP: initData verification + `getChatMember` + service-role RPC call + JSON out. `telegram_team_sessions` stays bot-only; the Mini App is stateless and does not need it.

**5) Scope: admin-only Mission Control, single screen.** Smallest safe scope; `social_mission_control_workspaces` already restricts to `owner/admin`. Build it *role-aware in shape* (the bridge returns the caller's role/workspaces) but ship only Mission Control screens in V1.

**6) Bot vs Mini App, long term.**
- Permanently bot: notifications, Launch Watch join/mute/stop, Pulse and launch alerts, welcome CTA, group posts, Project Inbox conversation. These are conversational, push-shaped, and must work for non-operators.
- Move to Mini App over time: Mission Control (V1), Launch Control lifecycle, broadcast composition, community settings, analytics. These are form-shaped and currently suffer as chat flows.
- The bot keeps a working fallback for everything it does today — no removal in SE-16.

**7) Entry points.** `/mission manage` keeps its current bot panel and gains a Mini App button beside it — fallback preserved. Add the bot Menu button and `?startapp=mission_<missionId>` deep links, parsed into the same `/tg/mission/$missionId` route. Existing `start` payloads (`lw_`, `mission_manage`) are untouched.

**8) SE-16 build sequence (each a stop gate).**
1. **SE-16.0** — repo-only auth bridge: initData verification + replay window + `getChatMember`, with regression coverage. No UI. STOP.
2. **SE-16.1** — repo-only read-only Mini App: `/tg/*` route tree, Telegram theme/safe areas, mission picker + read-only panel. STOP.
3. **SE-16.2** — repo-only mutations wired to the existing four RPCs, idempotency keys derived per request. Full gate. STOP.
4. **SE-16.3** — authorized production step: deploy the bridge, register the Mini App URL/menu button with BotFather, add the button to `/mission manage`. STOP.
5. **SE-16.4** — live QA in real Telegram, bot fallback verified intact. STOP.
No schema change, no new table, no second scheduler at any step.

**9) Blockers and risks.**
- Telegram WebView needs frame-ancestors/CSP that permit Telegram embedding; `/tg/*` must not inherit any anti-embedding header the operator app wants.
- `/api/public/*` bypasses site auth by design — the handler is the only security boundary, so signature + freshness + live admin check are mandatory, not optional.
- The preview host is stable but not a production domain; a host change later invalidates the registered Mini App URL.
- Supabase session assumptions: `/tg/*` must not run `supabase.auth.getSession()` or mount `AppShell`; a Telegram user is not an HQ session.
- Replay: `initData` is bearer-like; short freshness window plus hash replay cache required.
- Bot token must exist only in server env, never in the client bundle.
- Role confusion: platform-owner ≠ workspace-admin ≠ Telegram group admin. Mission mutations need all three relevant checks, exactly as `social_mission_control_authorize` plus `getChatMember` already enforce.
- Mobile: Telegram theme params, dark-first brand palette, `safe-area-inset` bottom, and no reliance on browser chrome. A plain browser hit on `/tg/*` must show a neutral "open from Telegram" state.

**10) V1 Mission Control screen structure.**
```text
[ Mission header ]  @author · LIVE · ends in 41m
------------------------------------------------
LIVE X RESULTS            (stored snapshot only)
  Views 1,204   Likes 88   Replies 12
  Reposts 9     Bookmarks unavailable
------------------------------------------------
TARGETS                            [AUTO|MANUAL]
  Primary goal   Views       70
  Views 70 · Likes 20 · Replies off · Reposts off
------------------------------------------------
[ Edit targets ] [ Change end time ]
[ End now ]      [ Cancel mission ]
------------------------------------------------
History (read-only, last 5 changes)
```
Editing is a numeric form sheet, not a chat prompt: tap a metric, type a number, save — the same values the bot writes, without the conversational back-and-forth. Results and targets are always in separate labelled blocks so "Likes 20" can never read as a live result.

## Limitations of this audit

Everything above is from static reads of the repo at HEAD. The deployed state of `docs/sql/SE15_mission_control.sql` in `ocoinbnjgstkmnwwvnhi` was not queried, and no live Telegram or browser behaviour was observed. `platform-admin`, `telegram-link`, and `telegram-group` Edge Function sources are not in this repo.

Nothing here is implemented. Approving this plan approves SE-16.0 only (repo-only auth bridge), which then stops for review.
