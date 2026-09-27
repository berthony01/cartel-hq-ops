# MINI-HQ Operator Console Architecture Lock

## Product surfaces

- **Telegram bot/chat:** event detection, alerts, permission warnings, concise status cards, deep links, and emergency fallback commands.
- **Owner Mini App:** day-to-day operator Home, Missions, Project Inbox, quick community status, Brand/Appearance, and bounded quick actions.
- **Full CARTEL HQ web app:** launcher and contract flows, treasury/signers, billing, deep analytics, team settings, and advanced administration.
- **Future member Mini App:** a separate read-mostly community experience. It must never reuse or expose owner/operator controls.

These surfaces must not be collapsed into one interface.

## Identity and authority

CARTEL HQ is the platform identity. The active project identity is dynamic and comes from the existing workspace, `project_profiles`, `brand_kits`, and media sources of truth. Customer branding must never be hard-coded into the reusable shell.

The external Supabase project `ocoinbnjgstkmnwwvnhi` remains the only backend system of record. The Mini App continues to use signed Telegram `initData`, existing operator authorization, workspace isolation, mission infrastructure, and the platform-owner unrestricted-access invariant. No parallel backend is permitted.

## Owner navigation

The target primary navigation is:

```text
Home | Missions | Inbox | Brand | More
```

Home must remain useful with no live mission. It prioritizes active project identity, truthful needs-attention signals, mission summary, inbox/community context as each phase supports it, and bounded actions.

## Phased sequence

### MINI-HQ-1A — Operator Shell + Home + Dynamic Identity

- Convert `/tg` from a mission picker into the reusable owner shell.
- Make Home and Missions functional.
- Show dynamic project identity from existing sources.
- Preserve the existing mission detail and safe mutation behavior.
- Represent Inbox, Brand, and More as explicit deferred states only.

### MINI-HQ-1B — Project Inbox

- Reuse the existing Project Inbox architecture and authority.
- Deep-link bot notifications into the relevant conversation where feasible.
- Preserve opaque `member_ref` identity and never expose provider identifiers.
- Keep Telegram reply mode only as a verified fallback until a later removal decision.

### MINI-HQ-1C — Mission Control Consolidation

- Move remaining routine mission controls into the Mini App using existing mutation semantics.
- Add explicitly confirmed End Mission and Cancel Mission actions.
- Simplify bot controls only after Mini App equivalence is verified.

### MINI-HQ-1D — Brand / Appearance

- Add owner-facing preview/edit controls using existing identity and brand sources.
- Start with static identity and keep clean extension points for future animation and entitlement handling.
- Do not introduce duplicate branding state or pricing decisions.

### MINI-HQ-2 — Member Community Mini App

This is a separate future phase for community-facing project identity, mission progress, official links, Launch Watch, verified contract information, and Contact Team. It must not expose owner controls.

## Guardrails

- No duplicate inbox, mission, identity, or branding backend.
- No schema, RLS, role, service-role, or integration expansion without a separately authorized atomic task.
- Preserve Telegram authentication, tenant isolation, privacy-safe identifiers, and unrestricted platform-owner access.
- Do not remove a proven bot fallback before its Mini App replacement is verified.
- No deployment or publication without explicit authorization.
## MINI-HQ-1B implementation note

- 1B is IMPLEMENTED. The backend wrappers were applied externally to Supabase `ocoinbnjgstkmnwwvnhi` as migration `20260924151436` (`mini_hq_1b_miniapp_inbox_wrappers`) and verified live; `docs/sql/MINI_HQ_1B_miniapp_inbox_wrappers.sql` is the exact historical source record of that migration.
- The Inbox tab reuses the existing Project Inbox RPCs through the nine service-only `miniapp_inbox_*` wrappers (service_role EXECUTE only).
- Wrappers map the signature-derived Telegram user to the linked platform user, verify owner/admin on the workspace and conversation membership, set a transaction-local `request.jwt.claim.sub`, then delegate to the unchanged RPC.
- `/tg?tab=inbox&conversation=<uuid>` is bounded deep-link state; unknown or foreign conversations fail closed.
- Bot notification buttons and the 30-minute Telegram reply mode remain the unchanged fallback; the bot handoff cutover is NOT finished and remains a later decision.

### MINI-HQ-1B.1 — Bot -> Mini App Inbox handoff (implemented in repo, NOT deployed)
- New team capture alerts and `/inbox` list rows open the owner Mini App via a private-chat `web_app` button: `/tg?tab=inbox&workspace=<uuid>&conversation=<uuid>` (built with URL/URLSearchParams, UUID-gated, no Telegram identifiers).
- Alert workspace is resolved server-side by exact `project_conversations.id` lookup, then re-authorized with `bot_inbox_operator_workspaces`; any failure falls back to the legacy `pi_c_*` callback button.
- Legacy `pi_c_*` callbacks, `openInboxConversation`, 30-minute reply mode and `/cancel` remain as backward-compatible fallback.


## MINI-HQ-1C — Lifecycle parity + concise Telegram (code complete, not deployed)
- `/tg/mission/$missionId` exposes End mission now and Cancel mission behind a two-step confirmation. Bridge `miniAppEndMission` / `miniAppCancelMission` reuse `end_social_mission_from_control` / `cancel_social_mission_from_control`, the existing in-place `edit_mission` transport lane (which alone owns the single best-effort final X read for COMPLETED; CANCELLED takes none), the schedule-event ownership rule (`event_owned`), and the `pinned_by_hq`-guarded safe unpin. Retries replay the same request id; the transport duplicate short-circuits.
- New private Mission Control panels show only a mission-specific `Open Mission Control` web_app button (`/tg/mission/<uuid>`) plus Exit. Legacy `mc_*` callbacks stay handled for old messages and emergency fallback. Link Finder START MISSION / IGNORE unchanged.
- Brand tab shows saved identity read-only and links to Project Profile / Brand Kit; More links to existing full-app routes. No new backend, RPC, table, or schema.
