# social-mission-setup deployment inputs

This read-only function is staged and not deployed. Root release must preserve `verify_jwt = true` and package these exact repository files together:

- `backend-source/edge-functions/social-mission-setup/index.ts`
- `backend-source/edge-functions/social-mission-setup/handler.ts`
- `backend-source/edge-functions/social-mission-setup/deno.json`
- `backend-source/edge-functions/_shared/x-metrics.ts`
- `src/lib/telegram-miniapp-auth.server.ts`

The import map contains only `@supabase/supabase-js` pinned to `https://esm.sh/@supabase/supabase-js@2.45.0`. Runtime values are the existing external Supabase secrets `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `TELEGRAM_BOT_TOKEN`, and `X_API_BEARER_TOKEN`; no new or duplicated secret is required.

The function accepts only a service-role bearer plus `X-Cartel-Internal-Source: telegram-miniapp-bridge`. It validates fresh signed Telegram `initData`, resolves candidate/community authority server-side, requires a linked workspace operator and current group administrator, applies identity and `x_missions` access gates, requires a `READY` candidate, performs one fail-soft official X read, and invokes the existing read-only `social_mission_metric_targets` policy. It performs no mission, schedule, usage, candidate, or Telegram mutation.

The standard `supabase/functions/` mirror cannot be added by this TanStack workspace's enforced file guard. The backend snapshot above is therefore the reviewed deploy input for root release; no runtime deployment has occurred.