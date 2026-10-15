import { readFileSync } from "node:fs";
import { canSeeGuidePreview, GUIDE_STATUS, submitGuideQuestion } from "../src/lib/cartel-guide-contract";

let pass = 0, fail = 0;
const t = (name: string, ok: boolean) => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"} ${name}`); };

t("owner confirmed -> visible", canSeeGuidePreview({ loading: false, error: null, isPlatformOwner: true }));
t("loading -> hidden", !canSeeGuidePreview({ loading: true, error: null, isPlatformOwner: true }));
t("error -> hidden", !canSeeGuidePreview({ loading: false, error: "x", isPlatformOwner: true }));
t("non-owner -> hidden", !canSeeGuidePreview({ loading: false, error: null, isPlatformOwner: false }));
t("status is disabled", GUIDE_STATUS === "disabled");
t("submit never dispatches", submitGuideQuestion("hello").dispatched === false);

const banned = /fetch\(|supabase|createServerFn|XMLHttpRequest|WebSocket|openai|anthropic|gemini|ai-gateway|pcart|axios/i;
for (const f of ["src/lib/cartel-guide-contract.ts", "src/components/cartel/CartelGuideShell.tsx"]) {
  t(`${f}: no network/backend/AI/pcart`, !banned.test(readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")));
}
const panel = readFileSync("src/components/cartel/SetupHelpPanel.tsx", "utf8");
t("panel lazy-loads shell", /lazy\(\(\) => import\("@\/components\/cartel\/CartelGuideShell"\)\)/.test(panel));
t("panel gates on platform access, not workspace owner", panel.includes("canSeeGuidePreview(platformAccess)") && !/showGuide\s*=.*isOwner/.test(panel));
t("panel has no static shell import", !/^import .*CartelGuideShell/m.test(panel));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
