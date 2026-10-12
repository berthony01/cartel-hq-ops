import type { OnboardingStepDef, OnboardingStepKey } from "@/lib/onboarding";
import type { ProjectGoal } from "@/lib/workspace-goal";

/**
 * Setup Help (H1, deterministic): pure helpers only. No network, no model
 * calls. Maps the current page / selected guide step / project goal to
 * existing Help Center article IDs and an honest next step derived from the
 * existing onboarding progress. Never decides completion itself.
 */

export type HelpTopic = OnboardingStepKey | "general";

/** Fixed mapping to existing Help Center articles. Unknown IDs are dropped at render. */
export const TOPIC_ARTICLES: Record<HelpTopic, readonly string[]> = {
  general: ["first-session", "create-project", "troubleshoot-access"],
  identity: ["project-identity", "project-links", "publish-profile"],
  community: ["connect-telegram-account", "connect-group", "bot-permissions", "welcome-message"],
  launch: ["create-launch", "launch-schedule", "share-watchlist"],
  review: ["first-session", "manage-communities"],
};

/** Which topic a signed-in page belongs to. Anything unknown is general help. */
export function topicForPath(pathname: string): HelpTopic {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === "/project-profile") return "identity";
  if (path === "/telegram") return "community";
  if (path === "/launch-control") return "launch";
  return "general";
}

/** Fail closed: keep only article IDs that actually exist, in mapping order, de-duplicated. */
export function resolveArticleIds(ids: readonly string[], exists: (id: string) => boolean): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (!seen.has(id) && exists(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

export function goalNote(goal: ProjectGoal | null, isOwner: boolean): string {
  if (goal === "community")
    return "Goal: Manage My Community. Launch steps are not required. Any launch you already created stays in Launch Control.";
  if (goal === "launch")
    return "Goal: Prepare a Token Launch. A Telegram community is suggested, not required.";
  if (goal === "both")
    return "Goal: Both. Project identity first, then your Telegram community, then launch basics.";
  return isOwner
    ? "No goal chosen yet, so the standard guide is shown. You can choose a goal in Guided setup."
    : "No goal chosen yet, so the standard guide is shown. Only the project owner can choose a goal.";
}

export type HelpStepView = {
  key: OnboardingStepKey;
  title: string;
  status: "done" | "todo";
};

export type HelpNextStep = { key: OnboardingStepKey; title: string; to: OnboardingStepDef["to"]; ctaLabel: string };

export type ProgressInput = {
  isPending: boolean;
  isError: boolean;
  stepDefs: { key: OnboardingStepKey; title: string; to: OnboardingStepDef["to"]; ctaLabel: string }[];
  steps: { key: OnboardingStepKey; complete: boolean }[];
  currentIndex: number;
  allComplete: boolean;
};

export type SetupHelpView =
  | { kind: "no-workspace" }
  | { kind: "loading" }
  | { kind: "unavailable"; topic: HelpTopic }
  | {
      kind: "ready";
      topic: HelpTopic;
      /** False when the topic's step is not part of this goal's guide (shown as optional). */
      topicInGuide: boolean;
      note: string;
      steps: HelpStepView[];
      nextStep: HelpNextStep | null;
      allComplete: boolean;
    };

export function deriveSetupHelp(input: {
  workspaceId: string | null;
  goalStatus: "pending" | "error" | "success";
  goal: ProjectGoal | null;
  progress: ProgressInput | null;
  requestedTopic: HelpTopic | null;
  pathname: string;
  isOwner: boolean;
}): SetupHelpView {
  if (!input.workspaceId) return { kind: "no-workspace" };
  const topic = input.requestedTopic ?? topicForPath(input.pathname);
  if (input.goalStatus === "error") return { kind: "unavailable", topic };
  if (input.goalStatus === "pending" || !input.progress || input.progress.isPending)
    return { kind: "loading" };
  const p = input.progress;
  if (p.isError) return { kind: "unavailable", topic };

  const steps: HelpStepView[] = p.stepDefs
    .map((def, i) => ({ def, state: p.steps[i] }))
    .filter(({ def }) => def.key !== "review")
    .map(({ def, state }) => ({
      key: def.key,
      title: def.title,
      status: state?.complete === true ? "done" : "todo",
    }));

  const current = p.allComplete ? null : p.stepDefs[p.currentIndex];
  const nextStep =
    current && current.key !== "review"
      ? { key: current.key, title: current.title, to: current.to, ctaLabel: current.ctaLabel }
      : null;

  const topicInGuide = topic === "general" || p.stepDefs.some((d) => d.key === topic);

  return {
    kind: "ready",
    topic,
    topicInGuide,
    note: goalNote(input.goal, input.isOwner),
    steps,
    nextStep,
    allComplete: p.allComplete,
  };
}

/** Help context never survives a project switch. */
export function shouldResetHelp(prevWorkspaceId: string | null, nextWorkspaceId: string | null): boolean {
  return prevWorkspaceId !== nextWorkspaceId;
}
