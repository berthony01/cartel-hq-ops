import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { handleCleanupRequest } from "./handler.ts";

/**
 * Phase 5.2 — Durable Telegram message cleanup worker entrypoint.
 * All logic lives in ./handler.ts (scheduler lane + service-only fast lane).
 */
Deno.serve((request) => {
  const runtime = (globalThis as any).EdgeRuntime;
  const waitUntil = typeof runtime?.waitUntil === "function" ? runtime.waitUntil.bind(runtime) : undefined;
  return handleCleanupRequest(request, {
    env: {
      SUPABASE_URL: Deno.env.get("SUPABASE_URL"),
      SUPABASE_SERVICE_ROLE_KEY: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
      TELEGRAM_BOT_TOKEN: Deno.env.get("TELEGRAM_BOT_TOKEN"),
    },
    createAdmin: (url, key) => createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }),
    waitUntil,
  });
});
