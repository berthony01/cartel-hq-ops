# Mission Control group launcher: findings so far and the one remaining step

## Current state
- The code is finished, reviewed and saved but not deployed. Nothing else is being implemented, so no work is repeated.
- The live bot backend (`telegram-webhook`) is ACTIVE v110. That is the old code, without `/missioncontrol`.
- The BotFather Main Mini App has NOT been checked. The private-chat "Open" button (a web_app menu) is a different setting and does not prove the Main Mini App is enabled.
- Without `MISSION_CONTROL_MINIAPP_LINK`, the group command shows a "not available" message with no button. It never guesses a link.

## Several groups in the same project
- Each group's button carries its own connection ID (`mc_<connection UUID>`). It is never a project ID or a `chat_instance`.
- The Mini App looks up that one connection and gets its exact `telegram_chat_id`.
- Every mission list request re-checks access and returns only missions posted in that chat. Group A's launch never shows Group B's missions, even in the same project.
- The project picker is hidden in community mode, so the view can't drift to the whole project.
- **Limitation:** opening Mission Control the usual private way still shows the whole project, as it did before.

## What happens when a launch fails
- **Bad `mc_` code:** shows "Mission Control can't open here" (`community_launch_invalid`).
- **These all show the same refusal and reveal nothing about the community** (`community_launch_unavailable`):
  - the connection is missing, removed, or the bot is no longer admin;
  - the user isn't an operator of that project;
  - the user isn't a current admin of that chat.
- No project is picked automatically after a refusal. The user only sees a retry option.
- A copied link gives no rights. Every open re-checks the signed Telegram login data, operator access and live chat admin status.
- The platform owner's access works exactly as before. Partners get no new rights.

## Remaining step (tests only, no product change)
Add one assertion to `scripts/mission-control-group-launcher-regression.ts`. It runs the mission list's filter on fake missions from two chats in the same project and confirms only the target chat's missions come back. The current tests only check the source code text, so this proves it actually works. Then re-run that test, se16, se161 and the type check.

## Not included
No deploy, publish, database writes, BotFather changes, broadcasts, wallet, Safe or mainnet work.
