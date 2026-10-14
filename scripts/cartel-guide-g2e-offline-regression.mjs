/**
 * Cartel HQ G2E DRAFT integration offline checks.
 * Run from checked-out repo AFTER existing dependencies are installed:
 * node scripts/cartel-guide-g2e-offline-regression.mjs
 * NO database, browser, HTTP, Kie.ai call, CI runner or credit is required.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const get = (file) => readFileSync(file, "utf8");
const server = get("supabase/functions/cartel-guide/index.ts");
const frontend = get("src/components/cartel/GuideConversationPreview.tsx");
const panel = get("src/components/cartel/SetupHelpPanel.tsx");
const flag = get("src/lib/cartel-guide-ui-gate.ts");
const adapter = get("supabase/functions/_shared/cartel-guide-kie-chat-contract.ts");
const specs = get("docs/sql/G2D_CARTEL_GUIDE_PRO_100_WORKSPACE_POLICY_CANDIDATE.sql");
const failures = [];
let passed = 0;
function check(name, action) {
  try {
    assert.equal(action(), true);
    passed++;
  } catch (error) {
    failures.push(name + ": " + String(error));
  }
}
function before(a, b, source = server) {
  const x = source.indexOf(a);
  const y = source.indexOf(b);
  return x >= 0 && y >= 0 && x < y;
}

// Structural safety and order. Mutating a required gate must FAIL its check.
const enabledExpr = 'Deno.env.get("CARTEL_GUIDE_PAID_CALLS_ENABLED") !== "true"';
const reserved = 'admin.rpc(\n    "cartel_guide_reserve_budget"';
const provider = "await fetch(KIE_GUIDE_CHAT_ENDPOINT";
const marked = '"cartel_guide_mark_in_flight"';
const settled = '"cartel_guide_settle_budget"';
check("explicit paid-switch guard before budget", () => before(enabledExpr, reserved));
check("auth before separate paid switch", () => before("await evaluateGuideRequest(", enabledExpr));
check("reserve before marking", () => before(reserved, marked));
check("mark before provider", () => before(marked, provider));
check("provider before settlement", () => before(provider, settled));
check("budget quote provider pinned", () => server.includes('reserved.provider !== "kie.ai"') &&
  server.includes("reserved.model !== KIE_GUIDE_CHAT_MODEL"));
check("reject invalid input quote before provider", () =>
  before('reserved.max_input_tokens < inputBytes', provider));
check("question -> vetted docs before reserving", () =>
  before("findGuidePublicEvidence(question, 3)", reserved));
check("no private workspace fields sent to model", () =>
  !/prepared\s*=\s*prepareKieGuideChatRequest\(\s*JSON/.test(server) &&
  !server.includes("privateMessages") && !server.includes("telegram_messages"));
check("timeouts and never-retry behavior", () =>
  server.includes("AbortSignal.timeout(20_000)") &&
  !/while\s*\(|for\s*\(/.test(server.slice(server.indexOf(provider))));
check("failed provider settles conservative amount", () =>
  server.includes("_input_tokens: provider?.ok ? provider.promptTokens : null") &&
  server.includes("_output_tokens: provider?.ok ? provider.completionTokens : null"));
check("no source URL from client to model", () =>
  !frontend.includes("findGuidePublicEvidence") &&
  frontend.includes('supabase.functions.invoke("cartel-guide"'));
check("front end uses controlled workspace and session", () =>
  frontend.includes("useWorkspace()") && frontend.includes("useSession()"));
check("front end never includes API/service role key", () =>
  !/KIE_API_KEY|SERVICE_ROLE_KEY|SUPABASE_SERVICE_ROLE_KEY/.test(frontend));
check("citations internal-only", () =>
  frontend.includes("safeSources") && frontend.includes('^\\/docs\\?article'));
check("UI remains gated hard off", () =>
  flag.includes("CARTEL_GUIDE_PREVIEW_UI_ENABLED = false") &&
  panel.includes("CARTEL_GUIDE_PREVIEW_UI_ENABLED && workspaceId"));
check("candidate 100 shared count computed", () =>
  /COUNT\(\*\)\s+INTO v_workspace_month, v_workspace_requests/.test(specs) &&
  /v_workspace_requests\s*>=\s*v_cfg.customer_workspace_month_requests/.test(specs));
check("mutation: missing paid gate would be rejected", () =>
  !before(enabledExpr, reserved, server.replace(enabledExpr, "false")));
check("mutation: wrong request order would be rejected", () =>
  !before(reserved, marked, server.replace(reserved, "REMOVED_RESERVE_CALL")));

// Real source TypeScript transpile for syntax and Kie chat parser tests.
// Not a TypeScript typecheck, full frontend build or provider compatibility test.
const tsResult = ts.transpileModule(adapter, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  reportDiagnostics: true,
});
check("Kie TS transpilation diagnostics", () => (tsResult.diagnostics ?? [])
  .filter((d) => d.category === ts.DiagnosticCategory.Error).length === 0);
const isolated = { exports: {} };
vm.runInNewContext(tsResult.outputText, isolated, { timeout: 250 });
const { prepareKieGuideChatRequest, parseKieGuideChatResponse } = isolated.exports;

const doc = {
  title: "Connect Telegram",
  excerpt: "Connect your Telegram account first, then connect your group.",
  href: "/docs?article=connect-group",
  verifiedAt: "2026-09-30",
};
const prepared = prepareKieGuideChatRequest("How can I connect a Telegram group?", [doc]);
check("text-only chat request without tools", () =>
  prepared.body.stream === false && prepared.body.include_thoughts === false &&
  Object.keys(prepared.body).sort().join(",") === "include_thoughts,messages,stream" &&
  prepared.body.messages.length === 2);
check("local public grounding is present", () =>
  JSON.stringify(prepared.body).includes(doc.href));
check("external citation URL rejected", () => {
  try { prepareKieGuideChatRequest("Help me connect a Telegram group", [
    { ...doc, href: "https://evil.invalid/key" },
  ]); return false; } catch { return true; }
});
const response = {
  choices: [{ message: { role: "assistant", content: "Open Community Command Center." },
    finish_reason: "stop" }],
  usage: { prompt_tokens: 900, completion_tokens: 42, total_tokens: 980 },
  credits_consumed: 0.05,
};
const parsed = parseKieGuideChatResponse(200, response);
check("valid model answer with usage tracked", () =>
  parsed.ok === true && parsed.promptTokens === 900 && parsed.completionTokens === 42);
check("HTTP 200 provider error rejected", () =>
  parseKieGuideChatResponse(200, { code: 401, msg: "denied" }).ok === false);
check("missing Kie usage rejected", () =>
  parseKieGuideChatResponse(200, { ...response, credits_consumed: undefined }).ok === false);
check("truncated answer rejected", () =>
  parseKieGuideChatResponse(200, {
    ...response, choices: [{ ...response.choices[0], finish_reason: "length" }],
  }).ok === false);

console.log("Cartel HQ G2E offline:", passed, "PASS", failures.length, "FAIL");
if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
}
// NO paid model calls, production changes or automated deploys performed.
