# Phase 1C-8 — Mobile Containment Audit + Surgical Fix Plan

Read-only audit complete at HEAD `fdc1275` (clean tree). Presentation-only remediation proposed; no backend, Supabase, auth, KIE, Telegram logic, route paths, or business behaviour touched.

## Verification limitation (disclosed)

The cloud browser reports `LOVABLE_BROWSER_AUTH_STATUS=external_unmanaged`: Lovable cannot mint a session for the external Supabase project, so no authenticated route can be measured here. The audit below is a static structural audit. The scrollWidth === clientWidth requirement at 360/390/412/430px must be proven on a real authenticated device, or via a temporary unauthenticated measurement harness (see "Optional verification harness"), which is out of scope unless you authorize it.

## Root causes identified

### RC-1 — Grid children default to `min-width: auto` (primary cause of defects 1, 2, 3, 5)

Every page-level grid uses bare `grid gap-… lg:grid-cols-N` with no `min-w-0` on children. A CSS grid item's automatic minimum size is its min-content width, so a single wide row inside one card widens the whole track past the viewport. The document then scrolls horizontally and *every* sibling card looks clipped at the right edge — which is exactly the reported pattern where the Module Status paragraph and the HQ badges appear cut rather than wrapped.

Confirmed containers missing child min-width containment:
- `src/routes/_authenticated/index.tsx:155, 176, 197, 297`
- `src/routes/_authenticated/sticker-lab.index.tsx:111`
- `src/components/cartel/PlaceholderPage.tsx:40`
- `src/routes/_authenticated/brand-kit.tsx:216, 251, 286, 334, 393`
- `src/routes/_authenticated/assets.tsx:122`
- `src/routes/_authenticated/sticker-lab.new.tsx:1313, 1493, 1620, 2185, 2295, 2395`

The widest min-content offender feeding RC-1 is the InlineRow trailing cluster (below).

### RC-2 — `InlineRow` trailing cluster is unbounded and non-shrinkable (defects 1, 2)

`src/components/cartel/InlineRow.tsx:45-50`: both the `meta` and `trailing` slots are `shrink-0` with no width cap and no wrapping. On HQ recent packs the trailing slot is StatusBadge + chevron; on the Sticker Lab index it is StatusBadge + a "Resume" button. That cluster sets the row's min-content width, which propagates up through RC-1. The row itself also carries `touch-target`, which applies `min-width: 44px` in addition to min-height — harmless but semantically wrong for a full-width row.

### RC-3 — `StatusBadge` cannot truncate its own text (defects 1, 3, 7)

`src/components/cartel/StatusBadge.tsx:28` truncates only nested `<span>` children (`[&>span]:truncate`). Every real callsite passes a raw string, so the badge width is always the full label plus `tracking-[0.14em]`, and it can never give ground.

### RC-4 — Bottom nav label overflow (defect 8)

`src/lib/nav.ts:80-85`: the Telegram tab has no `mobileLabel`. Five tabs across 390px leave ~70px per tab; "TELEGRAM" at 10px uppercase with `tracking-[0.12em]` exceeds that, so `truncate` in `MobileTabBar.tsx:33-35` produces the accidental "TELEGRA…".

### RC-5 — Over-truncated section headings (defects 6, 7)

Single-line `truncate` is applied to headings that have vertical room to wrap:
- `src/components/cartel/Section.tsx:59` (`h2` truncate — every Section title app-wide)
- `src/components/cartel/TelegramGroupCard.tsx:669` ("Connected Telegram groups")
- `src/components/cartel/PageHeader.tsx` title is already wrap-safe.

### RC-6 — Workflow rail reads as accidental clipping (defect 4)

`sticker-lab.index.tsx:93-108` renders six `min-w-[8.5rem]` tiles in a `ScrollRail`. Scrolling is intentional, but there is no edge fade, no partial-peek sizing guarantee, and no affordance, so the third tile looks broken. `ScrollRail`'s `-mx-4 px-4` correctly matches `--gutter-mobile: 1rem`, so it is not itself an overflow source; the `sm:mx-0` breakpoint vs. the gutter's `md` breakpoint is a cosmetic inset mismatch between 640–767px only.

### RC-7 — Top bar (defect 9)

`AppShell.tsx:12-46` is structurally sound: the search block is `lg:` only, all trailing controls are `shrink-0`, and the workspace switcher sits in a `min-w-0 flex-1` container. The remaining risk is inside `WorkspaceSwitcher`; it needs a truncation check on long workspace names.

## Fix plan (shared-first, smallest safe change)

Ordered so shared primitives absorb most defects before any page edits.

1. **`StatusBadge.tsx`** — truncate own text content and cap width: apply `truncate`/`min-w-0` to the badge itself instead of only nested spans; keep tones, sizes and tone API identical.
2. **`InlineRow.tsx`** — let the trailing cluster survive narrow screens: keep `shrink-0` but add `max-w-[55%]` + `min-w-0` behaviour on mobile with `flex-wrap`, and replace root `touch-target` with `min-h-11` so no phantom min-width is introduced. Props and callsites unchanged.
3. **`Section.tsx`** — heading wraps instead of ellipsing (`truncate` → wrap with `break-words`); add `min-w-0` to grid/flex children of the header row and keep the existing `grid-cols-[minmax(0,1fr)_auto]` mobile structure.
4. **`nav.ts`** — add `mobileLabel: "Telegram"`-safe short label (`"TG"` or `"Chat"`, your call; plan assumes `"TG"`) for the Telegram tab. Presentation metadata only; desktop label unchanged.
5. **`ScrollRail.tsx`** — add an intentional-scroll treatment: right-edge mask/fade on mobile and `pr-6` peek so the next tile is obviously partially visible. Behaviour and desktop grid fallback unchanged.
6. **Page-level `min-w-0` pass** — add `min-w-0` (or `[&>*]:min-w-0` on the container) to the grid children listed under RC-1 in `index.tsx`, `sticker-lab.index.tsx`, `sticker-lab.new.tsx`, `brand-kit.tsx`, `assets.tsx`, `PlaceholderPage.tsx`. Pure class additions, no structural change.
7. **`TelegramGroupCard.tsx`** — un-truncate the card title (RC-5), and confirm badge/button/disclosure clusters wrap (`flex-wrap`) inside the card at 390px. No change to any handler, action name, payload, polling, launcher URL, or capability logic.
8. **`WorkspaceSwitcher.tsx`** — verify and, if needed, add `min-w-0` + `truncate` to the workspace name only.

Desktop and tablet output is unchanged: every edit is either a min-width containment class (no visual effect when space is ample), a mobile-only utility, or a heading that already fits on one line at desktop widths.

## Optional verification harness (needs your authorization)

To satisfy the hard scrollWidth requirement inside this environment, a temporary dev-only route could render each page's presentational shell with static fixture props (no Supabase calls) so a Playwright script can assert `documentElement.scrollWidth === clientWidth` at 360/390/412/430px and flag any child whose right edge exceeds its parent by >1px. This adds a file outside the current allowlist and would be removed after the run. Not included in the plan above; say the word and I will fold it in as a separate step.

## Files this plan would touch

`src/components/cartel/StatusBadge.tsx`, `InlineRow.tsx`, `Section.tsx`, `ScrollRail.tsx`, `TelegramGroupCard.tsx`, `WorkspaceSwitcher.tsx`, `src/lib/nav.ts`, `src/routes/_authenticated/index.tsx`, `sticker-lab.index.tsx`, `sticker-lab.new.tsx`, `brand-kit.tsx`, `assets.tsx`, `src/components/cartel/PlaceholderPage.tsx`.

No changes to `src/lib/telegram-*`, Supabase clients, Edge Functions, route paths, query keys, or any `.invoke` payload. Nothing published.
