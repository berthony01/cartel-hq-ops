# Recurring Preview Failure Repair

## Confirmed cause

The app and production build are healthy. The failure is an authentication-initialization timing mismatch inside the Lovable preview:

- Preview session storage can legitimately take about 4.25 seconds on its first brokered lookup.
- The authenticated route currently abandons that lookup after 2 seconds.
- The abandoned session lookup can leave that preview tab’s authentication client locked, so soft retries repeat the failure.
- The root “This page didn’t load” screen only performs a soft router retry, which cannot reset that locked browser state.
- This explains the observed split: one connected preview currently renders CARTEL HQ and real data, while the older preview tab remains stuck on the error screen.

## Smallest repair

1. **Align authentication timing**
   - Change only the authenticated route guard’s fail-safe timeout from 2 seconds to 5 seconds, exceeding the preview storage broker’s documented worst-case path.
   - Preserve `getSession()`, fail-closed redirects, pending UI, RLS, and all authentication behavior.
   - Clean up the timeout timer when session initialization finishes normally.

2. **Make recovery actually reset the failed browser state**
   - Change the root error screen’s **Try again** action to reload the page instead of repeating a soft router invalidation.
   - In editor development only, if a corrected hot update arrives while the error screen is mounted, reload once so a stale error boundary cannot remain after the code has recovered.
   - Production behavior receives no automatic reload listener.

## Allowed files

- `src/routes/_authenticated/route.tsx`
- `src/routes/__root.tsx`

No other files, backend state, authentication settings, data, Telegram, wallet, chain, runtime flags, migrations, or publishing.

## Verification

- Confirm the build diagnostics remain clean.
- Run the focused type check and production build.
- Verify signed-out routing still reaches `/auth`.
- Verify the authenticated preview reaches CARTEL HQ and Launch Control without the error boundary.
- Verify the previously stuck preview can recover after the update instead of retaining “This page didn’t load.”
- Confirm only the two allowed files changed and the project remains unpublished.
