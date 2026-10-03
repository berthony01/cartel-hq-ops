# /missioncontrol group launcher -> Mission Control Mini App (audit + proposed contract)

## Audit findings (read-only, this turn)

Repo HEAD: `f1a5f2c4396bb8f4f34250c08773f50f2b046d65` (differs from earlier 246251b; treat Lovable `latest_commit_sha` as authoritative). Deployed webhook version was not compared this turn; that is step 1 of the build.

What already exists (reuse, do not rebuild):
- `supabase/functions/telegram-webhook/index.ts`
  - `/mission manage` group launcher (SE-15, ~line 4694): live `getChatMember` admin check (or anonymous-admin `sender_chat` proof); non-admins get a refusal; admins get a private deep link `t.me/<bot>?start=mission_manage` (line 313), raw command cleanup after a confirmed post.
  - `/start mission_manage` private entry (line 4831) -> workspace picker -> private panel whose button is `web_app` to `https://pepecartelhq.com/tg/mission/<uuid>` (MINI-HQ-1C, line 2808).
  - `helpText(isGroup)` lists `/mission manage`; `ensureCommands` registers only start/help/roadmap/mission (no `missioncontrol`, default scope only).
- Mini App: `src/routes/tg.index.tsx` accepts `?tab=missions&workspace=<uuid>` and keeps the workspace only if it is in the server-authorized list (`resolveAuthorizedWorkspace`). `src/lib/telegram-miniapp-auth.server.ts` validates signed initData (HMAC, `auth_date` freshness, size bound).
- Authorization: operator workspaces resolved server-side from the verified Telegram user (`bot_inbox_operator_workspaces`, `social_mission_control_workspaces`); group mapping lives in `telegram_group_connections (workspace_id, telegram_chat_id)`; mission authorization requires `_verified_chat_id` (SE15 SQL).
- Gap: nothing reads `start_param`/`startapp` anywhere. `web_app` buttons are not allowed in groups, so a group needs a normal URL button to a direct Mini App link (`t.me/<bot>/<short_name>?startapp=...` or the Main Mini App form `t.me/<bot>?startapp=...`).

## Manual prerequisite (owner, BotFather)
- Configure the Mini App for @PepeCartelHQBot: either a Main Mini App (Bot Settings -> Configure Mini App, URL `https://pepecartelhq.com/tg`) or `/newapp` with a short name. Report back which form and the short name. Build is blocked until this exists; I will not guess the link.

## Proposed behaviour
1. In a connected group, `/missioncontrol` (and `/missioncontrol@PepeCartelHQBot`) runs the SAME admin gate as `/mission manage`. Admins get one message with a URL button "Open Mission Control" -> direct Mini App link with `startapp=mc_<group_connection_id>`. Non-admins get the existing refusal. Unconnected group: short notice, no link. Raw command cleanup identical to SE-15.
2. Mini App reads `start_param` only from the verified initData on the server (never `Telegram.WebApp.initDataUnsafe`), parses `mc_<uuid>`, looks up the group connection, and opens `tab=missions` for that workspace ONLY if the verified user's operator workspace list (owner/admin/authorized partner per existing RPCs, platform-owner bypass preserved) contains it. Otherwise fail closed to the normal picker without disclosing whether the community exists. `chat_instance` is never used as a chat id; the payload is a routing hint, never authorization.
3. Unchanged: `/mission manage`, `/start mission_manage`, all `mc_*`/`pi_*` callbacks, private panel buttons.
4. Help text and `setMyCommands` add `missioncontrol` (group-admin scope addition only if supported by the existing helper; otherwise default list).

## Allowlist
- `supabase/functions/telegram-webhook/index.ts` (+ `backend-source/edge-functions/telegram-webhook/index.ts` mirror if parity script requires)
- `src/lib/telegram-miniapp-auth.server.ts` (expose verified `start_param`) and the Mini App server function that returns the session/workspaces (`src/lib/telegram-miniapp-client.ts` / its functions file)
- `src/routes/tg.index.tsx` (apply resolved start workspace -> missions tab)
- New `scripts/mission-control-group-launcher-regression.ts`; minimal assertion updates in `scripts/mini-hq-1b1-bot-handoff-regression.ts`, `scripts/se16-miniapp-auth-bridge-regression.ts`, `scripts/se161-miniapp-ui-regression.ts`
- Deploy of `telegram-webhook` only after explicit approval; no SQL/migration (existing group-connection read via service role inside webhook/server fn).

Forbidden: schema/RLS/RPC changes, billing/entitlements, wallet/PCART/Safe, other Edge Functions, broadcasts, publishing.

## Tests
- Command regex matches `/missioncontrol` and `@bot` form only; non-admin gets no link; unconnected group gets no link; button is `url`, not `web_app`; payload is `mc_` + UUID and contains no chat/user ids.
- start_param parsed only from HMAC-verified initData; tampered/expired initData rejected; malformed payload ignored; connection in a workspace the user cannot operate -> picker, no disclosure; authorized -> missions tab for that workspace; owner bypass intact.
- Legacy `/mission manage`, `/start mission_manage`, `mc_*`/`pi_*` handlers still present; existing regressions, typecheck, build pass.
- Live (after approval): deployed version check, one admin `/missioncontrol` in a test group, open link, confirm correct community view; non-admin refusal.

## Stop point
Stop after implementation + tests; deploy and publish each require separate approval.
