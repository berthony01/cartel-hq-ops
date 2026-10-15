import { readFileSync } from "node:fs";
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

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
