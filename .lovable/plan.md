# C7.2 Deploy Artifact Generation (no repo edits, no deployment)

Gate verified read-only this turn: HEAD `5809439956b3557c975c186af3f9533c7ad0c6ad`, `git status --porcelain` empty, `backend-source/edge-functions/telegram-group/index.ts` = 61276 bytes, SHA-256 `795bd52b2ceb3c99880fc512b383cf86e2580fc0bb285523b80de56886b1feda`.

This task is build-mode work (it runs a bundler command), so it needs approval before execution.

## What will be done

1. Generate `/tmp/telegram-group-c72.min.js` from the authoritative source with all imports left external:
   `bun build backend-source/edge-functions/telegram-group/index.ts --target=browser --format=esm --external '*' --minify --outfile=/tmp/telegram-group-c72.min.js`
2. Re-parse the generated artifact (second `bun build` pass over the output, externals preserved) to confirm valid ESM.
3. Report exact byte count and SHA-256 of the artifact.
4. Grep-confirm all six markers survive minification: `telegram_photo_v1`, `Official communication through @PepeCartelHQBot`, `sendPhoto`, `brandingEnabled`, `branding_logo_asset_id`, `send_group_announcement`.
5. Re-verify HEAD and `git status --porcelain` unchanged after generation.
6. Return the complete artifact contents in one fenced code block with no truncation.

## Constraints honored

- Nothing written inside the repository; artifact lives only in `/tmp`.
- No Supabase deploy, no Edge Function invocation, no Telegram call, no DB/migration change, no publish.
- Source file is read only; its fingerprint is re-checked after generation.

## Known risk to confirm

Step 6 output size: the minified artifact is expected to be roughly 30-45 KB. If it exceeds what a single chat response can carry verbatim, no partial output will be emitted; the run will report the byte count, SHA-256, and the limitation instead, and the file will remain at `/tmp/telegram-group-c72.min.js` for external retrieval.
