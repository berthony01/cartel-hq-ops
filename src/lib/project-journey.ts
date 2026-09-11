import {
  fetchLaunchReadiness,
  type LaunchReadiness,
} from "@/lib/launch-readiness";
import {
  listLaunches,
  getLaunchWatchSummary,
  hasSchedule,
  isProjectLaunch,
  toLaunchStatus,
  launchStatusIndex,
  type LaunchRow,
} from "@/lib/launch-control";

import { listChainDeployments } from "@/lib/chain-launcher";
import {
  evaluateLaunchDeploymentEvidence,
  type LaunchEvidenceEvaluation,
} from "@/lib/launch-verified-eligibility";
import { evaluateProductionFinality } from "@/lib/launch-production-finality";
import { getLaunchProductionDeploymentRequest } from "@/lib/launch-production-request";
import type { DeploymentEvidenceInput } from "@/lib/launch-evidence-checks";
import { supabase } from "@/integrations/supabase/client";
import { listWorkspaceAssets } from "@/lib/media";
import { listWorkspacePacks } from "@/lib/sticker-packs";
import { getProjectInboxSettings, getProjectInboxSummary } from "@/lib/project-inbox";

/**
 * P1-A — one unified, read-only project journey model.
 *
 * This creates NO state of its own and persists nothing. Every stage is
 * derived from authoritative rows the operator can already read through
 * existing RLS surfaces, reusing the existing readiness derivation, the
 * existing launch reads, the existing Launch Watch summary RPC and the
 * existing deployment-evidence evaluator.
 *
 * Rules that must not be weakened:
 *  - Never treat testnet or historical rows as current mainnet readiness.
 *  - Never guess: an unreadable input becomes `unavailable`, never `complete`.
 *  - Never expose watcher identities — aggregate counts only.
 */

export type JourneyRoute =
  | "/project-profile"
  | "/launch-control"
  | "/telegram"
  | "/distribution"
  | "/sticker-lab"
  | "/brand-kit"
  | "/assets";

export const JOURNEY_STAGE_KEYS = [
  "project_profile",
  "profile_published",
  "brand_kit",
  "creative_assets",
  "sticker_pack",
  "launch_created",
  "launch_announced",
  "launch_schedule",
  "launch_watch_open",
  "telegram_community",
  "launch_welcome",
  "audience",
  "communications",
  "deployment",
  "official_contract",
  "launch_live",
] as const;

export type JourneyStageKey = (typeof JOURNEY_STAGE_KEYS)[number];

export type JourneyStageStatus = "complete" | "action" | "waiting" | "unavailable";

export type JourneyPhase =
  | "Identity"
  | "Brand & Creative"
  | "Launch"
  | "Audience"
  | "Contract";


export type JourneyStage = {
  key: JourneyStageKey;
  order: number;
  phase: JourneyPhase;
  title: string;
  description: string;
  status: JourneyStageStatus;
  /** Only actionable stages can become the next action. */
  actionable: boolean;
  to: JourneyRoute;
  actionLabel: string;
  /** Short live detail, when one can be stated honestly. */
  detail: string | null;
  /**
   * Pure display metadata. None of these fields participate in status
   * derivation, prerequisites, actionability or routing — they only give the
   * renderer truthful wording for locked/dependent stages.
   */
  reviewLabel?: string;
  lockedLabel?: string;
  dependency?: string;
};

export type JourneyNextAction = {
  stage: JourneyStage | null;
  label: string;
  to: JourneyRoute;
  headline: string;
  explanation: string;
};

export type ProjectJourney = {
  stages: JourneyStage[];
  completedCount: number;
  totalCount: number;
  allComplete: boolean;
  nextAction: JourneyNextAction;
  projectName: string | null;
  primaryLaunchId: string | null;
  primaryLaunchName: string | null;
  readiness: LaunchReadiness;
};

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export type JourneyLaunchFacts = {
  id: string;
  status: string;
  scheduleSet: boolean;
  officialContractAddress: string | null;
  officialContractDeploymentId: string | null;
  contractRegisteredAt: string | null;
};

export type JourneyDeploymentEvidenceFacts = {
  productionDeploymentCount: number;
  verifiedProductionCount: number;
  managedFinalizedVerifiedCount: number;
  deploymentAmbiguous: boolean;
  registrationEligibleCount: number;
  registrationAmbiguous: boolean;
};

/** Brand Kit facts. `null` means "no row"; unavailable is tracked separately. */
export type JourneyBrandKitFacts = {
  /** The Brand Kit UI treats brand name as the one required core field. */
  brandName: string | null;
};

/**
 * Launcher-B2 — the latest production deployment handoff request for the
 * primary PROJECT launch. Read-only fact; the database stays authoritative and
 * `effectiveStatus === "COMPLETED"` is derived server-side from evidence.
 */
export type JourneyProductionRequestFacts = {
  status: string;
  effectiveStatus: string;
};

export type JourneyCreativeAssetFacts = {
  /** logo / mascot / reference_image — real brand identity assets. */
  brandAssetCount: number;
  /** Generated stickers are detail only; they never prove brand setup. */
  generatedStickerCount: number;
  otherAssetCount: number;
};

export type JourneyStickerPackFacts = {
  /** Active (non-archived) packs only. */
  activeCount: number;
  publishedCount: number;
};

export type JourneyInboxFacts = {
  repliesEnabled: boolean;
  newConversationsEnabled: boolean;
  /** Aggregate only — never member identities. */
  waitingOnTeamCount: number | null;
};

export type JourneyInput = {
  readiness: LaunchReadiness;
  launch: JourneyLaunchFacts | null;
  /** Aggregate Launch Watch counts, or null when not readable / not opened. */
  activeWatchers: number | null;
  watchUnavailable: boolean;
  /** Read-only evidence summary for the primary launch only. */
  deploymentEvidence: JourneyDeploymentEvidenceFacts | null;
  deploymentUnavailable: boolean;
  /** Latest handoff request for the primary PROJECT launch, when readable. */
  productionRequest: JourneyProductionRequestFacts | null;
  productionRequestUnavailable: boolean;
  brandKit: JourneyBrandKitFacts | null;
  brandKitUnavailable: boolean;
  creativeAssets: JourneyCreativeAssetFacts | null;
  creativeAssetsUnavailable: boolean;
  stickerPacks: JourneyStickerPackFacts | null;
  stickerPacksUnavailable: boolean;
  inbox: JourneyInboxFacts | null;
  inboxUnavailable: boolean;
};


// ---------------------------------------------------------------------------
// Pure derivation
// ---------------------------------------------------------------------------

const STAGE_COPY: Record<
  JourneyStageKey,
  {
    phase: JourneyPhase;
    title: string;
    description: string;
    to: JourneyRoute;
    actionLabel: string;
    explanation: string;
    /** Display-only wording used when the stage is not yet available. */
    reviewLabel?: string;
    lockedLabel?: string;
    dependency?: string;
  }
> = {
  project_profile: {
    phase: "Identity",
    title: "Project Profile",
    description: "Create the project identity for this workspace.",
    to: "/project-profile",
    actionLabel: "Create Project Profile",
    explanation:
      "Start here. Your Project Profile is the identity every other Cartel HQ feature builds on.",
  },
  profile_published: {
    phase: "Identity",
    title: "Profile published",
    description: "Publish the profile so Cartel HQ launch features can use it.",
    to: "/project-profile",
    actionLabel: "Publish Project Profile",
    explanation:
      "Publishing makes the profile discoverable on the Cartel Network and ready for launch features.",
  },
  brand_kit: {
    phase: "Brand & Creative",
    title: "Brand Kit set up",
    description: "Save the Brand Kit so every creative surface uses one identity.",
    to: "/brand-kit",
    actionLabel: "Set up Brand Kit",
    explanation:
      "Your Brand Kit holds the brand name, look and language reused across creative and community surfaces.",
  },
  creative_assets: {
    phase: "Brand & Creative",
    title: "Creative assets uploaded",
    description: "Add a logo, mascot or reference image for this project.",
    to: "/assets",
    actionLabel: "Upload Creative Assets",
    explanation:
      "Upload a logo, mascot or reference image so creative work has real source material to build from.",
  },
  sticker_pack: {
    phase: "Brand & Creative",
    title: "Sticker pack published",
    description: "Build and publish a sticker pack for your community.",
    to: "/sticker-lab",
    actionLabel: "Create a Sticker Pack",
    explanation:
      "Sticker Lab turns your brand assets into a pack you can publish and distribute to the community.",
  },

  launch_created: {
    phase: "Launch",
    title: "Launch created",
    description: "Add the launch you want people to follow.",
    to: "/launch-control",
    actionLabel: "Create Your Launch",
    explanation: "Create your launch record so you can announce it and open Launch Watch.",
  },
  launch_announced: {
    phase: "Launch",
    title: "Launch announced",
    description: "Move the launch out of Draft so it becomes a locked launch record.",
    to: "/launch-control",
    actionLabel: "Announce Your Launch",
    explanation: "Announcing locks the launch identity and starts the lifecycle.",
  },
  launch_schedule: {
    phase: "Launch",
    title: "Launch schedule set",
    description: "Set the launch time or launch window so countdowns and reminders work.",
    to: "/launch-control",
    actionLabel: "Set Launch Schedule",
    explanation:
      "A launch time or window is required before the launch can advance to Launch Approaching.",
  },
  launch_watch_open: {
    phase: "Audience",
    title: "Launch Watch open",
    description: "Open Launch Watch so people can opt in for private launch alerts.",
    to: "/launch-control",
    actionLabel: "Open Launch Watch",
    explanation:
      "Open Launch Watch so people can opt in for private launch alerts through the Telegram bot.",
  },
  telegram_community: {
    phase: "Audience",
    title: "Telegram community ready",
    description: "Connect a Telegram community with the bot as admin.",
    to: "/telegram",
    actionLabel: "Connect Telegram Community",
    explanation:
      "Connect a Telegram community and make the bot an admin so it can welcome new members.",
  },
  launch_welcome: {
    phase: "Audience",
    title: "Launch Watch in welcome",
    description: "Add the separate Launch Watch card to your community welcome.",
    to: "/telegram",
    actionLabel: "Add Launch Watch to Welcome",
    explanation:
      "Open Welcome & onboarding on a connected community and enable the Launch Watch card for this launch.",
  },
  audience: {
    phase: "Audience",
    title: "Watchers joined",
    description: "At least one person is watching this launch.",
    to: "/launch-control",
    actionLabel: "Share Launch Watch link",
    explanation:
      "Share the Launch Watch deep link so people can opt in before the launch goes live.",
  },
  communications: {
    phase: "Audience",
    title: "Project inbox open",
    description: "Let community members reach the team through the project inbox.",
    to: "/telegram",
    actionLabel: "Open Project Inbox",
    explanation:
      "Turn on replies and new conversations so members can contact the team privately through the project inbox.",
  },

  deployment: {
    phase: "Contract",
    title: "Mainnet deployment verified",
    description: "A production deployment for this launch has passed on-chain verification.",
    to: "/launch-control",
    actionLabel: "Review deployment evidence",
    explanation: "",
  },
  official_contract: {
    phase: "Contract",
    title: "Official contract registered",
    description: "Register the official contract address from verified deployment evidence.",
    to: "/launch-control",
    actionLabel: "Register Official Contract",
    explanation:
      "Registering publishes the official contract address supplied by the authenticated project.",
  },
  launch_live: {
    phase: "Contract",
    title: "Launch live",
    description: "The launch lifecycle has reached Live.",
    to: "/launch-control",
    actionLabel: "Advance the launch",
    explanation: "Advance the lifecycle in Launch Control when the launch is actually live.",
  },
};

function stageOf(
  key: JourneyStageKey,
  order: number,
  status: JourneyStageStatus,
  actionable: boolean,
  detail: string | null,
  /** Optional label override for stages whose action depends on live state. */
  actionLabel?: string,
): JourneyStage {
  const copy = STAGE_COPY[key];
  return {
    key,
    order,
    phase: copy.phase,
    title: copy.title,
    description: copy.description,
    status,
    actionable,
    to: copy.to,
    actionLabel: actionLabel ?? copy.actionLabel,
    detail,
  };
}

export function computeProjectJourney(input: JourneyInput): ProjectJourney {
  const r = input.readiness;
  const stepDone = (key: string) => r.steps.find((s) => s.key === key)?.complete === true;

  const launch = input.launch;
  const statusIndex = launch ? launchStatusIndex(toLaunchStatus(launch.status)) : -1;
  const liveIndex = launchStatusIndex("LIVE");
  const normalizedLaunchStatus = launch ? toLaunchStatus(launch.status) : null;

  const registrationFields = launch
    ? [
        launch.officialContractAddress,
        launch.officialContractDeploymentId,
        launch.contractRegisteredAt,
      ]
    : [];
  const registrationFieldCount = registrationFields.filter(
    (value) => typeof value === "string" && value.trim() !== "",
  ).length;
  const registrationComplete = registrationFieldCount === 3;
  const registrationInconsistent = registrationFieldCount > 0 && registrationFieldCount < 3;

  const deployment = input.deploymentEvidence;
  const deploymentComplete =
    !!deployment &&
    deployment.verifiedProductionCount === 1 &&
    deployment.managedFinalizedVerifiedCount === 1 &&
    !deployment.deploymentAmbiguous;
  const registrationActionable =
    !!launch &&
    !registrationComplete &&
    !registrationInconsistent &&
    !input.deploymentUnavailable &&
    deployment?.registrationEligibleCount === 1 &&
    !deployment.registrationAmbiguous;

  // --- Production deployment handoff request (Launcher-B) -----------------
  // The request is a record of intent. The database re-derives every rule and
  // may still refuse; these are client-known hints for guidance only.
  const productionRequest = input.productionRequest;
  const requestCompleted = productionRequest?.effectiveStatus === "COMPLETED";
  const requestOpen =
    !!productionRequest &&
    !requestCompleted &&
    ["REQUESTED", "IN_REVIEW", "APPROVED", "EXECUTING"].includes(productionRequest.status);
  const requestClosed =
    !!productionRequest &&
    !requestCompleted &&
    (productionRequest.status === "DECLINED" || productionRequest.status === "WITHDRAWN");
  const requestEligibilityHint =
    !!launch &&
    stepDone("profile_published") &&
    launch.scheduleSet &&
    ["WATCHLIST_OPEN", "LAUNCH_APPROACHING", "CONTRACT_PENDING"].includes(
      normalizedLaunchStatus ?? "",
    ) &&
    !registrationComplete &&
    !registrationInconsistent &&
    !input.deploymentUnavailable &&
    !input.productionRequestUnavailable &&
    (deployment?.productionDeploymentCount ?? 0) === 0;
  const requestActionable =
    requestEligibilityHint && (productionRequest === null || requestClosed);
  const requestDetail = requestOpen
    ? productionRequest.status === "EXECUTING"
      ? "Deployment request approved · platform execution in progress"
      : productionRequest.status === "APPROVED"
        ? "Deployment request approved · no transaction sent yet"
        : productionRequest.status === "IN_REVIEW"
          ? "Deployment request under review"
          : "Deployment request submitted · waiting for review"
    : requestClosed
      ? productionRequest.status === "DECLINED"
        ? "Previous deployment request was declined"
        : "Previous deployment request was withdrawn"
      : null;


  const watchOpen = stepDone("launch_watch_open");

  // --- Brand & Creative ---------------------------------------------------
  const brandKitConfigured =
    !input.brandKitUnavailable && !!input.brandKit?.brandName?.trim();

  const assets = input.creativeAssets;
  const usefulAssetCount = assets ? assets.brandAssetCount + assets.otherAssetCount : 0;

  const packs = input.stickerPacks;

  // --- Communications -----------------------------------------------------
  const inbox = input.inbox;
  const inboxConfigured =
    !input.inboxUnavailable && !!inbox && inbox.repliesEnabled && inbox.newConversationsEnabled;
  const waiting = inbox?.waitingOnTeamCount ?? null;
  const inboxDetail = input.inboxUnavailable
    ? null
    : inboxConfigured
      ? waiting && waiting > 0
        ? `Inbox ready · ${waiting} need${waiting === 1 ? "s" : ""} reply`
        : "Inbox ready"
      : inbox
        ? !inbox.repliesEnabled && !inbox.newConversationsEnabled
          ? "Replies and new conversations are off"
          : !inbox.repliesEnabled
            ? "Replies are off"
            : "New conversations are off"
        : null;


  const raw: Array<{
    key: JourneyStageKey;
    status: JourneyStageStatus;
    actionable: boolean;
    detail: string | null;
    /** Only set where the label depends on live state. */
    actionLabel?: string;
  }> = [
    {
      key: "project_profile",
      status: stepDone("project_profile") ? "complete" : "action",
      actionable: true,
      detail: r.projectName,
    },
    {
      key: "profile_published",
      status: stepDone("profile_published") ? "complete" : "action",
      actionable: true,
      detail: r.profilePublished ? "Published" : "Draft",
    },
    {
      key: "brand_kit",
      status: input.brandKitUnavailable
        ? "unavailable"
        : brandKitConfigured
          ? "complete"
          : "action",
      actionable: !input.brandKitUnavailable,
      detail: brandKitConfigured ? input.brandKit!.brandName : null,
    },
    {
      key: "creative_assets",
      status: input.creativeAssetsUnavailable || !assets
        ? "unavailable"
        : usefulAssetCount > 0
          ? "complete"
          : "action",
      actionable: !input.creativeAssetsUnavailable && !!assets,
      detail:
        input.creativeAssetsUnavailable || !assets
          ? null
          : usefulAssetCount > 0
            ? `${usefulAssetCount} brand asset${usefulAssetCount === 1 ? "" : "s"}` +
              (assets.generatedStickerCount > 0
                ? ` · ${assets.generatedStickerCount} generated sticker${assets.generatedStickerCount === 1 ? "" : "s"}`
                : "")
            : "No logo, mascot or reference image yet",
    },
    {
      key: "sticker_pack",
      status: input.stickerPacksUnavailable || !packs
        ? "unavailable"
        : packs.publishedCount > 0
          ? "complete"
          : "action",
      actionable: !input.stickerPacksUnavailable && !!packs,
      detail:
        input.stickerPacksUnavailable || !packs
          ? null
          : packs.publishedCount > 0
            ? `${packs.publishedCount} published pack${packs.publishedCount === 1 ? "" : "s"}`
            : packs.activeCount > 0
              ? `${packs.activeCount} pack${packs.activeCount === 1 ? "" : "s"} in progress`
              : "No sticker pack yet",
    },
    {
      key: "launch_created",

      status: stepDone("launch_created") ? "complete" : "action",
      actionable: true,
      detail: r.primaryLaunchName,
    },
    {
      key: "launch_announced",
      status: stepDone("launch_announced") ? "complete" : launch ? "action" : "waiting",
      actionable: !!launch,
      detail: null,
    },
    {
      key: "launch_schedule",
      status: !launch ? "waiting" : launch.scheduleSet ? "complete" : "action",
      actionable: !!launch,
      detail: launch && !launch.scheduleSet ? "No launch time or window set" : null,
    },
    {
      key: "launch_watch_open",
      status: watchOpen ? "complete" : launch ? "action" : "waiting",
      actionable: !!launch,
      detail: null,
    },
    {
      key: "telegram_community",
      status: stepDone("telegram_community") ? "complete" : "action",
      actionable: true,
      detail:
        r.operationalGroupCount > 0
          ? `${r.operationalGroupCount} community${r.operationalGroupCount === 1 ? "" : "s"} ready`
          : null,
    },
    {
      key: "launch_welcome",
      status: stepDone("launch_welcome")
        ? "complete"
        : stepDone("telegram_community") && watchOpen
          ? "action"
          : "waiting",
      actionable: stepDone("telegram_community") && watchOpen,
      detail: null,
    },
    {
      key: "audience",
      status: !watchOpen
        ? "waiting"
        : input.watchUnavailable
          ? "unavailable"
          : (input.activeWatchers ?? 0) > 0
            ? "complete"
            : "action",
      actionable: watchOpen && !input.watchUnavailable,
      detail:
        input.watchUnavailable || input.activeWatchers === null
          ? null
          : `${input.activeWatchers} active watcher${input.activeWatchers === 1 ? "" : "s"}`,
    },
    {
      key: "communications",
      status: input.inboxUnavailable || !inbox
        ? "unavailable"
        : inboxConfigured
          ? "complete"
          : "action",
      actionable: !input.inboxUnavailable && !!inbox,
      detail: inboxDetail,
    },

    {
      key: "deployment",
      // Complete when verified evidence is on record, or when the database
      // itself derives the handoff request as COMPLETED from that evidence.
      status: !launch
        ? "waiting"
        : deploymentComplete || requestCompleted
          ? "complete"
          : input.deploymentUnavailable
            ? "unavailable"
            : requestActionable
              ? "action"
              : "waiting",
      // Execution stays platform-controlled. The only owner action here is
      // recording a request; it never deploys, signs or broadcasts anything.
      actionable: !!launch && !deploymentComplete && !requestCompleted && requestActionable,
      actionLabel: "Request production deployment",
      detail:
        requestDetail ??
        (input.deploymentUnavailable || deployment === null
          ? null
          : deployment.deploymentAmbiguous
            ? "Multiple verified production deployments require review"
            : deployment.productionDeploymentCount === 0
              ? "No production deployment evidence yet"
              : deployment.verifiedProductionCount === 0
                ? "Production deployment evidence is not verified"
                : deployment.managedFinalizedVerifiedCount === 0
                  ? "Production evidence verified · managed finality pending"
                  : "Verified production deployment · managed finality confirmed"),
    },
    {
      key: "official_contract",
      status: !launch
        ? "waiting"
        : registrationInconsistent
          ? "unavailable"
          : registrationComplete
          ? "complete"
          : registrationActionable
            ? "action"
            : "waiting",
      actionable: registrationActionable,
      detail: registrationComplete
        ? "Registered"
        : registrationInconsistent
          ? "Recorded registration fields are incomplete"
          : deployment?.registrationAmbiguous
            ? "Multiple eligible contracts require review"
            : null,
    },
    {
      key: "launch_live",
      status: !launch
        ? "waiting"
        : statusIndex >= liveIndex
          ? "complete"
          : registrationComplete
            ? "action"
            : "waiting",
      actionable: !!launch && registrationComplete,
      detail: normalizedLaunchStatus
        ? `Lifecycle: ${normalizedLaunchStatus.toLowerCase().replaceAll("_", " ")}`
        : null,
    },
  ];

  const stages = raw.map((entry, index) =>
    stageOf(
      entry.key,
      index + 1,
      entry.status,
      entry.actionable,
      entry.detail,
      entry.actionLabel,
    ),
  );

  const completedCount = stages.filter((s) => s.status === "complete").length;
  const nextStage =
    stages.find((s) => s.status === "action" && s.actionable) ?? null;

  const nextAction: JourneyNextAction = nextStage
    ? {
        stage: nextStage,
        label: nextStage.actionLabel,
        to: nextStage.to,
        headline: `Next: ${nextStage.actionLabel}.`,
        explanation:
          STAGE_COPY[nextStage.key].explanation ||
          (nextStage.key === "deployment"
            ? "Ask the CARTEL platform to deploy your token contract. Submitting records a request only — nothing is deployed or signed by it."
            : ""),
      }
    : {
        stage: null,
        label: "Review Launch Control",
        to: "/launch-control",
        headline:
          completedCount === stages.length
            ? "Launch journey complete"
            : "Nothing to action right now",
        explanation:
          completedCount === stages.length
            ? "Every stage of this project's launch journey is on record."
            : "The remaining stages depend on work that is not available yet. Launch Control holds the authoritative state.",
      };

  return {
    stages,
    completedCount,
    totalCount: stages.length,
    allComplete: completedCount === stages.length,
    nextAction,
    projectName: r.projectName,
    primaryLaunchId: r.primaryLaunchId,
    primaryLaunchName: r.primaryLaunchName,
    readiness: r,
  };
}

// ---------------------------------------------------------------------------
// Query
// ---------------------------------------------------------------------------

/**
 * Prefixed with the readiness key so every existing
 * `invalidateQueries(["launch-readiness", workspaceId])` call keeps working.
 */
export function projectJourneyQueryKey(workspaceId: string | null | undefined) {
  return ["launch-readiness", workspaceId ?? null, "project-journey"] as const;
}

export function launchFactsOf(row: LaunchRow): JourneyLaunchFacts {
  return {
    id: row.id,
    status: row.status,
    scheduleSet: hasSchedule(row),
    officialContractAddress: row.official_contract_address,
    officialContractDeploymentId: row.official_contract_deployment_id,
    contractRegisteredAt: row.contract_registered_at,
  };
}

/**
 * Compresses existing pure evidence evaluations into journey-only facts.
 * Rows are explicitly re-scoped to the selected launch before finality is read.
 */
export function deriveJourneyDeploymentEvidenceFacts(
  evaluation: LaunchEvidenceEvaluation,
  rows: readonly DeploymentEvidenceInput[],
): JourneyDeploymentEvidenceFacts {
  const scopedProductionRows = rows.filter(
    (row) =>
      row.launch_id === evaluation.launchId && row.network_environment === "PRODUCTION",
  );
  const scopedIds = new Set(scopedProductionRows.map((row) => row.id));
  const verifiedProduction = evaluation.deployments.filter(
    (deployment) =>
      scopedIds.has(deployment.deploymentId) &&
      deployment.environment === "PRODUCTION" &&
      deployment.evidenceVerified,
  );
  const finalizedVerifiedIds = new Set(
    scopedProductionRows
      .filter((row) => evaluateProductionFinality(row).finalityOk)
      .map((row) => row.id),
  );

  return {
    productionDeploymentCount: scopedProductionRows.length,
    verifiedProductionCount: verifiedProduction.length,
    managedFinalizedVerifiedCount: verifiedProduction.filter((deployment) =>
      finalizedVerifiedIds.has(deployment.deploymentId),
    ).length,
    deploymentAmbiguous: verifiedProduction.length > 1,
    registrationEligibleCount: evaluation.eligibleForOfficialRegistration,
    registrationAmbiguous: evaluation.ambiguous,
  };
}

export async function fetchProjectJourney(workspaceId: string): Promise<ProjectJourney> {
  // Readiness resolves the project profile, so the launch list can be scoped to
  // that exact profile (never workspace-wide) and to PROJECT launches only:
  // INTERNAL_TEST chain-test records are never part of the project journey.
  const readiness = await fetchLaunchReadiness(workspaceId);
  const launches = readiness.projectProfileId
    ? await listLaunches(workspaceId, readiness.projectProfileId)
        .then((rows) => rows.filter(isProjectLaunch))
        .catch(() => [] as LaunchRow[])
    : [];

  const primaryRow =
    readiness.primaryLaunchId
      ? (launches.find((l) => l.id === readiness.primaryLaunchId) ?? null)
      : null;
  const launch = primaryRow ? launchFactsOf(primaryRow) : null;


  let activeWatchers: number | null = null;
  let watchUnavailable = false;
  if (primaryRow?.launch_watch_token) {
    try {
      const summary = await getLaunchWatchSummary(primaryRow.id);
      activeWatchers = summary.active_count;
    } catch {
      watchUnavailable = true;
    }
  }

  let deploymentEvidence: JourneyDeploymentEvidenceFacts | null = null;
  let deploymentUnavailable = false;
  if (primaryRow) {
    try {
      const rows = await listChainDeployments(primaryRow.id);
      const evaluation = evaluateLaunchDeploymentEvidence(
        {
          launchId: primaryRow.id,
          workspaceId: primaryRow.workspace_id,
          declaredChain: primaryRow.chain,
          launchStatus: primaryRow.status,
          officialContractAddress: primaryRow.official_contract_address,
          officialContractDeploymentId: primaryRow.official_contract_deployment_id,
          contractRegisteredAt: primaryRow.contract_registered_at,
        },
        rows,
      );
      deploymentEvidence = deriveJourneyDeploymentEvidenceFacts(evaluation, rows);
    } catch {
      deploymentUnavailable = true;
    }
  }

  // Launcher-B — latest handoff request for the primary PROJECT launch only.
  // Read-only; INTERNAL_TEST launches are already excluded above.
  let productionRequest: JourneyProductionRequestFacts | null = null;
  let productionRequestUnavailable = false;
  if (primaryRow) {
    try {
      const row = await getLaunchProductionDeploymentRequest(primaryRow.id);
      productionRequest = row
        ? { status: row.status, effectiveStatus: row.effectiveStatus }
        : null;
    } catch {
      productionRequestUnavailable = true;
    }
  }


  // --- Brand & Creative + Communications (read-only, existing surfaces) ----
  const [brandKitResult, assetsResult, packsResult, inboxSettingsResult] =
    await Promise.allSettled([
      supabase
        .from("brand_kits")
        .select("id,brand_name")
        .eq("workspace_id", workspaceId)
        .maybeSingle(),
      listWorkspaceAssets(workspaceId),
      listWorkspacePacks(workspaceId),
      getProjectInboxSettings(workspaceId),
    ]);

  let brandKit: JourneyBrandKitFacts | null = null;
  let brandKitUnavailable = true;
  if (brandKitResult.status === "fulfilled" && !brandKitResult.value.error) {
    brandKitUnavailable = false;
    const row = brandKitResult.value.data;
    brandKit = row ? { brandName: row.brand_name ?? null } : null;
  }

  let creativeAssets: JourneyCreativeAssetFacts | null = null;
  let creativeAssetsUnavailable = true;
  if (assetsResult.status === "fulfilled") {
    creativeAssetsUnavailable = false;
    const rows = assetsResult.value;
    creativeAssets = {
      brandAssetCount: rows.filter((a) =>
        ["logo", "mascot", "reference_image"].includes(a.asset_type),
      ).length,
      generatedStickerCount: rows.filter((a) => a.asset_type === "generated_sticker").length,
      otherAssetCount: rows.filter(
        (a) =>
          !["logo", "mascot", "reference_image", "generated_sticker"].includes(a.asset_type),
      ).length,
    };
  }

  let stickerPacks: JourneyStickerPackFacts | null = null;
  let stickerPacksUnavailable = true;
  if (packsResult.status === "fulfilled") {
    stickerPacksUnavailable = false;
    const rows = packsResult.value;
    stickerPacks = {
      activeCount: rows.length,
      publishedCount: rows.filter((p) => p.status === "published").length,
    };
  }

  let inbox: JourneyInboxFacts | null = null;
  let inboxUnavailable = true;
  if (inboxSettingsResult.status === "fulfilled") {
    inboxUnavailable = false;
    const settings = inboxSettingsResult.value;
    let waitingOnTeamCount: number | null = null;
    try {
      const summary = await getProjectInboxSummary(workspaceId);
      waitingOnTeamCount = summary.waiting_on_team_count;
    } catch {
      waitingOnTeamCount = null;
    }
    inbox = {
      repliesEnabled: settings.replies_enabled === true,
      newConversationsEnabled: settings.new_conversations_enabled === true,
      waitingOnTeamCount,
    };
  }

  return computeProjectJourney({
    readiness,
    launch,
    activeWatchers,
    watchUnavailable,
    deploymentEvidence,
    deploymentUnavailable,
    productionRequest,
    productionRequestUnavailable,
    brandKit,
    brandKitUnavailable,
    creativeAssets,
    creativeAssetsUnavailable,
    stickerPacks,
    stickerPacksUnavailable,
    inbox,
    inboxUnavailable,
  });
}

