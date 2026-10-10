import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { getProjectProfile } from "@/lib/project-profile";
import { hasSchedule, listLaunches } from "@/lib/launch-control";
import { groupIsOperational } from "@/lib/launch-readiness";

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
  steps: OnboardingStepState[];
  /** Index of the first incomplete working step, or the review step when done. */
  currentIndex: number;
  allComplete: boolean;
  isPending: boolean;
  isError: boolean;
};

export function useOnboardingProgress(
  workspaceId: string | null | undefined,
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

  const isPending =
    profileQuery.isPending || groupsQuery.isPending || launchesQuery.isPending;
  const isError =
    profileQuery.isError || groupsQuery.isError || launchesQuery.isError;

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

  const steps: OnboardingStepState[] = [
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

  const allComplete = identityDone && communityDone && launchDone;
  const firstIncomplete = steps.findIndex(
    (step) => step.key !== "review" && !step.complete,
  );
  const currentIndex = allComplete ? 3 : firstIncomplete === -1 ? 0 : firstIncomplete;

  return { steps, currentIndex, allComplete, isPending, isError };
}
