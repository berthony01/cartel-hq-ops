import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { captureCorsHeaders, isValidReferralCode, newReferralToken, sha256Hex } from "./logic.ts";

/**
 * CARTEL HQ partner-referral-capture (SOURCE ONLY — NOT DEPLOYED).
 * verify_jwt=false ONLY because capture happens before sign-up.
 *
 *  - Exchanges a 10-char referral code for a server-issued opaque token.
 *  - Only the SHA-256 hash is persisted (via service-role-only RPC).
 *  - Response is identical whether or not the code is real/active/limited,
 *    so codes cannot be enumerated; an unissued token simply never claims.
 *  - No IP, user agent, fingerprint or token is logged or stored.
 */
const DECOY_TTL_DAYS = 30;

Deno.serve(async (req: Request) => {
  const cors = captureCorsHeaders(req.headers.get("Origin"));
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });

  if (req.method === "OPTIONS") return new Response(null, { status: cors["Access-Control-Allow-Origin"] ? 204 : 403, headers: cors });
  if (!cors["Access-Control-Allow-Origin"]) return json({ error: "forbidden" }, 403);
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  let code: unknown;
  try {
    const raw = await req.text();
    if (raw.length > 256) return json({ error: "invalid request" }, 400);
    code = (JSON.parse(raw) as { code?: unknown })?.code;
  } catch {
    return json({ error: "invalid request" }, 400);
  }
  if (!isValidReferralCode(code)) return json({ error: "invalid request" }, 400);

  const token = newReferralToken();
  let expiresAt = new Date(Date.now() + DECOY_TTL_DAYS * 86_400_000).toISOString();
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data } = await admin.rpc("partner_issue_referral_click", {
      _code: (code as string).toLowerCase(),
      _token_hash: await sha256Hex(token),
    });
    const issued = data as { issued?: boolean; expires_at?: string } | null;
    if (issued?.issued === true && typeof issued.expires_at === "string") expiresAt = issued.expires_at;
  } catch {
    // Generic: never reveal backend state. No token or code in logs.
    console.error("partner-referral-capture issuance unavailable");
  }
  return json({ token, expiresAt });
});
