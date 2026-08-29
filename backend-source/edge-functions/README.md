# CARTEL HQ Supabase Edge Function Source Snapshots

This directory version-controls source snapshots of the Edge Functions currently deployed to the CARTEL HQ Supabase project (`ocoinbnjgstkmnwwvnhi`).

## Why this directory exists

The Cartel HQ Lovable project uses the TanStack project structure. Lovable currently blocks creating new files under the standard `supabase/functions/` path in this project. Because the production functions were originally deployed directly to Supabase, their source was not present in the Lovable repository.

`backend-source/edge-functions/` is therefore the repository source-snapshot location for the deployed backend functions. It is not automatically deployed by Lovable. The active Supabase project remains the authoritative runtime state.

No secrets belong in this directory. Runtime credentials and API keys must remain in Supabase Edge Function secrets or another approved secret store.

## Production inventory captured 2026-08-29

| Function | Live version | verify_jwt | Supabase deployment hash |
| --- | ---: | :---: | --- |
| sticker-ai | 2 | true | `2b85d39c2d7a85f529257a7f8b989fb2cde6caf06a95043cc43be437661bceb9` |
| telegram-stickers | 3 | true | `2c6566aca397831376257b72fb86c876bbf4818498c893d1885c91f595680824` |
| telegram-link | 3 | true | `9996641ed725ff32335ca24f576396856191fdf390bbaf622ae6ef688508e486` |
| telegram-webhook | 12 | false | `b6b9b1a3cefbeb73d57874fb16956400d914012450104c1e294dcd84f5fdf376` |
| telegram-group | 6 | true | `804c3364929bb85c83b490f4cbcfcc7dc86ffd178a744e18e74d5911fb9eddcc` |
| telegram-profile-sync | 2 | true | `27b82cc0dd197e9b3bb5a988fef2370e50a64594fc66aa48ade44fb0d38910c1` |
| sticker-drop-config | 2 | true | `48f4b2ac1053236c7db9a4cd3f21bcde8227e186973e67dfec25c2050ab883b5` |
| sticker-drops | 4 | false | `50688adafed03a2824b1547ba773979baea67bbe1167cdaff3b74fc28174f31a` |
| platform-admin | 2 | true | `3fb151d8c8b4f4396d2033f6c90ce19e2fbde9344e44cb736bf9787e7e141c5e` |

## Required change workflow

1. Before changing an Edge Function, read the currently deployed Supabase function and compare it with the repository snapshot.
2. Treat Supabase as authoritative for the live runtime until a formal source-first deployment workflow is established.
3. Make the smallest reviewed change against the matching snapshot.
4. Deploy only the intended function with the existing `verify_jwt` setting preserved unless a security-reviewed change explicitly requires otherwise.
5. Re-read the deployed function after deployment and verify its new version, hash, and runtime setting.
6. Update the matching snapshot and this inventory in the same work session.
7. Commit the source snapshot so production backend code never exists only in Supabase again.

## Important

The files in this directory are source snapshots, not a second backend and not a deployment target by themselves. Do not create parallel functions, duplicate infrastructure, alternate webhooks, or new secrets just to match this directory.
