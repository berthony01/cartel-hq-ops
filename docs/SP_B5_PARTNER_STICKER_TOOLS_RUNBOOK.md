# SP-B5 V1 — Service Partner Sticker Tools (Sticker Drops management)

Status: PRODUCTION ACTIVE. Migration `20260929192440 sp_b5_partner_sticker_tools` live; Edge v30 active; frontend published.

## Scope
Activates ONLY the stored partner scope `sticker_tools`. A Service Partner with an accepted, active client grant containing `sticker_tools` may, for that client project only:
- see the client's published, Telegram-ready sticker packs and published stickers (labels and emoji only — no images, file ids, set names or storage paths);
- see connected groups (safe display fields), Sticker Drop schedules, the workspace kill switch (read-only) and the last 50 drop events;
- create/edit one Sticker Drop schedule per connected group; new schedules start disabled;
- enable, disable and delete schedules.

Kept OWNER/ADMIN-only or deferred: workspace kill switch; Telegram pack publish/refresh/replace_version/release_motion/send_test (they use the caller's own Telegram identity / DM); pack create/edit, uploads and storage (no storage policy change); every paid AI action (`static_ai_generations`, `static_ai_tools`, `motion_ai_generations`, `telegram_motion_prep`, `concept_generation`); group connect/disconnect/reassign; broadcasts, watcher comms, inbox, missions, launcher/wallet/billing, Affiliate.

## Architecture
- DB (`docs/sql/SP_B5_partner_sticker_tools.sql`): `partner_list_sticker_drop_packs(uuid)`, `partner_list_sticker_drop_state(uuid)`, `partner_authorize_sticker_drop_action(uuid, text, uuid, uuid, uuid, boolean)`. SECURITY DEFINER, postgres owner, empty search_path, scope checked first, PUBLIC/anon revoked, authenticated + service_role execute. No table/RLS/storage/trigger/helper change.
- The authorize function has one extra trailing parameter `_enabled boolean DEFAULT NULL` beyond the approved list: it carries the requested enable/disable value so disabling stays ungated exactly like the owner path.
- Edge (`sticker-drop-config`, staged source only): non-member → only save_schedule / set_schedule_enabled / delete_schedule, authorized with the partner's own JWT, then falls through into the existing single implementation. Owner Gate B skipped only for partner-authorized save/enable (the RPC already evaluated client Project Identity + client `sticker_drops`, no owner bypass). Partner responses omit `loadState`. `created_by` is the real partner.
- Worker `sticker-drops` reused unchanged; it sends with `sendSticker` using stored Telegram file ids (no file fallback).

## Owner validation (unchanged, shared)
save_schedule: group + pack required; interval integer 15..720; daily cap integer 1..24; valid IANA timezone; active hours `HH:MM`; `approved_only` forced true; one schedule per group (existing row updated); new insert `enabled=false`. Ownership is enforced for every writer by the live trigger `validate_sticker_drop_schedule` (pack in workspace + published with Telegram set; group in workspace; selected stickers published Telegram stickers of that pack). No owner-path ownership gap found. No idempotency key or rate limit exists on the owner path; none added.

## Commercial
Save and enable evaluate the CLIENT workspace `sticker_drops` via the SP-B0 core. Production: `cartel_49` v1 includes it (no quota); the current free plan does not, so a partner on a free client is denied save/enable (FEATURE_NOT_INCLUDED, 403) while disable/delete stay allowed. Denials: PLAN_LIMIT_REACHED 429; FEATURE_NOT_INCLUDED / PLAN_ACCESS_INACTIVE / COMMERCIAL_ACCESS_DENIED 403; PROJECT_IDENTITY_REQUIRED 403; GROUP/PACK/SCHEDULE_NOT_FOUND 404; PACK_NOT_PUBLISHED 400; unavailable 503.

## Activation (COMPLETE)
1. CP-SPB5-SQL — DONE: migration `20260929192440` live. Three authenticated RPCs verified (SECURITY DEFINER, empty search_path, authenticated+service_role execute, anon/PUBLIC revoked). Transactional DB smoke 15/15 passed and rolled back (no event-count mutation of its own). Advisor: 0028 = 9 unchanged, 0029 129 → 132, mutable search path = 1.
2. CP-SPB5-EDGE — DONE: `sticker-drop-config` v30 ACTIVE, verify_jwt=true, SHA `6830315d10a6d37b6d8c26c916a1db92e9f58de8659c7a6a4a7c0ba28b09f3e0`; deployed v30 index is EXACT staged source. No real sticker was sent.
3. CP-SPB5-PUBLISH — DONE: publish `a7635945-3bc9-4cbc-9091-ed682e04f5a3` initiated; project reports published/ready.
4. Types sync — DONE: generated types contain `partner_list_sticker_drop_packs`, `partner_list_sticker_drop_state` and `partner_authorize_sticker_drop_action` (including `_enabled boolean`) and match the live schema; grants verified against production.

## Production smoke (one transaction, ROLLBACK, no Edge call, no real sticker)
Temporary approved partner + access with `sticker_tools`; list packs/state (safe keys only); authorize save on current client plan (expect FEATURE_NOT_INCLUDED on free); disable/delete allowed; wrong group, wrong pack, unpublished pack, wrong schedule, cross-workspace and invalid action (incl. set_kill_switch) denied; revoke then deny; ROLLBACK; verify counts unchanged (packs 2, stickers 24, schedules 1, events 745, partner_client_access 0).

## Rollback
Redeploy `sticker-drop-config` v29; DROP the three functions; revert the frontend (remove `sticker_tools` from ACTIVE_PARTNER_SCOPES).

## Pending
Real two-account test with a scheduled drop in a committed test group needs an approved active Service Partner account. Browser propagation of the published frontend is also not yet independently verified.
