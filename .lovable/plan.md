# C8.7E Build-Contract Validation (plan only)

Read-only validation of the proposed C8.7E contract against HEAD `d115af70ce097e44e477eb83674485e826aedbd1` (tree clean). No code, migration, data, deploy, send, or publish action was taken.

## G. Contract defects found (fix before build)

1. **Correction must NOT move `contract_registered_at`.** C8.7C idempotency anchors the watcher event at `scheduled_for = launches.contract_registered_at` (`on conflict (launch_id, event_type, scheduled_for)`). If a correction rewrites that timestamp, a **second** `OFFICIAL_CONTRACT_REGISTERED` DM can be queued to every watcher. Required: a correction updates only `official_contract_deployment_id` (address re-derived); `contract_registered_at` / `contract_registered_by` stay at the original registration. Correction actor/time live in the ledger only. This is safe because the C8.7C RPC re-derives the address from bound evidence at send time.
2. **`launch_events_event_type_check` blocks the new type.** The CHECK allows only `REMINDER_24H, REMINDER_1H, OFFICIAL_CONTRACT_REGISTERED, LAUNCH_LIVE, WATCHER_UPDATE`. `OFFICIAL_CONTRACT_CORRECTED` must be added in the same migration or every insert fails.
3. **The notification worker silently drops unknown types.** `launch-notifications` falls through to `skip(deliveryId, "unknown_event_type")`. Without a new copy branch **and a redeploy**, correction deliveries are created and then discarded. Deploy authorization is a build prerequisite, not an afterthought.
4. **Status gates in existing comms paths are narrower than the correction contract.** Both `notify_launch_watchers_official_contract` and the `send_official_contract_broadcast` edge action hard-require status `OFFICIAL_CONTRACT_REGISTERED`. If correction is allowed at `LIVE`/`COMPLETED`, the *new* correction RPC and *new* edge action must accept all three statuses, otherwise a correction after go-live can never be communicated. Recommendation: allow correction and correction-comms at `OFFICIAL_CONTRACT_REGISTERED`, `LIVE`, `COMPLETED`; leave the C8.7C/D originals untouched at `OFFICIAL_CONTRACT_REGISTERED`.
5. **Session-flag trigger guard is unnecessary.** `authenticated` holds no UPDATE privilege on the four protected columns, so any update necessarily arrives through a postgres-owned SECURITY DEFINER path. The trigger stays the invariant enforcer (owner + status + evidence + always re-derive address + never clear) and needs no GUC. Do not add a session flag; do not disable triggers.
6. **Do not reuse `launch_notification_payload` for corrections.** Add a separate `launch_contract_correction_payload(_launch_id, _registration_event_id)` so C8.7C payload composition is byte-identically preserved.
7. **Do not add `contract_corrected_at` / `corrected_by` columns to `launches`.** The ledger is the history; extra denormalized columns invite a second source of truth.
8. Everything else in the proposed contract is safe and appropriately scoped.

## C. Final file allowlist

CREATE
- `src/components/cartel/OfficialContractCorrectionPanel.tsx` — correction + its two separate comms actions + optional compact history. One new file so C8.7D's panel is not touched.
- one new migration file (written by the migration tool only).

MODIFY
- `src/lib/launch-control.ts` — correction/ledger types, RPC wrappers, correction-notify wrapper, copy.
- `src/lib/telegram-group.ts` — `send_official_contract_correction_broadcast` wrapper + types.
- `src/routes/_authenticated/launch-control.tsx` — mount panel, ledger/eligibility query reuse, cache invalidation, terminology.
- `backend-source/edge-functions/launch-notifications/index.ts` — `OFFICIAL_CONTRACT_CORRECTED` copy branch; terminology.
- `backend-source/edge-functions/telegram-group/index.ts` — new correction action, `announcement_kind='OFFICIAL_CONTRACT_CORRECTION'`, ledger select adds `contract_registration_event_id`.
- `backend-source/edge-functions/telegram-webhook/index.ts` — terminology only (E4; requires its own deploy).
- `src/integrations/supabase/types.ts` — schema-corresponding regeneration only.

Not in scope: eligibility evaluator, `VerifiedDeploymentEvidencePanel`, `OfficialContractNotifyPanel`, `OfficialContractGroupBroadcastPanel`, `VerifiedContractRegistrationPanel` (except copy if terminology requires), any prior migration, `.lovable/plan.md`.

## D. Single additive migration — objects required

- `public.launch_contract_registration_events`: `id`, `workspace_id`, `launch_id` (FK cascade — launches are deletable only in DRAFT, so history cannot orphan), `action` CHECK in (`ACCEPTED`,`CORRECTED`), `deployment_id` FK **ON DELETE RESTRICT** (evidence referenced by a decision cannot be deleted), `contract_address`, `evidence_snapshot jsonb not null`, `correction_reason`, `superseded_event_id` self-FK RESTRICT, `actor_id`, `created_at`.
- CHECKs: reason NULL iff `ACCEPTED` (non-empty, length-bounded for `CORRECTED`); `superseded_event_id` NULL iff `ACCEPTED`.
- Unique partial: one `ACCEPTED` per launch; one `CORRECTED` per `superseded_event_id` (blocks branched history).
- Index: `(launch_id, created_at desc)`; `(workspace_id)`.
- `alter ... launch_events_event_type_check` to add `OFFICIAL_CONTRACT_CORRECTED`.
- Partial unique index `launch_events (launch_id, (payload->>'registration_event_id')) where event_type='OFFICIAL_CONTRACT_CORRECTED'`, plus `scheduled_for` anchored to the ledger event's `created_at` (dual idempotency).
- `telegram_group_announcements.contract_registration_event_id uuid null` FK RESTRICT + partial unique `(contract_registration_event_id, group_connection_id) where announcement_kind='OFFICIAL_CONTRACT_CORRECTION'`. Existing `OFFICIAL_CONTRACT` index untouched.
- `public.launch_contract_correction_payload(uuid, uuid)`.
- `public.correct_verified_launch_contract(_launch_id, _deployment_id, _expected_contract_address, _reason)` — SECURITY DEFINER, `search_path='public'`, row lock, owner check, status set, evidence assertion, typed-address match, reason normalization, same-deployment no-op returning `unchanged`, atomic update + `CORRECTED` append linked to current effective event.
- `public.notify_launch_watchers_official_contract_correction(_launch_id, _registration_event_id)`.
- Amend `register_verified_launch_contract` to append exactly one `ACCEPTED` event (guarded so the existing idempotent early-return path appends nothing); no other semantic change.
- Amend `enforce_launch_contract_update` to permit deployment-only correction under the invariants in defect 5; direct clearing and free-text address remain refused; `set_launch_contract_address` stays retired.

## E. Security / grants / RLS

- `launch_contract_registration_events`: RLS ENABLED. `GRANT SELECT TO authenticated` only, policy `USING (public.is_workspace_member(workspace_id, auth.uid()))`. No INSERT/UPDATE/DELETE grant or policy to anyone. `GRANT SELECT TO service_role` (telegram-group reads it); no anon.
- New functions: postgres-owned SECURITY DEFINER, `revoke all ... from public, anon`, `grant execute ... to authenticated`. No service_role execute unless an edge function calls them.
- `launch_contract_correction_payload`: revoke from public/anon; no authenticated grant (internal only).
- Column privileges on the four protected `launches` columns remain unchanged.

## F. Build sequence and QA matrix

- **E1** migration (schema + ledger + functions + trigger amendment) → linter clean, generated-types diff inspected for schema-only drift.
- **E2** client contracts (`launch-control.ts`, `telegram-group.ts`).
- **E3** UI panel + route mount.
- **E4** edge functions (notification copy, correction broadcast, terminology) — requires explicit deploy authorization.
- **E5** verification: `bunx tsgo --noEmit`, `bun run build`, read-only DB inspection of grants/policies/indexes/proconfig.

QA (no sends; SQL-level with rollback):
1. Initial registration appends exactly one `ACCEPTED`; repeat registration appends none.
2. Correction to a different eligible deployment appends one `CORRECTED` linked to the prior effective event; `contract_registered_at`/`_by` unchanged.
3. Correction to the same deployment = no-op, no second ledger row.
4. Two sequential corrections form a linear chain; a second `CORRECTED` against an already-superseded event is refused.
5. Non-owner member and cross-workspace actor refused `42501`.
6. Wrong typed address, empty reason, ineligible/foreign deployment refused `22023`.
7. Direct `UPDATE launches SET official_contract_address=...` as authenticated still refused.
8. Correction does not change status and creates no `launch_events` row and no announcement row.
9. Correction notify: stale/superseded `registration_event_id` refused; valid event queues exactly one `OFFICIAL_CONTRACT_CORRECTED`; repeat returns `already_notified`.
10. Correction broadcast: one correction event postable once per community; C8.7D `OFFICIAL_CONTRACT` uniqueness and no-auto-resend semantics unchanged.
11. Authenticated SELECT on the ledger returns only same-workspace rows; INSERT/UPDATE/DELETE denied.

## H. Confirmation

No files were created or modified, no SQL executed, no migration created, no edge function deployed, no Telegram message sent, no publish. `.lovable/plan.md` is the only write this turn, as required by plan mode.
