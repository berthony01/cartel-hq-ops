# Pre-start Mission Setup

## Scope
- Reuse the existing `/tg` Mini App, Telegram webhook, link candidate, mission sender, authorization, commercial gates, and cleanup machinery.
- Route official-link prompts and `/mission <link>` through candidate setup; preserve `/mission`, `/mission close`, `/mission manage`, and existing live mission controls.
- Add a candidate-scoped setup screen with editable likes, replies, reposts, and bookmarks, plus honest auto suggestions and an explicit Start Mission action.
- Stage, but do not apply, one SQL file that stores the reviewed candidate configuration and atomically claims/finalizes one winner before the existing single-send launch flow.
- Include the already-authorized presentation mirror, UTF-16 regression, and truthful Close & clear error-state fixes only if absent from the current tree.

## Security and behavior
- Signed Telegram `initData` and candidate routing are hints only; every read, save, and start rechecks linked workspace operator status and current admin status for the candidate’s exact connected group.
- Anonymous `sender_chat` may create a setup offer but cannot authorize setup changes or Start.
- No mission, target, schedule, metric fetch, or quota use occurs before explicit Start.
- Start preserves official-X, identity, commercial, permission, transport, ambiguity, pinning, source-cleanup, and finalization contracts.
- Concurrent starts commit one reviewed configuration; losing/replayed attempts cannot overwrite it or emit a second card.

## Allowed files
- Existing Telegram webhook source and mirror.
- Existing Mini App auth/bridge/client, `/tg` route, and small Mini App presentation components.
- Existing mission launcher shared helper only if candidate URL construction belongs there.
- One narrow staged SQL file under `docs/sql/`.
- Focused regression scripts, `roadmap.md`, and `AGENTS.md` only for durable architecture/status records.

## Verification
- Mocked regressions for admin/member/anonymous, expired/foreign/cross-group, commercial/owner paths, duplicate/racing starts, no pre-start mission side effects, auto-suggestion unknown-vs-zero, cleanup binding, legacy routing, and one-send behavior.
- Mirror byte comparisons, TypeScript check, and production build.
- No SQL application, real mission mutation, Telegram test message, manual deployment, or publication.
