# Roadmap Reconciliation After C7.3E (read-only report)

No files were edited, no migration applied, no deploy/publish, no Telegram call.

## 1. Current HEAD

`b95929a1f99d36f358bccd4e747e2b29b5bd5ac5` — working tree clean (`b95929a Update plan`).

## 2. What the repository actually contains as authoritative planning material

There is **no roadmap file in the repository**. `AGENTS.md`, `README.md` and `docs/` contain no phase IDs. `.lovable/plan.md` held only the C7.3E hardening plan. The only authoritative phase enumeration is in project knowledge (product build order 0–10) and in the phase contracts issued in chat.

The C7.3 arc IDs come from the C7.3A contract (chat #731), which names the full intended series: **C7.3A, C7.3B, C7.3C, C7.3D, C7.3E, C7.3F, C7.3G**, then **C8**.

## 3. Genuinely outstanding items, in order

1. **C7.3D D2 repository-record sync (only open remnant of C7.3D).**
   Live infrastructure is already done outside Lovable — migration version `20260902220631_c73d_d2_activate_project_inbox_delivery_scheduler`, Edge Function `project-inbox-delivery` v1 ACTIVE, cron `cartel-project-inbox-delivery-runner` every minute. The repository still does **not** contain that migration file (verified absent from `supabase/migrations/`), and `supabase/functions/` contains only `telegram-webhook` while the worker source lives solely at `backend-source/edge-functions/project-inbox-delivery/`, with no `supabase/config.toml` entry for it. This is a repo-vs-live drift record, not new behavior. Two prior attempts stopped: once on a gate mismatch, once because the migration system refused a direct migration-file write.

2. **C7.3E runtime proof (no phase ID assigned).**
   The hardened webhook was deployed at HEAD `b95929a`, but the deploy tool returned no version/hash and no live bare-DM capture has ever been observed end-to-end. No authoritative contract exists for this verification turn; it would need one.

3. **C7.3F** — named in the C7.3A contract, **no scope defined anywhere** in repository or chat.

4. **C7.3G** — named in the C7.3A contract, **no scope defined anywhere** in repository or chat.

5. **C8** — referenced only as a prohibition ("no C8 work", once as "C8 History"); **no contract, no scope**.

## 4. One-sentence scope of each remaining item

- **C7.3D D2 sync** — add the already-live scheduler migration file (and decide whether the delivery worker source/config also belongs in `supabase/`) so the repository matches production, with zero live changes.
- **C7.3E runtime proof** — controlled live verification that a bare eligible private DM produces exactly one MEMBER_INITIATED conversation and message, and that ambiguous/ineligible DMs produce nothing.
- **C7.3F / C7.3G / C8** — undefined; see item 7.

## 5. Already done, superseded, or overlapping with C7.3E — do NOT rebuild

- **Member-initiated Telegram DMs**: fully delivered by C7.3E via `capture_project_inbox_member_message`. Any older "member DM capture" plan is superseded.
- **Project selection / project picker for ambiguous DMs**: deliberately **excluded** by the C7.3E contract — ambiguity returns `ambiguous_workspace` with zero writes and no chooser. This is a decided non-goal, not an unfinished task; reintroducing a picker requires a new explicit contract.
- **Project Inbox routing** (candidate workspaces from ACTIVE `project_inbox_contacts` + active `launch_watch_subscriptions`, `new_conversations_enabled` gate, BLOCKED exclusion, dedupe, unresolved-thread continuity): closed in C7.3E.
- **Independent `replies_enabled` / `new_conversations_enabled` setters and Inbox settings UI/copy**: closed in C7.3E.
- **Reply capture (C7.3B), Inbox UI (C7.3C), durable team replies + worker + thread continuity (C7.3D D1/D3)**: complete.
- **Team Bot Console** (owners reading/replying from inside Telegram): explicitly deferred by every C7.3 contract; it is **not** part of C7.3E and remains unbuilt and unscoped.
- Product build order items 6–9 (Cartel Network, Watchlist/Signals, Project Verification, Owner Console) already have shipped surfaces in the repo; project-knowledge "6 NEXT" is stale.

## 6. Is C7.3 fully closed?

**No — but functionally it is.** C7.3A through C7.3E are implemented and verified. What remains under the C7.3 umbrella is (a) the D2 repository-record sync, (b) unproven C7.3E runtime behavior, and (c) two named-but-never-specified subphases C7.3F and C7.3G. C7.3 cannot be declared closed while F and G exist as placeholders with no contract.

## 7. Missing authoritative contracts (stated explicitly, not guessed)

The repository and chat history contain **no scope, acceptance criteria, or contract** for **C7.3F**, **C7.3G**, or **C8**. Nothing in either source defines the Team Bot Console phase either. No inference is offered here; these need to be specified before any gate can be written.

Also note: no message in this project's history ever contained the ID **C7.4A** — there is no older C7.4A plan in the repository or chat to reconcile against.

## 8. Immediate next safe phase

**C7.3D D2 repository-record sync** — smallest, lowest-risk, zero live effect, and it removes a real repo-vs-production drift. Note the known blocker: the migration tooling previously refused a direct migration-file write, so the turn may need an explicit decision on how the file gets recorded.
