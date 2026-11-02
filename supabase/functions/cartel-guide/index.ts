/**
 * CARTEL HQ G2A.1 — SOURCE-ONLY, NOT DEPLOYED.
 * Authenticated Guide request boundary, intentionally returns 503 for all
 * otherwise-authorized requests. No AI call, no billing, no writes, no chat.
 * Never deploy without G2A.2 atomic budgets and security approval.
 * Future deployment must use verify_jwt=true and explicit allowed origins.
 */
import { createClient } from "npm:@supabase/supabase-js@2.112.4";
import { evaluateGuideRequest, GUIDE_MAX_BODY_BYTES } from "../_shared/cartel-guide-contract.ts";

const jsonHeaders = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
};
const origins = new Set((Deno.env.get("CARTEL_GUIDE_ALLOWED_ORIGINS") ?? "")
  .split(",").map(x => x.trim()).filter(Boolean));

function headersFor(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = { ...jsonHeaders, "Vary": "Origin" };
  if (origin && origins.has(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Headers"] = "authorization, apikey, content-type, x-client-info";
    headers["Access-Control-Allow-Methods"] = "POST, OPTIONS";
  }
  return headers;
}

/** Read at most 2 KB from the network, not request.text() on an unbounded body. */
async function boundedBody(req: Request): Promise<string | null> {
  const reader = req.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > GUIDE_MAX_BODY_BYTES) {
        await reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder("utf-8", { fatal: true }).decode(joined);
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin");
  const headers = headersFor(origin);
  const respond = (status: number, code: string) =>
    new Response(JSON.stringify({ code, message: "The Guide is unavailable for this request." }),
      { status, headers });
  // No wildcard CORS. The origin whitelist is empty until deliberately configured.
  if (origin && !origins.has(origin)) return respond(403, "ORIGIN_NOT_ALLOWED");
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (req.method !== "POST") return respond(405, "METHOD_NOT_ALLOWED");
  if (!(req.headers.get("Content-Type") ?? "").toLowerCase().startsWith("application/json")) {
    return respond(400, "INVALID_CONTENT_TYPE");
  }
  let raw: string | null;
  try { raw = await boundedBody(req); }
  catch { return respond(400, "INVALID_BODY"); }
  if (raw === null) return respond(413, "REQUEST_TOO_LARGE");

  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  const secret = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anon || !secret) return respond(503, "AUTH_UNAVAILABLE");

  const result = await evaluateGuideRequest(
    { method: req.method, authorization: req.headers.get("Authorization"), body: raw },
    {
      enabled: Deno.env.get("CARTEL_GUIDE_ENABLED"),
      verifyUser: async (jwt) => {
        const client = createClient(url, anon, {
          global: { headers: { Authorization: `Bearer ${jwt}` } },
          auth: { persistSession: false, autoRefreshToken: false },
        });
        const { data, error } = await client.auth.getUser(jwt);
        return error || !data?.user ? null : data.user.id;
      },
      workspaceAccess: async (userId, workspaceId) => {
        const admin = createClient(url, secret, {
          auth: { persistSession: false, autoRefreshToken: false },
        });
        const [project, membership] = await Promise.all([
          admin.from("workspaces").select("id,owner_id")
            .eq("id", workspaceId).maybeSingle(),
          admin.from("workspace_members").select("user_id")
            .eq("workspace_id", workspaceId).eq("user_id", userId).maybeSingle(),
        ]);
        if (project.error || membership.error) throw Error("access check unavailable");
        // No general platform-owner cross-tenant read is introduced here.
        if (project.data?.owner_id === userId || membership.data?.user_id === userId)
          return "member";
        // A managed Service Partner grant is NOT workspace membership.
        // Scope-based reads need a separately audited server authority.
        return "none";
      },
    },
  );
  return new Response(JSON.stringify(result.body), { status: result.status, headers });
});
