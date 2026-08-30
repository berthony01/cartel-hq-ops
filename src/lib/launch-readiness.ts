import { supabase } from "@/integrations/supabase/client";
import {
  LAUNCH_STATUSES,
  toLaunchStatus,
  type LaunchStatus,
} from "@/lib/launch-control";
import type { TelegramGroupConnectionMetadata } from "@/lib/telegram-group";

/**
 * Phase 5.5 — Guided setup / launch readiness.
 *
 * A single derived read-only model. It creates NO state of its own: every
 * step is computed from authoritative rows the operator can already see
 * through existing RLS (project profile, launches, connected communities and
 * their welcome settings). Nothing about onboarding progress is persisted.
 *
 * Never queries Launch Watch subscriptions or Telegram user identities.
 */

export const READINESS_STEP_KEYS = [
  "project_profile",
  "profile_published",
  "launch_created",
  "launch_announced",
  "launch_watch_open",
  "telegram_community",
  "launch_welcome",
] as const;

export type ReadinessStepKey = (typeof READINESS_STEP_KEYS)[number];

export type ReadinessRoute = "/project-profile" | "/launch-control" | "/telegram";

export type ReadinessStep = {
  key: ReadinessStepKey;
  /** 1-based recommended order. */
  order: number;
  title: string;
  /** What the step means, in plain language. */
  description: string;
  complete: boolean;
  /** Where the operator goes to work on this step. */
  to: ReadinessRoute;
  /** Button label used when this step is the next action. */
  actionLabel: string;
};

export type ReadinessNextAction = {
  step: ReadinessStep | null;
  label: string;
  to: ReadinessRoute;
  /** One-line "Next: …" sentence for the operator. */
  headline: string;
  explanation: string;
};

export type LaunchReadiness = {
  steps: ReadinessStep[];
  completedCount: number;
  totalCount: number;
  allComplete: boolean;
  nextAction: ReadinessNextAction;
  /** Deterministically chosen launch the guidance talks about. */
  primaryLaunchId: string | null;
  primaryLaunchName: string | null;
  primaryLaunchStatus: LaunchStatus | null;
  projectName: string | null;
  profileExists: boolean;
  profilePublished: boolean;
  operationalGroupCount: number;
};

// ---------------------------------------------------------------------------
// Raw shapes (minimal projections)
// ---------------------------------------------------------------------------

export type ReadinessProfileRow = {
  id: string;
  project_name: string;
  discovery_status: string;
};

export type ReadinessLaunchRow = {
  id: string;
  token_name: string;
  status: string;
  announced_at: string | null;
  watchlist_opened_at: string | null;
  launch_watch_token: string | null;
  created_at: string;
  updated_at: string | null;
};

export type ReadinessGroupRow = {
  id: string;
  bot_is_admin: boolean | null;
  metadata: unknown;
};

export type ReadinessSettingsRow = {
  group_connection_id: string;
  welcome_enabled: boolean | null;
  launch_watch_cta_enabled: boolean | null;
  launch_watch_launch_id: string | null;
};

export type ReadinessInput = {
  profile: ReadinessProfileRow | null;
  launches: ReadinessLaunchRow[];
  groups: ReadinessGroupRow[];
  settings: ReadinessSettingsRow[];
};

// ---------------------------------------------------------------------------
// Pure derivation
// ---------------------------------------------------------------------------

function timeOf(row: ReadinessLaunchRow): number {
  const value = row.updated_at ?? row.created_at;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/** Newest non-COMPLETED launch, otherwise newest launch. Deterministic. */
export function selectPrimaryLaunch(launches: ReadinessLaunchRow[]): ReadinessLaunchRow | null {
  if (launches.length === 0) return null;
  const byNewest = [...launches].sort((a, b) => {
    const diff = timeOf(b) - timeOf(a);
    return diff !== 0 ? diff : a.id.localeCompare(b.id);
  });
  return byNewest.find((l) => toLaunchStatus(l.status) !== "COMPLETED") ?? byNewest[0]!;
}

function statusIndex(status: LaunchStatus): number {
  return LAUNCH_STATUSES.indexOf(status);
}

/** True once the lifecycle has moved past DRAFT, or the timestamp is recorded. */
export function launchIsAnnounced(row: ReadinessLaunchRow): boolean {
  const status = toLaunchStatus(row.status);
  return Boolean(row.announced_at) || statusIndex(status) > statusIndex("DRAFT");
}

/** True once Watchlist Open has been passed, historically or currently. */
export function launchWatchIsOpen(row: ReadinessLaunchRow): boolean {
  const status = toLaunchStatus(row.status);
  return (
    Boolean(row.watchlist_opened_at) ||
    Boolean(row.launch_watch_token) ||
    statusIndex(status) >= statusIndex("WATCHLIST_OPEN")
  );
}

/**
 * A community counts as operational from stored state only — no live Telegram
 * calls. The bot must be admin, and metadata must not explicitly record that
 * it lost info permission or was removed.
 */
export function groupIsOperational(row: ReadinessGroupRow): boolean {
  if (row.bot_is_admin !== true) return false;
  const meta = (row.metadata ?? null) as TelegramGroupConnectionMetadata | null;
  if (!meta || typeof meta !== "object") return true;
  if (meta.bot_can_change_info === false) return false;
  if (meta.bot_removed_at) return false;
  return true;
}

const STEP_COPY: Record<
  ReadinessStepKey,
  { title: string; description: string; to: ReadinessRoute; actionLabel: string }
> = {
  project_profile: {
    title: "Project Profile",
    description: "Create the project identity for this workspace.",
    to: "/project-profile",
    actionLabel: "Create Project Profile",
  },
  profile_published: {
    title: "Profile published",
    description:
      "Mark the profile Published so it can be used by Cartel HQ launch features. This does not create a public webpage.",
    to: "/project-profile",
    actionLabel: "Publish Project Profile",
  },
  launch_created: {
    title: "Launch created",
    description: "Add the launch you want people to follow.",
    to: "/launch-control",
    actionLabel: "Create Your Launch",
  },
  launch_announced: {
    title: "Launch announced",
    description: "Move the launch out of Draft so it becomes a real, locked launch record.",
    to: "/launch-control",
    actionLabel: "Announce Your Launch",
  },
  launch_watch_open: {
    title: "Launch Watch open",
    description: "Open Launch Watch so people can opt in for private launch alerts.",
    to: "/launch-control",
    actionLabel: "Open Launch Watch",
  },
  telegram_community: {
    title: "Telegram community ready",
    description: "Connect a Telegram community with the bot as admin.",
    to: "/telegram",
    actionLabel: "Connect Telegram Community",
  },
  launch_welcome: {
    title: "Launch Watch in welcome",
    description:
      "Turn on the community welcome and add the separate Launch Watch card for this launch.",
    to: "/telegram",
    actionLabel: "Add Launch Watch to Welcome",
  },
};

const NEXT_EXPLANATION: Record<ReadinessStepKey, string> = {
  project_profile:
    "Start here. Your Project Profile is the identity every other Cartel HQ feature builds on.",
  profile_published:
    "Publishing makes the profile discoverable on the Cartel Network and ready for Cartel HQ launch features.",
  launch_created: "Create your launch record so you can announce it and open Launch Watch.",
  launch_announced: "Announcing locks the launch identity and starts the lifecycle.",
  launch_watch_open:
    "Open Launch Watch so people can opt in for private launch alerts through the Telegram bot.",
  telegram_community:
    "Connect a Telegram community and make the bot an admin so it can welcome new members.",
  launch_welcome:
    "Open Welcome & onboarding on a connected community and enable the separate Launch Watch card for this launch.",
};

export function computeLaunchReadiness(input: ReadinessInput): LaunchReadiness {
  const profile = input.profile;
  const profileExists = !!profile;
  const profilePublished = profile?.discovery_status === "published";

  const launches = profile
    ? input.launches
    : []; // launches always belong to a profile; without one nothing counts
  const primary = selectPrimaryLaunch(launches);

  const operationalGroups = input.groups.filter(groupIsOperational);
  const operationalIds = new Set(operationalGroups.map((g) => g.id));

  const welcomeReady =
    !!primary &&
    input.settings.some(
      (s) =>
        operationalIds.has(s.group_connection_id) &&
        s.welcome_enabled === true &&
        s.launch_watch_cta_enabled === true &&
        s.launch_watch_launch_id === primary.id,
    );

  const complete: Record<ReadinessStepKey, boolean> = {
    project_profile: profileExists,
    profile_published: profilePublished,
    launch_created: !!primary,
    launch_announced: !!primary && launchIsAnnounced(primary),
    launch_watch_open: !!primary && launchWatchIsOpen(primary),
    telegram_community: operationalGroups.length > 0,
    launch_welcome: welcomeReady,
  };

  const steps: ReadinessStep[] = READINESS_STEP_KEYS.map((key, index) => ({
    key,
    order: index + 1,
    ...STEP_COPY[key],
    complete: complete[key],
  }));

  const nextStep = steps.find((s) => !s.complete) ?? null;
  const completedCount = steps.filter((s) => s.complete).length;

  const nextAction: ReadinessNextAction = nextStep
    ? {
        step: nextStep,
        label: nextStep.actionLabel,
        to: nextStep.to,
        headline: `Next: ${nextStep.actionLabel}.`,
        explanation: NEXT_EXPLANATION[nextStep.key],
      }
    : {
        step: null,
        label: "Review Launch Control",
        to: "/launch-control",
        headline: "Launch foundation ready",
        explanation:
          "Your project, launch, Launch Watch and community welcome are all set up, and your project is discoverable on the Cartel Network.",
      };

  return {
    steps,
    completedCount,
    totalCount: steps.length,
    allComplete: completedCount === steps.length,
    nextAction,
    primaryLaunchId: primary?.id ?? null,
    primaryLaunchName: primary?.token_name ?? null,
    primaryLaunchStatus: primary ? toLaunchStatus(primary.status) : null,
    projectName: profile?.project_name ?? null,
    profileExists,
    profilePublished,
    operationalGroupCount: operationalGroups.length,
  };
}

// ---------------------------------------------------------------------------
// Query
// ---------------------------------------------------------------------------

export function launchReadinessQueryKey(workspaceId: string | null | undefined) {
  return ["launch-readiness", workspaceId ?? null] as const;
}

export async function fetchLaunchReadiness(workspaceId: string): Promise<LaunchReadiness> {
  const profileResult = await supabase
    .from("project_profiles")
    .select("id,project_name,discovery_status")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (profileResult.error) throw profileResult.error;
  const profile = (profileResult.data as ReadinessProfileRow | null) ?? null;

  const [launchesResult, groupsResult, settingsResult] = await Promise.all([
    profile
      ? supabase
          .from("launches")
          .select(
            "id,token_name,status,announced_at,watchlist_opened_at,launch_watch_token,created_at,updated_at",
          )
          .eq("workspace_id", workspaceId)
          .eq("project_profile_id", profile.id)
      : Promise.resolve({ data: [], error: null } as const),
    supabase
      .from("telegram_group_connections")
      .select("id,bot_is_admin,metadata")
      .eq("workspace_id", workspaceId),
    supabase
      .from("telegram_community_settings")
      .select(
        "group_connection_id,welcome_enabled,launch_watch_cta_enabled,launch_watch_launch_id",
      )
      .eq("workspace_id", workspaceId),
  ]);

  if (launchesResult.error) throw launchesResult.error;
  if (groupsResult.error) throw groupsResult.error;
  if (settingsResult.error) throw settingsResult.error;

  return computeLaunchReadiness({
    profile,
    launches: (launchesResult.data ?? []) as ReadinessLaunchRow[],
    groups: (groupsResult.data ?? []) as ReadinessGroupRow[],
    settings: (settingsResult.data ?? []) as ReadinessSettingsRow[],
  });
}
