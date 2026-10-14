/** G2C: purely offline contract checks. No API calls, DB, secrets, or paid AI. 
 * Run in checkout: bun scripts/cartel-guide-g2c-kie-contract-regression.ts
 */
import { readFileSync } from "node:fs";
import {
  KIE_GUIDE_CHAT_ENDPOINT,
  KIE_GUIDE_CHAT_MODEL,
  prepareKieGuideChatRequest,
  parseKieGuideChatResponse,
} from "../supabase/functions/_shared/cartel-guide-kie-chat-contract.ts";

let pass = 0;
let fail = 0;
function check(label: string, success: boolean) {
  if (success) pass++;
  else { fail++; console.error("FAIL", label); }
}
function throws(fn: () => unknown): boolean {
  try { fn(); return false; } catch { return true; }
}

const publicSource = {
  title: "Set an exact launch time or launch window",
  excerpt: "Saving the date does not automatically arm countdowns or notify watchers.",
  href: "/docs?article=launch-schedule",
  verifiedAt: "2026-09-30",
};
const q = "How do I set a launch schedule?";
const prepared = prepareKieGuideChatRequest(q, [publicSource]);
const json = JSON.stringify(prepared.body);

check("Kie base endpoint pinned HTTPS", KIE_GUIDE_CHAT_ENDPOINT ===
  "https://api.kie.ai/gemini-3-8-flash-openai/v1/chat/completions");
check("explicit model identified", KIE_GUIDE_CHAT_MODEL === "gemini-3-8-flash-openai");
check("request is non-streaming", prepared.body.stream === false);
check("reasoning thoughts not requested", prepared.body.include_thoughts === false);
check("only expected request keys", Object.keys(prepared.body).sort().join(",") ===
  "include_thoughts,messages,stream");
check("system and user text only", prepared.body.messages.length === 2 &&
  prepared.body.messages[0]?.role === "system" &&
  prepared.body.messages[1]?.role === "user" &&
  prepared.body.messages.every(m => m.content.length === 1 && m.content[0]?.type === "text"));
check("citations grounded locally", json.includes("/docs?article=launch-schedule"));
check("document review date preserved", json.includes("2026-09-30"));
check("no tool or search use", !/"tools"|"googleSearch"|"image_url"|"file_url"/.test(json));
check("no auth, workspace, or API credentials in request", !/api[_-]?key|Bearer |workspaceId|supabase_key/i.test(json));
check("repeat produces same exact request", JSON.stringify(prepared) ===
  JSON.stringify(prepareKieGuideChatRequest(q, [publicSource])));
check("blank question refused", throws(() => prepareKieGuideChatRequest(" ", [publicSource])));
check("question over 500 refused", throws(() => prepareKieGuideChatRequest("x".repeat(501), [publicSource])));
check("question control characters refused", throws(() => prepareKieGuideChatRequest("hello\nworld", [publicSource])));
check("empty sources refused", throws(() => prepareKieGuideChatRequest(q, [])));
check("four sources refused", throws(() => prepareKieGuideChatRequest(q, [publicSource,publicSource,publicSource,publicSource])));
check("external source refused", throws(() => prepareKieGuideChatRequest(q,
  [{...publicSource, href: "https://hostile.invalid/doc"}])));
check("oversized evidence refused", throws(() => prepareKieGuideChatRequest(q,
  [{...publicSource, excerpt: "x".repeat(1351)}])));
check("malformed review date refused", throws(() => prepareKieGuideChatRequest(q,
  [{...publicSource, verifiedAt: "unknown"}])));
const good = {
  choices: [{ message: { role: "assistant", content: "Open Launch Control." }, finish_reason: "stop" }],
  usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 128 },
  credits_consumed: 0.005,
};
const ok = parseKieGuideChatResponse(200, good);
check("valid reply parsed and metering retained", ok.ok && ok.answer === "Open Launch Control." &&
  ok.promptTokens === 100 && ok.completionTokens === 20 && ok.totalTokens === 128 &&
  ok.creditsConsumed === 0.005);
check("HTTP error fails closed", !parseKieGuideChatResponse(429, good).ok);
check("HTTP 200 body error fails closed", !parseKieGuideChatResponse(200, {code: 401, msg: "denied"}).ok);
check("missing usage fails closed", !parseKieGuideChatResponse(200, {...good, usage: null}).ok);
check("missing provider credits fails closed", !parseKieGuideChatResponse(200, {...good, credits_consumed: undefined}).ok);
check("missing answer fails closed", !parseKieGuideChatResponse(200, {...good, choices: []}).ok);
check("unfinished answer fails closed", !parseKieGuideChatResponse(200, {
  ...good, choices: [{...good.choices[0],finish_reason: "length"}]
}).ok);
check("oversized answer fails closed", !parseKieGuideChatResponse(200, {
  ...good, choices: [{...good.choices[0],message:{role:"assistant",content:"x".repeat(4001)}}]
}).ok);
check("non-finite credit count fails closed", !parseKieGuideChatResponse(200, {
  ...good, credits_consumed: Infinity
}).ok);
const source = readFileSync("supabase/functions/_shared/cartel-guide-kie-chat-contract.ts", "utf8");
check("no provider network call", !/\bfetch\s*\(|\.functions\.invoke|XMLHttpRequest|sendBeacon/.test(source));
check("no credential retrieval or env access", !/Deno\.env|process\.env|KIE_API_KEY|localStorage|service_role/.test(source));
check("no source editing or DB writes", !/\.from\(|\.insert\(|\.update\(|\.delete\(|\.rpc\(/.test(source));
console.log(`G2C Kie chat source contract: ${pass} PASS, ${fail} FAIL; REAL API/BUILD NOT RUN`);
if (fail) process.exitCode = 1;
