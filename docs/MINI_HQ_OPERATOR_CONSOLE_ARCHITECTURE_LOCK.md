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