# Sticker Lab V2A — Surface + End-to-End Visibility Audit (READ-ONLY)

Gate verified: HEAD `87b833607b7d48baf74ffeca12f4ede962fcea00`, working tree clean. No edits, no commands against Kie/Telegram/database.

Classification used: **A** visible + connected end-to-end, **B** visible but partial/unclear, **C** built but effectively invisible, **D** planned/not built.

## Where the V2 surfaces actually live

Everything V2A is inside one route: `src/routes/_authenticated/sticker-lab.new.tsx` (4,325 lines), rendered as five conditional step blocks (`step === 1..5`, L1726 / L2021 / L2228 / L2754 / L3320). `sticker-lab.index.tsx` is a pack list, `sticker-lab.$packId.tsx` is a read-only pack manager that links back into the builder (`Continue editing` -> `/sticker-lab/new?pack=<id>`, L193-195; `?pack=<id>&step=5` at L182).

Consequence: **all V2 work is only reachable after clicking Create Sticker Pack or Continue editing, then stepping to the right step.** Nothing on the Sticker Lab home page names Blueprint, Concept Studio, Sticker Studio, version history or published safety. That alone explains "I do not see what the recent phases created."

## Capability-by-capability findings

### 1. Creative Blueprint / Character Lock — A (with one B caveat)
- Character Lock is authored in Brand Kit (`brand-kit.tsx` L485 panel, canonical reference picker L589, persisted via `writeCharacterLock` L220 into `brand_kits.metadata`).
- Builder Step 1 shows a Character Lock card with status badge, subject/traits/wardrobe/never-change list, a "Set up in Brand Kit" link, and the per-pack opt-in checkbox `Use Brand Kit Character Lock for this pack` (L1909-2016).
- Creative Direction (purpose, audience, tone, humor, intensity, visual direction, plus a collapsed `Text treatment & pack rules` block) is Step 2, L2112-2222.
- Generation genuinely consumes it: `backend-source/edge-functions/sticker-ai/index.ts` parses `creative_blueprint` (L104, L469), applies the lock as an identity contract (L258-293), uses canonical references as fallback (L488-500), and records `character_lock_applied` (L558).
- Caveat (B): it only takes effect **after the pack is saved** (blueprint lives on the pack row), and the Text/pack-rules half is inside a `<details>` most users will never open.

### 2. AI Concept Studio — A, but discoverable only inside Step 3
- Explicit actions exist: `Suggest unlocked concepts` and `Alternatives for selected (n)` (L2253-2278), gated by a cost/scope `AlertDialog` (L2648-2699) that states tokens-only, no images.
- Suggestions land in a non-destructive preview panel with per-item `Use this one`, `Use all suggestions`, `Suggest another set`, `Discard` (L2318-2426), plus a second confirm when the pack is already saved (L2701-2748).
- Per-concept lock/reorder/duplicate/remove/select-for-alternative controls exist (L2514-2586); `Mark concept board ready` at L2594-2630.
- Connected end-to-end via `src/lib/sticker-concepts.ts` -> Edge Function `sticker-concepts`; a free `config` probe drives the disabled state (`conceptsConfigured`).
- Persistence: applying only mutates the local draft; concepts persist to the DB on `Save pack to project` (L2632-2646). Correct but easy to misread as "AI results were lost".

### 3. Sticker Studio / batch generation — A
- Step 4 header "Sticker Studio" (L2755). Toolbar: `Select all ungenerated`, `Clear selection`, `Generate selected (n)` (L2919-2964); per-card `Select for batch` checkbox with disabled reasons in `title` (L3101-3124).
- `Generate first test sticker` targets `draft.concepts[0]` (L2887-2903); `Generate remaining (n)` (L2904-2912); `Retry failed (n)` (L2865-2873); per-card Generate/Regenerate/Retry (L3144-3160) and per-card PNG download (L3162-3173).
- Cost gates: both dialogs state 2 Kie tasks per sticker (L3181-3236).
- Concurrency: `SELECTED_BATCH_CONCURRENCY = 2` (L1509), worker-pool over a shared cursor (L1514-1561) — surfaced honestly in the dialog copy "runs up to 2 stickers at a time".
- Visibility caveat: the selection toolbar renders only when `configured && selectableIds.length > 0`, so on a fully generated pack the batch surface disappears entirely.

### 4. Version history / variations — B for history, D for variations
- Visible: a per-card collapsed `<details>` "Version history (n)" with thumbnails, version numbers, `Current` badge and `Set current` (L3031-3097). It renders **only** when `versionsBySticker[stickerId].length > 0`, and only on Step 4.
- Read path: `src/lib/sticker-versions.ts` (select from `sticker_versions`, signed thumbnails).
- **No A/B/C variation generation exists anywhere** — no "generate variations" action, no variation column, no provider call for N candidates. Repo grep for variation/variant returns only unrelated Button `variant` props. This is D: history/recovery infrastructure only.
- Gap worth flagging: **no `insert` into `sticker_versions` exists in this repo** (only reads in `sticker-versions.ts` and `telegram-stickers/index.ts` L396; no SQL migration in `supabase/migrations` creates or populates it). Row creation is happening outside the readable snapshot (external DB trigger or an unsynced function). Unverified from code alone — this needs live inspection before any Phase 5 work depends on it.

### 5. Phase 4B Set Current / Telegram replacement — C (functionally present, practically hidden)
- The only entry point is the `Set current` button inside the collapsed version-history `<details>` inside a sticker card inside Step 4. Two-stage confirmation exists: DB-only dialog (L3239-3277) then a separate `Replace the live Telegram sticker?` dialog (L3280-3315) wired to `confirmTelegramRestore`, backed by `telegram-stickers` `replace_version`.
- A user who never expands a card's version history will never learn this exists. Nothing on Step 5, `$packId`, or the pack list mentions restore/replace.

### 6. Phase 4C Published Mutation Safety — A visually, C for the server half
- Visible: card-level `Live on Telegram` disabled button plus explanatory line (L3126-3142), batch checkbox disabled with tooltip reason (L3107-3115), lock-aware toast on first-test (L2892-2897).
- Invisible by design: the `STICKER_PUBLISHED` HTTP 409 pre-billing guard in `sticker-ai`. Correct — no surface needed, but note there is no place in the UI that tells the user "your account cannot be billed for a published sticker".

### 7. Review / Quality Center — B
Present in Step 5 today: pack readiness header with Ready/In progress/Failed stats (L3326-3366), live progress bar for browser checks (L3368-3400), `Re-check transparency & cutout` and `Refresh status` (L3402-3422), a collapsed `Verification detail` block with the four counters — Backend ready, Backend transparency verified, Browser alpha verified, Telegram cutout verified (L3426-3464), per-sticker verification lines including halo cleanup wording "Outer halo will be removed on export (n px)" (L3548-3561), export gate notice (L3468-3477), per-sticker emoji/keywords (L3592-3623), ZIP/PNG export (L4090-4123), and the long halo explainer under `Advanced details` (L4125-4178).
Not present: any named "Quality Center" surface, pack-level pass/fail checks beyond counters, per-sticker manual re-check, or side-by-side compare. The richer V2 Quality Center is **D**; the underlying checks are already **A** but buried under two `<details>`.

### 8. Release / Telegram — B (coherent within Step 5, split from everything else)
One screen contains Community targets with per-group readiness and select-all/clear (L3648-3777), Publish & send card with lifecycle-aware single primary action (`lifecycleMode` publish/update/add/retry/attention, L3992-4019), `Refresh Telegram status`, `Open sticker pack`, `Send test sticker to community` (L4020-4052), per-group delivery state (L3877-3931), per-sticker Telegram status in a `<details>` (L3965-3989), set-naming preview (L3839-3853), and a `Next step — Sticker Drops` card that renders only when `allPublished || packSchedules.length > 0` (L4180+).
Split points: community connection/onboarding lives in `/telegram`, Sticker Drops scheduling in its own surface, and `$packId` duplicates a read-only view of the same state. So: one coherent publish flow, but discovery of it is spread across three routes.

### 9. Pack modes / static vs animated — D
No pack-mode concept exists. `telegram-stickers/index.ts` L84 hardcodes `sticker_format: "static"`. There is no animated/WEBM/TGS path, no UI toggle, no schema field in the readable snapshot. Nothing inferred.

### 10. Navigation / onboarding — the core defect
- Sidebar has a single `/sticker-lab` entry (`src/lib/nav.ts` L58); the dashboard links to it twice (`index.tsx` L589, L616).
- The home page "Workflow" rail renders `FLOW_STEPS` (`sticker-lab.index.tsx` L364) = **V1 labels**: Character Reference, Pack Setup, Sticker Concepts, Generate, Review & Publish (`src/lib/sticker-lab.ts` L173-179).
- The builder footer renders `BUILDER_STEPS` (L4276) = Character Reference, Pack Setup, Sticker Concepts, **Generation Preview**, Review.
- The actual step cards are titled **Concept Studio** (L2230) and **Sticker Studio** (L2756).
So three different vocabularies describe the same five steps, and the two the user sees first are both the older ones. Nothing anywhere says "Blueprint".

## Prioritized audit conclusion (no implementation proposed)

P0 — invisibility, not missing functionality:
1. Terminology drift across `FLOW_STEPS`, `BUILDER_STEPS` and the rendered card titles; the home page still teaches the V1 model.
2. Phase 4B Set Current / Telegram replacement has no discoverable entry point outside a doubly-collapsed panel.
3. Creative Blueprint is split across Brand Kit (lock) and Step 1 + Step 2 (opt-in + direction) with no single "Blueprint" surface or summary of what will be applied at generation time.

P1 — truth/verification risk:
4. `sticker_versions` write path is not evidenced anywhere in this repository; the entire version-history and Set-Current feature depends on it. Requires live inspection of the external project before further phases build on it.
5. Version history and the Quality Center counters are gated behind conditional rendering (`length > 0`, `configured && selectableIds.length > 0`), so on common pack states the V2 surfaces silently vanish.

P2 — genuine gaps, correctly reported as not built:
6. A/B/C variation generation: **not built** (D).
7. Named Quality Center with pack-level checks: **not built** (D); underlying checks exist.
8. Animated/static pack modes: **not built** (D).

No code exists without any entry point except the version-write path in item 4 (external) and the `sticker-ai` 409 guard in item 6 of section 6 (intentionally serverside).

Stop point reached. No edits made.
