# C3 Read-Only Diagnostic Audit — no changes made

State inspected: HEAD `a1a58328f9cec905986c891ec68e44338e904a88` ("Fixed static replace version", on top of `81c3609`), working tree clean. No files edited, nothing deployed, no DB/Telegram/provider calls.

## A) Preview crash on `/sticker-lab/new`

Facts established:

- SSR for the route returns HTTP 200 (`curl http://localhost:8080/sticker-lab/new`), so this is not a server/module-init failure.
- `/tmp/observability/` contains no `runtime-errors.log`, `console-logs.log`, or `build-errors.log` for this turn — no preview telemetry was captured with the request, so the exact exception text and stack are **not available to me**.
- Dev-server log shows only normal HMR/SSR reloads (last entries 05:45–05:50), no exception.
- `LOVABLE_BROWSER_AUTH_STATUS=external_unmanaged` — this project uses external Supabase `ocoinbnjgstkmnwwvnhi`, so no browser session can be minted here and `/sticker-lab/new` (under `_authenticated`) cannot be driven end-to-end from this sandbox. Unauthenticated reproduction only reaches the `/auth` gate.

Conclusion: **the crash cause is UNCONFIRMED.** I will not name a root cause I could not observe.

What the symptom pattern does tell us: the Sticker Lab cards render underneath the modal, so this is a captured/reported error (Lovable overlay via `reportLovableError` / global `error` + `unhandledrejection` listeners in `src/lib/error-capture.ts`), not a React render crash — a render crash inside the route would replace the tree with the root `errorComponent`.

Highest-probability candidates, all Step 4 code, none yet verified:

1. A rejected promise from one of the Step-4 probes — `motionConfigQuery` (`sticker-lab.new.tsx:655`), `telegramMotionConfigQuery` (`:668`), or `motionQuery` (`:634`, `loadStickerMotionState`). These throw into React Query, but a rejection reaching the global handler still trips the overlay.
2. An edge-function invoke error surfaced from `fetchStickerMotionTelegramConfig` — the last live probe reported `prep.configured=false`, `falConfigured=false`, `cloudConvertConfigured=false`, so this path is the least exercised.
3. Preview/Lovable infrastructure noise (HMR, preview auth broker) unrelated to Motion Studio.

Smallest safe fix boundary (NOT implemented): whichever single Step-4 client call is identified as the rejecting source — i.e. one of `src/lib/sticker-motion.ts`, `src/lib/sticker-motion-ai.ts`, `src/lib/sticker-motion-telegram.ts`, or the query wiring in `sticker-lab.new.tsx:628-676`. No backend, schema, RLS, or edge-function change is implied by anything observed.

Required first step before any fix: capture the exact overlay text/stack (screenshot or copied stack, or send a message from the affected preview so console/runtime telemetry is attached). Without it, any fix would be speculative.

## B) Lovable Queue item `SC-2 QA RECOVERY RUN...`

The Lovable message queue is editor-side state. It is **not readable from this environment** — there is no tool exposing queued-but-unsent prompts, and it leaves no repository or database trace. I cannot report its full text, origin, or status.

What the repository does show: the SC-1/SC-2/SC-3 Sticker Lab surface-consolidation work is already landed (unified builder steps in `sticker-lab.new.tsx`, pack command summary, release orientation strip), and several later phases (4B/4C/4D, variations, motion A1–C3) were built on top of it. A "QA RECOVERY RUN" written against an SC-2-era tree would be reasoning about a surface that has since changed substantially.

Recommendation: **CANCEL** (or at minimum, do not run as-is). Running a stale SC-2 recovery prompt now risks re-applying superseded edits over ten-plus later commits, and its start gate/SHA will not match `a1a5832`. If its intent still matters, re-author it against the current HEAD rather than replaying it.

## C) Motion Studio layout — why it is compressed

This is confirmed from source, not inference:

- `MotionStudioPanel` is rendered **inside every concept card**, at `src/routes/_authenticated/sticker-lab.new.tsx:3856`, within the card list at `:3399`:
  `<ul className="mt-6 grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-3 xl:grid-cols-4 …">`
- So on a desktop viewport each card is roughly a quarter of the content width (~280–320px), and the entire Motion Studio (mode chooser, explanatory copy, version history, prepare/release controls, dialogs) is squeezed into that cell.
- The panel's own internal layout uses viewport breakpoints, not container queries — e.g. the three motion modes at `src/components/sticker-lab/MotionStudioPanel.tsx:264`: `<ul className="mt-2 grid gap-1.5 sm:grid-cols-3">`. `sm:` fires on the 1280px+ **viewport**, so Quick / AI / Custom render as three columns inside a ~300px cell. That is exactly the "extremely narrow vertical columns" the user sees.
- The panel is 737 lines of stateful UI with confirmation dialogs; multiplied across up to 12 cards it also produces heavy visual repetition and no single obvious "next action".

Recommended information architecture (frontend/presentation only; no change to motion backend, runtime hooks, or edge functions):

1. **Card keeps only a compact motion summary strip**: one `StatusBadge` line (`No motion` / `Motion draft ready` / `Current Motion approved` / `Prepared for Telegram` / `Motion live` / `Update available`) plus a single primary button — `Open Motion Studio`.
2. **Full Motion Studio moves into a focused per-sticker workspace** — a right-side Sheet/Drawer on desktop and a full-screen sheet on mobile, one sticker at a time, titled with the sticker label and showing the static Current alongside the motion preview.
3. Inside the drawer the existing panel gets real width, so the three-mode grid, explanatory copy, version history, and the Prepare/Release actions read normally; no breakpoint hacks needed and the current `sm:grid-cols-3` becomes correct rather than pathological.
4. **Linear step ordering inside the drawer**, with exactly one enabled primary action at a time: Generate motion (billable, confirmed) → Set Current Motion (free) → Prepare for Telegram (billable, confirmed) → Release motion to Telegram (mutating, confirmed). Later steps stay visible but disabled with a one-line reason.
5. All existing props, guards, confirmation dialogs, error scoping, and eligibility logic (`currentMotionIsLive` / `anyMotionIsLive`, lineage checks, `telegramAssetId` gating) are carried over unchanged — this is a container/placement change, not a behavior change.

Alternative if a drawer is unwanted: keep it inline but render Motion Studio as a **full-width expanded row below the grid** for the single selected sticker. Same benefit, less new UI surface. The one option not worth keeping is the status quo — full Motion Studio in every grid cell.

## D) Test recommendation

**Wait.** Two independent reasons, both observed:

1. The last live `cartel-e2e-motion` probe reported `prep.configured=false`, `falConfigured=false`, `cloudConvertConfigured=false`. The Telegram preparation stage (fal.ai + CloudConvert VP9 normalization) cannot complete, so a motion test would spend on generation and then stall before `Prepare for Telegram`, and `release_motion` could never be exercised.
2. An unexplained error modal is currently firing on the exact surface under test, so any failure observed now would be ambiguous between the real motion path and the unknown client fault.

Sequence I would recommend: capture the exact overlay error → fix that single boundary → configure the fal/CloudConvert secrets → then run one manual motion E2E on a single sticker. The Motion Studio layout rework (C) can be done in parallel since it touches only presentation.

STOP. No files changed, no deploys, no database, Telegram, or provider calls.
