import { createClient } from "@supabase/supabase-js";
import type { ToolContext } from "@lovable.dev/mcp-js";

// Publishable (anon) values — same as the generated browser client. Safe in code.
const SUPABASE_URL = "https://ocoinbnjgstkmnwwvnhi.supabase.co";
const SUPABASE_PUBLISHABLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9jb2luYm5qZ3N0a21ud3d2bmhpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc3OTU5MDAsImV4cCI6MjEwMzM3MTkwMH0.SiDT4-20XnbyHxZbfSC53C0u1uYcyqIegGtUfd5X7r8";

/** Forwards the verified OAuth bearer token so RLS runs as the signed-in user. Read-only use. */
export function supabaseForUser(ctx: ToolContext) {
  const token = ctx.getToken();
  if (!token) throw new Error("A verified sign-in is required");
  return createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function toolError(text: string) {
  return { content: [{ type: "text" as const, text }], isError: true };
}
