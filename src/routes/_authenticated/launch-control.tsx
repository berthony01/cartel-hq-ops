import { useEffect, useMemo, useState, type ReactNode } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Bell,
  ChevronDown,
  Copy,
  ExternalLink,
  IdCard,
  Loader2,
  Megaphone,
  Plus,
  Rocket,
  Save,
  ShieldCheck,
  Trash2,
} from "lucide-react";

import { toast } from "sonner";
import { useWorkspace } from "@/lib/workspace-context";
import { getProjectProfile } from "@/lib/project-profile";
import {
  isProjectLaunch,
  isInternalTestLaunch,
  selectPrimaryProjectLaunch,
} from "@/lib/launch-control";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import {
  CHAIN_MAX,
  LAUNCH_STATUSES,
  LAUNCH_STATUS_HELP,
  LAUNCH_STATUS_LABELS,
  NOTES_MAX,
  SLUG_MAX,
  SLUG_RULE_HINT,
  TICKER_MAX,
  TOKEN_NAME_MAX,
  canDeleteLaunch,
  getLaunchNotificationSummary,
  getLaunchWatchSummary,
  getLaunchWatchConfirmationSummary,
  getLaunchWatcherUpdateStats,
  listLaunchWatcherUpdates,
  canSendWatcherUpdate,
  getPendingScheduleCommunication,
  scheduleCommunicationQueryKey,
  workspaceScheduleCommunicationsQueryKey,



  isLaunchWatchClosedStatus,
  isLaunchWatchOpenStatus,
  launchWatchDeepLink,
  createLaunch,
  deleteDraftLaunch,
  deviceTimezone,
  formatTimestamp,
  getLaunchAccess,
  hasSchedule,
  identityLocked,
  isValidLaunchSlug,
  isoToLocalInput,
  launchStatusIndex,
  listLaunches,
  notifyLaunchWatchersOfficialContract,
  notifyLaunchWatchersOfficialContractCorrection,
  localInputToIso,
  nextLaunchStatus,
  nullableText,
  scheduleLocked,
  registerVerifiedLaunchContract,
  correctVerifiedLaunchContract,
  listLaunchContractRegistrationEvents,
  launchContractRegistrationEventsQueryKey,
  slugifyLaunch,
  toLaunchStatus,
  transitionLaunchStatus,
  updateLaunchDetails,
  type LaunchRow,
  type LaunchStatus,
  type OfficialContractNotifyResult,
  type OfficialContractCorrectionResult,
  type OfficialContractCorrectionNotifyResult,
} from "@/lib/launch-control";


import { PageHeader } from "@/components/cartel/PageHeader";
import { Section } from "@/components/cartel/Section";
import { EmptyState } from "@/components/cartel/EmptyState";
import { StatusBadge } from "@/components/cartel/StatusBadge";
import { LaunchControlHero } from "@/components/cartel/LaunchControlHero";
import { LaunchFacts } from "@/components/cartel/LaunchFacts";
import { LaunchLifecycleRail } from "@/components/cartel/LaunchLifecycleRail";
import { ScheduleChangeSummary } from "@/components/cartel/ScheduleChangeSummary";
import {
  ProjectJourneyProgress,
  useProjectJourney,
} from "@/components/cartel/ProjectJourney";
import { VerifiedDeploymentEvidencePanel } from "@/components/cartel/VerifiedDeploymentEvidencePanel";
import { VerifiedContractRegistrationPanel } from "@/components/cartel/VerifiedContractRegistrationPanel";
import { ProductionDeploymentRequestPanel } from "@/components/cartel/ProductionDeploymentRequestPanel";
import { PcartProductionBlockedCheckpoint } from "@/components/cartel/PcartProductionBlockedCheckpoint";
import { PcartReviewLaunchSummary } from "@/components/cartel/PcartReviewLaunchSummary";
import { PcartProductionReviewPanel } from "@/components/cartel/PcartProductionReviewPanel";
import { PcartWalletPreparationPanel } from "@/components/cartel/PcartWalletPreparationPanel";
import { PcartFinalSendReviewPanel } from "@/components/cartel/PcartFinalSendReviewPanel";
import { PcartMainnetSendPanel, fetchLatestPcartSendClaim, pcartSendClaimQueryKey } from "@/components/cartel/PcartMainnetSendPanel";
import { pcartP5SummaryText, pcartSendWindowState } from "@/lib/pcart-production-send";
import { fetchLatestPcartExecutionPermit, pcartExecutionPermitQueryKey } from "@/lib/pcart-production-execution-permit";
import { isPcartExecutionPermitActive } from "@/lib/pcart-production-execution";
import {
  fetchLatestPcartPreparation,
  isPcartPreparationActive,
  pcartPreparationQueryKey,
} from "@/lib/pcart-production-preparation";
import { fetchPcartReadiness, pcartReadinessQueryKey } from "@/lib/pcart-production-readiness";
import { findPcartProductionAttempt, isUnsentPcartDraft } from "@/lib/pcart-production-draft";
import { PCART_FIXED_INTENT, isCanonicalPcartLaunch } from "@/lib/launch-artifact-registry";
import { TreasurySignerSetupPanel } from "@/components/cartel/TreasurySignerSetupPanel";
import { PcartLaunchSetupGuide } from "@/components/cartel/PcartLaunchSetupGuide";
import {
  derivePcartReadiness,
  isPcartLaunchScheduleExpired,
  isPcartTreasurySafeReady,
  pcartMainnetSummary,
} from "@/lib/pcart-launch-readiness";
import { getLaunchTreasurySigners, treasurySignerConfigQueryKey } from "@/lib/treasury-signers";
import {
  TreasurySafeCreatePanel,
  treasurySafeStatusQueryKey,
} from "@/components/cartel/TreasurySafeCreatePanel";
import { getTreasurySafeStatus } from "@/lib/treasury-safe-create.functions";
import { useServerFn } from "@tanstack/react-start";
import {
  getLaunchProductionDeploymentRequest,
  hasRegistrationRecord,
  productionDeploymentRequestQueryKey,
  submitLaunchProductionDeploymentRequest,
  withdrawLaunchProductionDeploymentRequest,
} from "@/lib/launch-production-request";
import { OfficialContractNotifyPanel } from "@/components/cartel/OfficialContractNotifyPanel";
import { OfficialContractGroupBroadcastPanel } from "@/components/cartel/OfficialContractGroupBroadcastPanel";
import { OfficialContractCorrectionPanel } from "@/components/cartel/OfficialContractCorrectionPanel";
import { SectionNav, type SectionNavItem } from "@/components/cartel/SectionNav";
import { RelatedLinks, relatedLinkClass } from "@/components/cartel/RelatedLinks";

/** Presentation-only in-page navigation targets for a selected launch. */
const LAUNCH_SECTION_IDS = [
  "lc-overview",
  "lc-details",
  "lc-schedule",
  "lc-watch",
  "lc-comms",
  "lc-contract",
] as const;
type LaunchSectionId = (typeof LAUNCH_SECTION_IDS)[number];

const LAUNCH_SECTIONS: SectionNavItem[] = [
  { id: "lc-overview", label: "Overview" },
  { id: "lc-details", label: "Details" },
  { id: "lc-schedule", label: "Schedule" },
  { id: "lc-watch", label: "Launch Watch" },
  { id: "lc-comms", label: "Communications" },
  { id: "lc-contract", label: "Deploy & Contract" },
];

type LaunchControlSearch = { launch?: string; section?: LaunchSectionId };

function validateLaunchControlSearch(search: Record<string, unknown>): LaunchControlSearch {
  const rawLaunch = search["launch"];
  const launch =
    typeof rawLaunch === "string" && rawLaunch.trim().length > 0 && rawLaunch.length <= 100
      ? rawLaunch.trim()
      : undefined;
  const rawSection = search["section"];
  const section = (LAUNCH_SECTION_IDS as readonly string[]).includes(String(rawSection))
    ? (String(rawSection) as LaunchSectionId)
    : undefined;
  const next: LaunchControlSearch = {};
  if (launch) next.launch = launch;
  if (section && section !== "lc-overview") next.section = section;
  return next;
}

import { supabase } from "@/integrations/supabase/client";
import {
  sendOfficialContractBroadcast,
  sendOfficialContractCorrectionBroadcast,
  type OfficialContractBroadcastResult,
  type OfficialContractCorrectionBroadcastResult,
} from "@/lib/telegram-group";
import { evaluateLaunchDeploymentEvidence } from "@/lib/launch-verified-eligibility";
import { chainDeploymentsQueryKey, listChainDeployments } from "@/lib/chain-launcher";

import { launchReadinessQueryKey } from "@/lib/launch-readiness";

import { StickyActionBar } from "@/components/cartel/StickyActionBar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/_authenticated/launch-control")({
  validateSearch: validateLaunchControlSearch,
  head: () => ({
    meta: [
      { title: "Launch Control — CARTEL HQ" },
      {
        name: "description",
        content:
          "Operator control center for the authenticated project's token launch lifecycle, schedule and official contract registration.",
      },
      { property: "og:title", content: "Launch Control — CARTEL HQ" },
      {
        property: "og:description",
        content:
          "Manage launch records, lifecycle status and official contract registration inside CARTEL HQ.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: LaunchControlPage,
});

type ScheduleMode = "none" | "exact" | "window";

type EditorForm = {
  token_name: string;
  ticker: string;
  chain: string;
  public_slug: string;
  schedule_mode: ScheduleMode;
  launch_at: string;
  window_start: string;
  window_end: string;
  internal_notes: string;
};

const STATUS_TONE: Record<LaunchStatus, "gold" | "green" | "muted"> = {
  DRAFT: "muted",
  ANNOUNCED: "gold",
  WATCHLIST_OPEN: "gold",
  LAUNCH_APPROACHING: "gold",
  CONTRACT_PENDING: "gold",
  OFFICIAL_CONTRACT_REGISTERED: "green",
  LIVE: "green",
  COMPLETED: "muted",
};

const LIFECYCLE_GUIDE: Record<LaunchStatus, { title: string; body: string }> = {
  DRAFT: {
    title: "Draft",
    body:
      "Private setup. Identity fields are editable. There are no watchers and no messages are sent.",
  },
  ANNOUNCED: {
    title: "Announced",
    body:
      "Launch identity is locked and the public Cartel Network launch page can be visible when the Project Profile is published. This stage does NOT send a Telegram announcement or DM.",
  },
  WATCHLIST_OPEN: {
    title: "Watchlist Open",
    body:
      "The unique Launch Watch link accepts opt-ins through @PepeCartelHQBot. Opening the watchlist does NOT itself send a broadcast.",
  },
  LAUNCH_APPROACHING: {
    title: "Launch Approaching",
    body:
      "Schedule confirmed / countdown delivery armed. Eligible 24h and 1h reminders can be created when due for active watchers who allow countdowns.",
  },
  CONTRACT_PENDING: {
    title: "Contract Pending",
    body:
      "Evidence-bound contract registration becomes available. Bind this launch to one verified deployment record before advancing. The address is never typed in freehand.",
  },
  OFFICIAL_CONTRACT_REGISTERED: {
    title: "Official Contract Registered",
    body:
      "The authenticated project has registered its official contract reference, bound to verified deployment evidence. Notifying watchers is a separate, explicit owner action.",
  },
  LIVE: {
    title: "Live",
    body: "Active watchers receive the Launch Is Live alert.",
  },
  COMPLETED: {
    title: "Completed",
    body: "Lifecycle is finished. No new Launch Watch sign-ups.",
  },
};

const NEXT_ACTION_GUIDE: Record<
  LaunchStatus,
  { current: string; means: string; nextAction: string; after: string }
> = {
  DRAFT: {
    current: "Draft",
    means:
      "This launch is in private setup. Identity is editable and no messages are sent.",
    nextAction: "Announce launch & lock identity",
    after:
      "Announced: identity locks and the Cartel Network launch page can become visible once the Project Profile is published.",
  },
  ANNOUNCED: {
    current: "Announced",
    means:
      "Launch identity is locked. The Cartel Network page can be visible when the Project Profile is published. No Telegram announcement or DM is sent at this stage.",
    nextAction: "Open Launch Watch",
    after:
      "Watchlist Open: the unique Launch Watch link starts accepting opt-ins.",
  },
  WATCHLIST_OPEN: {
    current: "Watchlist Open",
    means:
      "Watchers can opt in privately through @PepeCartelHQBot. This stage itself does not send them a message.",
    nextAction: "Confirm schedule & arm countdowns",
    after:
      "Launch Approaching: countdown delivery becomes armed. The following lifecycle step opens contract registration.",
  },
  LAUNCH_APPROACHING: {
    current: "Launch Approaching",
    means:
      "Schedule is confirmed and countdown delivery is armed. Eligible 24h and 1h reminders can be created when due for active watchers who allow countdowns.",
    nextAction: "Open contract registration",
    after:
      "Contract Pending: evidence-bound contract registration opens for a qualifying verified deployment.",
  },
  CONTRACT_PENDING: {
    current: "Contract Pending",
    means:
      "Evidence-bound registration is open. Bind this launch to one qualifying verified deployment record. Registering sends nothing and does not advance the lifecycle on its own.",
    nextAction: "Register official contract from verified deployment evidence",
    after:
      "Official Contract Registered: the launch carries an evidence-bound official contract reference. Notifying watchers remains a separate, explicit owner action.",
  },
  OFFICIAL_CONTRACT_REGISTERED: {
    current: "Official Contract Registered",
    means:
      "The authenticated project has registered its official contract reference, bound to verified deployment evidence. Notifying watchers is a separate, explicit owner action.",
    nextAction: "Mark launch live",
    after: "Live: active watchers receive the Launch Is Live alert.",
  },
  LIVE: {
    current: "Live",
    means: "Active watchers have received the Launch Is Live alert.",
    nextAction: "Complete launch",
    after:
      "Completed: the lifecycle is finished and no new Launch Watch sign-ups are accepted.",
  },
  COMPLETED: {
    current: "Completed",
    means: "The lifecycle is finished. No new Launch Watch sign-ups.",
    nextAction: "No further action",
    after: "This launch record remains read-only.",
  },
};

const TRANSITION_BUTTON_LABEL: Record<LaunchStatus, string> = {
  DRAFT: "Announce launch & lock identity",
  ANNOUNCED: "Open Launch Watch",
  WATCHLIST_OPEN: "Confirm schedule & arm countdowns",
  LAUNCH_APPROACHING: "Open contract registration",
  CONTRACT_PENDING: "Register official contract from verified deployment evidence",
  OFFICIAL_CONTRACT_REGISTERED: "Mark launch live",
  LIVE: "Complete launch",
  COMPLETED: "No further action",
};

function formFromRow(row: LaunchRow): EditorForm {
  const mode: ScheduleMode = row.launch_at
    ? "exact"
    : row.launch_window_start || row.launch_window_end
      ? "window"
      : "none";
  return {
    token_name: row.token_name,
    ticker: row.ticker,
    chain: row.chain,
    public_slug: row.public_slug,
    schedule_mode: mode,
    launch_at: isoToLocalInput(row.launch_at),
    window_start: isoToLocalInput(row.launch_window_start),
    window_end: isoToLocalInput(row.launch_window_end),
    internal_notes: row.internal_notes ?? "",
  };
}

/**
 * Client-only clock. Starts null on the server and on the first client render
 * so hydration output is stable, then ticks at a slow interval (no per-second
 * animation, no layout thrash).
 */
function useClientNow(intervalMs = 30_000): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

/** Compact human countdown, e.g. `4d 2h 18m`, `3h 12m`, `42m`, `under a minute`. */
function formatCountdown(ms: number): string {
  const totalMinutes = Math.floor(ms / 60_000);
  if (totalMinutes < 1) return "under a minute";
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

/** Lifecycle states in which the worker actually enqueues countdown reminders. */
const REMINDER_ARMED_STATUSES: readonly LaunchStatus[] = [
  "LAUNCH_APPROACHING",
  "CONTRACT_PENDING",
  "OFFICIAL_CONTRACT_REGISTERED",
];


function LaunchControlPage() {
  const { workspaceId, workspace, loading: workspaceLoading } = useWorkspace();
  const queryClient = useQueryClient();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const tz = useMemo(() => deviceTimezone(), []);

  const profileQuery = useQuery({
    queryKey: ["project-profile", workspaceId],
    enabled: !!workspaceId,
    queryFn: () => getProjectProfile(workspaceId!),
  });
  const profile = profileQuery.data ?? null;

  const projectJourneyQuery = useProjectJourney(workspaceId);

  const launchesQuery = useQuery({
    queryKey: ["launches", workspaceId, profile?.id ?? null],
    enabled: !!workspaceId && !!profile,
    queryFn: () => listLaunches(workspaceId!, profile!.id),
  });
  const launches = useMemo(() => launchesQuery.data ?? [], [launchesQuery.data]);
  /** Customer-facing launches. INTERNAL_TEST rows never appear here. */
  const projectLaunches = useMemo(() => launches.filter(isProjectLaunch), [launches]);
  /** Owner-only internal chain-test records. */
  const internalTestLaunches = useMemo(
    () => launches.filter(isInternalTestLaunch),
    [launches],
  );


  // Local permission hint only. RLS and the RPCs remain authoritative.
  const accessQuery = useQuery({
    queryKey: ["launch-access", workspaceId, workspace?.owner_id ?? null],
    enabled: !!workspaceId,
    queryFn: () => getLaunchAccess(workspaceId!, workspace?.owner_id ?? null),
  });
  const canManage = accessQuery.data?.canManage ?? false;
  const isWorkspaceOwner = accessQuery.data?.isWorkspaceOwner ?? false;
  const readOnly = !canManage;



  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = launches.find((l) => l.id === selectedId) ?? null;
  const selectedIsInternalTest = selected ? isInternalTestLaunch(selected) : false;

  useEffect(() => {
    if (launches.length === 0) {
      setSelectedId(null);
      return;
    }
    // A URL may select only a PROJECT launch from this already workspace- and
    // profile-scoped list. Stale, inaccessible and INTERNAL_TEST ids fail back
    // to the deterministic primary PROJECT launch without triggering work.
    if (search.launch) {
      const requested = projectLaunches.find((launch) => launch.id === search.launch);
      const fallback = selectPrimaryProjectLaunch(projectLaunches);
      const resolved = requested ?? fallback;
      if (resolved?.id !== selectedId) setSelectedId(resolved?.id ?? null);
      return;
    }
    // Preserve an explicit selection across ordinary query refresh.
    if (launches.some((l) => l.id === selectedId)) return;
    // Otherwise fall back to the deterministic PROJECT primary launch. Only a
    // workspace with no PROJECT launch at all may land on an internal record.
    const primary = selectPrimaryProjectLaunch(projectLaunches);
    setSelectedId(primary?.id ?? internalTestLaunches[0]?.id ?? null);
  }, [launches, projectLaunches, internalTestLaunches, search.launch, selectedId]);

  /** Controlled working view for the selected PROJECT launch. */
  const [activeSection, setActiveSection] = useState<LaunchSectionId>(
    search.section ?? "lc-overview",
  );
  useEffect(() => {
    // The validated URL owns explicit deep links. This only changes which
    // already-mounted section is visible; ordinary launch changes still reset
    // to Overview, and no action handler is invoked.
    setActiveSection(search.section ?? "lc-overview");
  }, [search.section, selectedId]);

  const selectProjectLaunch = (launchId: string) => {
    if (!projectLaunches.some((launch) => launch.id === launchId)) return;
    setSelectedId(launchId);
    setActiveSection("lc-overview");
    void navigate({ search: { launch: launchId }, replace: true });
  };

  const selectInternalLaunch = (launchId: string) => {
    if (!internalTestLaunches.some((launch) => launch.id === launchId)) return;
    setSelectedId(launchId);
    setActiveSection("lc-overview");
    void navigate({ search: {}, replace: true });
  };

  const selectSection = (sectionId: string) => {
    if (!(LAUNCH_SECTION_IDS as readonly string[]).includes(sectionId)) return;
    const section = sectionId as LaunchSectionId;
    setActiveSection(section);
    const launch = selected && isProjectLaunch(selected) ? selected.id : null;
    void navigate({
      search:
        section === "lc-overview"
          ? launch
            ? { launch }
            : {}
          : launch
            ? { launch, section }
            : { section },
      replace: true,
    });
  };


  const [form, setForm] = useState<EditorForm | null>(null);
  useEffect(() => {
    setForm(selected ? formFromRow(selected) : null);
  }, [selected]);

  const set = (patch: Partial<EditorForm>) =>
    setForm((f) => (f ? { ...f, ...patch } : f));

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["launches", workspaceId] });
    void queryClient.invalidateQueries({ queryKey: launchReadinessQueryKey(workspaceId) });
    // C6: a saved schedule edit may create/refresh a pending communication.
    void queryClient.invalidateQueries({ queryKey: ["launch-schedule-communication"] });
    void queryClient.invalidateQueries({
      queryKey: workspaceScheduleCommunicationsQueryKey(workspaceId),
    });
  };



  // ---- create -------------------------------------------------------------
  const [creating, setCreating] = useState(false);
  const [newLaunch, setNewLaunch] = useState({
    token_name: "",
    ticker: "",
    chain: "",
    public_slug: "",
  });

  const startCreate = () => {
    if (!profile) return;
    setNewLaunch({
      token_name: profile.project_name,
      ticker: profile.ticker ?? "",
      chain: profile.primary_chain ?? "",
      public_slug: slugifyLaunch(`${profile.public_slug}-launch`),
    });
    setCreating(true);
  };

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!workspaceId || !profile) throw new Error("No active project profile.");
      return createLaunch({
        workspaceId,
        projectProfileId: profile.id,
        token_name: newLaunch.token_name,
        ticker: newLaunch.ticker,
        chain: newLaunch.chain,
        public_slug: newLaunch.public_slug,
        timezone: tz,
      });
    },
    onSuccess: (row) => {
      toast.success("Draft launch created");
      setCreating(false);
      setSelectedId(row.id);
      void invalidate();
    },
    onError: (err: unknown) =>
      toast.error(err instanceof Error ? err.message : "Could not create the launch."),
  });

  const newSlugValid = isValidLaunchSlug(newLaunch.public_slug.trim().toLowerCase());
  const canCreate =
    newLaunch.token_name.trim().length > 0 &&
    newLaunch.ticker.trim().length > 0 &&
    newLaunch.chain.trim().length > 0 &&
    newSlugValid;

  // ---- save details -------------------------------------------------------
  const status: LaunchStatus = selected ? toLaunchStatus(selected.status) : "DRAFT";
  const idLocked = identityLocked(status);
  const schedLocked = scheduleLocked(status);

  // UX guards only. The database remains the authoritative validator.
  const identityError =
    !form || idLocked
      ? null
      : !form.token_name.trim()
        ? "Token name is required."
        : !form.ticker.trim()
          ? "Ticker is required."
          : !form.chain.trim()
            ? "Chain is required."
            : !isValidLaunchSlug(form.public_slug.trim().toLowerCase())
              ? `Public launch slug must be ${SLUG_RULE_HINT.toLowerCase()}`
              : null;

  const scheduleError = (() => {
    if (!form || schedLocked) return null;
    if (form.schedule_mode === "exact") {
      return localInputToIso(form.launch_at)
        ? null
        : "Set a valid launch date and time, or switch the schedule mode to Not set.";
    }
    if (form.schedule_mode === "window") {
      const start = localInputToIso(form.window_start);
      const end = localInputToIso(form.window_end);
      if (!start || !end) return "A launch window needs both a valid start and end.";
      if (new Date(end).getTime() < new Date(start).getTime())
        return "Window end must be the same as or after the window start.";
      return null;
    }
    return null;
  })();

  const notesError =
    form && form.internal_notes.length > NOTES_MAX
      ? `Internal notes are limited to ${NOTES_MAX} characters.`
      : null;

  const saveError = identityError ?? scheduleError ?? notesError;
  const canSave = !!form && !saveError && canManage;


  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!selected || !form) throw new Error("No launch selected.");
      const payload: Parameters<typeof updateLaunchDetails>[1] = {
        internal_notes: nullableText(form.internal_notes),
      };
      if (!idLocked) {
        payload.token_name = form.token_name.trim();
        payload.ticker = form.ticker.trim();
        payload.chain = form.chain.trim();
        payload.public_slug = form.public_slug.trim().toLowerCase();
      }
      if (!schedLocked) {
        payload.timezone = tz;
        if (form.schedule_mode === "exact") {
          payload.launch_at = localInputToIso(form.launch_at);
          payload.launch_window_start = null;
          payload.launch_window_end = null;
        } else if (form.schedule_mode === "window") {
          payload.launch_at = null;
          payload.launch_window_start = localInputToIso(form.window_start);
          payload.launch_window_end = localInputToIso(form.window_end);
        } else {
          payload.launch_at = null;
          payload.launch_window_start = null;
          payload.launch_window_end = null;
        }
      }
      return updateLaunchDetails(selected.id, payload);
    },
    onSuccess: () => {
      toast.success("Launch details saved");
      void invalidate();
    },
    onError: (err: unknown) =>
      toast.error(err instanceof Error ? err.message : "Could not save launch details."),
  });

  const transitionMutation = useMutation({
    mutationFn: async (target: LaunchStatus) => {
      if (!selected) throw new Error("No launch selected.");
      return transitionLaunchStatus(selected.id, target);
    },
    onSuccess: (row) => {
      toast.success(`Status is now ${LAUNCH_STATUS_LABELS[toLaunchStatus(row.status)]}`);
      void invalidate();
    },
    onError: (err: unknown) =>
      toast.error(err instanceof Error ? err.message : "Status transition was rejected."),
  });

  // C8.7B — evidence-bound registration. The operator never supplies the
  // address: the dedicated registration panel derives it from verified
  // deployment evidence, and the database re-derives it again server side.
  const registerContractMutation = useMutation({
    mutationFn: async (input: { deploymentId: string; expectedAddress: string }) => {
      if (!selected) throw new Error("No launch selected.");
      return registerVerifiedLaunchContract(
        selected.id,
        input.deploymentId,
        input.expectedAddress,
      );
    },
    onSuccess: () => {
      toast.success("Official contract registered from verified deployment evidence");
      void invalidate();
      void queryClient.invalidateQueries({
        queryKey: chainDeploymentsQueryKey(selected?.id ?? null),
      });
    },
    onError: (err: unknown) =>
      toast.error(
        err instanceof Error ? err.message : "Could not register the official contract.",
      ),
  });

  // C8.7C — explicit watcher notification. Registration and the lifecycle
  // transition never notify anyone; this is the only path that queues the
  // official-contract packet, and the database keeps it owner-only,
  // evidence-bound and idempotent. The outcome is keyed to the launch so a
  // result can never be shown against a different one.
  const [notifyOutcome, setNotifyOutcome] = useState<{
    launchId: string;
    result: OfficialContractNotifyResult | null;
    error: string | null;
  } | null>(null);
  const notifyContractMutation = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error("No launch selected.");
      return notifyLaunchWatchersOfficialContract(selected.id);
    },
    onSuccess: (result) => {
      setNotifyOutcome({ launchId: selected?.id ?? "", result, error: null });
      toast.success(
        result.status === "queued"
          ? "Official contract queued for eligible Launch Watch subscribers"
          : "Launch Watch subscribers were already notified — nothing was sent again",
      );
      void invalidate();
    },
    onError: (err: unknown) => {
      const message =
        err instanceof Error ? err.message : "Could not notify Launch Watch subscribers.";
      setNotifyOutcome({ launchId: selected?.id ?? "", result: null, error: message });
      toast.error(message);
    },
  });
  const notifyOutcomeForSelected =
    notifyOutcome && selected && notifyOutcome.launchId === selected.id ? notifyOutcome : null;

  // C8.7D — explicit official-contract community broadcast. Read-only group
  // list (the webhook owns these rows); the server derives the posted packet and
  // the contract address, enforces owner-only authority and keeps the durable
  // broadcast ledger idempotent.
  const broadcastGroupsQuery = useQuery({
    queryKey: ["telegram-group-connections", workspaceId],
    enabled: !!workspaceId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("telegram_group_connections")
        .select("id,title,bot_is_admin")
        .eq("workspace_id", workspaceId!)
        .order("connected_at", { ascending: true });
      if (error) throw error;
      return (data ?? []).map((row) => ({
        id: row.id as string,
        title: String(row.title ?? "Telegram community"),
        ready: row.bot_is_admin === true,
      }));
    },
  });

  const [broadcastOutcome, setBroadcastOutcome] = useState<{
    launchId: string;
    result: OfficialContractBroadcastResult | null;
    error: string | null;
  } | null>(null);
  const broadcastContractMutation = useMutation({
    mutationFn: async (groupConnectionId: string) => {
      if (!selected || !workspaceId) throw new Error("No launch selected.");
      return sendOfficialContractBroadcast({
        workspaceId,
        groupConnectionId,
        launchId: selected.id,
        clientRequestId: crypto.randomUUID(),
      });
    },
    onSuccess: (result) => {
      setBroadcastOutcome({ launchId: selected?.id ?? "", result, error: null });
      if (result.status === "SENT" && !result.duplicate) {
        toast.success("Official contract posted to the community");
      } else if (result.status === "SENT") {
        toast.success("Already posted — nothing was posted again");
      } else {
        toast.warning(result.message ?? "The community post outcome could not be confirmed.");
      }
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : "Could not post the official contract.";
      setBroadcastOutcome({ launchId: selected?.id ?? "", result: null, error: message });
      toast.error(message);
    },
  });
  const broadcastOutcomeForSelected =
    broadcastOutcome && selected && broadcastOutcome.launchId === selected.id
      ? broadcastOutcome
      : null;

  // C8.7E E3 — append-only registration ledger (read-only; RLS authoritative)
  // and the owner-only, evidence-bound correction RPC. A correction sends
  // nothing: watcher and community communications remain separate actions.
  const registrationEventsQuery = useQuery({
    queryKey: launchContractRegistrationEventsQueryKey(selected?.id ?? null),
    enabled: !!selected?.id,
    queryFn: () => listLaunchContractRegistrationEvents(selected!.id),
  });

  const [correctionOutcome, setCorrectionOutcome] = useState<{
    launchId: string;
    result: OfficialContractCorrectionResult | null;
    error: string | null;
  } | null>(null);
  const correctContractMutation = useMutation({
    mutationFn: async (input: {
      deploymentId: string;
      expectedAddress: string;
      reason: string;
    }) => {
      if (!selected) throw new Error("No launch selected.");
      return correctVerifiedLaunchContract({
        launchId: selected.id,
        deploymentId: input.deploymentId,
        expectedContractAddress: input.expectedAddress,
        reason: input.reason,
      });
    },
    onSuccess: (result) => {
      const launchId = selected?.id ?? "";
      setCorrectionOutcome({ launchId, result, error: null });
      if (result.status === "corrected") {
        toast.success("Official contract correction recorded");
        void queryClient.invalidateQueries({ queryKey: ["launches", workspaceId] });
        void queryClient.invalidateQueries({
          queryKey: launchContractRegistrationEventsQueryKey(launchId),
        });
        void queryClient.invalidateQueries({
          queryKey: chainDeploymentsQueryKey(launchId),
        });
      } else {
        toast.info("This launch is already bound to that deployment — nothing was recorded");
      }
    },
    onError: (err: unknown) => {
      const message =
        err instanceof Error ? err.message : "Could not correct the official contract.";
      setCorrectionOutcome({ launchId: selected?.id ?? "", result: null, error: message });
      toast.error(message);
    },
  });
  const correctionOutcomeForSelected =
    correctionOutcome && selected && correctionOutcome.launchId === selected.id
      ? correctionOutcome
      : null;

  // Identity of the newest immutable registration event for the selected
  // launch. Communication outcomes are matched against it so a durable result
  // is never displayed against a later, superseding correction.
  const latestRegistrationEventId =
    (registrationEventsQuery.data ?? []).at(-1)?.id ?? null;



  // C8.7E E4B — two independent, explicit post-correction communications.
  // Neither is ever called from `correctContractMutation.onSuccess`: recording
  // a correction still sends nothing. Both are keyed to launch + registration
  // event so an outcome can never be shown against a different correction.
  const [correctionNotifyOutcome, setCorrectionNotifyOutcome] = useState<{
    launchId: string;
    registrationEventId: string;
    result: OfficialContractCorrectionNotifyResult | null;
    error: string | null;
  } | null>(null);
  const correctionNotifyMutation = useMutation({
    mutationFn: async (registrationEventId: string) => {
      if (!selected) throw new Error("No launch selected.");
      return notifyLaunchWatchersOfficialContractCorrection(selected.id, registrationEventId);
    },
    onSuccess: (result, registrationEventId) => {
      const launchId = selected?.id ?? "";
      setCorrectionNotifyOutcome({ launchId, registrationEventId, result, error: null });
      toast.success(
        result.status === "queued"
          ? "Correction queued for active Launch Watch subscribers"
          : "Subscribers were already notified about this correction — nothing was sent again",
      );
      void queryClient.invalidateQueries({
        queryKey: ["launch-notification-summary", launchId],
      });
    },
    onError: (err: unknown, registrationEventId) => {
      const message =
        err instanceof Error ? err.message : "Could not notify Launch Watch subscribers.";
      setCorrectionNotifyOutcome({
        launchId: selected?.id ?? "",
        registrationEventId,
        result: null,
        error: message,
      });
      toast.error(message);
    },
  });

  const [correctionBroadcastOutcome, setCorrectionBroadcastOutcome] = useState<{
    launchId: string;
    registrationEventId: string;
    result: OfficialContractCorrectionBroadcastResult | null;
    error: string | null;
  } | null>(null);
  const correctionBroadcastMutation = useMutation({
    mutationFn: async (input: { groupConnectionId: string; registrationEventId: string }) => {
      if (!selected || !workspaceId) throw new Error("No launch selected.");
      return sendOfficialContractCorrectionBroadcast({
        workspaceId,
        groupConnectionId: input.groupConnectionId,
        launchId: selected.id,
        registrationEventId: input.registrationEventId,
        clientRequestId: crypto.randomUUID(),
      });
    },
    onSuccess: (result, input) => {
      setCorrectionBroadcastOutcome({
        launchId: selected?.id ?? "",
        registrationEventId: input.registrationEventId,
        result,
        error: null,
      });
      if (result.status === "SENT" && !result.duplicate) {
        toast.success("Correction posted to the community");
      } else if (result.status === "SENT") {
        toast.success("Already posted — nothing was posted again");
      } else if (result.status === "FAILED") {
        toast.error(result.message ?? "The correction was not posted.");
      } else {
        toast.warning(
          result.message ?? "The community post outcome could not be confirmed. Nothing is retried.",
        );
      }
    },
    onError: (err: unknown, input) => {
      const message = err instanceof Error ? err.message : "Could not post the correction.";
      setCorrectionBroadcastOutcome({
        launchId: selected?.id ?? "",
        registrationEventId: input.registrationEventId,
        result: null,
        error: message,
      });
      toast.error(message);
    },
  });


  const [confirmDelete, setConfirmDelete] = useState(false);
  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error("No launch selected.");
      return deleteDraftLaunch(selected.id);
    },
    onSuccess: () => {
      toast.success("Draft launch deleted");
      setConfirmDelete(false);
      setSelectedId(null);
      void invalidate();
    },
    onError: (err: unknown) =>
      toast.error(err instanceof Error ? err.message : "Could not delete the draft launch."),
  });

  const next = nextLaunchStatus(status);
  const scheduleReady = selected ? hasSchedule(selected) : false;
  // Registration is only complete when all three binding fields are present.
  // An address alone is never treated as a registered official contract.
  const contractRegistered = Boolean(
    (selected?.official_contract_address ?? "").trim() !== "" &&
      selected?.official_contract_deployment_id &&
      selected?.contract_registered_at,
  );

  // Launch Watch (read-only). Aggregate counts only — never subscriber identities.
  const watchToken = selected?.launch_watch_token ?? null;
  const watchLink = watchToken ? launchWatchDeepLink(watchToken) : null;
  const profilePublished = profile?.discovery_status === "published";
  const watchAcceptingNew = Boolean(watchToken) && profilePublished && isLaunchWatchOpenStatus(status);
  const watchSummaryQuery = useQuery({
    queryKey: ["launch-watch-summary", selected?.id ?? null],
    enabled: !!selected?.id && !!watchToken,
    queryFn: () => getLaunchWatchSummary(selected!.id),
  });
  const watchSummary = watchSummaryQuery.data ?? null;

  // Private confirmation diagnostics (aggregate-only, active watchers).
  const confirmationSummaryQuery = useQuery({
    queryKey: ["launch-watch-confirmation-summary", selected?.id ?? null],
    enabled: !!selected?.id && !!watchToken,
    queryFn: () => getLaunchWatchConfirmationSummary(selected!.id),
  });
  const confirmationSummary = confirmationSummaryQuery.data ?? null;
  const confirmationStatsReady = confirmationSummaryQuery.isSuccess && !!confirmationSummary;

  // Notification engine (aggregate-only). Delivery rows and Telegram
  // identifiers are service-role state and are never fetched here.
  const notificationSummaryQuery = useQuery({
    queryKey: ["launch-notification-summary", selected?.id ?? null],
    enabled: !!selected?.id,
    queryFn: () => getLaunchNotificationSummary(selected!.id),
  });
  const notificationSummary = notificationSummaryQuery.data ?? null;

  // ---- Watcher Updates (manual project updates) ----------------------------
  // Aggregate audience counts and the operator's own update text only. No
  // watcher identity is ever fetched here.
  const watcherUpdateStatsQuery = useQuery({
    queryKey: ["launch-watcher-update-stats", selected?.id ?? null],
    enabled: !!selected?.id && !!watchToken,
    queryFn: () => getLaunchWatcherUpdateStats(selected!.id),
  });
  const watcherUpdateStats = watcherUpdateStatsQuery.data ?? null;

  const watcherUpdateHistoryQuery = useQuery({
    queryKey: ["launch-watcher-updates", selected?.id ?? null],
    enabled: !!selected?.id && !!watchToken,
    queryFn: () => listLaunchWatcherUpdates(selected!.id, 10),
  });
  const watcherUpdates = watcherUpdateHistoryQuery.data ?? [];

  // Composing and sending watcher updates moved to Community Command →
  // Broadcasts (C2). Launch Control keeps the read-only audience counts and
  // recent outcomes only, so exactly one send composer exists.

  // ---- C6: pending schedule-change communication ---------------------------

  // Read-only here. The canonical review/notify/dismiss composer lives in
  // Community Command → Broadcasts, so Launch Control only warns and links.
  const scheduleCommQuery = useQuery({
    queryKey: scheduleCommunicationQueryKey(selected?.id ?? null),
    enabled: !!selected?.id,
    queryFn: () => getPendingScheduleCommunication(selected!.id),
  });
  const pendingScheduleComm = scheduleCommQuery.data ?? null;

  // ---- C8.7A: read-only deployment evidence / eligibility ------------------
  // Reuses the existing authenticated `list_launch_chain_deployments` read
  // surface. Nothing here writes, registers, transitions or notifies.
  const deploymentEvidenceQuery = useQuery({
    queryKey: chainDeploymentsQueryKey(selected?.id ?? null),
    enabled: !!selected?.id,
    queryFn: () => listChainDeployments(selected!.id),
  });
  // ---- L-S2: PCART launch setup readiness (read-only, existing surfaces) ----
  const selectedIsCanonicalPcart = !!selected && isCanonicalPcartLaunch(selected);
  const pcartSignerQuery = useQuery({
    queryKey: treasurySignerConfigQueryKey(selected?.id ?? null),
    enabled: !!selected?.id && selectedIsCanonicalPcart,
    queryFn: () => getLaunchTreasurySigners(selected!.id),
  });
  const treasurySafeStatusFn = useServerFn(getTreasurySafeStatus);
  const pcartSafeStatusQuery = useQuery({
    queryKey: treasurySafeStatusQueryKey(selected?.id ?? null),
    enabled: !!selected?.id && selectedIsCanonicalPcart && !!pcartSignerQuery.data,
    queryFn: () => treasurySafeStatusFn({ data: { launchId: selected!.id } }),
  });
  const pcartSafeReady = isPcartTreasurySafeReady({
    persistedSafeAddress: pcartSafeStatusQuery.data?.persistedSafeAddress,
    fresh: pcartSafeStatusQuery.data?.fresh,
  });
  const pcartReadiness = useMemo(
    () =>
      selectedIsCanonicalPcart
        ? derivePcartReadiness({
            auctionIntegrated: false,
            treasurySignersRecorded: !!pcartSignerQuery.data,
            treasurySafeVerified: pcartSafeReady,
            deploymentRows: deploymentEvidenceQuery.data ?? [],
            mainnetLocked: true,
          })
        : null,
    [selectedIsCanonicalPcart, pcartSignerQuery.data, pcartSafeReady, deploymentEvidenceQuery.data],
  );
  // ---- PCART P2: authoritative readiness/control + production draft (read-only) ----
  const pcartProdReadinessQuery = useQuery({
    queryKey: pcartReadinessQueryKey(selected?.id ?? "none"),
    enabled: !!selected?.id && selectedIsCanonicalPcart,
    queryFn: () => fetchPcartReadiness(selected!.id),
  });
  const pcartProductionAttempt = findPcartProductionAttempt(deploymentEvidenceQuery.data);
  const pcartApproved = !!pcartProdReadinessQuery.data?.approval;
  const pcartUnsentDraft = isUnsentPcartDraft(pcartProductionAttempt) ? pcartProductionAttempt : null;
  const pcartPreparationQuery = useQuery({
    queryKey: pcartPreparationQueryKey(pcartUnsentDraft?.id ?? "none"),
    enabled: !!pcartUnsentDraft && pcartProdReadinessQuery.data?.is_platform_owner === true,
    queryFn: () => fetchLatestPcartPreparation(pcartUnsentDraft!.id),
    refetchInterval: 15_000,
  });
  const pcartPermitQuery = useQuery({
    queryKey: pcartExecutionPermitQueryKey(pcartUnsentDraft?.id ?? "none"),
    enabled: !!pcartUnsentDraft && pcartProdReadinessQuery.data?.is_platform_owner === true,
    queryFn: () => fetchLatestPcartExecutionPermit(pcartUnsentDraft!.id),
    refetchInterval: 10_000,
  });
  const pcartSendClaimQuery = useQuery({
    queryKey: pcartSendClaimQueryKey(pcartProductionAttempt?.id ?? "none"),
    enabled: !!pcartProductionAttempt && pcartProdReadinessQuery.data?.is_platform_owner === true,
    queryFn: () => fetchLatestPcartSendClaim(pcartProductionAttempt!.id),
    refetchInterval: 15_000,
  });
  const pcartP5Text = pcartProductionAttempt
    ? pcartP5SummaryText({
        window: pcartSendWindowState(selected?.launch_window_start, selected?.launch_window_end, selected?.status, Date.now()),
        readyToSend: isPcartExecutionPermitActive(pcartPermitQuery.data, Date.now()),
        claimStatus: pcartSendClaimQuery.data && pcartSendClaimQuery.data.claim_status !== "RELEASED" ? pcartSendClaimQuery.data.claim_status : null,
        submitted: !!pcartProductionAttempt.tx_hash || pcartProductionAttempt.status !== "DRAFT",
      })
    : null;
  const pcartMainnetBaseText = pcartMainnetSummary({
    approved: pcartApproved,
    executionLocked: pcartProdReadinessQuery.data?.execution_locked !== false,
    draftSaved: pcartProductionAttempt?.status === "DRAFT",
    walletReady: isPcartPreparationActive(pcartPreparationQuery.data, Date.now()),
    readyToSend: isPcartExecutionPermitActive(pcartPermitQuery.data, Date.now()),
  });
  const pcartMainnetText = pcartP5Text ?? pcartMainnetBaseText;
  const pcartScheduleExpired = isPcartLaunchScheduleExpired(
    selected?.launch_at,
    selected?.launch_window_end,
    Date.now(),
  );
  const deploymentEvidence = useMemo(() => {
    if (!selected) return null;
    return evaluateLaunchDeploymentEvidence(
      {
        launchId: selected.id,
        workspaceId: selected.workspace_id,
        declaredChain: selected.chain,
        launchStatus: selected.status,
        officialContractAddress: selected.official_contract_address,
        officialContractDeploymentId: selected.official_contract_deployment_id,
        contractRegisteredAt: selected.contract_registered_at,
      },
      deploymentEvidenceQuery.data ?? [],
    );
  }, [selected, deploymentEvidenceQuery.data]);
  /** Presentation-only count derived from the existing evidence query. */
  const deploymentRecordCount = deploymentEvidenceQuery.data?.length ?? 0;

  // ---- Launcher-B2: production deployment handoff request ------------------
  // PROJECT launches only. Reading, submitting and withdrawing all go through
  // the existing owner-only RPCs; nothing here deploys, signs, broadcasts,
  // registers a contract, changes lifecycle, notifies Telegram or adds
  // liquidity. The database re-derives every eligibility rule.
  const selectedIsProjectLaunch = !!selected && isProjectLaunch(selected);
  const productionRequestQuery = useQuery({
    queryKey: productionDeploymentRequestQueryKey(
      selectedIsProjectLaunch ? selected!.id : null,
    ),
    enabled: selectedIsProjectLaunch,
    queryFn: () => getLaunchProductionDeploymentRequest(selected!.id),
  });

  const productionRequestHints = useMemo(
    () => ({
      isProjectLaunch: selectedIsProjectLaunch,
      profilePublished: profile?.discovery_status === "published",
      // B2.1 — mirror the server rules exactly: launch_at OR a complete window.
      scheduleSet: selected ? hasSchedule(selected) : false,
      launchStatus: selected?.status ?? "",
      // B2.1 — any one of the three registration fields counts as recorded.
      registrationRecorded: hasRegistrationRecord({
        officialContractAddress: selected?.official_contract_address ?? null,
        officialContractDeploymentId: selected?.official_contract_deployment_id ?? null,
        contractRegisteredAt: selected?.contract_registered_at ?? null,
      }),
      hasProductionDeploymentEvidence: (deploymentEvidenceQuery.data ?? []).some(
        (row) => row.network_environment === "PRODUCTION",
      ),
    }),
    [selectedIsProjectLaunch, profile, selected, deploymentEvidenceQuery.data],
  );

  const invalidateProductionRequest = (launchId: string) => {
    void queryClient.invalidateQueries({
      queryKey: productionDeploymentRequestQueryKey(launchId),
    });
    void queryClient.invalidateQueries({ queryKey: ["launches", workspaceId] });
    void queryClient.invalidateQueries({ queryKey: launchReadinessQueryKey(workspaceId) });
    void queryClient.invalidateQueries({ queryKey: chainDeploymentsQueryKey(launchId) });
  };

  const submitProductionRequestMutation = useMutation({
    mutationFn: async (input: { tokenSupplyWhole: string; tokenRecipient: string }) => {
      if (!selected) throw new Error("No launch selected.");
      return submitLaunchProductionDeploymentRequest({ launchId: selected.id, ...input });
    },
    onSuccess: () => {
      toast.success("Deployment request recorded — nothing has been deployed");
      if (selected) invalidateProductionRequest(selected.id);
    },
    onError: (err: unknown) => {
      toast.error(
        err instanceof Error ? err.message : "Could not record the deployment request.",
      );
    },
  });

  const withdrawProductionRequestMutation = useMutation({
    mutationFn: (requestId: string) => withdrawLaunchProductionDeploymentRequest(requestId),
    onSuccess: () => {
      toast.success("Deployment request withdrawn");
      if (selected) invalidateProductionRequest(selected.id);
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : "Could not withdraw the request.");
    },
  });



  

  // ---- countdown + reminder readiness (saved launch fields only) -----------
  const nowMs = useClientNow(30_000);
  const anchorIso = selected?.launch_at ?? selected?.launch_window_start ?? null;
  const anchorIsWindowStart = !selected?.launch_at && !!selected?.launch_window_start;
  const anchorMs = anchorIso ? new Date(anchorIso).getTime() : null;
  const anchorValid = anchorMs !== null && !Number.isNaN(anchorMs);
  const countdownLabel = anchorIsWindowStart ? "Window opens in" : "Launch in";
  const anchorPassed = anchorValid && nowMs !== null && nowMs >= anchorMs!;
  const countdownText =
    anchorValid && nowMs !== null
      ? anchorPassed
        ? anchorIsWindowStart
          ? "Window opened"
          : "Launch time reached"
        : formatCountdown(anchorMs! - nowMs)
      : null;

  const remindersArmed = REMINDER_ARMED_STATUSES.includes(status);
  const countdownPhaseEnded = status === "LIVE" || status === "COMPLETED";
  const reminder24Iso =
    anchorValid ? new Date(anchorMs! - 24 * 3600_000).toISOString() : null;
  const reminder1Iso = anchorValid ? new Date(anchorMs! - 3600_000).toISOString() : null;

  const armingState: {
    tone: "gold" | "green" | "muted";
    badge: string;
    detail: string;
  } = !anchorValid
    ? {
        tone: "muted",
        badge: "Schedule needed",
        detail:
          "Countdown reminders cannot be timed until this launch has an exact launch time or a launch window.",
      }
    : countdownPhaseEnded
      ? {
          tone: "muted",
          badge: "Countdown phase ended",
          detail:
            "The countdown phase for this launch is over. Reminder delivery no longer applies.",
        }
      : remindersArmed
        ? {
            tone: "green",
            badge: "Countdowns armed",
            detail:
              "Countdown delivery is armed. Each reminder is created when it becomes due and sent privately to active watchers who allow countdowns.",
          }
        : {
            tone: "gold",
            badge: "Not armed yet",
            detail:
              "Watchers can opt in now, but countdown delivery only becomes armed once this launch advances to Launch approaching. Advance before a reminder's due time if you want that reminder delivered.",
          };

  const watchStatsReady = watchSummaryQuery.isSuccess && !!watchSummary;
  const notificationStatsReady = notificationSummaryQuery.isSuccess && !!notificationSummary;
  const mutedCount =
    watchStatsReady && notificationStatsReady
      ? Math.max(watchSummary!.active_count - notificationSummary!.reminder_enabled_watchers, 0)
      : null;



  const blockedReason =
    next === "LAUNCH_APPROACHING" && !scheduleReady
      ? "Set an exact launch time or a complete launch window before you can arm countdowns."
      : next === "OFFICIAL_CONTRACT_REGISTERED" && !contractRegistered
        ? "Complete evidence-bound contract registration first. This launch must be bound to a verified deployment record — address, deployment and registration time — before the official contract reference can be registered."
        : null;

  /**
   * UX-A: presentation-only section indicators. Every value below is already
   * rendered inside the corresponding section — nothing new is asserted, no
   * query is added and no handler, mutation or gate is involved.
   */
  const registrationCandidateReady = Boolean(
    deploymentEvidence?.registrationCandidate && !deploymentEvidence.ambiguous,
  );
  const sectionItems: SectionNavItem[] = LAUNCH_SECTIONS.map((item) => {
    switch (item.id) {
      case "lc-overview":
        return blockedReason
          ? { ...item, state: "blocked" as const, stateLabel: "Blocked" }
          : next
            ? { ...item, state: "attention" as const, stateLabel: "Action available" }
            : { ...item, state: "complete" as const, stateLabel: "Lifecycle complete" };
      case "lc-schedule":
        return scheduleReady
          ? { ...item, state: "complete" as const, stateLabel: "Schedule set" }
          : { ...item, state: "attention" as const, stateLabel: "Schedule not set" };
      case "lc-watch":
        return watchToken
          ? { ...item, state: "complete" as const, stateLabel: "Launch Watch open" }
          : profilePublished
            ? { ...item, state: "attention" as const, stateLabel: "Launch Watch not open yet" }
            : { ...item, state: "blocked" as const, stateLabel: "Publish the project profile first" };
      case "lc-comms":
        return pendingScheduleComm
          ? { ...item, state: "attention" as const, stateLabel: "Schedule change not communicated" }
          : { ...item, state: "neutral" as const };
      case "lc-contract":
        return contractRegistered
          ? { ...item, state: "complete" as const, stateLabel: "Official contract registered" }
          : registrationCandidateReady
            ? { ...item, state: "attention" as const, stateLabel: "Registration available" }
            : { ...item, state: "blocked" as const, stateLabel: "Deployment evidence required" };
      default:
        return { ...item, state: "neutral" as const };
    }
  });

  /**
   * Plain-English contract guidance derived from the same evaluation object the
   * registration panel already uses. Eligibility, finality and registration
   * rules are untouched — this only explains the state the user is already in.
   */
  const contractGuidance: { tone: "green" | "gold" | "muted"; headline: string; why: string; nextUp: string } =
    contractRegistered
      ? {
          tone: "green",
          headline: "Official contract: Registered",
          why: "This launch is bound to a verified deployment record — address, deployment and registration time.",
          nextUp:
            "Notifying watchers and posting to your community remain separate, explicit actions below.",
        }
      : registrationCandidateReady
        ? {
            tone: "gold",
            headline: "Official contract: Ready to register",
            why: "Exactly one verified production deployment qualifies for official registration.",
            nextUp: "Review the candidate below and register the official contract when you are ready.",
          }
        : deploymentEvidence && deploymentEvidence.ambiguous
          ? {
              tone: "muted",
              headline: "Official contract: Not registered yet",
              why: "More than one deployment qualifies, so no candidate is selected automatically.",
              nextUp:
                "Registration stays closed until exactly one qualifying production deployment remains.",
            }
          : {
              tone: "muted",
              headline: "Official contract: Not created or registered yet",
              why: "This launch does not yet have verified production mainnet deployment evidence.",
              nextUp:
                "Production deployment evidence must exist before official contract registration unlocks.",
            };



  const saveButton =
    selected && canManage ? (
      <Button
        type="submit"
        form="launch-editor-form"
        className="min-h-11"
        disabled={saveMutation.isPending || !canSave}
      >
        {saveMutation.isPending ? (
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        ) : (
          <Save className="size-4" aria-hidden="true" />
        )}
        Save launch details
      </Button>
    ) : null;
  const showPersistentSaveAction =
    !selectedIsCanonicalPcart ||
    (activeSection !== "lc-overview" && activeSection !== "lc-contract");

  return (
    <div className="space-y-6 pb-24 sm:space-y-8 lg:pb-0">
      <PageHeader
        eyebrow="Launch Operations"
        title="Launch Control"
        description="Create launches, set the launch schedule, advance the launch through its lifecycle and register the official contract address for this project."
        status={workspace ? workspace.name : "No project"}
      />

      <RelatedLinks label="Go to">
        <Link to="/telegram" className={relatedLinkClass}>
          Community Command
        </Link>
        <Link to="/sticker-lab" className={relatedLinkClass}>
          Sticker Lab
        </Link>
        <Link to="/assets" className={relatedLinkClass}>
          Asset Vault
        </Link>
        <Link to="/project-profile" className={relatedLinkClass}>
          Project Profile
        </Link>
      </RelatedLinks>



      {workspaceLoading ? (
        <Section variant="surface">
          <p className="text-sm text-muted-foreground">Loading project…</p>
        </Section>
      ) : !workspaceId ? (
        <EmptyState
          icon={Rocket}
          title="No project yet"
          description="Add a project from the switcher in the header before setting up launches."
        />
      ) : profileQuery.isLoading ? (
        <Section variant="surface">
          <p className="text-sm text-muted-foreground">Loading project profile…</p>
        </Section>
      ) : profileQuery.isError ? (
        <Section variant="surface" title="Could not load project profile">
          <p className="text-sm text-muted-foreground">
            {(profileQuery.error as Error)?.message ?? "Unexpected error."}
          </p>
          <Button
            variant="outline"
            className="mt-3 min-h-11"
            onClick={() => void profileQuery.refetch()}
          >
            Retry
          </Button>
        </Section>
      ) : !profile ? (
        <EmptyState
          icon={IdCard}
          title="Project Profile required"
          description="Launch Control operates on this project’s identity record. Create the Project Profile first, then return here to add a launch."
          action={
            <Button asChild className="min-h-11">
              <Link to="/project-profile">Go to Project Profile</Link>
            </Button>
          }
        />
      ) : (
        <div className="min-w-0 space-y-4 sm:space-y-6">
          {readOnly && !accessQuery.isLoading ? (
            <Section variant="surface">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <StatusBadge tone="muted">
                  <span>Read only</span>
                </StatusBadge>
                <p className="min-w-0 text-xs leading-relaxed text-muted-foreground">
                  You can view launches for this project. Creating, editing, advancing or
                  deleting a launch requires the project owner or admin role.
                </p>
              </div>
            </Section>
          ) : null}

          <Section
            variant="quiet"
            title="Project launches"
            description="Select a launch to work on. One project profile can hold multiple launches."

            actions={
              canManage ? (
                <Button size="sm" className="min-h-11" onClick={startCreate}>
                  <Plus className="size-4" aria-hidden="true" />
                  New launch
                </Button>
              ) : null
            }
          >
            {launchesQuery.isLoading ? (
              <p className="text-sm text-muted-foreground">Loading launches…</p>
            ) : launchesQuery.isError ? (
              <div>
                <p className="text-sm text-muted-foreground">
                  {(launchesQuery.error as Error)?.message ?? "Could not load launches."}
                </p>
                <Button
                  variant="outline"
                  className="mt-3 min-h-11"
                  onClick={() => void launchesQuery.refetch()}
                >
                  Retry
                </Button>
              </div>
            ) : projectLaunches.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No launches yet. Create a draft launch to begin the lifecycle.
              </p>
            ) : (
              <ul className="grid gap-2.5 sm:grid-cols-2 [&>*]:min-w-0">
                {projectLaunches.map((launch) => {
                  const s = toLaunchStatus(launch.status);
                  const active = launch.id === selectedId;
                  return (
                    <li key={launch.id}>
                      <button
                        type="button"
                        onClick={() => selectProjectLaunch(launch.id)}
                        aria-current={active ? "true" : undefined}
                        className={`hover-lift flex w-full min-w-0 items-start gap-3 rounded-lg border px-3.5 py-3 text-left ${
                          active
                            ? "border-gold/55 bg-gold/8 shadow-[var(--glow-gold)]"
                            : "border-border-subtle bg-background/40"
                        }`}
                      >
                        <span
                          className={`mt-1.5 size-2 shrink-0 rounded-full ${
                            active ? "bg-gold" : "bg-border-strong"
                          }`}
                          aria-hidden="true"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block min-w-0 truncate font-display text-base uppercase leading-tight text-foreground">
                            {launch.token_name}
                          </span>
                          <span className="mt-0.5 block min-w-0 truncate type-technical text-muted-foreground">
                            {launch.ticker} · {launch.chain} · /{launch.public_slug}
                          </span>
                          <span className="mt-2 block">
                            <StatusBadge tone={STATUS_TONE[s]}>
                              <span>{LAUNCH_STATUS_LABELS[s]}</span>
                            </StatusBadge>
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>

            )}
          </Section>

          {/* Owner-only. Internal chain-test records are never part of the
              product surface: the database keeps them permanently DRAFT,
              tokenless and unable to bind an official contract. */}
          {isWorkspaceOwner && !selectedIsCanonicalPcart && internalTestLaunches.length > 0 ? (
            <details className="surface-quiet min-w-0 rounded-lg">
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-3.5 type-eyebrow text-muted-foreground transition-colors hover:text-foreground">
                <span className="min-w-0 [overflow-wrap:anywhere]">Internal test launches ({internalTestLaunches.length})</span>
                <ChevronDown className="size-4 shrink-0 transition-transform [[open]_&]:rotate-180" aria-hidden="true" />
              </summary>
              <div className="min-w-0 space-y-3 px-3.5 pb-3.5">
                <p className="max-w-prose type-helper text-muted-foreground">
                  Permanently private DRAFT chain-test records. They never appear on the Cartel
                  Network, never open Launch Watch, never register an official contract and are
                  never part of the project journey or launch readiness.
                </p>
                <ul className="grid gap-2.5 sm:grid-cols-2 [&>*]:min-w-0">
                  {internalTestLaunches.map((launch) => {
                    const active = launch.id === selectedId;
                    return (
                      <li key={launch.id}>
                        <button
                          type="button"
                          onClick={() => selectInternalLaunch(launch.id)}
                          aria-current={active ? "true" : undefined}
                          className={`hover-lift flex w-full min-w-0 items-start gap-3 rounded-lg border px-3.5 py-3 text-left ${
                            active
                              ? "border-gold/55 bg-gold/8"
                              : "border-border-subtle bg-background/40"
                          }`}
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block min-w-0 truncate font-display text-base uppercase leading-tight text-foreground">
                              {launch.token_name}
                            </span>
                            <span className="mt-0.5 block min-w-0 truncate type-technical text-muted-foreground">
                              {launch.ticker} · {launch.chain} · /{launch.public_slug}
                            </span>
                            <span className="mt-2 flex flex-wrap gap-1.5">
                              <StatusBadge tone="gold">
                                <span>Internal test</span>
                              </StatusBadge>
                              <StatusBadge tone="muted">
                                <span>{LAUNCH_STATUS_LABELS[toLaunchStatus(launch.status)]}</span>
                              </StatusBadge>
                            </span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </details>
          ) : null}

          {/* New launch is a focused dialog so creation fields never mix with
              the selected launch. Same state, inputs, validation and mutation. */}
          <Dialog
            open={creating && canManage}
            onOpenChange={(open) => {
              if (!open) setCreating(false);
            }}
          >
            <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
              <DialogHeader>
                <DialogTitle>New launch</DialogTitle>
                <DialogDescription>
                  Prefilled from the Project Profile. Nothing is saved until you press Create. The
                  Project Profile is not modified.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="min-w-0">
                  <Label htmlFor="new-token-name">Token name</Label>
                  <Input
                    id="new-token-name"
                    maxLength={TOKEN_NAME_MAX}
                    value={newLaunch.token_name}
                    onChange={(e) =>
                      setNewLaunch((n) => ({ ...n, token_name: e.target.value }))
                    }
                  />
                </div>
                <div className="min-w-0">
                  <Label htmlFor="new-ticker">Ticker</Label>
                  <Input
                    id="new-ticker"
                    maxLength={TICKER_MAX}
                    value={newLaunch.ticker}
                    onChange={(e) => setNewLaunch((n) => ({ ...n, ticker: e.target.value }))}
                  />
                </div>
                <div className="min-w-0">
                  <Label htmlFor="new-chain">Chain</Label>
                  <Input
                    id="new-chain"
                    maxLength={CHAIN_MAX}
                    value={newLaunch.chain}
                    onChange={(e) => setNewLaunch((n) => ({ ...n, chain: e.target.value }))}
                  />
                </div>
                <div className="min-w-0">
                  <Label htmlFor="new-slug">Public launch slug</Label>
                  <Input
                    id="new-slug"
                    maxLength={SLUG_MAX}
                    value={newLaunch.public_slug}
                    onChange={(e) =>
                      setNewLaunch((n) => ({ ...n, public_slug: e.target.value }))
                    }
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    {newSlugValid
                      ? "Sets the public launch page address on Cartel Network. The page goes live once the project profile is published and the launch leaves Draft."
                      : SLUG_RULE_HINT}
                  </p>

                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Timezone recorded from this device: {tz}. New launches always start in Draft.
              </p>
              <DialogFooter className="gap-2 sm:gap-2">
                <Button
                  variant="outline"
                  className="min-h-11"
                  onClick={() => setCreating(false)}
                >
                  Cancel
                </Button>
                <Button
                  className="min-h-11"
                  disabled={!canCreate || !canManage || createMutation.isPending}
                  onClick={() => createMutation.mutate()}
                >
                  {createMutation.isPending ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Plus className="size-4" aria-hidden="true" />
                  )}
                  Create draft launch
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>


          {/* INTERNAL_TEST: read-only internal record. No lifecycle controls,
              no schedule, no Launch Watch, no communications and no official
              contract registration are rendered on this path at all. */}
          {selected && selectedIsInternalTest ? (
            <div className="min-w-0 space-y-4 sm:space-y-6">
              <Section variant="hero" className="min-w-0" contentClassName="min-w-0">
                <p className="type-eyebrow text-gold">Internal test record</p>
                <h2 className="mt-1.5 min-w-0 font-display text-2xl uppercase leading-[0.95] text-foreground [overflow-wrap:anywhere] sm:text-3xl">
                  {selected.token_name}
                </h2>
                <div className="mt-2.5 flex min-w-0 flex-wrap items-center gap-1.5">
                  <StatusBadge tone="gold">
                    <span>Internal test</span>
                  </StatusBadge>
                  <StatusBadge tone="muted">
                    <span>{LAUNCH_STATUS_LABELS[status]}</span>
                  </StatusBadge>
                  <StatusBadge tone="muted">
                    <span>{selected.chain}</span>
                  </StatusBadge>
                  <span className="min-w-0 rounded-sm border border-border-subtle bg-background/40 px-2 py-1 type-technical text-muted-foreground [overflow-wrap:anywhere]">
                    /{selected.public_slug}
                  </span>
                </div>
                <p className="mt-3 max-w-prose type-helper text-muted-foreground">
                  This is a permanently private chain-test record. It stays in Draft, never opens
                  Launch Watch, never registers an official contract, never appears on the Cartel
                  Network and is excluded from launch readiness and the project journey.
                </p>
              </Section>

              <Section
                variant="surface"
                title="Chain deployment evidence"
                description="Read-only summary of the deployment attempts recorded against this internal test record."
              >
                <dl className="grid min-w-0 gap-2.5 sm:grid-cols-3">
                  <div className="surface-quiet min-w-0 rounded-lg p-3">
                    <dt className="type-eyebrow text-muted-foreground">Deployment records</dt>
                    <dd className="mt-1.5 font-mono text-lg font-semibold text-foreground">
                      {deploymentEvidenceQuery.isLoading ? "—" : deploymentRecordCount}
                    </dd>
                  </div>
                  <div className="surface-quiet min-w-0 rounded-lg p-3">
                    <dt className="type-eyebrow text-muted-foreground">Declared chain</dt>
                    <dd className="mt-1.5 min-w-0 text-sm font-semibold text-foreground [overflow-wrap:anywhere]">
                      {selected.chain}
                    </dd>
                  </div>
                  <div className="surface-quiet min-w-0 rounded-lg p-3">
                    <dt className="type-eyebrow text-muted-foreground">Created</dt>
                    <dd className="mt-1.5 min-w-0 text-sm font-semibold text-foreground [overflow-wrap:anywhere]">
                      {formatTimestamp(selected.created_at)}
                    </dd>
                  </div>
                </dl>

                <details className="surface-quiet mt-3 min-w-0 rounded-lg">
                  <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-3.5 type-eyebrow text-muted-foreground transition-colors hover:text-foreground">
                <span className="min-w-0 [overflow-wrap:anywhere]">Technical deployment evidence</span>
                <ChevronDown className="size-4 shrink-0 transition-transform [[open]_&]:rotate-180" aria-hidden="true" />
              </summary>
                  <div className="min-w-0 px-3 pb-3">
                    <VerifiedDeploymentEvidencePanel
                      evaluation={deploymentEvidence}
                      loading={deploymentEvidenceQuery.isLoading}
                      error={
                        deploymentEvidenceQuery.isError
                          ? "Could not load deployment evidence for this launch."
                          : null
                      }
                    />
                  </div>
                </details>

                <div className="mt-3 flex flex-wrap gap-2">
                  <Button asChild variant="outline" size="sm" className="min-h-11">
                    <Link to="/chain-launcher">Testnet Lab</Link>
                  </Button>
                  <Button asChild variant="outline" size="sm" className="min-h-11">
                    <Link to="/mainnet-canary">Mainnet Deployment</Link>
                  </Button>
                </div>
              </Section>
            </div>
          ) : null}

          {selected && !selectedIsInternalTest ? (
            <>
            <SectionNav
              label="Launch Control sections"
              items={sectionItems}
              activeId={activeSection}
              onChange={selectSection}
            />

            {/* Every working view stays mounted. Only visibility changes, so
                form state, queries, mutation state and idempotency outcomes
                survive navigation. */}
            <WorkingView id="lc-overview" active={activeSection === "lc-overview"}>
              {pcartReadiness ? (
                <div className="mb-4 min-w-0">
                  <PcartLaunchSetupGuide readiness={pcartReadiness} />
                </div>
              ) : null}
              <LaunchControlHero
                identity={
                  <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
                    <div className="min-w-0">
                      <p className="type-eyebrow text-gold">Selected launch</p>
                      <h2 className="mt-2 min-w-0 font-display text-3xl uppercase leading-none text-foreground [overflow-wrap:anywhere] sm:text-4xl lg:text-5xl">
                        {selected.token_name}
                      </h2>
                      <div className="mt-3 flex min-w-0 flex-wrap items-center gap-2">
                        <StatusBadge tone="gold"><span>{selected.ticker}</span></StatusBadge>
                        <StatusBadge tone="muted"><span>{selected.chain}</span></StatusBadge>
                        <span className="min-w-0 rounded-sm border border-border-subtle bg-background/40 px-2 py-1 type-technical text-muted-foreground [overflow-wrap:anywhere]">
                          /{selected.public_slug}
                        </span>
                      </div>
                      <p className="mt-4 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                        {LAUNCH_STATUS_HELP[status]}
                      </p>
                    </div>
                    <StatusBadge tone={STATUS_TONE[status]}><span>{LAUNCH_STATUS_LABELS[status]}</span></StatusBadge>
                  </div>
                }
                facts={
                  <LaunchFacts
                    facts={[
                      {
                        label: "Schedule",
                        value: selected.launch_at
                          ? formatTimestamp(selected.launch_at)
                          : selected.launch_window_start && selected.launch_window_end
                            ? `${formatTimestamp(selected.launch_window_start)} → ${formatTimestamp(selected.launch_window_end)}`
                            : "Not set",
                        detail: countdownText
                          ? anchorPassed
                            ? countdownText
                            : `${countdownLabel} ${countdownText}`
                          : undefined,
                      },
                      {
                        label: "Launch Watch",
                        value: !watchToken
                          ? "Not opened yet"
                          : watchSummaryQuery.isLoading
                            ? "Loading watcher count…"
                            : watchSummaryQuery.isError
                              ? "Watcher count unavailable"
                              : `${watchSummary?.active_count ?? 0} active`,
                        detail:
                          watchToken && watchSummaryQuery.isSuccess
                            ? `${watchSummary?.total_count ?? 0} total opt-ins · ${watchAcceptingNew ? "Accepting new watchers" : "Closed to new watchers"}`
                            : undefined,
                      },
                      {
                        label: "Official contract",
                        value: contractRegistered
                          ? "Registered"
                          : status === "CONTRACT_PENDING"
                            ? "Pending registration"
                            : "Not yet available",
                      },
                    ]}
                  />
                }
                action={
                  <div className="min-w-0">
                    <p className="type-eyebrow text-gold">{next ? "Next lifecycle action" : "Current step"}</p>
                    <h3 className="mt-3 min-w-0 text-xl font-semibold leading-snug text-foreground [overflow-wrap:anywhere]">
                      {next ? NEXT_ACTION_GUIDE[status].nextAction : NEXT_ACTION_GUIDE[status].current}
                    </h3>
                    <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{NEXT_ACTION_GUIDE[status].means}</p>
                    {blockedReason ? (
                      <p className="mt-4 rounded-md border border-border-subtle bg-background/40 p-3 text-xs leading-relaxed text-muted-foreground">
                        {blockedReason}
                      </p>
                    ) : null}
                    {next && canManage && blockedReason ? (
                      <Button className="mt-4 min-h-11 w-full whitespace-normal" onClick={() => selectSection(next === "LAUNCH_APPROACHING" ? "lc-schedule" : "lc-contract")}>
                        {next === "LAUNCH_APPROACHING" ? "Open Schedule" : "Open Deploy & Contract"}
                      </Button>
                    ) : next && canManage ? (
                      <Button className="mt-4 min-h-11 w-full whitespace-normal" disabled={transitionMutation.isPending} onClick={() => transitionMutation.mutate(next)}>
                        {transitionMutation.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
                        {TRANSITION_BUTTON_LABEL[status]}
                      </Button>
                    ) : next ? (
                      <p className="mt-4 text-xs leading-relaxed text-muted-foreground">Advancing the lifecycle requires the project owner or admin role.</p>
                    ) : (
                      <p className="mt-4 text-xs leading-relaxed text-muted-foreground">This launch has reached the final lifecycle state.</p>
                    )}
                    <details className="mt-4 border-t border-gold/15 pt-3">
                      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 type-eyebrow text-muted-foreground">
                        What happens next
                        <ChevronDown className="size-4 shrink-0 transition-transform [[open]_&]:rotate-180" aria-hidden="true" />
                      </summary>
                      <p className="pb-1 text-xs leading-relaxed text-muted-foreground">{NEXT_ACTION_GUIDE[status].after}</p>
                    </details>
                  </div>
                }
                lifecycle={
                  <LaunchLifecycleRail
                    currentId={status}
                    steps={LAUNCH_STATUSES.map((launchStatus) => ({
                      id: launchStatus,
                      label: LAUNCH_STATUS_LABELS[launchStatus],
                      description: LIFECYCLE_GUIDE[launchStatus].body,
                    }))}
                  />
                }
              />

              <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(17rem,1fr)]">
                <Section variant="surface" title="Selected launch facts" description="Saved operational state for this launch." contentClassName="space-y-3">
                  <dl className="grid min-w-0 gap-x-5 gap-y-3 sm:grid-cols-2">
                    <PreviewRow label="Project" value={profile.project_name} />
                    <PreviewRow label="Launch" value={selected.token_name} />
                    <PreviewRow label="Ticker" value={selected.ticker} />
                    <PreviewRow label="Chain" value={selected.chain} />
                    <PreviewRow label="Public path" value={`/${selected.public_slug}`} />
                    <PreviewRow label="Status" value={LAUNCH_STATUS_LABELS[status]} />
                  </dl>
                </Section>
                <Section variant="quiet" title="Project setup" description="Project-wide progress, separate from this launch's lifecycle." contentClassName="space-y-3">
                  {projectJourneyQuery.isPending ? (
                    <p className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="size-4 animate-spin" aria-hidden="true" />Checking project setup…</p>
                  ) : projectJourneyQuery.isError ? (
                    <div><p className="text-xs text-muted-foreground">Project setup is unavailable right now.</p><Button variant="outline" size="sm" className="mt-3 min-h-11" onClick={() => void projectJourneyQuery.refetch()}>Retry</Button></div>
                  ) : projectJourneyQuery.data ? (
                    <>
                      <div className="flex items-center justify-between gap-3 text-xs"><span className="text-muted-foreground">Project journey</span><strong className="text-foreground">{projectJourneyQuery.data.completedCount}/{projectJourneyQuery.data.totalCount}</strong></div>
                      <ProjectJourneyProgress value={projectJourneyQuery.data.completedCount} total={projectJourneyQuery.data.totalCount} />
                      <p className="text-xs leading-relaxed text-muted-foreground">{projectJourneyQuery.data.nextAction.explanation}</p>
                    </>
                  ) : null}
                </Section>
              </div>

            <details className="surface-quiet min-w-0 rounded-lg">
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-3.5 type-eyebrow text-muted-foreground transition-colors hover:text-foreground">
                <span className="min-w-0 [overflow-wrap:anywhere]">Lifecycle timestamps</span>
                <ChevronDown className="size-4 shrink-0 transition-transform [[open]_&]:rotate-180" aria-hidden="true" />
              </summary>
              <div className="min-w-0 px-3.5 pb-3.5">
                <dl className="space-y-1.5 text-xs">
                  {(
                    [
                      ["Created", selected.created_at],
                      ["Status changed", selected.status_changed_at],
                      ["Announced", selected.announced_at],
                      ["Watchlist opened", selected.watchlist_opened_at],
                      ["Launch approaching", selected.launch_approaching_at],
                      ["Contract pending", selected.contract_pending_at],
                      ["Contract registered", selected.contract_registered_at],
                      ["Live", selected.live_at],
                      ["Completed", selected.completed_at],
                    ] as const
                  )
                    .filter(([, value]) => Boolean(value))
                    .map(([label, value]) => (
                      <div key={label} className="flex min-w-0 justify-between gap-3">
                        <dt className="shrink-0 text-muted-foreground">{label}</dt>
                        <dd className="min-w-0 truncate text-right text-foreground">
                          {formatTimestamp(value)}
                        </dd>
                      </div>
                    ))}
                </dl>
              </div>
            </details>
            </WorkingView>

            {form ? (
              <form
                id="launch-editor-form"
                className="min-w-0"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!canSave) return;
                  saveMutation.mutate();
                }}
              >
                <WorkingView id="lc-details" active={activeSection === "lc-details"}>
                  <Section
                    variant="primary"
                    title="Launch identity"
                    description={
                      idLocked
                        ? "Identity fields are locked once the launch is announced."
                        : "Identity fields can only be edited while the launch is a draft."
                    }
                  >
                    <div className="mb-5 border-b border-border-subtle pb-4">
                      <p className="type-eyebrow text-muted-foreground">Identity preview</p>
                      <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2">
                        <span className="min-w-0 text-lg font-semibold text-foreground [overflow-wrap:anywhere]">
                          {form.token_name || "Untitled launch"}
                        </span>
                        <StatusBadge tone="gold"><span>{form.ticker || "No ticker"}</span></StatusBadge>
                        <StatusBadge tone="muted"><span>{form.chain || "No chain"}</span></StatusBadge>
                      </div>
                      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                        {idLocked
                          ? "This saved identity is locked because the launch has left Draft."
                          : "This preview follows the editable identity below. Identity locks after the launch leaves Draft."}
                      </p>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="min-w-0">
                        <Label htmlFor="token-name">Token name</Label>
                        <Input
                          id="token-name"
                          maxLength={TOKEN_NAME_MAX}
                          disabled={idLocked || readOnly}
                          value={form.token_name}
                          onChange={(e) => set({ token_name: e.target.value })}
                        />
                      </div>
                      <div className="min-w-0">
                        <Label htmlFor="ticker">Ticker</Label>
                        <Input
                          id="ticker"
                          maxLength={TICKER_MAX}
                          disabled={idLocked || readOnly}
                          value={form.ticker}
                          onChange={(e) => set({ ticker: e.target.value })}
                        />
                      </div>
                      <div className="min-w-0">
                        <Label htmlFor="chain">Chain</Label>
                        <Input
                          id="chain"
                          maxLength={CHAIN_MAX}
                          disabled={idLocked || readOnly}
                          value={form.chain}
                          onChange={(e) => set({ chain: e.target.value })}
                        />
                      </div>
                      <div className="min-w-0">
                        <Label htmlFor="slug">Public launch slug</Label>
                        <Input
                          id="slug"
                          maxLength={SLUG_MAX}
                          disabled={idLocked || readOnly}
                          value={form.public_slug}
                          onChange={(e) => set({ public_slug: e.target.value })}
                        />
                        <p className="mt-1 text-xs text-muted-foreground">{SLUG_RULE_HINT}</p>
                      </div>
                    </div>
                    {identityError ? (
                      <p className="mt-3 text-xs text-destructive">{identityError}</p>
                    ) : null}
                  </Section>

                  <Section
                    variant="quiet"
                    title="Internal notes"
                    description="Operator-only. Never shown outside this project."
                  >
                    <Textarea
                      id="internal-notes"
                      rows={4}
                      maxLength={NOTES_MAX}
                      disabled={readOnly}
                      value={form.internal_notes}
                      onChange={(e) => set({ internal_notes: e.target.value })}
                    />
                    <p className="mt-1 text-xs text-muted-foreground">
                      {form.internal_notes.length} / {NOTES_MAX} characters.
                    </p>
                    {notesError ? (
                      <p className="mt-1 text-xs text-destructive">{notesError}</p>
                    ) : null}
                  </Section>
                </WorkingView>

                <WorkingView id="lc-schedule" active={activeSection === "lc-schedule"}>
                  <Section
                    variant="surface"
                    title="Schedule"
                    description={
                      schedLocked
                        ? "Schedule fields are locked once the launch is live."
                        : `Times are entered and displayed in this device's timezone (${tz}) and stored as absolute timestamps. There is no arbitrary timezone conversion in this phase.`
                    }
                  >
                    <div className="mb-5 grid min-w-0 gap-3 border-b border-border-subtle pb-4 sm:grid-cols-2">
                      <div className="surface-quiet min-w-0 rounded-md p-3">
                        <p className="type-eyebrow text-muted-foreground">Saved schedule</p>
                        <p className="mt-1.5 text-sm font-semibold leading-snug text-foreground [overflow-wrap:anywhere]">
                          {selected.launch_at
                            ? formatTimestamp(selected.launch_at)
                            : selected.launch_window_start && selected.launch_window_end
                              ? `${formatTimestamp(selected.launch_window_start)} → ${formatTimestamp(selected.launch_window_end)}`
                              : "Not set"}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">Recorded timezone: {selected.timezone}</p>
                      </div>
                      <div className="surface-quiet min-w-0 rounded-md p-3">
                        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                          <p className="type-eyebrow text-muted-foreground">Reminder state</p>
                          <StatusBadge tone={armingState.tone}><span>{armingState.badge}</span></StatusBadge>
                        </div>
                        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{armingState.detail}</p>
                      </div>
                    </div>
                    {scheduleCommQuery.isError ? (
                      <div className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
                        Could not check whether this launch has an unnotified schedule change.
                        <button
                          type="button"
                          className="ml-2 underline underline-offset-2"
                          onClick={() => void scheduleCommQuery.refetch()}
                        >
                          Retry
                        </button>
                      </div>
                    ) : null}
                    {pendingScheduleComm ? (
                      <div className="mb-4 rounded-lg border border-primary/40 bg-primary/10 p-4">
                        <div className="flex items-start gap-2">
                          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-primary" />
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-semibold text-foreground">
                              Schedule changed · Watchers have not been notified.
                            </p>
                            <div className="mt-3">
                              <ScheduleChangeSummary row={pendingScheduleComm} />
                            </div>
                            <Button asChild size="sm" className="mt-4 min-h-11">
                              <Link
                                to="/telegram"
                                search={{ tab: "broadcasts", launch: selected.id }}
                              >
                                Review &amp; notify in Community Command
                              </Link>
                            </Button>
                            {readOnly ? (
                              <p className="mt-2 text-xs text-muted-foreground">
                                You have read-only access. An owner or admin decides whether to
                                notify watchers.
                              </p>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    ) : null}
                    <div className="grid gap-3 sm:grid-cols-2">

                      <div className="min-w-0">
                        <Label htmlFor="schedule-mode">Schedule mode</Label>
                        <Select
                          value={form.schedule_mode}
                          disabled={schedLocked || readOnly}
                          onValueChange={(v) => set({ schedule_mode: v as ScheduleMode })}
                        >
                          <SelectTrigger id="schedule-mode" className="min-h-11">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">Not set</SelectItem>
                            <SelectItem value="exact">Exact time</SelectItem>
                            <SelectItem value="window">Launch window</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      {form.schedule_mode === "exact" ? (
                        <div className="min-w-0">
                          <Label htmlFor="launch-at">Launch time</Label>
                          <Input
                            id="launch-at"
                            type="datetime-local"
                            disabled={schedLocked || readOnly}
                            value={form.launch_at}
                            onChange={(e) => set({ launch_at: e.target.value })}
                          />
                        </div>
                      ) : null}
                      {form.schedule_mode === "window" ? (
                        <>
                          <div className="min-w-0">
                            <Label htmlFor="window-start">Window start</Label>
                            <Input
                              id="window-start"
                              type="datetime-local"
                              disabled={schedLocked || readOnly}
                              value={form.window_start}
                              onChange={(e) => set({ window_start: e.target.value })}
                            />
                          </div>
                          <div className="min-w-0">
                            <Label htmlFor="window-end">Window end</Label>
                            <Input
                              id="window-end"
                              type="datetime-local"
                              disabled={schedLocked || readOnly}
                              value={form.window_end}
                              onChange={(e) => set({ window_end: e.target.value })}
                            />
                          </div>
                        </>
                      ) : null}
                    </div>
                    <p className="mt-3 text-xs text-muted-foreground">
                      Recorded timezone on this launch: {selected.timezone}
                    </p>
                    {scheduleError ? (
                      <p className="mt-2 text-xs text-destructive">{scheduleError}</p>
                    ) : null}
                  </Section>
                </WorkingView>
              </form>
            ) : null}

            {/* Save / preview / delete live outside the form element so the
                destructive action can never submit it. */}
            <WorkingView id="lc-details-actions" active={activeSection === "lc-details"}>
              <div className="hidden lg:flex lg:justify-end">{saveButton}</div>

              <Section
                variant="surface"
                title="Launch preview"
                description="How this launch appears to operators, plus its public Cartel Network page once it is out of Draft."
              >
                <dl className="space-y-1.5 text-xs">
                  <PreviewRow label="Project" value={profile.project_name} />
                  <PreviewRow label="Token" value={selected.token_name} />
                  <PreviewRow label="Ticker" value={selected.ticker} />
                  <PreviewRow label="Chain" value={selected.chain} />

                  <PreviewRow
                    label="Schedule"
                    value={
                      selected.launch_at
                        ? formatTimestamp(selected.launch_at)
                        : selected.launch_window_start && selected.launch_window_end
                          ? `${formatTimestamp(selected.launch_window_start)} → ${formatTimestamp(selected.launch_window_end)}`
                          : "Not set"
                    }
                  />
                  <PreviewRow
                    label="Network path"
                    value={`/network/launch/${selected.public_slug}`}
                  />
                </dl>
                {status !== "DRAFT" && profile.discovery_status === "published" ? (
                  <Button asChild variant="outline" size="sm" className="mt-3 w-full sm:w-auto">
                    <Link
                      to="/network/launch/$launchSlug"
                      params={{ launchSlug: selected.public_slug }}
                    >
                      View Network Launch
                    </Link>
                  </Button>
                ) : (
                  <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                    {status === "DRAFT"
                      ? "Draft launches are never public. Announce this launch to publish its Cartel Network page."
                      : "Publish your Project Profile to make this launch page live on the Cartel Network."}
                  </p>
                )}
              </Section>

              {canManage && canDeleteLaunch(status) ? (
                <Section
                  variant="quiet"
                  title="Delete draft"
                  description="Only draft launches can be deleted. Once announced, a launch record is permanent."
                >
                  <Button
                    type="button"
                    variant="destructive"
                    className="min-h-11"
                    onClick={() => setConfirmDelete(true)}
                  >
                    <Trash2 className="size-4" aria-hidden="true" />
                    Delete draft launch
                  </Button>
                </Section>
              ) : null}
            </WorkingView>

            <WorkingView id="lc-watch" active={activeSection === "lc-watch"}>
                <Section
                  variant="surface"
                  title="Launch Watch"
                  leading={<Bell className="size-4" aria-hidden="true" />}
                >
                  {watchToken ? (
                    <div className="space-y-3">
                      <div className="min-w-0">
                        <p className="type-eyebrow text-muted-foreground">
                          Telegram deep link
                        </p>
                        <p className="mt-1.5 min-w-0 break-all rounded-md border border-gold/25 bg-background/60 px-3 py-2.5 type-technical text-foreground">
                          {watchLink}
                        </p>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          className="min-h-11"
                          onClick={async () => {
                            const write = navigator.clipboard?.writeText;
                            if (!write) {
                              toast.error("Clipboard access is unavailable. Copy the link manually.");
                              return;
                            }
                            try {
                              await navigator.clipboard.writeText(watchLink!);
                              toast.success("Launch Watch link copied");
                            } catch {
                              toast.error("Could not copy the link. Copy it manually.");
                            }
                          }}
                        >
                          <Copy className="size-4" aria-hidden="true" />
                          Copy link
                        </Button>
                        <Button asChild size="sm" variant="outline" className="min-h-11">
                          <a href={watchLink!} target="_blank" rel="noreferrer noopener">
                            <ExternalLink className="size-4" aria-hidden="true" />
                            Open Telegram
                          </a>
                        </Button>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <StatusBadge tone={watchAcceptingNew ? "green" : "muted"}>
                          <span>
                            {watchAcceptingNew ? "Accepting new watchers" : "Closed to new watchers"}
                          </span>
                        </StatusBadge>
                        <span className="text-xs text-muted-foreground">
                          {watchSummaryQuery.isLoading
                            ? "Loading watcher count…"
                            : `${watchSummary?.active_count ?? 0} active · ${watchSummary?.total_count ?? 0} total opt-ins`}
                        </span>
                      </div>

                      {!profilePublished ? (
                        <p className="text-xs leading-relaxed text-muted-foreground">
                          This Project Profile is not Published. The deep link will not accept new
                          watchers until the Project Profile discovery status is Published.
                        </p>
                      ) : isLaunchWatchClosedStatus(status) ? (
                        <p className="text-xs leading-relaxed text-muted-foreground">
                          New Launch Watch sign-ups are closed at this lifecycle stage. Existing
                          opt-ins and the link are preserved.
                        </p>
                      ) : null}

                      <div className="surface-quiet min-w-0 rounded-lg p-3.5">
                        <p className="type-eyebrow text-muted-foreground">
                          Watcher activity
                        </p>
                        {watchSummaryQuery.isError ? (
                          <div className="mt-2">
                            <p className="text-xs leading-relaxed text-muted-foreground">
                              Watcher counts could not be loaded right now.
                            </p>
                            <Button
                              variant="outline"
                              size="sm"
                              className="mt-2 min-h-11"
                              onClick={() => void watchSummaryQuery.refetch()}
                            >
                              Retry
                            </Button>
                          </div>
                        ) : (
                          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                            <div className="min-w-0">
                              <dt className="text-muted-foreground">Active watchers</dt>
                              <dd className="mt-0.5 font-mono text-lg font-semibold text-foreground">
                                {watchStatsReady ? watchSummary!.active_count : "—"}
                              </dd>
                            </div>
                            <div className="min-w-0">
                              <dt className="text-muted-foreground">Total opt-ins</dt>
                              <dd className="mt-0.5 font-mono text-lg font-semibold text-foreground">
                                {watchStatsReady ? watchSummary!.total_count : "—"}
                              </dd>
                            </div>
                            <div className="min-w-0">
                              <dt className="text-muted-foreground">Countdown reminders on</dt>
                              <dd className="mt-0.5 font-mono text-lg font-semibold text-foreground">
                                {notificationStatsReady
                                  ? notificationSummary!.reminder_enabled_watchers
                                  : "—"}
                              </dd>
                            </div>
                            <div className="min-w-0">
                              <dt className="text-muted-foreground">Countdown reminders muted</dt>
                              <dd className="mt-0.5 font-mono text-lg font-semibold text-foreground">
                                {mutedCount ?? "—"}
                              </dd>
                            </div>
                          </dl>
                        )}
                        {!watchSummaryQuery.isError &&
                        (!watchStatsReady || !notificationStatsReady) ? (
                          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                            {notificationSummaryQuery.isError
                              ? "Reminder opt-in counts are unavailable right now."
                              : "Loading watcher activity…"}
                          </p>
                        ) : null}
                      </div>

                      <div className="surface-quiet min-w-0 rounded-lg p-3.5">
                        <p className="type-eyebrow text-muted-foreground">
                          Private confirmation health
                        </p>
                        {confirmationSummaryQuery.isError ? (
                          <div className="mt-2">
                            <p className="text-xs leading-relaxed text-muted-foreground">
                              Confirmation counts could not be loaded right now.
                            </p>
                            <Button
                              variant="outline"
                              size="sm"
                              className="mt-2 min-h-11"
                              onClick={() => void confirmationSummaryQuery.refetch()}
                            >
                              Retry
                            </Button>
                          </div>
                        ) : (
                          <>
                            <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                              <div className="min-w-0">
                                <dt className="text-muted-foreground">Confirmations delivered</dt>
                                <dd className="mt-0.5 font-mono text-lg font-semibold text-foreground">
                                  {confirmationStatsReady ? confirmationSummary!.delivered_count : "—"}
                                </dd>
                              </div>
                              <div className="min-w-0">
                                <dt className="text-muted-foreground">Confirmation failed</dt>
                                <dd className="mt-0.5 font-mono text-lg font-semibold text-foreground">
                                  {confirmationStatsReady ? confirmationSummary!.failed_count : "—"}
                                </dd>
                              </div>
                              <div className="min-w-0">
                                <dt className="text-muted-foreground">Outcome unconfirmed</dt>
                                <dd className="mt-0.5 font-mono text-lg font-semibold text-foreground">
                                  {confirmationStatsReady ? confirmationSummary!.ambiguous_count : "—"}
                                </dd>
                              </div>
                              <div className="min-w-0">
                                <dt className="text-muted-foreground">Pre-tracking opt-ins</dt>
                                <dd className="mt-0.5 font-mono text-lg font-semibold text-foreground">
                                  {confirmationStatsReady ? confirmationSummary!.untracked_count : "—"}
                                </dd>
                              </div>
                            </dl>
                            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                              {confirmationStatsReady
                                ? "Counts describe the most recent private confirmation message per active watcher. Outcome unconfirmed means Telegram never returned a clear result, so the message may or may not have arrived; it is never resent automatically. Pre-tracking opt-ins happened before confirmation diagnostics existed — their delivery cannot be reconstructed and is not a failure."
                                : "Loading confirmation health…"}
                            </p>
                          </>
                        )}
                      </div>



                      <div className="surface-quiet min-w-0 rounded-lg p-3.5">
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <StatusBadge tone={armingState.tone}>
                            <span>{armingState.badge}</span>
                          </StatusBadge>
                          <span className="type-eyebrow text-muted-foreground">
                            Countdown delivery
                          </span>
                        </div>
                        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                          {armingState.detail}
                        </p>
                        {anchorValid && !countdownPhaseEnded ? (
                          <dl className="mt-2 space-y-1.5 text-xs">
                            <div className="min-w-0">
                              <dt className="text-muted-foreground">24h reminder</dt>
                              <dd className="text-foreground [overflow-wrap:anywhere]">
                                {formatTimestamp(reminder24Iso)}
                                {nowMs !== null &&
                                !remindersArmed &&
                                new Date(reminder24Iso!).getTime() < nowMs
                                  ? " · missed (countdowns were not armed)"
                                  : ""}
                              </dd>
                            </div>
                            <div className="min-w-0">
                              <dt className="text-muted-foreground">1h reminder</dt>
                              <dd className="text-foreground [overflow-wrap:anywhere]">
                                {formatTimestamp(reminder1Iso)}
                                {nowMs !== null &&
                                !remindersArmed &&
                                new Date(reminder1Iso!).getTime() < nowMs
                                  ? " · missed (countdowns were not armed)"
                                  : ""}
                              </dd>
                            </div>
                          </dl>
                        ) : null}
                        {anchorValid && !countdownPhaseEnded ? (
                          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                            Times shown in this device’s timezone ({tz}).
                            {anchorIsWindowStart
                              ? " A launch window counts down to the window start."
                              : ""}
                          </p>
                        ) : null}
                      </div>

                      <details className="surface-quiet min-w-0 rounded-lg">
                        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-3.5 type-eyebrow text-muted-foreground transition-colors hover:text-foreground">
                <span className="min-w-0 [overflow-wrap:anywhere]">How Launch Watch works</span>
                <ChevronDown className="size-4 shrink-0 transition-transform [[open]_&]:rotate-180" aria-hidden="true" />
              </summary>
                        <div className="space-y-2 px-3 pb-3">
                          <ol className="list-decimal space-y-1 pl-4 text-xs leading-relaxed text-muted-foreground">
                            <li>A user taps “Watch this launch” from a community post or public link.</li>
                            <li>Telegram opens the private @PepeCartelHQBot chat and they press Start.</li>
                            <li>
                              The bot privately confirms the watch and gives Mute Countdowns and Stop
                              Watching controls.
                            </li>
                            <li>
                              Eligible 24h and 1h reminders, the official-contract packet and the
                              launch-live alert arrive in that private bot chat.
                            </li>
                          </ol>
                          <p className="text-xs leading-relaxed text-muted-foreground">
                            Joining your Telegram community does not subscribe anyone. Each watcher
                            must opt in through Launch Watch.
                          </p>
                        </div>
                      </details>

                      <p className="text-xs leading-relaxed text-muted-foreground">
                        Launch Watch is privacy-first: project operators see aggregate watcher
                        activity, not individual Telegram identities.
                      </p>
                      <p className="text-xs leading-relaxed text-muted-foreground">
                        Automated messages are the countdown reminders, the official-contract
                        notice and the launch-live alert. Manual project updates are sent separately
                        from Communications.
                      </p>

                    </div>
                  ) : (
                    <div className="space-y-2">
                      <p className="text-xs leading-relaxed text-muted-foreground">
                        The Launch Watch link is generated automatically the first time this launch
                        reaches Watchlist open.
                      </p>
                      <p className="text-xs leading-relaxed text-muted-foreground">
                        Watchers who join through that link receive the countdown reminders,
                        official-contract packet and launch-live alert for this launch.
                      </p>
                    </div>
                  )}
                </Section>
            </WorkingView>

            <WorkingView id="lc-comms" active={activeSection === "lc-comms"}>
                <Section
                  variant="surface"
                  title="Watcher Updates"
                  leading={<Megaphone className="size-4" aria-hidden="true" />}
                  description="Send a private text update to active watchers who allow Project Updates."
                >
                  {watchToken ? (
                    <div className="space-y-3">
                      <ul className="space-y-1 text-xs leading-relaxed text-muted-foreground">
                        <li>
                          Delivered as a private @PepeCartelHQBot message to active watchers who
                          allow Project Updates.
                        </li>
                        <li>Separate from countdown reminders — muting one never mutes the other.</li>
                        <li>Never posted to your connected Telegram community group.</li>
                        <li>No watcher identities are exposed in CARTEL HQ.</li>
                      </ul>

                      <div className="surface-quiet min-w-0 rounded-lg p-3.5">
                        <p className="type-eyebrow text-muted-foreground">
                          Update audience
                        </p>
                        {watcherUpdateStatsQuery.isError ? (
                          <div className="mt-2">
                            <p className="text-xs leading-relaxed text-muted-foreground">
                              Update audience counts could not be loaded right now.
                            </p>
                            <Button
                              variant="outline"
                              size="sm"
                              className="mt-2 min-h-11"
                              onClick={() => void watcherUpdateStatsQuery.refetch()}
                            >
                              Retry
                            </Button>
                          </div>
                        ) : (
                          <dl className="mt-2 grid grid-cols-3 gap-x-4 gap-y-2 text-xs">
                            <div className="min-w-0">
                              <dt className="text-muted-foreground">Active watchers</dt>
                              <dd className="mt-0.5 font-mono text-lg font-semibold text-foreground">
                                {watcherUpdateStats ? watcherUpdateStats.active_watchers : "—"}
                              </dd>
                            </div>
                            <div className="min-w-0">
                              <dt className="text-muted-foreground">Project updates on</dt>
                              <dd className="mt-0.5 font-mono text-lg font-semibold text-foreground">
                                {watcherUpdateStats
                                  ? watcherUpdateStats.updates_enabled_watchers
                                  : "—"}
                              </dd>
                            </div>
                            <div className="min-w-0">
                              <dt className="text-muted-foreground">Project updates muted</dt>
                              <dd className="mt-0.5 font-mono text-lg font-semibold text-foreground">
                                {watcherUpdateStats ? watcherUpdateStats.updates_muted_watchers : "—"}
                              </dd>
                            </div>
                          </dl>
                        )}
                        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                          Watchers who opted in before Project Updates existed agreed to countdowns
                          and launch alerts only, so they start with Project Updates off. They keep
                          receiving countdowns, the official-contract notice and the launch-live
                          alert. Their older Launch Watch message may not show the new control yet:
                          they can open the Launch Watch link again or interact with their Launch
                          Watch controls in @PepeCartelHQBot to receive refreshed controls, then
                          choose “Enable project updates”. CARTEL HQ never silently opts them in.
                        </p>
                      </div>

                      {canManage ? (
                        <div className="space-y-2">
                          <Button className="min-h-11" asChild>
                            <Link
                              to="/telegram"
                              search={{ tab: "broadcasts", launch: selected!.id }}
                            >
                              <Megaphone className="size-4" aria-hidden="true" />
                              Send update in Community Command
                            </Link>
                          </Button>
                          <p className="text-xs leading-relaxed text-muted-foreground">
                            {canSendWatcherUpdate(status)
                              ? "Composing and sending watcher updates now lives in Community Command → Broadcasts, with this launch preselected."
                              : `Watcher updates can be sent from Watchlist open through Live. This launch is currently ${LAUNCH_STATUS_LABELS[status]}.`}
                          </p>
                        </div>
                      ) : (
                        <p className="text-xs leading-relaxed text-muted-foreground">
                          Only project owners and admins can send watcher updates. You can view the
                          audience counts and update history.
                        </p>
                      )}


                      <div className="surface-quiet min-w-0 rounded-lg p-3.5">
                        <p className="type-eyebrow text-muted-foreground">
                          Recent updates
                        </p>
                        {watcherUpdateHistoryQuery.isError ? (
                          <div className="mt-2">
                            <p className="text-xs leading-relaxed text-muted-foreground">
                              Update history could not be loaded right now.
                            </p>
                            <Button
                              variant="outline"
                              size="sm"
                              className="mt-2 min-h-11"
                              onClick={() => void watcherUpdateHistoryQuery.refetch()}
                            >
                              Retry
                            </Button>
                          </div>
                        ) : watcherUpdateHistoryQuery.isLoading ? (
                          <p className="mt-2 text-xs text-muted-foreground">Loading updates…</p>
                        ) : watcherUpdates.length === 0 ? (
                          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                            No manual watcher updates have been sent for this launch.
                          </p>
                        ) : (
                          <ul className="mt-2 space-y-3">
                            {watcherUpdates.map((item) => (
                              <li
                                key={item.event_id}
                                className="min-w-0 rounded-md border border-border/50 bg-background/40 p-2.5"
                              >
                                <p className="text-xs font-semibold text-foreground [overflow-wrap:anywhere]">
                                  {item.title ?? "Project update"}
                                </p>
                                <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">
                                  {item.body}
                                </p>
                                <p className="mt-1.5 text-xs text-muted-foreground">
                                  {formatTimestamp(item.created_at)}
                                </p>
                                <dl className="mt-1.5 grid grid-cols-3 gap-x-3 gap-y-1 text-xs sm:grid-cols-5">
                                  {(
                                    [
                                      ["Pending", item.pending_count],
                                      ["Delivered", item.sent_count],
                                      ["Failed", item.failed_count],
                                      ["Outcome unconfirmed", item.ambiguous_count],
                                      ["Skipped", item.skipped_count],
                                    ] as const
                                  ).map(([label, value]) => (
                                    <div key={label} className="min-w-0">
                                      <dt className="truncate type-eyebrow text-muted-foreground">
                                        {label}
                                      </dt>
                                      <dd className="mt-0.5 font-mono text-lg font-semibold text-foreground">{value}</dd>
                                    </div>
                                  ))}
                                </dl>
                              </li>
                            ))}
                          </ul>
                        )}
                        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                          Aggregate delivery counts only. Individual watchers, Telegram identifiers
                          and delivery rows are never shown.
                        </p>
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      Watcher updates become available once this launch reaches Watchlist open and
                      the Launch Watch link starts collecting watchers.
                    </p>
                  )}
                </Section>

                <details className="surface-quiet min-w-0 rounded-lg">
                  <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-3.5 type-eyebrow text-muted-foreground transition-colors hover:text-foreground">
                <span className="min-w-0 [overflow-wrap:anywhere]">Advanced communication diagnostics</span>
                <ChevronDown className="size-4 shrink-0 transition-transform [[open]_&]:rotate-180" aria-hidden="true" />
              </summary>
                  <div className="min-w-0 px-3 pb-3">
                <Section
                  variant="quiet"
                  title="Telegram alerts for watchers"
                  leading={<Bell className="size-4" aria-hidden="true" />}
                >
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge tone="green">
                        <span>Telegram alerts active</span>
                      </StatusBadge>
                      <span className="text-xs text-muted-foreground">
                        Messages are only sent to active watchers of this launch.
                      </span>
                    </div>

                    <ul className="space-y-1 text-xs leading-relaxed text-muted-foreground">
                      <li>24h + 1h countdown reminders (watchers who allow them)</li>
                      <li>Official-contract registration notice</li>
                      <li>Launch-live alert</li>
                      <li>Manual project updates (watchers who allow them)</li>
                    </ul>

                    {watchToken ? (
                      <>
                        <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-3">
                          {(
                            [
                              ["Alerts created", notificationSummary?.event_count],
                              ["Waiting to send", notificationSummary?.pending_count],
                              ["Delivered", notificationSummary?.sent_count],
                              ["Failed", notificationSummary?.failed_count],
                              ["Outcome unconfirmed", notificationSummary?.ambiguous_count],
                              ["Not sent (muted or stopped)", notificationSummary?.skipped_count],
                              ["Reminder opt-ins", notificationSummary?.reminder_enabled_watchers],
                            ] as const
                          ).map(([label, value]) => (
                            <div key={label} className="min-w-0">
                              <dt className="truncate type-eyebrow text-muted-foreground">
                                {label}
                              </dt>
                              <dd className="mt-0.5 font-mono text-lg font-semibold text-foreground">
                                {notificationSummaryQuery.isLoading ? "—" : (value ?? 0)}
                              </dd>
                            </div>
                          ))}
                        </dl>

                        <p className="text-xs leading-relaxed text-muted-foreground">
                          <span className="text-foreground">Outcome unconfirmed</span> means
                          Telegram never confirmed whether the message arrived. Those are
                          deliberately not resent automatically, so a watcher is never messaged
                          twice.
                        </p>

                        <p className="text-xs leading-relaxed text-muted-foreground">
                          <span className="text-foreground">Alerts created</span> counts every
                          watcher alert for this launch, including manual project updates. It can
                          stay at 0 even with a saved schedule and active watchers: reminder events
                          are created when the 24h or 1h reminder actually becomes due, not when the
                          launch date is saved, and countdown delivery must be in an armed lifecycle
                          state at that moment.
                        </p>

                      </>
                    ) : (

                      <p className="text-xs leading-relaxed text-muted-foreground">
                        Notification delivery becomes relevant once this launch reaches Watchlist
                        open and the Launch Watch link starts collecting watchers.
                      </p>
                    )}

                    <p className="text-xs leading-relaxed text-muted-foreground">
                      Advancing to Official contract registered or Live queues one Telegram message
                      per active watcher, and countdown reminders are scheduled from the launch
                      time for watchers who allow them.
                    </p>

                    <p className="text-xs leading-relaxed text-muted-foreground">
                      Only aggregate counts are shown. Individual deliveries, Telegram identifiers
                      and watcher identities are never exposed in Cartel HQ.
                    </p>
                  </div>
                </Section>
                  </div>
                </details>
            </WorkingView>

            <WorkingView id="lc-contract" active={activeSection === "lc-contract"}>
                {!selectedIsCanonicalPcart ? (
                <Section
                  variant="surface"
                  className={
                    contractGuidance.tone === "green"
                      ? "min-w-0 border-pepe/35"
                      : contractGuidance.tone === "gold"
                        ? "min-w-0 border-gold/45"
                        : "min-w-0"
                  }
                  contentClassName="space-y-3"
                >
                  <div className="flex min-w-0 items-start gap-3">
                    <span
                      className={`flex size-9 shrink-0 items-center justify-center rounded-md border ${
                        contractGuidance.tone === "green"
                          ? "border-pepe/45 bg-pepe/10 text-pepe"
                          : contractGuidance.tone === "gold"
                            ? "border-gold/45 bg-gold/10 text-gold"
                            : "border-border-strong bg-background/50 text-muted-foreground"
                      }`}
                    >
                      <ShieldCheck className="size-5" aria-hidden="true" />
                    </span>
                    <div className="min-w-0">
                      <p className="min-w-0 text-base font-semibold leading-snug text-foreground [overflow-wrap:anywhere]">
                        {contractGuidance.headline}
                      </p>
                      <p className="mt-1 max-w-prose text-xs leading-relaxed text-muted-foreground sm:text-sm">
                        <span className="font-semibold text-foreground/85">Why: </span>
                        {contractGuidance.why}
                      </p>
                      <p className="mt-1 max-w-prose text-xs leading-relaxed text-muted-foreground sm:text-sm">
                        <span className="font-semibold text-foreground/85">What happens next: </span>
                        {contractGuidance.nextUp}
                      </p>
                    </div>
                  </div>
                  <p className="min-w-0 border-t border-border-subtle pt-3 type-helper text-muted-foreground">
                    Registration, corrections, watcher notification and community posting stay
                    separate, explicit actions. Registering never messages anyone on its own.
                  </p>
                </Section>
                ) : null}

                {/* Generic deployment guidance remains unchanged. Canonical
                    PCART uses the single authoritative setup guide above. */}
                {selected && selectedIsProjectLaunch && !selectedIsCanonicalPcart ? (
                  <div className="min-w-0 space-y-2 rounded-lg border border-border-subtle bg-surface-raised/30 p-4">
                    <p className="text-sm font-semibold leading-snug text-foreground">
                      Deployment path — before deployment
                    </p>
                    <ol className="min-w-0 space-y-1.5 text-xs leading-relaxed text-muted-foreground">
                      <li>
                        <span className="font-semibold text-foreground">Now — </span>
                        Save the three treasury signer wallets below.
                      </li>
                      <li>
                        <span className="font-semibold text-foreground/80">Later — </span>
                        Create and verify the 2-of-3 Safe. That is a separate, explicitly
                        authorized step.
                      </li>
                      <li>
                        <span className="font-semibold text-foreground/80">Then — </span>
                        Request the production deployment, using the verified Safe address as the
                        token recipient.
                      </li>
                      <li>
                        <span className="font-semibold text-foreground/80">Finally — </span>
                        Verify the deployment evidence and register the official contract.
                      </li>
                    </ol>
                    <p className="min-w-0 border-t border-border-subtle pt-2 text-[11px] leading-relaxed text-muted-foreground">
                      Saving signer wallets does not create the Safe.
                    </p>
                  </div>
                ) : null}

                {/* PCART Treasury Signer Setup — records the three intended
                    public signer wallets only. It creates no Safe, signs
                    nothing, moves nothing and does not gate the request below. */}
                {selected && selectedIsProjectLaunch ? (
                  <TreasurySignerSetupPanel
                    launchId={selected.id}
                    isWorkspaceOwner={isWorkspaceOwner}
                    disabled={readOnly}
                    compact={selectedIsCanonicalPcart}
                  />
                ) : null}

                {/* PCART treasury Safe creation — one explicit wallet
                    confirmation, no auto-retry. Separate from token
                    deployment controls, which stay locked. */}
                {selected && selectedIsCanonicalPcart && pcartSignerQuery.data ? (
                  <TreasurySafeCreatePanel
                    launchId={selected.id}
                    isWorkspaceOwner={isWorkspaceOwner}
                    signerConfig={pcartSignerQuery.data}
                    disabled={readOnly}
                  />
                ) : null}

                {/* Launcher-B2 — guided handoff request, before the technical
                    deployment evidence details. PROJECT launches only. */}
                {selected && selectedIsProjectLaunch && isCanonicalPcartLaunch(selected) ? (
                  pcartSafeReady ? (
                    <div className="min-w-0 space-y-2">
                      <p className="text-sm font-semibold text-foreground">
                        Next step: Final production readiness
                      </p>
                      <PcartProductionBlockedCheckpoint launchId={selected.id} />
                      {pcartApproved && pcartProdReadinessQuery.data?.is_platform_owner === true && pcartSignerQuery.data ? (
                        <PcartProductionReviewPanel
                          launchId={selected.id}
                          signers={pcartSignerQuery.data.signers}
                          attempt={pcartProductionAttempt}
                        />
                      ) : null}
                      {pcartApproved && pcartProdReadinessQuery.data?.is_platform_owner === true && pcartUnsentDraft ? (
                        <PcartWalletPreparationPanel attempt={pcartUnsentDraft} />
                      ) : null}
                      {pcartApproved && pcartProdReadinessQuery.data?.is_platform_owner === true && pcartUnsentDraft ? (
                        <PcartFinalSendReviewPanel attempt={pcartUnsentDraft} />
                      ) : null}
                      {pcartApproved && pcartProdReadinessQuery.data?.is_platform_owner === true && pcartProductionAttempt &&
                      (pcartUnsentDraft || pcartProductionAttempt.status === "SUBMITTED") ? (
                        <PcartMainnetSendPanel
                          attempt={pcartProductionAttempt}
                          launchWindowStart={selected.launch_window_start ?? null}
                          launchWindowEnd={selected.launch_window_end ?? null}
                          lifecycle={selected.status ?? null}
                          onChanged={() => queryClient.invalidateQueries({ queryKey: chainDeploymentsQueryKey(selected.id) })}
                        />
                      ) : null}
                    </div>
                  ) : null
                ) : selected && selectedIsProjectLaunch ? (
                  <ProductionDeploymentRequestPanel
                    launchId={selected.id}
                    launchTokenName={selected.token_name}
                    launchTicker={selected.ticker}
                    request={productionRequestQuery.data ?? null}
                    requestLoading={productionRequestQuery.isLoading}
                    requestError={
                      productionRequestQuery.error instanceof Error
                        ? productionRequestQuery.error.message
                        : null
                    }
                    hints={productionRequestHints}
                    isWorkspaceOwner={isWorkspaceOwner}
                    disabled={readOnly}
                    submitting={submitProductionRequestMutation.isPending}
                    withdrawing={withdrawProductionRequestMutation.isPending}
                    submitError={
                      submitProductionRequestMutation.error instanceof Error
                        ? submitProductionRequestMutation.error.message
                        : null
                    }
                    withdrawError={
                      withdrawProductionRequestMutation.error instanceof Error
                        ? withdrawProductionRequestMutation.error.message
                        : null
                    }
                    onSubmit={(input) => submitProductionRequestMutation.mutate(input)}
                    onWithdraw={(id) => withdrawProductionRequestMutation.mutate(id)}
                  />
                ) : null}

                {selected && selectedIsCanonicalPcart && pcartReadiness ? (
                  <PcartReviewLaunchSummary
                    tokenName={selected.token_name}
                    ticker={selected.ticker}
                    chain={selected.chain}
                    fixedSupply={`${PCART_FIXED_INTENT.totalSupplyWhole.toLocaleString("en-US")} ${PCART_FIXED_INTENT.symbol}`}
                    readiness={pcartReadiness}
                    mainnetSummary={pcartMainnetText}
                    scheduleExpired={pcartScheduleExpired}
                  />
                ) : null}




                {/* Canonical PCART: later-stage registration/comms stay hidden
                    until that stage is genuinely relevant. Generic unchanged. */}
                {!selectedIsCanonicalPcart ? (
                <>
                <dl className="grid min-w-0 gap-2.5 sm:grid-cols-3">
                  <div className="surface-quiet min-w-0 rounded-lg p-3">
                    <dt className="type-eyebrow text-muted-foreground">Registration</dt>
                    <dd
                      className={`mt-1.5 min-w-0 text-sm font-semibold leading-snug [overflow-wrap:anywhere] ${
                        contractRegistered ? "text-pepe" : "text-foreground"
                      }`}
                    >
                      {contractRegistered
                        ? "Bound to verified deployment evidence"
                        : status === "CONTRACT_PENDING"
                          ? "Open — not registered yet"
                          : "Not available at this lifecycle stage"}
                    </dd>
                  </div>
                  <div className="surface-quiet min-w-0 rounded-lg p-3">
                    <dt className="type-eyebrow text-muted-foreground">Deployment records</dt>
                    <dd className="mt-1.5 font-mono text-lg font-semibold text-foreground">
                      {deploymentEvidenceQuery.isLoading ? "—" : deploymentRecordCount}
                    </dd>
                  </div>
                  <div className="surface-quiet min-w-0 rounded-lg p-3">
                    <dt className="type-eyebrow text-muted-foreground">Registered at</dt>
                    <dd className="mt-1.5 min-w-0 text-sm font-semibold leading-snug text-foreground [overflow-wrap:anywhere]">
                      {selected.contract_registered_at
                        ? formatTimestamp(selected.contract_registered_at)
                        : "—"}
                    </dd>
                  </div>
                </dl>

                <VerifiedContractRegistrationPanel
                  evaluation={deploymentEvidence}
                  launchId={selected.id}
                  launchStatus={status}
                  officialContractAddress={selected.official_contract_address}
                  officialContractDeploymentId={selected.official_contract_deployment_id}
                  contractRegisteredAt={selected.contract_registered_at}
                  isWorkspaceOwner={isWorkspaceOwner}
                  disabled={readOnly}
                  pending={registerContractMutation.isPending}
                  onRegister={(deploymentId, expectedAddress) =>
                    registerContractMutation.mutate({ deploymentId, expectedAddress })
                  }
                />

                <OfficialContractNotifyPanel
                  launchStatus={status}
                  registrationComplete={contractRegistered}
                  isWorkspaceOwner={isWorkspaceOwner}
                  disabled={readOnly}
                  pending={notifyContractMutation.isPending}
                  result={notifyOutcomeForSelected?.result ?? null}
                  error={notifyOutcomeForSelected?.error ?? null}
                  onNotify={() => notifyContractMutation.mutate()}
                />

                <OfficialContractGroupBroadcastPanel
                  launchStatus={status}
                  registrationComplete={contractRegistered}
                  officialContractAddress={selected.official_contract_address}
                  chain={selected.chain}
                  isWorkspaceOwner={isWorkspaceOwner}
                  groups={broadcastGroupsQuery.data ?? []}
                  groupsLoading={broadcastGroupsQuery.isLoading}
                  disabled={readOnly}
                  pending={broadcastContractMutation.isPending}
                  result={broadcastOutcomeForSelected?.result ?? null}
                  error={broadcastOutcomeForSelected?.error ?? null}
                  onBroadcast={(groupConnectionId) =>
                    broadcastContractMutation.mutate(groupConnectionId)
                  }
                />

                <OfficialContractCorrectionPanel
                  launchId={selected.id}
                  launchStatus={status}
                  registrationComplete={contractRegistered}
                  officialContractAddress={selected.official_contract_address}
                  officialContractDeploymentId={selected.official_contract_deployment_id}
                  isWorkspaceOwner={isWorkspaceOwner}
                  evaluation={deploymentEvidence}
                  events={registrationEventsQuery.data ?? []}
                  eventsLoading={registrationEventsQuery.isLoading}
                  eventsError={
                    registrationEventsQuery.isError
                      ? "Could not load the registration history for this launch."
                      : null
                  }
                  disabled={readOnly}
                  pending={correctContractMutation.isPending}
                  result={correctionOutcomeForSelected?.result ?? null}
                  error={correctionOutcomeForSelected?.error ?? null}
                  onCorrect={(input) => correctContractMutation.mutate(input)}
                  groups={broadcastGroupsQuery.data ?? []}
                  groupsLoading={broadcastGroupsQuery.isLoading}
                  correctionNotifyPending={correctionNotifyMutation.isPending}
                  correctionNotifyResult={
                    correctionNotifyOutcome &&
                    correctionNotifyOutcome.launchId === selected.id &&
                    correctionNotifyOutcome.registrationEventId === latestRegistrationEventId
                      ? correctionNotifyOutcome.result
                      : null
                  }
                  correctionNotifyError={
                    correctionNotifyOutcome &&
                    correctionNotifyOutcome.launchId === selected.id &&
                    correctionNotifyOutcome.registrationEventId === latestRegistrationEventId
                      ? correctionNotifyOutcome.error
                      : null
                  }
                  correctionBroadcastPending={correctionBroadcastMutation.isPending}
                  correctionBroadcastResult={
                    correctionBroadcastOutcome &&
                    correctionBroadcastOutcome.launchId === selected.id &&
                    correctionBroadcastOutcome.registrationEventId === latestRegistrationEventId
                      ? correctionBroadcastOutcome.result
                      : null
                  }
                  correctionBroadcastError={
                    correctionBroadcastOutcome &&
                    correctionBroadcastOutcome.launchId === selected.id &&
                    correctionBroadcastOutcome.registrationEventId === latestRegistrationEventId
                      ? correctionBroadcastOutcome.error
                      : null
                  }
                  onNotifyCorrection={(registrationEventId) =>
                    correctionNotifyMutation.mutate(registrationEventId)
                  }
                  onBroadcastCorrection={(groupConnectionId, registrationEventId) =>
                    correctionBroadcastMutation.mutate({ groupConnectionId, registrationEventId })
                  }
                />
                </>
                ) : null}


                {/* Generic launch evidence remains available exactly as before.
                    Canonical PCART omits this historical material from its
                    current-step flow without changing the underlying data. */}
                {!selectedIsCanonicalPcart ? (
                  <details className="surface-quiet min-w-0 rounded-lg">
                  <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-3.5 type-eyebrow text-muted-foreground transition-colors hover:text-foreground">
                    <span className="min-w-0 [overflow-wrap:anywhere]">Technical deployment evidence</span>
                    <ChevronDown className="size-4 shrink-0 transition-transform [[open]_&]:rotate-180" aria-hidden="true" />
                  </summary>
                  <div className="min-w-0 px-3 pb-3">
                    <VerifiedDeploymentEvidencePanel
                      evaluation={deploymentEvidence}
                      loading={deploymentEvidenceQuery.isLoading}
                      error={
                        deploymentEvidenceQuery.isError
                          ? "Could not load deployment evidence for this launch."
                          : null
                      }
                    />
                  </div>
                  </details>
                ) : null}
            </WorkingView>
            </>
          ) : null}

        </div>
      )}


      {selected && !selectedIsInternalTest && showPersistentSaveAction && saveButton ? (
        <StickyActionBar desktop="hidden" end={saveButton} />
      ) : null}




      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this draft launch?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the draft launch record. Only drafts can be deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                deleteMutation.mutate();
              }}
            >
              Delete draft
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function PreviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 justify-between gap-3">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate text-right text-foreground">{value}</dd>
    </div>
  );
}

/**
 * Controlled working view. Inactive views stay mounted — only visibility
 * changes — so form state, queries, mutation state and idempotency outcomes
 * survive navigation between sections.
 */
function WorkingView({
  id,
  active,
  children,
}: {
  id?: string;
  active: boolean;
  children: ReactNode;
}) {
  return (
    <div
      id={id}
      hidden={!active}
      aria-hidden={active ? undefined : true}
      className="min-w-0 space-y-4 sm:space-y-6"
    >
      {children}
    </div>
  );
}
