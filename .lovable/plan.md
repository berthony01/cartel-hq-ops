# Release record correction: telegram-webhook live version (read-only)

## Goal
Correct the earlier statements ("not deployed", "live still v110"). The owner independently saw `telegram-webhook` ACTIVE at v112, updated 2026-10-03 15:00:34 UTC, running the new `/missioncontrol` launcher code. Find out what can actually be proven about how it got deployed, then record the facts in the roadmap. No feature work.

## Hard limits
- No production writes, deploys, publishes, secret or config changes, and no bot messages.
- No source edits other than `roadmap.md`.
- Don't guess the cause. Anything the evidence can't prove is reported as UNPROVEN.

## Steps
1. **Agent actions:** search this project's chat history for any deploy action on `telegram-webhook` (manual deploy tool calls, approvals) between v110 and now. Record whether I called a deploy in any turn.
2. **Repository timeline:** use `git log` with timestamps on `supabase/functions/telegram-webhook/` and `supabase/functions/_shared/mission-control-launcher.ts`. Find the commit(s) that landed just before 15:00:34 UTC and check whether the live version's timing lines up with an automatic save.
3. **Supabase evidence (read-only):**
   - Edge function logs for `telegram-webhook`: boot and shutdown times around 15:00 UTC. The latest visible boot is a fresh boot, consistent with a new version.
   - Analytics `function_edge_logs` around the same window: requests served after the switch, no message content.
   - Read-only DB queries can't see Supabase function versions or deploy actors. I'll record that as a limit.
4. **Compare the live code to the repository:** only if a read-only way to see the deployed source exists. Otherwise report it as UNPROVEN and rely on the owner's independent file listing.
5. **Classify the cause**, from evidence only:
   - Manual: a deploy tool call by me or a user approval exists.
   - Automatic platform sync: no manual call, and the version timing matches an automatic save of edge function files. The platform may deploy edge functions automatically when their source changes, so a staged commit isn't proof that nothing went live.
   - Unknown: the evidence doesn't decide it. No guessing.

## Roadmap update (`roadmap.md` only)
Replace the "not deployed / live v110" wording on the Mission Control group-launcher lines with:
- Live `telegram-webhook` is ACTIVE v112 (2026-10-03 15:00:34 UTC), running the `/missioncontrol` launcher. Observed by the owner independently; the cause is recorded as manual, automatic or unknown, according to the evidence.
- **Platform limitation:** saving changes to edge function source in this project can push them live without a separate deploy step. "Staged, not deployed" can't be promised for bot code.
- **Still unconfirmed:**
  - Mini App publication (the community-binding fix is app code, not part of the bot).
  - BotFather Mini App setup.
  - `MISSION_CONTROL_MINIAPP_LINK`. Until it's set, live `/missioncontrol` shows the safe "link not available" message.
  - Real Telegram end-to-end test.
- Bot-side behavior worth noting: admins in groups can now trigger `/missioncontrol` live. It posts only the safe message with no button while the link isn't set.

## Report back
- Live versions observed.
- Evidence for each step.
- The manual vs automatic vs unknown verdict, with PASS/UNPROVEN for each claim.
- A plain correction of my earlier false statement.
- What stays unconfirmed.

Then stop.
