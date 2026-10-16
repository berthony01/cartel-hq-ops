import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { canSeeGuidePreview, GUIDE_STATUS, submitGuideQuestion } from "../src/lib/cartel-guide-contract";

let pass = 0, fail = 0;
const t = (name: string, ok: boolean) => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"} ${name}`); };
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

// Owner gate (contract).
t("owner confirmed -> visible", canSeeGuidePreview({ loading: false, error: null, isPlatformOwner: true }));
t("loading -> hidden", !canSeeGuidePreview({ loading: true, error: null, isPlatformOwner: true }));
t("error -> hidden", !canSeeGuidePreview({ loading: false, error: "x", isPlatformOwner: true }));
t("non-owner -> hidden", !canSeeGuidePreview({ loading: false, error: null, isPlatformOwner: false }));
t("status is disabled", GUIDE_STATUS === "disabled");
t("submit never dispatches", submitGuideQuestion("hello").dispatched === false);

const banned = /fetch\(|supabase|createServerFn|XMLHttpRequest|WebSocket|openai|anthropic|gemini|kie\.ai|ai-gateway|pcart|axios/i;

// Contract stays fully offline.
t("contract: no network/backend/AI/pcart", !banned.test(strip(readFileSync("src/lib/cartel-guide-contract.ts", "utf8"))));

// Shell: hard-OFF switch and gated dormant path.
const shell = strip(readFileSync("src/components/cartel/CartelGuideShell.tsx", "utf8"));
t("shell: hard-OFF flag is literally false", /export const G2E_LIVE_ENABLED = false as boolean;/.test(shell));
t("shell: flag declared exactly once, never reassigned", (shell.match(/G2E_LIVE_ENABLED\s*=/g) ?? []).length === 1);
t("shell: no static backend client import", !/^import .*supabase/m.test(shell));
t("shell: no fetch/XHR/WebSocket/provider/pcart", !/fetch\(|XMLHttpRequest|WebSocket|openai|anthropic|gemini|kie\.ai|ai-gateway|pcart|axios|createServerFn/i.test(shell));
t("shell: no useEffect (nothing runs on load/reload)", !/useEffect/.test(shell));

const dispatch = shell.match(/async function dispatchGuideRequest[\s\S]*?\n}\n/)?.[0] ?? "";
t("shell: dispatch function exists", dispatch.length > 0);
const guardIdx = dispatch.indexOf('if (!G2E_LIVE_ENABLED) return');
const importIdx = dispatch.indexOf('import("@/integrations/supabase/client")');
t("shell: dispatch returns before importing client when OFF", guardIdx > 0 && importIdx > guardIdx);
const outside = shell.replace(dispatch, "");
t("shell: 'supabase' appears only inside guarded dispatch", !/supabase/i.test(outside));
t("shell: exactly one invoke, to cartel-guide", (shell.match(/\.invoke\(/g) ?? []).length === 1 && /invoke\("cartel-guide"/.test(dispatch));
t("shell: payload is only question/selectedWorkspaceId/requestId", /body: \{ question, selectedWorkspaceId, requestId: crypto\.randomUUID\(\) \}/.test(dispatch));
t("shell: no retry loop in dispatch", !/\b(for|while)\s*\(|retry/i.test(dispatch));
t("shell: answer bounded to 4000", /MAX_ANSWER_LENGTH = 4000/.test(shell));
t("shell: max 3 citations, /docs?article= only", /MAX_SOURCES = 3/.test(shell) && shell.includes("/^\\/docs\\?article=[a-z0-9-]{1,100}$/"));
t("shell: history bounded to 5", /MAX_TURNS = 5/.test(shell) && /\.slice\(-MAX_TURNS\)/.test(shell));
t("shell: no raw HTML rendering", !/dangerouslySetInnerHTML|innerHTML/.test(shell));
t("shell: no raw error text shown", !/error\.message|\.message\)/.test(shell));

const submit = shell.match(/async function onSubmit[\s\S]*?\n  }\n/)?.[0] ?? "";
const offIdx = submit.indexOf("if (!G2E_LIVE_ENABLED)");
const callIdx = submit.indexOf("dispatchGuideRequest(");
t("shell: submit short-circuits OFF before any dispatch", offIdx >= 0 && callIdx > offIdx && /submitGuideQuestion\(text\);\s*setNotice\(true\);\s*return;/.test(submit));
t("shell: submit fails closed without workspace/session or managed", /if \(busy \|\| !workspaceId \|\| !session \|\| isManaged\)/.test(submit));
t("shell: dispatch only called from submit", (shell.match(/dispatchGuideRequest\(/g) ?? []).length === 2);

// Panel gating unchanged.
const panel = readFileSync("src/components/cartel/SetupHelpPanel.tsx", "utf8");
t("panel lazy-loads shell", /lazy\(\(\) => import\("@\/components\/cartel\/CartelGuideShell"\)\)/.test(panel));
t("panel gates on platform access, not workspace owner", panel.includes("canSeeGuidePreview(platformAccess)") && !/showGuide\s*=.*isOwner/.test(panel));
t("panel has no static shell import", !/^import .*CartelGuideShell/m.test(panel));

// Runtime: dormant module never dispatches.
const mod = await import("../src/components/cartel/CartelGuideShell").catch(() => null);
if (mod) t("runtime: G2E_LIVE_ENABLED === false", mod.G2E_LIVE_ENABLED === false);

// Isolated rendering only: hypothetical ON is in memory, never in source or a live app.
// Mock all session/workspace/UI dependencies; the actual dispatch body stays hard OFF.
const rawShell = readFileSync("src/components/cartel/CartelGuideShell.tsx", "utf8");
const renderSource = rawShell
  .replace(/^import[\s\S]*?from "[^"]+";\n/gm, "")
  .replace("export const G2E_LIVE_ENABLED = false as boolean;", "const G2E_LIVE_ENABLED = enabled;")
  .replace("if (!G2E_LIVE_ENABLED) return { ok: false, code: \"GUIDE_NOT_ENABLED\" };", "return { ok: false, code: \"GUIDE_NOT_ENABLED\" };")
  .replace("export default function CartelGuideShell", "function CartelGuideShell");
const js = new Bun.Transpiler({ loader: "tsx", tsconfig: { compilerOptions: { jsx: "react", jsxFactory: "React.createElement" } } }).transformSync(renderSource);
type Fixture = { enabled: boolean; text?: string; session?: boolean; workspace?: boolean; managed?: boolean; busy?: boolean; message?: string };
function renderFixture(f: Fixture): string {
  let stateIndex = 0;
  const states = [f.text ?? "hello", false, [], f.message ?? "", f.busy ?? false];
  const control = (tag: string) => ({ children, ...props }: Record<string, unknown>) => React.createElement(tag, props, children as React.ReactNode);
  const icon = () => null;
  const make = new Function("React", "enabled", "useState", "useWorkspace", "useSession", "Button", "Textarea", "ArrowRight", "Bot", "Lock", "Send", "GUIDE_DISABLED_MESSAGE", "GUIDE_QUESTION_MAX_LENGTH", "GUIDE_SAMPLE_QUESTION", "submitGuideQuestion", `${js}\nreturn CartelGuideShell;`);
  const Component = make(React, f.enabled, () => [states[stateIndex++], () => {}],
    () => ({ workspaceId: f.workspace === false ? null : "test-workspace", isManaged: f.managed ?? false }),
    () => ({ session: f.session === false ? null : {} }), control("button"), control("textarea"), icon, icon, icon, icon,
    "Disabled preview fixture", 1000, "Example question", submitGuideQuestion);
  return renderToStaticMarkup(React.createElement(Component));
}
const offMarkup = renderFixture({ enabled: false, session: false, workspace: false, managed: true, text: "" });
const offCopy = ["Preview · Off", "Soon you&#x27;ll be able to ask", "Sending is off in preview", "Try an example (fills the box only)", "Type a question to preview the layout", "Nothing you type is sent anywhere."];
for (const copy of offCopy) t(`OFF render preserves: ${copy}`, offMarkup.includes(copy));
const onMarkup = renderFixture({ enabled: true });
for (const copy of offCopy) t(`hypothetical ON omits OFF copy: ${copy}`, !onMarkup.includes(copy));
t("hypothetical ON ready submit is enabled", !/<button[^>]*disabled/.test(onMarkup));
t("hypothetical ON shows Ask AI Guide", onMarkup.includes("Ask AI Guide"));
t("hypothetical ON explains public grounding, age and privacy", onMarkup.includes("public Help Center articles") && onMarkup.includes("out of date") && onMarkup.includes("Never include secrets"));
for (const [name, fixture, explanation] of [
  ["busy", { busy: true }, "Checking…"],
  ["no session", { session: false }, "Sign in"],
  ["no workspace", { workspace: false }, "Select a project"],
  ["managed", { managed: true }, "not available for managed projects"],
  ["short question", { text: " a " }, "at least 2 characters"],
] as const) {
  const markup = renderFixture({ enabled: true, ...fixture });
  t(`hypothetical ON ${name}: submit disabled with accessible explanation`, /<button[^>]*disabled/.test(markup) && markup.includes(explanation) && markup.includes('aria-describedby="cartel-guide-off"') && markup.includes('id="cartel-guide-off"'));
}
t("hypothetical ON safe error status is visible", renderFixture({ enabled: true, message: "The AI Guide is temporarily unavailable." }).includes("The AI Guide is temporarily unavailable."));
t("hypothetical ON success status is visible", renderFixture({ enabled: true, text: "", message: "Answer received." }).includes("Answer received."));
t("submit records success only after a valid answer", submit.indexOf('setMessage("Answer received.') > submit.indexOf("if (!r.ok)"));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
