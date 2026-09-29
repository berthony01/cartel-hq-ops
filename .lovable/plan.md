# SP-B5 Planning State — Closed

## Status
SP-B5 planning approval state is CLOSED. No application code, SQL, database, Edge function, or frontend changes are made in this turn.

## Locked decisions (confirmed)
1. Partners may delete client Sticker Drop schedules (delete_schedule ungated by client plan, matching owner safety behavior).
2. Sticker Drops workspace kill switch remains OWNER/ADMIN ONLY. Partner callers can never set it.
3. V1 sticker previews use labels/emoji only. No asset/image URLs in partner outputs.

## Verified staged state (read-only, this turn)
- HEAD: `ded3b01d` (plan artifact) on top of build commit `e0822118`; clean working tree.
- Edge source `backend-source/edge-functions/sticker-drop-config/index.ts`: partner fall-through restricted to exactly save_schedule / set_schedule_enabled / delete_schedule; set_kill_switch and unknown actions remain FORBIDDEN for partners; owner/admin behavior unchanged.
- SQL `docs/sql/SP_B5_partner_sticker_tools.sql`: partner authorization RPC with `_enabled` discriminator (enabling gated by client sticker_drops entitlement; disabling/deleting ungated); kill_switch surfaced read-only only.
- Panel `src/components/cartel/PartnerStickerDropsPanel.tsx`: label/emoji selection, no asset URLs.
- Production unchanged: no SQL applied, no Edge deployed, no frontend published.

## Next approved checkpoints (awaiting explicit approval, in order)
1. CP-SPB5-SQL — apply staged SQL to production with rolled-back smoke test.
2. Re-verify live sticker-drop-config Edge v29 baseline (SHA + 11,879-char match), then CP-SPB5-EDGE.
3. CP-SPB5-PUBLISH.
4. Generated-types sync.

## Allowlist for this turn
None. Read-only verification only.
