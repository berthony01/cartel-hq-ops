# Phase 6.5A — Whole-Application Product Architecture + UX/UI Audit

## 1. Executive diagnosis

CARTEL HQ has more working product than it appears to have. Three real workflows are complete and live (Project Identity, Launch Control lifecycle + notification engine, Sticker Lab → Telegram publishing/drops), plus a genuinely separate public Cartel Network micro-site. The problem is not missing features — it is that the product presents **inventory instead of state**.

Four structural defects account for nearly all of the observed noise:

1. **Roadmap outnumbers product in the navigation.** 21 nav destinations; 8 are placeholder pages with zero functionality, 2 more (`/watchlist`, `/signals`) have no route file at all and would 404. That is 10 of 21 primary destinations (48%) leading nowhere useful, presented in the same visual weight as live tools.
2. **Capability catalogs are duplicated instead of owned.** `telegram.tsx` renders the *same* 7-card capability grid twice (`Command overview` at :95-171 and `Community Command modules` at :179-281), sandwiching the only functional widget between two brochures. HQ re-renders the entire sidebar as a "Modules" grid (`index.tsx:306-331`). Sticker Lab's "Module status" restates the same cross-links a third time.
3. **Completed onboarding never gets out of the way.** `LaunchReadinessCallout/Panel` renders full-size on HQ, Project Profile and Launch Control, and at 7/7 it keeps the same `Section` shell, progress bar, next-step block and 7-step grid — only the label changes to "Launch foundation ready" (`LaunchReadiness.tsx:233,247-251,282`). For the current live PEPECARTEL workspace (7/7), three of the four most-used pages open with a large "you're done" panel.
4. **Diagnostics are rendered at primary-action weight.** Launch Control's right column stacks six `Section`s including raw notification counters (Events/In queue/Sent/Failed/Ambiguous/Skipped, `:1120-1141`), an "Ambiguous" jargon explainer (`:1143-1147`), and nine lifecycle timestamps (`:1164-1189`). Distribution's Activity log uses `variant="primary"` — the same chrome as the kill switch.

Compounding all four: the design system offers effectively **two card weights** (`Section` `surface` and `primary`, both bordered dark cards, `Section.tsx:6-10`), so nothing can be visually de-emphasized. Everything looks equally important because structurally it is.

Verdict: **not publication-ready**, but the gap is presentation, not engineering. No backend change is required for any recommendation in this report.

## 2. Checkpoint + no-edit confirmation

- Project: Cartel Command Center / CARTEL HQ (`469fb83c-0f27-4aa7-bb99-c4125279c565`)
- Verified HEAD: `56b6ca8f5c662f92149401c60dd31db6f2dad6e2`, working tree clean (`git status --porcelain` empty).
- Backend system of record: external Supabase `ocoinbnjgstkmnwwvnhi`. Not queried, not modified in this run.
- **NO EDITS MADE.** Zero files created, modified, deleted, renamed or formatted, other than this audit document. No dependency, migration, RLS, function, cron, secret, integration, deployment or publish action. CARTEL HQ remains unpublished.

## 3. Whole-app route inventory

| Route / surface | Status | Primary job | Current issues | Overlaps | Recommendation |
|---|---|---|---|---|---|
| `/auth`, `/auth/callback` | Live, public | Sign in / sign up | Fine; minimal | — | Keep |
| `/` HQ (`_authenticated/index.tsx`) | Live | Command-center summary | Repeats sidebar as "Modules" (:306-331); readiness panel dominates at 7/7; metrics are counts without meaning | Sidebar, readiness | Consolidate + progressive disclosure |
| `/project-profile` | Live | Project identity record | Readiness callout on top of a clear single-purpose form | Readiness | Keep; demote callout at 7/7 |
| `/launch-control` (1276 lines) | Live | Launch lifecycle operations | 6 stacked right-column Sections; raw counters/timestamps always visible; 1.6fr left col shorter than 1fr right col (`:497`) → dead space | Readiness | Progressive disclosure (largest single win) |
| `/sticker-lab` index | Live | Pack launchpad | "Module status" panel restates cross-page narrative | telegram.tsx, distribution.tsx | Consolidate |
| `/sticker-lab/new` (3229 lines) | Live | Pack builder | Step 5 alone is ~750 lines of JSX with 4 competing mechanisms (publish, test-send, drops, group management) | distribution.tsx, telegram.tsx | Consolidate + progressive disclosure |
| `/sticker-lab/$packId` | Live | Pack summary | Action row offers 3 destinations for "do Telegram things", 2 of which are the same Step 5 | Step 5, distribution | Consolidate |
| `/brand-kit` | Live | Brand system | Asset gallery duplicates Asset Vault pattern/types | assets.tsx | Keep (note overlap) |
| `/assets` | Live | Private asset library | No pagination; grows unbounded | brand-kit | Keep |
| `/telegram` Community Command | Live | Community health + welcome | **Two identical capability grids** (:95-171, :179-281) surrounding the one functional widget | itself, distribution, Step 5 | Consolidate (remove one grid) |
| `/distribution` Distribution Center | Live | Sticker Drop automation console | Name overpromises; Activity log at primary weight; unbounded lists | Step 5 drops card | Rename + de-emphasize activity |
| `/clearance` | Placeholder | — | 100% roadmap copy | — | Hide until live |
| `/command-terminal` | Placeholder | — | 100% roadmap copy | — | Hide until live |
| `/operations` | Placeholder | — | 100% roadmap copy | — | Hide until live |
| `/missions` | Placeholder | — | 100% roadmap copy | — | Hide until live |
| `/operatives` | Placeholder | — | 100% roadmap copy | — | Hide until live |
| `/cartel-shield` | Placeholder | — | 100% roadmap copy | — | Hide until live |
| `/reputation` | Placeholder | — | 100% roadmap copy | — | Hide until live |
| `/analytics` | Placeholder | — | 100% roadmap copy | — | Hide until live |
| `/watchlist` | **Nav entry, no route** | — | Would hit 404 (`__root.tsx:18-38`) | — | Remove from nav (P0) |
| `/signals` | **Nav entry, no route** | — | Would hit 404 | — | Remove from nav (P0) |
| `/settings` | Placeholder-ish | — | Renders `PlaceholderPage` with status "Placeholder" | — | Keep in nav, needs real content |
| `/admin` Owner Console | Live, owner-only | Platform metrics/moderation | Fine; correctly gated | — | Keep |
| `/network` shell + index | Live, public | Network overview | — | — | Keep |
| `/network/projects`, `/network/launches` | Live, public | Directories w/ pagination | — | — | Keep |
| `/network/project/$slug`, `/network/launch/$slug` | Live, public | Detail pages w/ SEO head | — | — | Keep |

## 4. Navigation inventory + proposed model

**Counts (from `src/lib/nav.ts:53-121`):** 6 sections, 21 items.
- Live authenticated: 9 (`/`, `/project-profile`, `/launch-control`, `/sticker-lab`, `/brand-kit`, `/assets`, `/telegram`, `/distribution`, `/settings`*)
- Owner-only: 1 (`/admin`)
- Public network: 2 (`/network/projects`, `/network/launches`)
- Placeholder routes: 8
- Broken links (no route): 2
- Mobile primary: 4 (HQ, Sticker Lab, Assets, Community Command)

*`/settings` currently renders `PlaceholderPage`, so functionally it is a 9th placeholder.

**Observation:** a first-time owner sees "Operations / Missions / Operatives / Cartel Shield / Reputation / Analytics / Cartel Clearance / Command Terminal" — eight authoritative-sounding destinations — before finding that the product is Project Profile, Launch Control, Sticker Lab and Community Command.

**Proposed navigation (today's product, 4 sections, 10 items):**

```text
LAUNCH        HQ                    /
              Project Profile       /project-profile
              Launch Control        /launch-control

CREATE        Sticker Lab           /sticker-lab
              Brand Kit             /brand-kit
              Assets                /assets

COMMUNITY     Community Command     /telegram
              Sticker Drops         /distribution   (renamed)

NETWORK       Cartel Network        /network        (single entry → public site)

—             Settings              /settings
              Owner Console         /admin          (owner-only)
```

Handling of the removed 8 placeholders: keep the routes (URLs stay valid, no 404s), remove them from primary nav, and surface the roadmap once — in a single "What's coming" panel inside Settings or a `/roadmap` surface — rather than eight nav slots and eight pages. `/watchlist` and `/signals` nav entries should be deleted outright until routes exist. Mobile tab bar recomputes automatically from `MOBILE_PRIMARY_ITEMS`; recommend HQ / Launch Control / Sticker Lab / Community + More.

## 5. Capability ownership matrix

| Capability | Recommended single owner | Valid secondary entry points | Current problem |
|---|---|---|---|
| Project identity/profile | `/project-profile` | HQ readiness next-step | None |
| Brand identity | `/brand-kit` | Sticker Lab step 1 prefill | Asset gallery overlaps `/assets` |
| Asset library | `/assets` | Brand Kit (brand-typed subset), Sticker Lab reference picker | Three UIs over one asset model |
| Sticker creation | `/sticker-lab/new` | `/sticker-lab/$packId` → Edit | None |
| Telegram pack publishing | Sticker Lab Step 5 | Pack manager button | Two buttons to the same Step 5 (`$packId.tsx:133-144`) |
| One-time community send | Sticker Lab Step 5 ("Send test sticker") | — | Terminology collision with "distribute" |
| Recurring Sticker Drops | `/distribution` | Step 5 drops card (locked to pack) | Two full surfaces editing one `drop_schedules` model |
| Telegram connection/health | `/telegram` (`TelegramGroupCard`) | read-only summary elsewhere | Same 1191-line card mounted on `/telegram` **and** Step 5 |
| Welcome/onboarding + Launch Watch CTA | `/telegram` → group → Community controls → dialog | Launch Control guidance link | Deep click path (3 levels to a modal) |
| Launch creation/lifecycle | `/launch-control` | HQ next-step | None |
| Launch scheduling | `/launch-control` | — | None |
| Launch Watch | `/launch-control` | Welcome dialog CTA, public launch page | None |
| Launch notifications | `/launch-control` (advanced) | — | Raw counters at primary weight |
| Public discovery | `/network/*` | Profile preview panel, Launch preview panel | None |
| System/technical logs | `/distribution` Activity (drops), Step 5 Generation history | — | Activity at primary weight; history correctly collapsed |
| Owner/admin | `/admin` | — | None |

## 6. Duplication matrix

| # | Duplication | Evidence | Classification |
|---|---|---|---|
| 1 | Two identical capability grids on one page | `telegram.tsx:95-171` "Command overview" vs `:179-281` "Community Command modules" — same 4 live + same 3 "Planned" cards, near-identical copy | **Harmful** — reads as unfinished; buries `TelegramGroupCard` at `:173` |
| 2 | HQ "Modules" grid = sidebar | `index.tsx:306-331` iterates `NAV_SECTIONS` | **Confusing** — HQ becomes an app directory |
| 3 | Readiness UI on 3 pages, persistent at 7/7 | `index.tsx:131`, `project-profile.tsx:285`, `launch-control.tsx:454`; no collapse path in `LaunchReadiness.tsx` | **Harmful once complete**, useful before |
| 4 | Sticker Drops editable from two surfaces | `distribution.tsx:347-355` and `sticker-lab.new.tsx:2767-2889`, same `StickerDropScheduleDialog` | **Useful reinforcement** (shared dialog, differing scope) — keep, clarify labels |
| 5 | `TelegramGroupCard` (1191 lines) mounted twice | `telegram.tsx:173`, `sticker-lab.new.tsx:2464-2470` | **Confusing** — group management inside a pack wizard |
| 6 | Three Telegram/distribution destinations from pack manager | `$packId.tsx:133-138` and `:139-144` (+ Edit at `:119`) | **Confusing** |
| 7 | Cross-page "where things live" narrative repeated | `telegram.tsx:53`, `sticker-lab.index.tsx:53`, `distribution.tsx:168-173` | **Harmless but symptomatic** — the app explains its own IA three times because the IA is unclear |
| 8 | Planned-capability cards repeated | 3 "Planned" cards duplicated within `telegram.tsx`; 8 placeholder pages; HQ modules grid | **Harmful** to value perception |
| 9 | Asset upload/gallery pattern | `brand-kit.tsx:387-437` vs `assets.tsx:121-236`, overlapping `logo`/`mascot`/`reference_image` types | **Harmless** |
| 10 | Responsive dual CTAs | `sticker-lab.index.tsx:67-74/86`, `brand-kit.tsx:368/439` | **Harmless** (intentional) |

## 7. Terminology dictionary and collisions

| User-facing term | Current meanings | Collision | Canonical recommendation |
|---|---|---|---|
| **Publish** | (a) pack → Telegram sticker set (`sticker-lab.new.tsx:1097`), (b) profile discovery_status (`project-profile.tsx`), (c) platform message template (`PlatformMessageEditor.tsx:211-249`), (d) app deployment | **4 meanings** — worst collision in the app | (a) "Publish to Telegram", (b) "List on Cartel Network", (c) "Activate template". Never bare "Publish". |
| **Distribute / Distribution** | (a) `/distribution` = recurring drops only, (b) "Publish & distribute pack" = one-time push, (c) "Sticker distribution" module card | 3 meanings | Retire the word for one-time sends. Reserve "Distribution" for nothing; rename the page. |
| **Distribution Center** | Actually Sticker Drop automation + kill switch + activity | Name overpromises | Rename **"Sticker Drops"** (evidence: every control on the page is drop-scoped, `distribution.tsx:198-422`) |
| **Send** | "Send test sticker to community"; planned "Broadcast text updates" | Mild | "Send test sticker" (keep "test" — it is a single sticker, not the pack) |
| **Sticker Drop** | Recurring scheduled auto-post | Clean | Keep as the canonical automation noun |
| **Automation** | Used loosely for drops | Redundant with Drop | Prefer "Sticker Drops"; avoid generic "automation" |
| **Save** | Form persist (Profile, Brand Kit, Launch details, emoji/keywords) | Consistent | Keep |
| **Launch / Announce / Live** | Lifecycle states; "Live" also = Cartel Network visibility, also = "Live beta" module badge (`index.tsx:55`) | 3 meanings of "Live" | Reserve "Live" for the launch lifecycle state only. Modules use "Available"/"Coming". Network uses "Listed". |
| **Community Command** | `/telegram` page name | Clean | Keep |
| **Launch Distribution** | Planned card in `telegram.tsx:147` | Inherits both collisions | Rename planned item "Launch announcements to communities" |
| **Launch Watch** | Opt-in alert subscription | Clean, well-defined | Keep — best-named concept in the product |
| **Cartel Network** | Public directory | Clean | Keep; never imply "published = public page" until it is |

## 8. First-time owner flow map

| Step | Current guidance | Friction | Who should own the next-step prompt |
|---|---|---|---|
| Sign in | `/auth` → HQ | None | — |
| Workspace exists? | Header switcher; HQ shows "Setup required" badge | Workspace creation is a header dropdown, not part of readiness | Should become readiness step 0 |
| 1. Create Project Profile | Readiness next-step button | Good | HQ |
| 2. List on Network (publish) | Readiness | Copy correctly says no public page yet (`project-profile.tsx:395-400`) | Project Profile |
| 3. Create launch | Readiness → `/launch-control` | Launch Control opens with list + readiness + 6 right-column cards before the user has a launch | Launch Control |
| 4. Announce | Lifecycle stepper + "Advance to…" | Good, but buried under readiness callout | Launch Control |
| 5. Open Launch Watch | Same | Good | Launch Control |
| 6. Connect Telegram | Readiness → `/telegram` | User lands on a page whose first two screens are capability brochures; the connect widget is third | Community Command |
| 7. Welcome + Launch Watch CTA | Readiness | **Deepest friction**: group card → "Community controls" disclosure → modal → CTA section. 3 levels. | Community Command |
| 8. Create stickers | No readiness step; discovered via Quick Actions | Sticker Lab is disconnected from the guided flow entirely | HQ Quick Actions (acceptable) |
| 9. Publish pack | Step 5 | 4 competing controls in one step | Sticker Lab Step 5 |
| 10. Set up recurring Drops | Step 5 card **or** `/distribution` | Two doors, unclear which is canonical | `/distribution` for workspace-wide; Step 5 for this-pack |
| 11. See public listing | Preview panels + `/network` | No "view your live listing" link from HQ once published | HQ |

**Proposed mental model** (three sentences a non-technical owner can hold):
1. **Set up your project** — who you are (Profile) and what you're launching (Launch Control).
2. **Build your community** — connect Telegram, greet new members, let them opt into launch alerts.
3. **Make content** — Sticker Lab creates packs; Sticker Drops posts them on a schedule.

Progressive onboarding without a wizard: keep the 7-step readiness model as the engine, but change its *presentation* by state — full panel while incomplete, single collapsed line ("Launch foundation ready · 7/7 · Review") once complete, and callout-only (not panel) on non-HQ pages. Add Sticker Lab/Drops as an optional "Next: grow your community" track shown only after 7/7.

## 9. HQ redesign direction

**Current identity:** an overloaded mix — onboarding checklist (readiness panel), app directory (Modules grid = sidebar), light analytics (4 count tiles), and launchpad (Quick Actions). It is not a command center: it never tells you the state of your launch.

**HQ should answer, above the fold:** What is my launch doing right now? Is anything broken or waiting on me? What happened recently?

Direction:
- **Hero: launch status**, not readiness. Current lifecycle state, countdown to launch time, watcher count, next automatic notification. Today this lives only in Launch Control's right column.
- **Attention items**: failed drops, group lost bot-admin, contract pending, schedule missing. Nothing surfaces these today.
- **Readiness**: full panel while incomplete; collapses to one line at 7/7.
- **Recent activity**: unified — packs published, drops sent, watchers joined.
- **Remove from HQ**: the Modules grid (`:306-331`) — it duplicates the sidebar and is the single largest roadmap surface in the app. Metrics tiles should gain meaning ("3 communities · all healthy") or go.
- **Keep**: Quick Actions (genuinely useful), workspace summary (compress to one line in the header area).

## 10. Launch Control redesign direction

**Observed layout defect:** `grid xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]` (`:497`) gives the *wider* column the *shorter* content (3 compact forms + delete) and the *narrower* column six stacked Sections — Lifecycle (`:847`), Contract (`:938`), Launch Watch (`:1000`), Notification engine (`:1097`), Timestamps (`:1164`), Preview (`:1191`). Result: a tall narrow ribbon on the right and a large empty area on the left below the forms. Exactly the screenshot symptom.

**Proposed hierarchy (no lifecycle behavior change):**
1. **Status header** (full width): current state, next action button, launch time / countdown, watcher count, blocking guard message (`:422`, `:424`).
2. **Tabs or sections**: *Details* (identity + schedule + notes) · *Watch* (link, copy, open, status) · *Contract* · *Advanced*.
3. **Advanced** (collapsed by default): notification counters (`:1120-1141`), the "Ambiguous" explainer (`:1143-1147`), the nine lifecycle timestamps (`:1164-1189`), raw token.
4. Rebalance to equal columns or a full-width stack per tab so no column carries 6× the other's height.
5. Move the readiness callout below the status header, or hide at 7/7.

## 11. Community / Sticker Lab / Sticker Drops responsibility model

```text
Community Command (/telegram)
  OWNS: connect group, bot/admin health, welcome & onboarding, Launch Watch CTA
  SHOWS: read-only summary of drops ("3 active · next in 2h" → link)
  DROPS: one of the two duplicate capability grids

Sticker Lab (/sticker-lab)
  OWNS: create pack, review, publish to Telegram, send test sticker,
        set drops FOR THIS PACK (locked scope, clearly labelled)
  DROPS: full TelegramGroupCard mount (replace with a compact readiness
         strip + "Manage communities" link)

Sticker Drops (/distribution, renamed)
  OWNS: all schedules across packs and groups, emergency pause,
        delivery history
  CHANGES: Activity moves to variant="plain" / collapsed by default,
           summarised as "24 sent today · 0 failed"; FAILURES stay
           prominent and uncollapsed at the top
```

Name evidence for the rename: every control on `/distribution` is drop-scoped (`:198-422`); the page itself disclaims broader distribution in its own header (`:168-173`). "Automation Center" is weaker — "Sticker Drops" is already the term users see in three other places.

Event logging itself is not changed by any of this — only its default visual prominence.

## 12. Global visual / design-system findings

Factual:
- Container width is consistent: `max-w-6xl` in both `AppShell.tsx:85` and `NetworkShell.tsx:42,94,99`. **No inconsistency.**
- Palette is well-defined oklch tokens (`styles.css:71-116`); surface levels: `--surface`, `--surface-raised`, `--card` (alias). Gradients `--gradient-gold`, `--gradient-hq`; shadows `--shadow-cartel`, `--glow-gold` — `--gradient-hq` and the glow appear under-used.
- Two font families (`Bebas Neue`/`Oswald` display, `Sora` body, `:64-65`) but **no tokenized type scale** — sizes are ad-hoc Tailwind (`text-[10px]`, `text-[11px]`, `text-xs`, `text-sm`, `text-2xl/3xl/4xl`).
- `Section` has exactly 3 variants (`Section.tsx:6-10`), two of which read as the same dark bordered card. `PageHeader` has no variants.
- Public network pages bypass `Section`/`PageHeader` and hand-roll `rounded-lg border border-border bg-surface` cards (`network.index.tsx:40-46`, `NetworkPieces.tsx:166`) — a parallel card idiom.
- Unbounded lists without pagination: `/assets` library, `/distribution` communities, Sticker Lab recent packs.
- Utilities exist and are used: `hover-lift`, `rise-in`, `touch-target` (44px), `safe-bottom`, `app-scroll-pad`.

Recommendations:
- Add a **third, lighter surface tier** (`variant="quiet"`: no border, no background, small caps heading) for diagnostics, history, timestamps and roadmap. This one addition makes de-emphasis possible everywhere and is a prerequisite for most other fixes.
- Add a **hero tier** for exactly one element per page (HQ launch status, Launch Control status header) using `--gradient-hq` + `--glow-gold` — currently no element outranks a card.
- Tokenize the type scale (display/h1/h2/body/meta) to stop `text-[10px]`/`text-[11px]` drift.
- Status colour semantics are sound (gold = attention/setup, green = healthy/complete, red = failure); enforce that gold is never used for merely-decorative emphasis, or "needs attention" loses meaning.
- Premium moments worth adding, low-gimmick: an HQ launch countdown as a genuine typographic hero; the lifecycle stepper as a full-width progress rail rather than a boxed card; the network profile preview treated as a real card artefact. No new animation beyond existing `rise-in`.

## 13. Publication gate backlog

**P0 — blocks publication**
1. Remove `/watchlist` and `/signals` from nav — they 404. *Broken links destroy trust instantly.* (`nav.ts:110-111`)
2. Remove the duplicate capability grid in `telegram.tsx` (`:95-171` or `:179-281`). *Reads as a build error; hides the real widget.*
3. Hide the 8 placeholder destinations from primary nav. *48% of navigation leading to roadmap copy makes a real product look like a mockup.*
4. Collapse the readiness panel at 7/7 across all three surfaces. *A permanent "setup" banner on a fully set-up account signals the app doesn't know its own state.*
5. Remove the HQ "Modules" grid (`index.tsx:306-331`). *Largest roadmap surface; duplicates the sidebar.*
6. Give `/settings` real content or remove it from nav. *A "Settings" placeholder is uniquely damaging — users expect it to work.*

**P1 — high-value polish for 6.5**
7. Launch Control progressive disclosure + column rebalance. *Fixes the dead-space screenshot and the diagnostics-as-primary problem on the app's most valuable page.*
8. Rename Distribution Center → Sticker Drops; demote Activity, promote failures. *Name honesty + correct signal/noise.*
9. HQ launch-status hero + attention items. *Turns a directory into a command center.*
10. Add the `quiet` Section tier and a hero tier. *Enables 7–9; without it nothing can be de-emphasized.*
11. Terminology pass on "Publish" (4 meanings) and "Distribute". *Direct comprehension cost for non-technical owners.*
12. Replace the full `TelegramGroupCard` in Step 5 with a compact readiness strip. *Removes ~1200 lines of duplicated UI from a wizard step.*
13. Shorten the pack-manager action row from 3 Telegram destinations to 1 + 1.

**P2 — later**
14. Consolidate Brand Kit assets and Asset Vault into one library with type filters.
15. Pagination for `/assets`, `/distribution` lists.
16. Tokenized type scale.
17. Single roadmap surface replacing 8 placeholder pages.
18. Deepen the welcome/Launch-Watch CTA path (currently 3 levels to a modal).
19. Add a post-7/7 "grow your community" optional track.

## 14. Proposed Phase 6.5 implementation sequence (do NOT implement)

**6.5B — Navigation truth pass.** Objective: nav reflects the product that exists. Surfaces: `src/lib/nav.ts`, possibly `SidebarNav.tsx`/`MobileTabBar.tsx` if a "hidden" flag is added. Invariants: all existing routes remain reachable by URL; `ownerOnly` gating unchanged; mobile tab bar still derives from one source. Non-goals: deleting routes, changing `PlaceholderPage`, renaming pages.

**6.5C — Duplication removal.** Objective: delete the second `telegram.tsx` capability grid and the HQ Modules grid. Surfaces: `telegram.tsx`, `_authenticated/index.tsx`. Invariants: `TelegramGroupCard` mount and props unchanged; readiness callout unchanged; no data-fetch changes. Non-goals: restructuring HQ, renaming anything.

**6.5D — Readiness completion behavior.** Objective: at 7/7, `Panel` renders one compact line; `Callout` hides or renders one line on Profile/Launch Control. Surfaces: `LaunchReadiness.tsx` only (plus prop pass-through at 3 call sites). Invariants: `launch-readiness.ts` derivation untouched; no persisted dismissal; incomplete states render exactly as today; retry state preserved. Non-goals: changing the 7-step model.

**6.5E — Design-system tiers.** Objective: add `Section variant="quiet"` and a hero treatment; token the type scale. Surfaces: `Section.tsx`, `styles.css`, optionally `PageHeader.tsx`. Invariants: existing `surface`/`primary`/`plain` render byte-identically; no page adopts the new tiers in this batch. Non-goals: applying them (that is 6.5F/G).

**6.5F — Launch Control restructure.** Objective: status header, tabbed/sectioned hierarchy, Advanced disclosure, column rebalance. Surfaces: `launch-control.tsx` only. Invariants: **every lifecycle guard, RPC call, mutation and invalidation preserved exactly**; no copy change to trust/contract statements; read-only banner behavior preserved. Non-goals: any change to `launch-control.ts`, lifecycle rules, or notification engine.

**6.5G — HQ command-center rebuild.** Objective: launch-status hero, attention items, recent activity. Surfaces: `_authenticated/index.tsx`, possibly a new read-only HQ summary lib. Invariants: authenticated-client reads under existing RLS only; no new tables/RPCs; no subscriber identities. Non-goals: new backend, analytics.

**6.5H — Sticker Drops rename + activity demotion.** Objective: rename Distribution Center, demote Activity, promote failures. Surfaces: `distribution.tsx`, `nav.ts`, inbound copy references in `telegram.tsx`/`sticker-lab.*`. Invariants: URL `/distribution` unchanged (no route rename); kill switch and schedule dialog behavior unchanged; event logging unchanged. Non-goals: changing what is logged.

**6.5I — Terminology pass.** Objective: canonical verbs from §7. Surfaces: copy strings only, across audited pages. Invariants: no logic, no state, no backend payload strings changed. Non-goals: renaming DB values or internal enums.

**6.5J — Step 5 slimming.** Objective: compact readiness strip instead of full `TelegramGroupCard`; clarify pack-scoped vs workspace-scoped drops. Surfaces: `sticker-lab.new.tsx` step 5, `$packId.tsx` action row. Invariants: publish/test-send/drops mutations identical; `StickerDropScheduleDialog` props unchanged. Non-goals: restructuring steps 1–4.

## 15. Inspected

Routes: all 8 network/auth public routes; all 21 `_authenticated` route files; `routeTree.gen.ts`; `__root.tsx`.
Components: all 20 in `src/components/cartel/`; both in `src/components/cartel-network/`.
Libs: `nav.ts`, `launch-readiness.ts`, `launch-control.ts`, `project-profile.ts`, `cartel-network.ts`, `telegram-group.ts`, `sticker-drops.ts`, `telegram-stickers.ts`, `sticker-packs.ts`, `sticker-lab.ts`.
Styles: `src/styles.css`.
Git: HEAD + tree state only (read-only).

## 16. Residual uncertainties (need browser/device, not code)

1. Actual rendered height ratio of Launch Control's two columns at 1280/1440px with live PEPECARTEL data — the dead-space magnitude is inferred from Section counts.
2. Whether the two `telegram.tsx` grids are visually obviously duplicated or merely repetitive at real viewport heights.
3. Mobile (390px) behavior of Sticker Lab Step 5's ~750-line stack — scroll fatigue and sticky-bar collisions.
4. Perceived weight of gold vs green badges on real screens (contrast/emphasis balance).
5. Whether `/watchlist` and `/signals` 404 or silently redirect in the running preview.
6. Whether `PlatformMessageEditor` is reachable from `/admin` in the UI (import path not traced repo-wide).
7. Unbounded-list performance on `/assets` with a large real library.

## 17. Stop point

Audit complete at `56b6ca8f5c662f92149401c60dd31db6f2dad6e2`. No code, database, integration, deployment or publish changes were made. Awaiting approval before any 6.5B work begins.
