# PCART Treasury Signer Setup Foundation — PLAN / AUDIT ONLY

Inspected at HEAD `3c1d479d12f413bed9198a1fb5d33a28128a8bc2`, working tree clean. No file edited, no SQL run, no chain call, no Safe touched.

Goal: the project owner types three public wallet addresses into CARTEL HQ, they are saved, and nothing on-chain happens. No address is ever written into source, config, env or a migration.

## 1. Current files, components and routes involved

Confirmed by reading HEAD:

- `src/routes/_authenticated/launch-control.tsx` — the owner's launch surface; renders `ProductionDeploymentRequestPanel` at line 2878.
- `src/components/cartel/ProductionDeploymentRequestPanel.tsx` — the production request form; renders `TreasurySafeVerificationPanel` at line 490.
- `src/components/cartel/TreasurySafeVerificationPanel.tsx` — hardened read-only canonical Safe v1.4.1 check. Its success copy already states the exact PEPECARTEL signer addresses are not pinned — this phase supplies the missing half.
- `src/lib/treasury-safe-verify.ts` — owns `normalizeTreasuryAddress` (lowercase), `isCandidateTreasuryAddress` (EVM shape + nonzero), `ZERO_ADDRESS`. Reused as-is; **not modified**.
- `src/lib/launch-production-request.ts` — existing address helpers and query-key conventions to mirror.
- `src/lib/workspace-context.tsx` — `workspaceId` / `workspace.owner_id` for the current workspace.
- DB ownership primitive: `public.is_workspace_owner(uuid, uuid)`, already `SECURITY DEFINER` and revoked from `PUBLIC/anon/authenticated`, used by every existing owner-gated RPC (e.g. the launcher-B1 handoff migration).

No checksum utility exists in the repo today; `viem` (present) exports `getAddress` for display-only checksumming.

## 2. Table and RLS proposal

One new table, one new owner-gated RPC. Nothing is bolted onto `launches` or `project_profiles`.

```sql
create table public.launch_treasury_signer_configs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  launch_id uuid not null references public.launches(id) on delete cascade,
  signer_addresses text[] not null,
  threshold smallint not null default 2,
  status text not null default 'DRAFT',
  created_by uuid not null,
  updated_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint launch_treasury_signer_configs_launch_unique unique (launch_id),
  constraint launch_treasury_signer_configs_threshold_fixed check (threshold = 2),
  constraint launch_treasury_signer_configs_status_allowed
    check (status in ('DRAFT','SIGNERS_READY')),
  constraint launch_treasury_signer_configs_addresses_shape check (
    array_length(signer_addresses, 1) = 3
    and signer_addresses <@ array(select unnest(signer_addresses))  -- placeholder, see note
  )
);
```

Address validity is enforced by a **validation trigger**, not a CHECK, per project rules: exactly 3 entries, each matching `^0x[0-9a-f]{40}$`, each not the zero address, all three distinct, and `threshold = 2`. Fail-closed: the trigger raises on any violation for insert and update.

`SAFE_CREATED` / `VERIFIED` are deliberately **absent from the allowed-status CHECK** in this phase, so no row can ever claim on-chain state that does not exist. Adding them is a later authorized migration.

Grants and RLS (exact order: create → grant → enable RLS → policies):

```sql
grant select, insert, update on public.launch_treasury_signer_configs to authenticated;
grant all on public.launch_treasury_signer_configs to service_role;
-- no anon grant: no public or anonymous access at all
alter table public.launch_treasury_signer_configs enable row level security;

create policy "owner reads own treasury signer config"
  on public.launch_treasury_signer_configs for select to authenticated
  using (public.is_workspace_owner(workspace_id, auth.uid()));

create policy "owner writes own treasury signer config"
  on public.launch_treasury_signer_configs for insert to authenticated
  with check (public.is_workspace_owner(workspace_id, auth.uid()));

create policy "owner updates own treasury signer config"
  on public.launch_treasury_signer_configs for update to authenticated
  using (public.is_workspace_owner(workspace_id, auth.uid()))
  with check (public.is_workspace_owner(workspace_id, auth.uid()));
```

No DELETE policy and no DELETE grant — a non-owner member can neither read, write nor remove; a workspace member who is not the owner gets zero rows and a denied write. Cascade delete still works through the FK at service level.

**RPC: yes, one is needed** — `public.save_launch_treasury_signers(_launch_id uuid, _signers text[])`, `SECURITY DEFINER`, `set search_path = public`, revoked from `PUBLIC/anon` and granted to `authenticated`. It resolves `workspace_id` from the launch itself (never from the client), re-asserts `is_workspace_owner(l.workspace_id, auth.uid())`, lowercases and validates the three addresses server-side, upserts on `launch_id`, sets `status = 'SIGNERS_READY'`, stamps `updated_by`/`updated_at`, and returns the stored row. This matches the existing launcher-B1 pattern and stops a client from claiming another workspace's launch. Reads go through plain RLS-protected `select`.

Also added: the standard `update_updated_at_column` trigger.

## 3. UI placement and fields

A new distinct card, **PEPECARTEL Treasury Setup**, rendered in `src/routes/_authenticated/launch-control.tsx` immediately **before** the production deployment request panel. `ProductionDeploymentRequestPanel.tsx` is **not** edited.

New component `src/components/cartel/TreasurySignerSetupPanel.tsx`:

- Heading + plain-English explainer covering, verbatim in spirit: three keys controlling one treasury, not three wallets receiving tokens; the eventual Safe is 2-of-3 so any two approve; never enter a seed phrase or private key; addresses must be three different, real, non-empty EVM addresses; they can be edited freely until the Safe is created, after which changing them needs a separate explicit process; this step only records the intended addresses — it creates nothing, signs nothing, moves nothing and authorises no launch.
- Three labelled inputs: `Signer wallet 1 / 2 / 3`, monospace, `spellCheck=false`, `autoComplete="off"`, placeholder `0x…`, each with inline per-field validation text.
- A read-only line: **Signatures required: 2 of 3 (fixed for PEPECARTEL)** — no control can change it.
- Primary button labelled exactly **Save signer wallets**. No "Create Safe" anywhere.
- Status badge: `Not set` (no row) / `Draft` / `Signers ready`. No badge implies an existing Safe.
- After save: the three addresses displayed in checksummed form via `viem`'s `getAddress`, with an Edit control returning to the inputs.
- Read-only for non-owners with an explanatory line, mirroring existing owner-gated panels.

The guided-journey model (`src/lib/project-journey.ts` / `launch-readiness.ts`) is **not** touched in this phase — adding a step there would change the global NEXT STEP for every non-PCART workspace. Called out as a separate later unit.

## 4. Validation rules (identical client and server)

1. Trim, strip nothing else; reject empty.
2. Must match `^0x[0-9a-fA-F]{40}$` — reuse `isCandidateTreasuryAddress`.
3. Must not be the zero address.
4. Normalise to lowercase for storage via `normalizeTreasuryAddress`.
5. Exactly three addresses; all three distinct after normalisation (duplicate → named error on the offending field).
6. Threshold is the literal `2`; never read from client input.
7. Any failure → nothing is written; the trigger and the RPC both raise. Client validation is convenience only.
8. No ENS, no name resolution, no address generation, no private-key or seed input of any kind anywhere in the component.

## 5. File and migration allowlist

New:
1. `supabase/migrations/<generated>_pcart_treasury_signer_config.sql` (via the migration tool)
2. `src/lib/treasury-signers.ts` — types, validation, query keys, read/save client calls
3. `src/components/cartel/TreasurySignerSetupPanel.tsx`
4. `scripts/pcart-treasury-signers-regression.ts`

Changed:
5. `src/routes/_authenticated/launch-control.tsx` — mount the panel only
6. `scripts/pcart-l1-closure-regression.ts` — re-pin migration count (see section 9)
7. `scripts/pcart-l2-draft-artifact-regression.ts` — re-pin migration count (see section 9)
8. `src/integrations/supabase/types.ts` — regenerated by the platform, not hand-edited
9. `docs/PCART_L1_CLOSURE_PACK.md` — status line only (see section 9)

Prohibited paths: `src/lib/treasury-safe-verify.ts`, `src/lib/treasury-safe-verify.functions.ts`, `src/components/cartel/TreasurySafeVerificationPanel.tsx`, `src/components/cartel/ProductionDeploymentRequestPanel.tsx`, `src/lib/launch-production-request.ts`, `contracts/**`, `src/lib/cartel-fixed-erc20.artifact.ts`, any chain execution/liquidity/runtime-control file, `package.json`/lock, `.lovable/plan.md`, every other migration.

## 6. Tests and regressions

New `scripts/pcart-treasury-signers-regression.ts` (dependency-free, source + pure-logic):

- Validation: happy path; short/long/non-hex address; zero address; duplicates in any position; two addresses; four addresses; mixed-case input normalising to identical lowercase.
- Storage normalisation is lowercase; display path uses checksum.
- Threshold is a hard-coded `2` with no UI control writing it.
- Migration source asserts: `is_workspace_owner` used in every policy; no `to anon` and no anon grant; `security definer` + `set search_path = public` on the RPC; the status CHECK contains only `DRAFT` and `SIGNERS_READY` and does **not** contain `SAFE_CREATED` or `VERIFIED`; threshold CHECK `= 2` present; unique on `launch_id`.
- Component source contains "Save signer wallets" and contains no "Create Safe", no seed/private-key input, no `sendTransaction`/`signMessage`/wallet import.
- Tripwires: no 40-hex address literal appears in any new file; `MAINNET_LIQUIDITY_TX_ENABLED` still `false`; `APPROVED_OFFICIAL_ARTIFACT_ID` still `cartel-fixed-erc20-v1`; `ProductionDeploymentRequestPanel.tsx` unchanged and production submission does **not** reference the signer config; hardened verifier files unchanged.

Re-run unchanged: pcart-l1b (59), pcart-l1-closure, pcart-l2-draft, hardening-b, p1a, p2c2, p3c-f/f1/f2, launcher-b, launcher-b3, verifier-state-write-activation, wallet-connector, plus `bunx tsgo --noEmit` and `bun run build`.

## 7. Can this be built now without knowing the addresses?

**YES, fully.** Nothing in the schema, RLS, RPC, UI or tests depends on the values. The addresses arrive at runtime, typed by the owner, and live only in a row. Regressions use synthetic fixtures that are asserted never to leak into shipped source.

## 8. Stop point

Stop once the migration is applied, the panel saves and reloads correctly for the workspace owner, all suites pass and the diff matches the allowlist. Stop **before**: creating any Safe; selecting or funding any wallet; any signature or transaction on any chain; wiring the stored signers into the verifier as a hard comparison; gating production request submission; Phase 2 PCART compilation; deploy or publish. No status beyond `SIGNERS_READY` may exist.

## 9. Conflicts with the master plan / L1 closure docs

Three, all surfaced rather than worked around:

1. **Migration count tripwire — blocking.** `scripts/pcart-l1-closure-regression.ts:379` and `scripts/pcart-l2-draft-artifact-regression.ts:210` both assert exactly 82 migration files. This phase adds one, so both fail unless explicitly re-pinned to 83 with the new filename named. Those two scripts are therefore on the allowlist and need your explicit authorisation; I will not delete or loosen the assertion, only re-pin it.
2. **Address-leak tripwire — not blocking.** `L1C-6` forbids external Safe/Uniswap addresses in `src/**`. Owner-entered addresses are runtime data, never source, and the new regression adds its own no-literal-address check, so `L1C-6` stays untouched.
3. **Closure-pack status wording — documentation only.** The closure pack currently lists "PCART initial treasury recipient address" and the exact-owner match as PENDING. After this phase the *intended* signer addresses become recordable, but the Safe still does not exist. Proposed single amendment: note that signer-address capture is BUILT while actual Safe creation, the live canonical pass and the exact owner-address match remain PENDING. No frozen economic value, no L1 closure status, and no "execution ready" claim changes.

Also worth naming: this phase intentionally does **not** make production request submission depend on signer setup. PCART-L2 is not ready, so gating would add a dependency that cannot yet be satisfied; it stays a guided prerequisite only.
