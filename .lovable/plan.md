# SE-16.3A — Telegram Reachability Audit + Surgical Change Contract

Read-only audit at HEAD `aa80d30a988f438bc5b1260c139aa67cf948cd7d`, clean tree. Nothing edited, deployed, published, or sent.

## 1. Where `/mission manage` and its keyboards live

All in `supabase/functions/telegram-webhook/index.ts` (authoritative; `backend-source/edge-functions/telegram-webhook/` is stale and NOT in the deploy-parity list).

- L4245 command match: `text.match(/^\/mission(?:@\w+)?(?:\s+(\S+))?\s*$/i)`
- L4258 `isManageCommand` = arg lowercased `=== "manage"`; runs before every other `/mission` branch
- L4264-4277 group path: anonymous-admin allowance, else live `getChatMember` administrator/creator
- L311-335 group launcher: `MISSION_MANAGE_DEEP_LINK = https://t.me/${BOT_USERNAME}?start=mission_manage`, `MISSION_MANAGE_GROUP_TEXT`, `sendMissionManageLauncherAndCleanup()` — single inline `url` button "🛠 Open Mission Control", then deletes only the exact source message id
- L4385 `/start mission_manage` deep-link entry
- L2724 `mcOpenConsole` (DM entry) → L2661 `mcRenderMissionPicker` → L2598 `mcRenderPanel`
- L2585-2595 `mcPanelKeyboard(missionId)`: Edit targets / Change end time / End mission now / Cancel mission / Exit
- L2772 `mcTargetsKeyboard`, L2788 `mcDurationKeyboard`

## 2. Existing Mini App wiring: none

`rg "web_app|startapp|setChatMenuButton|menu_button"` across `supabase/functions/` and `scripts/` returns zero matches. No Mini App URL, no menu button, no `?startapp=` handling anywhere in the bot. The only `/tg` references are the app routes and their UI regression script.

## 3. Fallback path that must be preserved unchanged

Group `/mission manage` → notice + `t.me` deep link → private `/start mission_manage` → `mcOpenConsole` → workspace picker → mission picker → `mcRenderPanel` with the full `mc_*` callback control set (targets, duration, END, CANCEL, exit). Every authorization gate (workspace RPCs, mission binding, live `getChatMember`) stays exactly as-is. The Mini App is additive only.

## 4. Smallest exact change

Telegram only permits `web_app` inline buttons in **private** chats. So the button goes on the DM panel, not the group launcher.

- Add one constant near L311: `MISSION_CONTROL_WEBAPP_URL = "https://cartel-hq-ops.lovable.app/tg"`.
- Add one row at the **top** of `mcPanelKeyboard`: `[{ text: "📲 Open Mission Control", web_app: { url: MISSION_CONTROL_WEBAPP_URL } }]`.
- Leave all existing rows, callback data, ordering below it, and the group launcher untouched.

Optional (decide before build): also add the same row to the multi-mission / multi-workspace picker keyboards. Default assumption: **no** — panel only, smallest surface.

## 5. Bot menu button

Not required for first reachability. The DM panel button alone makes `/tg` openable end-to-end via `/mission manage`. `setChatMenuButton` is a live BotFather/API config change and is deferred to a separate explicit config step (SE-16.3B).

## 6. Regression coverage

Extend `scripts/se15-mission-control-regression.ts` only (it already owns webhook static assertions; the webhook is not in the deploy-parity file list, so `social-mission-deploy-parity-regression.ts` needs no change).

New assertions:
- panel keyboard contains a `web_app` button whose URL is exactly `https://cartel-hq-ops.lovable.app/tg`
- the web_app row is inside `mcPanelKeyboard`, not in `MISSION_MANAGE_GROUP_TEXT`'s keyboard
- group launcher still carries no `web_app` and no `callback_data` (existing 1.5 preserved, plus a new negative tripwire)
- all four existing panel callbacks (`mc_t_`, `mc_d_`, `mc_e_`, `mc_c_`) and `mc_x` still present
- no `setChatMenuButton` / `menu_button` appears in the webhook

No existing assertion weakened.

## 7. Exact files for the smallest change

1. `supabase/functions/telegram-webhook/index.ts`
2. `scripts/se15-mission-control-regression.ts`

Nothing else. No SQL, no config.toml, no Supabase, no BotFather, no app routes, no deploy.

## Notes / residual

- Shipping this requires a later authorized `telegram-webhook` deploy; the repo change alone changes nothing in production.
- Telegram rejects `web_app` buttons in group chats — that constraint is why the group launcher keeps the `t.me` URL button.
- `/tg` is live and returns 200 with the H4 headers, but rendering inside a real Telegram WebView is still unproven.
