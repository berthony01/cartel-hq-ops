import { deriveSetupHelp, goalNote, resolveArticleIds, shouldResetHelp, topicForPath, TOPIC_ARTICLES, type ProgressInput } from "../src/lib/setup-help";
import type { ProjectGoal } from "../src/lib/workspace-goal";
import docs from "../src/lib/docs-data";

let pass = 0, fail = 0;
const t = (name: string, ok: boolean) => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"} ${name}`); };

const DEFS = {
  identity: { key: "identity" as const, title: "Project identity", to: "/project-profile" as const, ctaLabel: "Set up identity" },
  community: { key: "community" as const, title: "Connect your community", to: "/telegram" as const, ctaLabel: "Connect Telegram" },
  launch: { key: "launch" as const, title: "Launch basics", to: "/launch-control" as const, ctaLabel: "Set up launch" },
  review: { key: "review" as const, title: "Review & go live", to: "/dashboard" as const, ctaLabel: "Open dashboard" },
};
const KEYS: Record<string, (keyof typeof DEFS)[]> = { community: ["identity", "community", "review"], launch: ["identity", "launch", "review"], both: ["identity", "community", "launch", "review"], null: ["identity", "community", "launch", "review"] };
function prog(goal: ProjectGoal | null, done: Partial<Record<string, boolean>>, extra: Partial<ProgressInput> = {}): ProgressInput {
  const keys = KEYS[String(goal)]!;
  const steps = keys.map((k) => ({ key: k, complete: k !== "review" && !!done[k] }));
  const working = steps.filter((s) => s.key !== "review");
  const allComplete = working.every((s) => s.complete);
  const fi = steps.findIndex((s) => s.key !== "review" && !s.complete);
  return { isPending: false, isError: false, stepDefs: keys.map((k) => DEFS[k]), steps, currentIndex: allComplete ? steps.length - 1 : fi, allComplete, ...extra };
}
const base = { workspaceId: "w1", goalStatus: "success" as const, requestedTopic: null, pathname: "/dashboard", isOwner: true };
const run = (goal: ProjectGoal | null, done = {}, o: Partial<Parameters<typeof deriveSetupHelp>[0]> = {}) => deriveSetupHelp({ ...base, goal, progress: prog(goal, done), ...o });

const c = run("community", { identity: true });
t("community: no launch step required", c.kind === "ready" && !c.steps.some((s) => s.key === "launch"));
t("community: next is community", c.kind === "ready" && c.nextStep?.key === "community");
const cl = run("community", { identity: true, community: true }, { pathname: "/launch-control" });
t("community + existing launch: launch help kept, marked optional", cl.kind === "ready" && cl.topic === "launch" && !cl.topicInGuide && TOPIC_ARTICLES.launch.length > 0);
t("community note keeps existing launch", goalNote("community", true).includes("stays in Launch Control"));
const l = run("launch", { identity: true });
t("launch: Telegram not required", l.kind === "ready" && !l.steps.some((s) => s.key === "community") && l.nextStep?.key === "launch");
const b = run("both", { identity: true, launch: true });
t("both: order identity,community,launch", b.kind === "ready" && b.steps.map((s) => s.key).join() === "identity,community,launch");
t("both: out-of-order next is community", b.kind === "ready" && b.nextStep?.key === "community");
const n = run(null, {});
t("null: legacy 3 working steps", n.kind === "ready" && n.steps.length === 3 && n.nextStep?.key === "identity");
t("goal change changes steps", run("community").kind === "ready" && (run("community") as any).steps.length !== (run("both") as any).steps.length);
const done = run("launch", { identity: true, launch: true });
t("all complete: no next step", done.kind === "ready" && done.allComplete && done.nextStep === null);
t("no workspace", deriveSetupHelp({ ...base, workspaceId: null, goal: null, progress: null }).kind === "no-workspace");
t("goal loading", deriveSetupHelp({ ...base, goalStatus: "pending", goal: null, progress: null }).kind === "loading");
t("progress loading", run("both", {}, { progress: prog("both", {}, { isPending: true }) }).kind === "loading");
t("goal error -> unavailable", deriveSetupHelp({ ...base, goalStatus: "error", goal: null, progress: null }).kind === "unavailable");
const err = run("both", { identity: true }, { progress: prog("both", { identity: true }, { isError: true }) });
t("progress error/unauthorized -> unavailable, nothing done", err.kind === "unavailable" && !("steps" in err));
t("missing step state never Done", (() => { const p = prog("both", {}); p.steps = []; const v = deriveSetupHelp({ ...base, goal: "both", progress: p }); return v.kind === "ready" && v.steps.every((s) => s.status === "todo"); })());
t("missing article id fails closed", resolveArticleIds(["first-session", "nope-x", "first-session"], (id) => docs.articles.some((a) => a.id === id)).join() === "first-session");
t("all mapped article ids exist", Object.values(TOPIC_ARTICLES).flat().every((id) => docs.articles.some((a) => a.id === id)));
t("route mapping", topicForPath("/project-profile") === "identity" && topicForPath("/telegram/") === "community" && topicForPath("/launch-control") === "launch" && topicForPath("/sticker-lab") === "general");
t("requested step overrides route", run("both", {}, { requestedTopic: "community", pathname: "/launch-control" }).kind === "ready" && (run("both", {}, { requestedTopic: "community" }) as any).topic === "community");
t("partner/non-owner: no owner choice offered", goalNote(null, false).includes("Only the project owner") && !goalNote(null, false).includes("You can choose"));
t("owner: can choose goal", goalNote(null, true).includes("You can choose"));
t("workspace switch resets", shouldResetHelp("w1", "w2") && shouldResetHelp("w1", null) && !shouldResetHelp("w1", "w1"));
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
