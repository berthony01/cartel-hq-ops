/**
 * G2B.1 — static fail-closed UI boundary assertions.
 * Run: bun scripts/cartel-guide-g2b1-panel-regression.ts
 * Does not replace a real TypeScript/Vite build or authenticated UI test.
 */
import { readFileSync } from "node:fs";

const root = "src/components/cartel/";
const gate = readFileSync("src/lib/cartel-guide-ui-gate.ts", "utf8");
const ui = readFileSync(root + "GuideConversationPreview.tsx", "utf8");
const panel = readFileSync(root + "SetupHelpPanel.tsx", "utf8");
const shell = readFileSync(root + "SetupHelp.tsx", "utf8");
const corpus = readFileSync("supabase/functions/_shared/cartel-guide-public-knowledge.ts", "utf8");
let passed = 0, failed = 0;
function check(name: string, ok: boolean) {
  if (ok) passed++; else { failed++; console.error("FAIL", name); }
}
check("preview is unconditionally hard OFF", /export const CARTEL_GUIDE_PREVIEW_UI_ENABLED = false;/.test(gate));
check("gate ignores env and query strings", !/import\.meta\.env|location\.search|localStorage|process\.env/.test(gate));
check("single existing Setup Help host", panel.includes('import { CARTEL_GUIDE_PREVIEW_UI_ENABLED }') && panel.includes('GuideConversationPreview'));
check("host checks locked gate", panel.includes("CARTEL_GUIDE_PREVIEW_UI_ENABLED && workspaceId && user"));
check("host denies managed-only access", panel.includes('workspace?.access !== "managed"'));
check("host only shows when ready", panel.includes('view.kind === "ready"'));
check("host key resets per workspace", panel.includes("<GuideConversationPreview key={workspaceId}"));
check("shared Help Sheet unchanged focus restoration", shell.includes("trigger.focus({ preventScroll: true })"));
check("shared Help Sheet resets after switch", shell.includes("shouldResetHelp(lastWorkspace.current, workspaceId)"));
check("shared Help Sheet unmounts content on close", shell.includes("{open ? ("));
check("existing next step preserved", panel.includes("view.nextStep"));
check("existing topic articles preserved", panel.includes("TOPIC_ARTICLES[effectiveTopic]"));
check("existing search preserved", panel.includes('aria-label="Search the Help Center"'));
check("existing reviewed date preserved", panel.includes("docs.verifiedAt"));
check("no HTTP/AI provider calls in preview", !/\bfetch\s*\(|\.functions\.invoke|XMLHttpRequest|sendBeacon|\bsupabase\./.test(ui));
check("no browser persistence", !/\blocalStorage\b|\bsessionStorage\b|\bindexedDB\b/.test(ui));
check("no model generated answer claim", ui.includes("not an AI answer") && ui.includes("does not generate"));
check("local docs corpus only", ui.includes("findGuidePublicEvidence"));
check("renders canonical source href", ui.includes('href={source.href}'));
check("links protect external window handle", ui.includes('rel="noopener noreferrer"'));
check("text is React escaped, never injected HTML", !ui.includes("dangerouslySetInnerHTML"));
check("preview input bounded to 500", ui.includes("MAX_QUESTION_LENGTH = 500") && ui.includes("maxLength={MAX_QUESTION_LENGTH}"));
check("preview transcript bounded to 5", ui.includes("MAX_TURNS = 5") && ui.includes(".slice(-MAX_TURNS)"));
check("question clear button exists", ui.includes('aria-label="Clear preview questions"'));
check("a11y live reference announcements", ui.includes('role="log"') && ui.includes('aria-live="polite"'));
check("reasonable mobile touch size", ui.includes("min-h-11"));
check("sensitive data not in public source", !/SUPABASE_SERVICE_ROLE_KEY|OPENAI_API_KEY|\btelegram_user_id\b|auth\.users/.test(corpus));
check("no server flags changed by UI work", !panel.includes("CARTEL_GUIDE_ENABLED"));
console.log(`G2B.1 preview UI static gates: ${passed} PASS, ${failed} FAIL; TypeScript/build/browser QA NOT RUN`);
if (failed) process.exitCode = 1;
