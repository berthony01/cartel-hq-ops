# Phase 2 Read-Only Inspection Report

Start gate verified: HEAD = `40818c1b8b2859497cc9b4d777539960695ecdca`. No files edited, no commands with side effects, no DB or provider calls.

## 1. Existing AI provider integrations

Repo-wide search for OpenAI, Anthropic/Claude, Gemini/Google AI, Groq, Mistral, DeepSeek, OpenRouter, Lovable AI Gateway / `LOVABLE_API_KEY`, `chat/completions`, and generic LLM wrappers.

Result: **no text/chat AI provider exists anywhere — runtime, config, secrets, or wrapper.** Zero matches for every listed vendor except Kie.

The only AI runtime integration is image-only:

- `backend-source/edge-functions/sticker-ai/index.ts` — Kie.ai image runtime. `KIE_BASE = https://api.kie.ai`, secrets `KIE_API_KEY`, `KIE_STICKER_MODEL`, background model. Endpoints used: `/api/v1/jobs/createTask` and `/api/v1/jobs/recordInfo`. No text/chat endpoint is called.
- `src/lib/sticker-ai.ts` — thin client, actions `config` / `start` / `sync` only.
- `src/lib/sticker-packs.ts`, `src/routes/_authenticated/sticker-lab.new.tsx` — Kie mentions are user-facing copy/error strings, not integrations.
- `src/components/ui/sidebar.tsx` matched only on the substring "cookie"; irrelevant.

Documentation-only / comment references: `src/lib/sticker-ai.ts` header comment, `backend-source/edge-functions/README.md` inventory. No `.env` or `VITE_*` variable references any text model provider.

**Conclusion: there is no configured text AI provider. Phase 2A cannot call one without a new, explicitly authorized secret and provider decision.**

## 2. Step 3 Sticker Concepts — current data contract

Local draft model (`src/lib/sticker-lab.ts`):

```text
Concept = { id: string; label: string; action: string; emoji: string }
BuilderDraft.concepts  : Concept[]        // length capped by draft.size (6 | 12 | 24)
BuilderDraft.keywords  : Record<conceptId, string>   // comma-joined free text
BuilderDraft.stickerIds: Record<conceptId, stickerRowId>
```

- `starterConcepts(theme, size)` is deterministic, local, offline; seeded per theme, cycles seeds modulo length. `Custom` theme is placeholder text.
- Draft persists to `sessionStorage` key `cartel-hq:sticker-lab:draft` via `saveDraft` / `loadDraft` / `clearDraft`.

Step 3 UI (`src/routes/_authenticated/sticker-lab.new.tsx`, ~lines 1720–1830):

- "Reset to starter concepts" → `update({ concepts: starterConcepts(draft.theme, draft.size) })`.
- `addConcept` (blocked at `draft.size`), `removeConcept`, `editConcept(id, patch)` for label / action / emoji.
- Theme change regenerates all concepts; size change truncates or top-ups from starters.

Persistence (`src/lib/sticker-packs.ts`, `savePackDraft` ~lines 391–493):

- Upserts `sticker_packs` row (blueprint included) then per-concept `stickers` rows in `sort_order` index order.
- Column mapping: `label` ← `concept.label` (fallback `Concept N`), `action_description` ← `concept.action` or null, `emoji_list` ← single-element array or `[]`, `keyword_list` ← split of `draft.keywords[id]`.
- Deleted concepts' sticker rows are removed (orphan delete).
- Hydration (~lines 520–565): sticker rows map back to `Concept[]` with fresh local ids, `keyword_list` re-joined into `keywords`; falls back to draft/starter concepts when no rows exist.

So concepts are pure local state until an explicit save, and no generation is triggered by any Step 3 action.

## 3. `ai_jobs` — can a concept job be logged without schema change?

Schema (from `src/integrations/supabase/types.ts`): `id, workspace_id, user_id, pack_id, sticker_id, job_type (text, required), provider, provider_model, provider_task_id, status, input_json, output_json, provider_cost, error_code, error_message, created_at, updated_at, completed_at`.

- `job_type`, `provider`, `provider_model`, `status` are free-form text in the generated types; existing values are `sticker_generate` and `remove_background`. `sticker_id` is nullable, so a pack-level concept job fits.
- Therefore **a concept-generation job can be logged with no schema change**, provided no CHECK constraint on `job_type`/`status` exists in the live DB (not verified — this run is read-only and no DB query was made; verify before relying on it).
- Consumers to respect: `latestJobsForStickers` and attempt counting filter by sticker id and exclude `job_type` containing "background"; a `sticker_id = null` concept job is invisible to them (good). But `inspectPackLifecycle` reports an `active_ai_jobs` delete blocker computed server-side — a concept job left in `queued`/`running` could block pack deletion. Any concept job must terminate to `succeeded`/`failed`, or be excluded from that predicate.

## 4. Smallest safe Phase 2A architecture (recommendation)

Because no text provider is configured, Phase 2A splits into a gated decision:

Prerequisite (owner decision, not implementable now): choose one text provider and add exactly one secret to the existing Supabase project's Edge Function secrets (for example `OPENAI_API_KEY` or Lovable AI Gateway `LOVABLE_API_KEY`). No provider may be invented or defaulted.

Recommended shape once authorized:

1. New Edge Function `sticker-concepts` (separate from `sticker-ai`, so image credits and concept text can never share a code path), `verify_jwt = true`, workspace-authorized like existing functions.
   - Single action `suggest`: input `{ workspaceId, packId?, theme, size, brief, styleNotes, creativeBlueprint }`, output strictly `{ concepts: [{label, action, emoji}] }`, hard-capped at `size` (max 24).
   - Free `config` action mirroring `sticker-ai`'s `configured` probe so the UI can disclose "not configured" instead of failing.
   - Returns `{ error: "CONCEPTS_NOT_CONFIGURED" }` (503) when the secret is absent.
   - Optional audit row in `ai_jobs` with `job_type = 'concept_suggest'`, `sticker_id = null`, terminal status always written.
2. Client wrapper `src/lib/sticker-concepts.ts`, mirroring `src/lib/sticker-ai.ts` (no secret client-side).
3. Step 3 UI: one explicit button ("Suggest concepts with AI"), disabled while unconfigured or pending, with a confirm/preview step. Suggestions replace only `label`/`action`/`emoji` in the local draft — never auto-save, never call `startStickerGeneration`, never touch `stickerIds`.
4. `starterConcepts` stays the default and the fallback on any error, empty response, or unconfigured provider. Reset-to-starters button remains.

If the owner declines to add a provider secret, Phase 2A reduces to no-op and the local starter system stands unchanged.

## 5. Phase 2A execution contract (for a future authorized run)

Allowlist (create/edit only):
- `backend-source/edge-functions/sticker-concepts/index.ts` (new)
- `backend-source/edge-functions/sticker-concepts/deno.json` (new)
- `src/lib/sticker-concepts.ts` (new)
- `src/routes/_authenticated/sticker-lab.new.tsx` — Step 3 block only
- `backend-source/edge-functions/README.md` — inventory row, only after a deploy phase

Prohibited:
- Any edit to `backend-source/edge-functions/sticker-ai/index.ts`, `src/lib/sticker-ai.ts`, `src/hooks/useStickerGenerationRuntime.ts`, `src/hooks/useStickerReviewRuntime.ts`
- Any schema change, migration, RPC, RLS/grant change, cron, or new table
- Any change to `savePackDraft` persistence contract, `Concept` shape, `BuilderDraft` fields, or `starterConcepts` seeds
- Any auto-save, auto-generate, or provider image call from the concept path
- Any client-side provider key, package install, lockfile change, publish, or deploy in the same phase as code authoring

Verification:
- `bunx tsgo --noEmit` and `bun run build`
- Unconfigured path renders a clear disabled state and the starter concepts still work
- Confirm no code path from the concepts button reaches `startStickerGeneration` / `sticker-ai`
- If an `ai_jobs` audit row is written, confirm terminal status and that pack deletion is not blocked

Stop point: report after code authoring and static verification. Deployment of `sticker-concepts`, secret creation, and any live provider call are separate, explicitly authorized phases.
