/** G2E Cartel HQ conversational Guide — DRAFT ONLY, NOT DEPLOYED.
 * Enabled ONLY when BOTH Guide switches and the server-only DB budget/stop
 * permit. No deployment, paid use, new provider, or live change authorized.
 */
import { createClient } from "npm:@supabase/supabase-js@2.112.4";
import { evaluateGuideRequest, GUIDE_MAX_BODY_BYTES } from "../_shared/cartel-guide-contract.ts";
import { parseGuideRequest } from "../_shared/cartel-guide-contract.ts";
import { findGuidePublicEvidence } from "../_shared/cartel-guide-public-knowledge.ts";
import { KIE_GUIDE_CHAT_ENDPOINT, KIE_GUIDE_CHAT_MODEL,
  prepareKieGuideChatRequest, parseKieGuideChatResponse
} from "../_shared/cartel-guide-kie-chat-contract.ts";

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

  let verifiedUserId: string | null = null;
  // Preserve the already tested authentication and tenant isolation contract.
  const result = await evaluateGuideRequest(
    { method: req.method, authorization: req.headers.get("Authorization"), body: raw },
    {
      enabled: Deno.env.get("CARTEL_GUIDE_ENABLED"),
      verifyUser: async (jwt) => {
        const client = createClient(url, anon, {
          global: { headers: { Authorization: "Bearer " + jwt } },
          auth: { persistSession: false, autoRefreshToken: false },
        });
        const { data, error } = await client.auth.getUser(jwt);
        verifiedUserId = error || !data?.user ? null : data.user.id;
        return verifiedUserId;
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
        if (project.data?.owner_id === userId || membership.data?.user_id === userId)
          return "member";
        return "none";
      },
    },
  );
  if (result.status !== 503 || result.body.code !== "PROVIDER_NOT_CONFIGURED") {
    return new Response(JSON.stringify(result.body), { status: result.status, headers });
  }

  // Independent pay-per-call enable switch. Both flags default OFF.
  if (Deno.env.get("CARTEL_GUIDE_PAID_CALLS_ENABLED") !== "true")
    return respond(503, "PAID_CALLS_DISABLED");

  const parsed = parseGuideRequest(raw);
  if (!parsed.ok || !verifiedUserId) return respond(503, "GUIDE_UNAVAILABLE");
  const { question, selectedWorkspaceId } = parsed.value;
  // Public documentation only, server selected; never private project data.
  const evidence = findGuidePublicEvidence(question, 3);
  if (!evidence.length) return respond(422, "NO_VERIFIED_HELP_ARTICLE");
  let prepared: ReturnType<typeof prepareKieGuideChatRequest>;
  try {
    prepared = prepareKieGuideChatRequest(question,
      evidence.map(({ title, excerpt, href, verifiedAt }) =>
        ({ title, excerpt, href, verifiedAt })));
  } catch { return respond(503, "GUIDE_EVIDENCE_UNAVAILABLE"); }
  const kieKey = Deno.env.get("KIE_API_KEY");
  if (!kieKey) return respond(503, "GUIDE_MODEL_UNAVAILABLE");

  const admin = createClient(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const requestId = parsed.value.requestId ?? crypto.randomUUID();
  const { data: reserved, error: reserveError } = await admin.rpc(
    "cartel_guide_reserve_budget",
    { _user_id: verifiedUserId, _workspace_id: selectedWorkspaceId,
      _request_id: requestId },
  );
  if (reserveError || !reserved || reserved.allowed !== true ||
      typeof reserved.reservation_id !== "string") {
    const reason = String(reserved?.reason ?? "");
    const status = reason === "FORBIDDEN" || reason.startsWith("ENTITLEMENT") ? 403 :
      reason === "CUSTOMER_BUDGET_LIMIT" || reason === "GLOBAL_BUDGET_LIMIT" ? 429 : 503;
    return respond(status, reason || "GUIDE_BUDGET_UNAVAILABLE");
  }
  const reservationId = reserved.reservation_id as string;
  const releaseUnstarted = async () => {
    await admin.rpc("cartel_guide_release_unstarted",
      { _reservation_id: reservationId, _user_id: verifiedUserId! });
  };

  const inputBytes = new TextEncoder().encode(JSON.stringify(prepared.body)).length;
  // Conservative byte upper bound for input tokens; never trust client quote.
  if (reserved.provider !== "kie.ai" || reserved.model !== KIE_GUIDE_CHAT_MODEL ||
      !Number.isInteger(reserved.max_input_tokens) ||
      !Number.isInteger(reserved.max_output_tokens) ||
      reserved.max_input_tokens < inputBytes ||
      reserved.max_output_tokens < 128 || reserved.max_output_tokens > 2048) {
    await releaseUnstarted();
    return respond(503, "GUIDE_QUOTE_NOT_APPROVED");
  }
  const { data: marked, error: markedError } = await admin.rpc(
    "cartel_guide_mark_in_flight",
    { _reservation_id: reservationId, _user_id: verifiedUserId },
  );
  if (markedError || marked !== true) {
    await releaseUnstarted();
    return respond(503, "GUIDE_DISPATCH_BLOCKED");
  }

  // After in-flight, a provider charge may occur: no automatic retry/release.
  let provider: ReturnType<typeof parseKieGuideChatResponse> | null = null;
  try {
    const response = await fetch(KIE_GUIDE_CHAT_ENDPOINT, {
      method: "POST",
      headers: { Authorization: "Bearer " + kieKey, "Content-Type": "application/json" },
      body: JSON.stringify({ ...prepared.body, max_tokens: reserved.max_output_tokens }),
      signal: AbortSignal.timeout(20_000),
    });
    if (Number(response.headers.get("Content-Length") ?? "0") > 24_000)
      throw Error("oversized provider response");
    const bodyText = await response.text();
    if (bodyText.length > 24_000) throw Error("oversized provider response");
    provider = parseKieGuideChatResponse(response.status, JSON.parse(bodyText));
  } catch {
    provider = null;
  }

  // No metering data -> settle full reservation conservatively, not free retry.
  const { data: settled, error: settleError } = await admin.rpc(
    "cartel_guide_settle_budget",
    { _reservation_id: reservationId, _user_id: verifiedUserId,
      _input_tokens: provider?.ok ? provider.promptTokens : null,
      _output_tokens: provider?.ok ? provider.completionTokens : null },
  );
  if (settleError || settled?.ok !== true)
    return respond(503, "GUIDE_SETTLEMENT_UNAVAILABLE");
  if (!provider?.ok) return respond(503, "GUIDE_MODEL_UNAVAILABLE");
  if (settled.overrun_stop === true) return respond(503, "GUIDE_BUDGET_OVERRUN");
  return new Response(JSON.stringify({
    code: "OK", answer: provider.answer, requestId,
    sources: evidence.map(({ title, href, verifiedAt }) => ({ title, href, verifiedAt })),
  }), { status: 200, headers });
});
