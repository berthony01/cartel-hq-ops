# CARTEL HQ Supabase Edge Function Source Snapshots

This directory version-controls source snapshots of the Edge Functions currently deployed to the CARTEL HQ Supabase project (`ocoinbnjgstkmnwwvnhi`).

## Why this directory exists

The Cartel HQ Lovable project uses the TanStack project structure. Lovable currently blocks creating new files under the standard `supabase/functions/` path in this project. Because the production functions were originally deployed directly to Supabase, their source was not present in the Lovable repository.

`backend-source/edge-functions/` is therefore the repository source-snapshot location for the deployed backend functions. It is not automatically deployed by Lovable. The active Supabase project remains the authoritative runtime state.

No secrets belong in this directory. Runtime credentials and API keys must remain in Supabase Edge Function secrets or another approved secret store.


## Production inventory captured 2026-09-01



| Function | Live version | verify_jwt | Supabase deployment hash |
| --- | ---: | :---: | --- |
| sticker-ai | 9 | true | `2ea61be3e8205fba5f7bdb28288524f2e8848fe828f896af0c080d3882cfdd2f` |
| sticker-motion-ai | 2 | true | `dbf96b1b7751f2c3fae6ab1816b7e1b589ef450c6f7beb8b2e275af99838328a` |
| telegram-stickers | 6 | true | `d7d60a12cf98ca9d9313fff32102de6cc10319526e80d1cff100f21523224208` |
| telegram-link | 3 | true | `9996641ed725ff32335ca24f576396856191fdf390bbaf622ae6ef688508e486` |
| telegram-webhook | 45 | false | `214c3f87cfc2a1b3601e3c4b24f47314e30980ab7a817a95bcc84e4c016fbac7` |
| telegram-group | 11 | true | `425de4aeaf69833ff1c89d9aa25431073dfdd0de94df68661a0875714932fd23` |
| telegram-profile-sync | 2 | true | `27b82cc0dd197e9b3bb5a988fef2370e50a64594fc66aa48ade44fb0d38910c1` |
| sticker-drop-config | 2 | true | `48f4b2ac1053236c7db9a4cd3f21bcde8227e186973e67dfec25c2050ab883b5` |
| sticker-drops | 4 | false | `50688adafed03a2824b1547ba773979baea67bbe1167cdaff3b74fc28174f31a` |
| platform-admin | 4 | true | `7626af92ca7df5959c9a9673a70d66fde2a2a55168126fc4e7e6c910fa354219` |

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

