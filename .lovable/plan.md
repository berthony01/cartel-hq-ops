# PP2-V2-1A — Rich Content Data + Profile Studio Architecture (read-only audit)

## 1. Start gate

- HEAD: `21ce84ef6dbde3b91a59ccfc6814e18840d30042` (exact match)
- `git status --short`: empty (clean)
- No files created or edited except this plan. No migrations, RPC, storage, auth, secret, package or publish action.

## 2. Recommended schema

One-to-one scalar content stays on `project_profiles` as nullable columns. Repeatable ordered media gets one child table. No JSONB blobs for user-editable content (no constraints, no ordering, painful validation, invisible to RPC contracts).

New nullable columns on `public.project_profiles`:

| Column | Type | Limit | Why |
| --- | --- | --- | --- |
| `tagline` | text | <= 140 | One-line positioning for hero/About. Strictly 1:1. |
| `about_long` | text | <= 6000 | Richer "what we are building". Plain text with newlines only — no HTML, no markdown rendering in V2-1. |
| `highlights` | text[] | max 6 entries, each <= 120 | Ordered short key points. Array is correct here: no per-item metadata, no independent lifecycle. Enforce count/length by CHECK. |
| `docs_url` | text | <= 500 | Official documentation link. Same shape as existing link columns. |
| `github_url` | text | <= 500 | Official GitHub link. |

Do NOT add: audit URL, KYC URL, custom links, banner — deferred (see §11).

New child table `public.project_profile_videos`:

```
id uuid pk default gen_random_uuid()
project_profile_id uuid not null references public.project_profiles(id) on delete cascade
workspace_id uuid not null              -- denormalized for simple RLS, kept in sync by trigger/check
youtube_video_id text not null          -- canonical 11-char ID, CHECK ~ '^[A-Za-z0-9_-]{11}$'
title text null                         -- <= 120, owner-supplied caption, optional
position int not null default 0         -- 0 = featured
created_at / updated_at timestamptz
unique (project_profile_id, youtube_video_id)
```

Plus a CHECK-or-trigger cap of 6 videos per profile. A child table (not an array column) is right because each video carries a title, an order, and its own identity for edit/delete.

`media_assets` is NOT used for YouTube: these are external URLs, not private stored objects, and `workspace-assets` must stay private. Selected project images for a future gallery would reuse `media_assets` — deferred to V2-2.

Grants for the new table: `GRANT SELECT, INSERT, UPDATE, DELETE ... TO authenticated`, `GRANT ALL ... TO service_role`. No `anon` grant — public reads go only through the SECURITY DEFINER RPC.

## 3. Public RPC design

- Extend `get_cartel_network_project(text)` with the new scalar fields: `tagline`, `about_long`, `highlights`, `docs_url`, `github_url`. Same published-only + moderation-hidden filtering, unchanged signature, unchanged security model. Returning a wider row costs nothing and avoids a second round trip for the hero/Overview.
- Add a separate `get_cartel_network_project_videos(_project_slug text)` SECURITY DEFINER RPC returning `youtube_video_id, title, position`, ordered by `position, created_at`. Repeatable rows do not belong in the single-row project RPC, and the Media tab can load them independently.
- Both RPCs must apply the same published/not-hidden gate as today. No anon table grants, no direct anonymous reads, and launch data still comes only from `get_cartel_network_project_launches`.

## 4. RLS / write path

- New scalar columns: keep the existing browser path — `src/lib/project-profile.ts` `saveProjectProfile` update through workspace-member RLS. No new write surface, no service_role.
- `project_profile_videos` RLS: all four policies `TO authenticated`, scoped by `public.is_workspace_member(workspace_id)`, plus a check that `project_profile_id` belongs to the same `workspace_id` (mirrors the existing `logo_asset_id` same-workspace rule). Writes happen from the browser as the signed-in member.
- No edge function, no admin client, no anon write path.

## 5. Platform Review reset classification

The existing `project_profiles_clear_platform_review` trigger clears pending/verified on identity changes. Extend it precisely:

**SHOULD clear review (material identity/trust):**
- `docs_url`
- `github_url`
- `tagline` (public positioning claim, shown in hero)

**SHOULD NOT clear review (presentation/content):**
- `about_long`
- `highlights`
- any `project_profile_videos` insert/update/delete

Rationale: review covers identity and official links. Official destinations a reviewer checked (docs, GitHub) and the headline claim must re-clear; long-form copy and videos are routine content editing and must not force owners to re-request review constantly. No trigger is added to the videos table.

## 6. YouTube normalization and validation

Accept, client-side and re-validate in a CHECK:
- `https://www.youtube.com/watch?v=<id>` (extra params ignored)
- `https://youtu.be/<id>`
- `https://www.youtube.com/shorts/<id>`
- `https://www.youtube.com/embed/<id>`
- bare 11-char ID

Store the canonical `youtube_video_id` only, never the raw URL — it normalizes duplicates, kills tracking params, and makes the embed URL fully server-derived. Render embeds via `https://www.youtube-nocookie.com/embed/<id>` in a sandboxed iframe built by our code from the ID. No owner-supplied HTML anywhere.

Ordering: `position`, with `position = 0` treated as Featured; the editor shows a "Make featured" action rather than exposing raw numbers. Max 6 videos for V2-1. Optional owner title (<= 120 chars); when empty, show "Project video".

Owner UX: single input "Paste a YouTube link", inline validation message, thumbnail preview from the ID.

## 7. Profile Studio section map

| Section | Contents | Editable? |
| --- | --- | --- |
| Identity | project name, ticker, primary chain, public slug, logo (existing `AssetUploader` + `media_assets`) | Editable |
| About | `tagline`, `description` (existing short), `about_long`, `highlights` | Editable |
| Links | website, Telegram, X, `docs_url`, `github_url` | Editable |
| Media | YouTube videos (featured + additional) | Editable |
| Trust | existing `VerificationSignals` / request-review flow via `project-verification.ts` | Read-only + request action |
| Launch | derived summary of current launch from Launch Control, with deep link | Read-only |
| Visibility | `discovery_status`, public URL, publish guidance | Editable |

Trust and Launch stay pure read-only reuse — no duplicate editable stores. Save model stays one form state, one `saveProjectProfile` call for scalars; videos save through their own small mutations (child rows edit immediately, which is simpler than diffing an array on submit).

## 8. Live preview adapter

- `PublicProjectHub` keeps its current contract: plain props, zero Supabase, zero data fetching. Nothing about it changes for preview support.
- Add a small adapter in the editor, e.g. `src/lib/project-profile-preview.ts`, that maps unsaved form state -> the `NetworkProject` shape the hub already consumes (same field names the public RPC returns), plus the video list from local state.
- Launch and Trust inputs come from the real authenticated sources already loaded in the editor (current launch summary, verification state), mapped into the same props. Where a real value is absent, pass empty/null so the hub renders its genuine empty state — never synthesize a fake status, watcher count or contract.
- The preview renders the hub with `activeTab` driven by the studio's section, replacing the handcrafted duplicate preview card.

## 9. Phased implementation order

1. **V2-1B — schema + RPC contract**: migration for the 5 columns, the videos table with grants/RLS, trigger classification update, extended project RPC, new videos RPC. Regenerated types land with it.
2. **V2-1C — data layer**: `src/lib/project-profile.ts` payload/validation for new fields; new `src/lib/project-profile-videos.ts`; `src/lib/cartel-network.ts` fetcher for the videos RPC.
3. **V2-1D — Profile Studio shell**: restructure `project-profile.tsx` into the seven sections with no new fields yet (pure refactor, easy to verify).
4. **V2-1E — About + Links fields** wired into the studio.
5. **V2-1F — Media editor + public Media tab** in `PublicProjectHub` (tab appears only when videos exist).
6. **V2-1G — shared live preview**, replacing the duplicate preview card.

Schema first means every later frontend phase types against real generated types instead of casts.

## 10. First build phase allowlist (V2-1B)

- One migration via the migration tool (columns + CHECKs, `project_profile_videos` + GRANTs + RLS, trigger update, `get_cartel_network_project` replacement, new `get_cartel_network_project_videos`).
- Regenerated `src/integrations/supabase/types.ts` (tool-generated, not hand-edited).
- Nothing else. No frontend file changes in V2-1B.

Must NOT change: `get_cartel_network_project_launches`, `project_platform_reviews` structure, `media_assets` CHECK, bucket privacy, watcher exposure, launch lifecycle, auth/routes/packages.

## 11. Risks and deferrals

- Widening the project RPC return type changes generated types; frontend must compile against them before shipping UI (handled by phase order).
- Trigger change is the highest-risk item: it must add exactly the three new material fields and not alter existing reset behavior. Regression coverage should assert that a video or `about_long` edit does not clear a verified review.
- `highlights text[]` CHECK enforcement needs both count and per-element length; if that proves awkward, fall back to a `project_profile_highlights` child table (still avoid JSONB).
- Deferred to V2-2+: third-party audit/KYC links with provenance labelling, image gallery from `media_assets`, Updates module, custom links, banner, markdown rendering, watcher counts.

## STOP POINT

Audit complete. No build performed. Awaiting authorization for PP2-V2-1B.
