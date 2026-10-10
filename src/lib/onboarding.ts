import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { getProjectProfile } from "@/lib/project-profile";
import { hasSchedule, listLaunches } from "@/lib/launch-control";
import { groupIsOperational } from "@/lib/launch-readiness";
import type { ProjectGoal } from "@/lib/workspace-goal";

/**
 * Guided first-run setup: four steps, about ten minutes.
 *
 * This is orchestration only — every step deep-links into the existing,
 * battle-tested screens (identity form, Telegram connect, launch control)
 * instead of reimplementing them. Completion is detected live from the same
 * read surfaces the dashboard uses, so the wizard can never disagree with
 * the rest of the app about what is done.
 */

export type OnboardingStepKey = "identity" | "community" | "launch" | "review";

export type OnboardingStepDef = {
  key: OnboardingStepKey;
  title: string;
  description: string;
  /** Where the step's work actually happens. */
  to: "/project-profile" | "/telegram" | "/launch-control" | "/dashboard";
  ctaLabel: string;
};

export const ONBOARDING_STEPS: OnboardingStepDef[] = [
  {
    key: "identity",
    title: "Project identity",
    description:
      "Name your project and set its ticker, chain and official links. This becomes the public profile that every launch feature builds on.",
    to: "/project-profile",
    ctaLabel: "Set up identity",
  },
  {
    key: "community",
    title: "Connect your community",
    description:
      "Add the Cartel HQ bot to your Telegram group and make it an admin. Welcome messages and Launch Watch invites switch on from there.",
    to: "/telegram",
    ctaLabel: "Connect Telegram",
  },
  {
    key: "launch",
    title: "Launch basics",
    description:
      "Create your launch and set its date or window. Countdowns and watcher reminders are armed from this alone — nothing else is required yet.",
    to: "/launch-control",
    ctaLabel: "Set up launch",
  },
  {
    key: "review",
    title: "Review & go live",
    description:
      "Check the summary below. Your project is ready to operate from the dashboard — the project journey keeps guiding whatever comes next.",
    to: "/dashboard",
    ctaLabel: "Open dashboard",
  },
];

export type OnboardingStepState = {
  key: OnboardingStepKey;
  complete: boolean;
  /** Short live detail, when one can be stated honestly. */
  detail: string | null;
};

export type OnboardingProgress = {
  /** Step definitions shown for the current goal, aligned with `steps`. */
  stepDefs: OnboardingStepDef[];
  steps: OnboardingStepState[];
  /** Index of the first incomplete working step, or the review step when done. */
  currentIndex: number;
  allComplete: boolean;
  isPending: boolean;
  isError: boolean;
};

type QueryLoadFlags = { isPending: boolean; isError: boolean };

/**
 * A disabled TanStack query with no data reports `isPending: true` forever.
 * The launches query is only enabled once a project profile exists, so it
 * must only count toward pending/error while it is actually enabled —
 * otherwise a first-run workspace without a profile never leaves loading.
 */
export function deriveOnboardingLoadState(input: {
  profile: QueryLoadFlags;
  groups: QueryLoadFlags;
  launches: QueryLoadFlags;
  launchesEnabled: boolean;
}): QueryLoadFlags {
  const { profile, groups, launches, launchesEnabled } = input;
  return {
    isPending:
      profile.isPending ||
      groups.isPending ||
      (launchesEnabled && launches.isPending),
    isError:
      profile.isError ||
      groups.isError ||
      (launchesEnabled && launches.isError),
  };
}

export function useOnboardingProgress(
  workspaceId: string | null | undefined,
  goal: ProjectGoal | null,
): OnboardingProgress {
  const profileQuery = useQuery({
    queryKey: ["onboarding-profile", workspaceId],
    enabled: !!workspaceId,
    queryFn: () => getProjectProfile(workspaceId!),
  });
  const profileId = profileQuery.data?.id ?? null;

  const groupsQuery = useQuery({
    queryKey: ["onboarding-groups", workspaceId],
    enabled: !!workspaceId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("telegram_group_connections")
        .select("id,bot_is_admin,metadata")
        .eq("workspace_id", workspaceId!);
      if (error) throw error;
      return data ?? [];
    },
  });

  const launchesQuery = useQuery({
    queryKey: ["onboarding-launches", workspaceId, profileId],
    enabled: !!workspaceId && !!profileId,
    queryFn: () => listLaunches(workspaceId!, profileId!),
  });

  const { isPending, isError } = deriveOnboardingLoadState({
    profile: profileQuery,
    groups: groupsQuery,
    launches: launchesQuery,
    launchesEnabled: !!workspaceId && !!profileId,
  });

  const profileName = profileQuery.data?.project_name?.trim() ?? "";
  const identityDone = profileName.length > 0;

  const groups = groupsQuery.data ?? [];
  const operationalCount = groups.filter((group) =>
    groupIsOperational({
      id: group.id,
      bot_is_admin: group.bot_is_admin,
      metadata: group.metadata,
    }),
  ).length;
  const communityDone = operationalCount > 0;

  const launches = launchesQuery.data ?? [];
  const launchDone = launches.some((launch) => hasSchedule(launch));

  const allSteps: OnboardingStepState[] = [
    {
      key: "identity",
      complete: identityDone,
      detail: identityDone ? profileName : null,
    },
    {
      key: "community",
      complete: communityDone,
      detail:
        groups.length === 0
          ? null
          : `${operationalCount} of ${groups.length} operational`,
    },
    {
      key: "launch",
      complete: launchDone,
      detail: launchDone
        ? "Schedule set"
        : launches.length > 0
          ? "Launch created · schedule missing"
          : null,
    },
    { key: "review", complete: false, detail: null },
  ];

  return { ...summarizeOnboardingSteps(allSteps, goal), isPending, isError };
}

/** Which guided steps a goal shows. NULL keeps the legacy four-step guide. */
export function onboardingStepKeysForGoal(goal: ProjectGoal | null): OnboardingStepKey[] {
  if (goal === "community") return ["identity", "community", "review"];
  if (goal === "launch") return ["identity", "launch", "review"];
  return ["identity", "community", "launch", "review"];
}

/** Pure: filters steps by goal and derives the current index / completion. */
export function summarizeOnboardingSteps(
  allSteps: OnboardingStepState[],
  goal: ProjectGoal | null,
): Omit<OnboardingProgress, "isPending" | "isError"> {
  const keys = onboardingStepKeysForGoal(goal);
  const stepDefs = keys.map((k) => ONBOARDING_STEPS.find((d) => d.key === k)!);
  const steps = keys.map((k) => allSteps.find((s) => s.key === k)!);
  const working = steps.filter((s) => s.key !== "review");
  const allComplete = working.every((s) => s.complete);
  const firstIncomplete = steps.findIndex((s) => s.key !== "review" && !s.complete);
  const currentIndex = allComplete ? steps.length - 1 : firstIncomplete === -1 ? 0 : firstIncomplete;
  return { stepDefs, steps, currentIndex, allComplete };
}
