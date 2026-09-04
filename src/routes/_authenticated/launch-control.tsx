import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Bell,

  Check,
  Copy,
  ExternalLink,
  IdCard,
  Loader2,
  Megaphone,
  Plus,
  Rocket,
  Save,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { useWorkspace } from "@/lib/workspace-context";
import { getProjectProfile } from "@/lib/project-profile";
import {
  CHAIN_MAX,
  CONTRACT_MAX,
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
  localInputToIso,
  nextLaunchStatus,
  nullableText,
  scheduleLocked,
  setLaunchContractAddress,
  slugifyLaunch,
  toLaunchStatus,
  transitionLaunchStatus,
  updateLaunchDetails,
  type LaunchRow,
  type LaunchStatus,
} from "@/lib/launch-control";

import { PageHeader } from "@/components/cartel/PageHeader";
import { Section } from "@/components/cartel/Section";
import { EmptyState } from "@/components/cartel/EmptyState";
import { StatusBadge } from "@/components/cartel/StatusBadge";
import { ScheduleChangeSummary } from "@/components/cartel/ScheduleChangeSummary";
import { LaunchReadinessCallout } from "@/components/cartel/LaunchReadiness";
import { VerifiedDeploymentEvidencePanel } from "@/components/cartel/VerifiedDeploymentEvidencePanel";
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
      "Contract-address entry becomes available. Save the official contract address before advancing.",
  },
  OFFICIAL_CONTRACT_REGISTERED: {
    title: "Official Contract Registered",
    body:
      "The authenticated project has formally registered the official contract address. Active watchers receive the Verified Launch Packet through the existing notification engine.",
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
      "Contract Pending: the official contract address field becomes editable.",
  },
  CONTRACT_PENDING: {
    current: "Contract Pending",
    means:
      "Contract-address entry is open. Save the official contract address, then register it.",
    nextAction: "Register official contract",
    after:
      "Official Contract Registered: active watchers receive the Verified Launch Packet.",
  },
  OFFICIAL_CONTRACT_REGISTERED: {
    current: "Official Contract Registered",
    means:
      "The authenticated project has formally registered the official contract address. Active watchers will receive the Verified Launch Packet.",
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
  CONTRACT_PENDING: "Register official contract",
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
  const tz = useMemo(() => deviceTimezone(), []);

  const profileQuery = useQuery({
    queryKey: ["project-profile", workspaceId],
    enabled: !!workspaceId,
    queryFn: () => getProjectProfile(workspaceId!),
  });
  const profile = profileQuery.data ?? null;

  const launchesQuery = useQuery({
    queryKey: ["launches", workspaceId],
    enabled: !!workspaceId && !!profile,
    queryFn: () => listLaunches(workspaceId!),
  });
  const launches = useMemo(() => launchesQuery.data ?? [], [launchesQuery.data]);

  // Local permission hint only. RLS and the RPCs remain authoritative.
  const accessQuery = useQuery({
    queryKey: ["launch-access", workspaceId, workspace?.owner_id ?? null],
    enabled: !!workspaceId,
    queryFn: () => getLaunchAccess(workspaceId!, workspace?.owner_id ?? null),
  });
  const canManage = accessQuery.data?.canManage ?? false;
  const readOnly = !canManage;



  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = launches.find((l) => l.id === selectedId) ?? null;

  useEffect(() => {
    if (launches.length === 0) {
      setSelectedId(null);
      return;
    }
    if (!launches.some((l) => l.id === selectedId)) setSelectedId(launches[0]!.id);
  }, [launches, selectedId]);

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

  const [contractInput, setContractInput] = useState("");
  useEffect(() => {
    setContractInput(selected?.official_contract_address ?? "");
  }, [selected?.id, selected?.official_contract_address]);

  const contractMutation = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error("No launch selected.");
      return setLaunchContractAddress(selected.id, contractInput);
    },
    onSuccess: () => {
      toast.success("Official contract address saved");
      void invalidate();
    },
    onError: (err: unknown) =>
      toast.error(
        err instanceof Error ? err.message : "Could not save the official contract address.",
      ),
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
  const contractSaved = Boolean(selected?.official_contract_address);

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
  const deploymentEvidence = useMemo(() => {
    if (!selected) return null;
    return evaluateLaunchDeploymentEvidence(
      {
        launchId: selected.id,
        workspaceId: selected.workspace_id,
        declaredChain: selected.chain,
        launchStatus: selected.status,
        officialContractAddress: selected.official_contract_address,
        contractRegisteredAt: selected.contract_registered_at,
      },
      deploymentEvidenceQuery.data ?? [],
    );
  }, [selected, deploymentEvidenceQuery.data]);





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
      : next === "OFFICIAL_CONTRACT_REGISTERED" && !contractSaved
        ? "Save the official contract address before registering it."
        : null;

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


  return (
    <div className="space-y-6 pb-24 sm:space-y-8 lg:pb-0">
      <PageHeader
        eyebrow="Launch Operations"
        title="Launch Control"
        description="Create launches, set the launch schedule, advance the launch through its lifecycle and register the official contract address for this project."
        status={workspace ? workspace.name : "No project"}
      />

      {profile ? <LaunchReadinessCallout workspaceId={workspaceId} /> : null}



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
            title="Launches"
            description={`Select a launch to work on. One project profile can hold multiple launches.`}

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
            ) : launches.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No launches yet. Create a draft launch to begin the lifecycle.
              </p>
            ) : (
              <ul className="grid gap-2 sm:grid-cols-2 [&>*]:min-w-0">
                {launches.map((launch) => {
                  const s = toLaunchStatus(launch.status);
                  const active = launch.id === selectedId;
                  return (
                    <li key={launch.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(launch.id)}
                        className={`flex w-full min-w-0 items-center justify-between gap-3 rounded-lg border px-3 py-3 text-left transition-colors ${
                          active
                            ? "border-gold/50 bg-gold/5"
                            : "border-border bg-background/40 hover:bg-surface-raised/60"
                        }`}
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-semibold text-foreground">
                            {launch.token_name}
                          </span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {launch.ticker} · {launch.chain} · /{launch.public_slug}
                          </span>
                        </span>
                        <StatusBadge tone={STATUS_TONE[s]}>
                          <span>{LAUNCH_STATUS_LABELS[s]}</span>
                        </StatusBadge>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>

          {creating && canManage ? (
            <Section
              variant="surface"
              title="New launch"
              description="Prefilled from the Project Profile. Nothing is saved until you press Create. The Project Profile is not modified."
            >
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
              <p className="mt-3 text-xs text-muted-foreground">
                Timezone recorded from this device: {tz}. New launches always start in Draft.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
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
                <Button
                  variant="outline"
                  className="min-h-11"
                  onClick={() => setCreating(false)}
                >
                  Cancel
                </Button>
              </div>
            </Section>
          ) : null}

          {selected ? (
            <Section variant="hero" className="min-w-0">
              <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
                <div className="min-w-0 space-y-3">
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 sm:flex sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="type-meta text-gold">Selected launch</p>
                      <h2 className="mt-1 min-w-0 font-display text-2xl uppercase leading-tight text-foreground [overflow-wrap:anywhere] sm:text-3xl">
                        {selected.token_name}
                      </h2>
                      <p className="mt-1 text-xs text-muted-foreground [overflow-wrap:anywhere]">
                        {selected.ticker} · {selected.chain} · /{selected.public_slug}
                      </p>
                    </div>
                    <StatusBadge tone={STATUS_TONE[status]}>
                      <span>{LAUNCH_STATUS_LABELS[status]}</span>
                    </StatusBadge>
                  </div>

                  <dl className="grid gap-3 sm:grid-cols-3">
                    <div className="min-w-0">
                      <dt className="type-meta text-muted-foreground">Schedule</dt>
                      <dd className="mt-1 text-xs leading-relaxed text-foreground [overflow-wrap:anywhere]">
                        {selected.launch_at
                          ? formatTimestamp(selected.launch_at)
                          : selected.launch_window_start && selected.launch_window_end
                            ? `${formatTimestamp(selected.launch_window_start)} → ${formatTimestamp(selected.launch_window_end)}`
                            : "Not set"}
                      </dd>
                      {countdownText ? (
                        <dd className="mt-1 text-xs leading-relaxed text-gold [overflow-wrap:anywhere]">
                          {anchorPassed ? countdownText : `${countdownLabel} ${countdownText}`}
                        </dd>
                      ) : null}

                    </div>
                    <div className="min-w-0">
                      <dt className="type-meta text-muted-foreground">Launch Watch</dt>
                      <dd className="mt-1 text-xs leading-relaxed text-foreground">
                        {!watchToken
                          ? "Not opened yet"
                          : watchSummaryQuery.isLoading
                            ? "Loading watcher count…"
                            : `${watchSummary?.active_count ?? 0} active · ${watchSummary?.total_count ?? 0} total opt-ins`}
                      </dd>
                    </div>
                    <div className="min-w-0">
                      <dt className="type-meta text-muted-foreground">Official contract</dt>
                      <dd className="mt-1 text-xs leading-relaxed text-foreground">
                        {contractSaved
                          ? "Registered"
                          : status === "CONTRACT_PENDING"
                            ? "Pending registration"
                            : "Not yet available"}
                      </dd>
                    </div>
                  </dl>
                </div>

                <div className="min-w-0 space-y-3">
                  <p className="type-meta text-muted-foreground">Lifecycle progress</p>
                  <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4 lg:grid-cols-2">

                    {LAUNCH_STATUSES.map((s) => {
                      const current = s === status;
                      const done = launchStatusIndex(s) < launchStatusIndex(status);
                      return (
                        <span
                          key={s}
                          className={`flex min-w-0 items-center gap-1.5 rounded-md border px-2 py-1.5 ${
                            current
                              ? "border-gold/50 bg-gold/5"
                              : done
                                ? "border-pepe/30 bg-pepe/5"
                                : "border-border/60 bg-background/30"
                          }`}
                        >
                          <span
                            className={`flex size-3.5 shrink-0 items-center justify-center rounded-full border ${
                              done
                                ? "border-pepe/50 text-pepe"
                                : current
                                  ? "border-gold/60 text-gold"
                                  : "border-border text-muted-foreground"
                            }`}
                          >
                            {done ? <Check className="size-2.5" aria-hidden="true" /> : null}
                          </span>
                          <span
                            className={`min-w-0 truncate text-[10px] font-semibold uppercase tracking-[0.12em] ${
                              current
                                ? "text-gold"
                                : done
                                  ? "text-foreground"
                                  : "text-muted-foreground"
                            }`}
                          >
                            {LAUNCH_STATUS_LABELS[s]}
                          </span>
                        </span>
                      );
                    })}
                  </div>

                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {LAUNCH_STATUS_HELP[status]}
                  </p>

                  {next ? (
                    <div className="space-y-3">
                      <div className="rounded-md border border-gold/20 bg-gold/5 p-3">
                        <p className="type-meta text-gold">Current step</p>
                        <p className="mt-1 text-sm font-semibold text-foreground">
                          {NEXT_ACTION_GUIDE[status].current}
                        </p>
                        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                          {NEXT_ACTION_GUIDE[status].means}
                        </p>
                        <div className="mt-2 border-t border-gold/10 pt-2">
                          <p className="type-meta text-gold">Next action</p>
                          <p className="mt-0.5 text-xs text-foreground">
                            {NEXT_ACTION_GUIDE[status].nextAction}
                          </p>
                        </div>
                        <div className="mt-2 border-t border-gold/10 pt-2">
                          <p className="type-meta text-gold">What happens next</p>
                          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                            {NEXT_ACTION_GUIDE[status].after}
                          </p>
                        </div>
                      </div>

                      {blockedReason ? (
                        <p className="text-xs text-muted-foreground">{blockedReason}</p>
                      ) : null}
                      {canManage ? (
                        <Button
                          className="min-h-11 w-full"
                          disabled={transitionMutation.isPending || !!blockedReason}
                          onClick={() => transitionMutation.mutate(next)}
                        >
                          {transitionMutation.isPending ? (
                            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                          ) : null}
                          {TRANSITION_BUTTON_LABEL[status]}
                        </Button>
                      ) : (
                        <p className="text-xs text-muted-foreground">
                          Advancing the lifecycle requires the project owner or admin role.
                        </p>
                      )}
                      <p className="text-xs text-muted-foreground">
                        Only the single next step is available. The database enforces every
                        transition rule.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="rounded-md border border-border/60 bg-background/30 p-3">
                        <p className="type-meta text-muted-foreground">Current step</p>
                        <p className="mt-1 text-sm font-semibold text-foreground">
                          {NEXT_ACTION_GUIDE[status].current}
                        </p>
                        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                          {NEXT_ACTION_GUIDE[status].means}
                        </p>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        This launch has reached the final lifecycle state.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </Section>
          ) : null}

          {selected ? (
            <Section
              variant="surface"
              title="Launch lifecycle guide"
              description="What each lifecycle stage means for operators."
            >
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {LAUNCH_STATUSES.map((s) => {
                  const guide = LIFECYCLE_GUIDE[s];
                  const current = s === status;
                  const done = launchStatusIndex(s) < launchStatusIndex(status);
                  return (
                    <div
                      key={s}
                      className={`rounded-md border p-3 ${
                        current
                          ? "border-gold/50 bg-gold/5"
                          : done
                            ? "border-pepe/30 bg-pepe/5"
                            : "border-border/60 bg-background/30"
                      }`}
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <span
                          className={`flex size-4 shrink-0 items-center justify-center rounded-full border text-[10px] ${
                            done
                              ? "border-pepe/50 text-pepe"
                              : current
                                ? "border-gold/60 text-gold"
                                : "border-border text-muted-foreground"
                          }`}
                        >
                          {done ? <Check className="size-2.5" aria-hidden="true" /> : null}
                        </span>
                        <p
                          className={`min-w-0 truncate text-xs font-semibold uppercase tracking-[0.12em] ${
                            current
                              ? "text-gold"
                              : done
                                ? "text-foreground"
                                : "text-muted-foreground"
                          }`}
                        >
                          {guide.title}
                        </p>
                      </div>
                      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                        {guide.body}
                      </p>
                    </div>
                  );
                })}
              </div>
            </Section>
          ) : null}

          {selected ? (
            <div className="grid min-w-0 gap-4 sm:gap-6 xl:grid-cols-2">
              <div className="min-w-0 space-y-4 sm:space-y-6">
                {form ? (
                  <form
                    id="launch-editor-form"
                    className="min-w-0 space-y-4 sm:space-y-6"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (!canSave) return;
                      saveMutation.mutate();
                    }}
                  >
                    <Section
                      variant="primary"
                      title="Launch identity"
                      description={
                        idLocked
                          ? "Identity fields are locked once the launch is announced."
                          : "Identity fields can only be edited while the launch is a draft."
                      }
                    >
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
                      variant="surface"
                      title="Schedule"
                      description={
                        schedLocked
                          ? "Schedule fields are locked once the launch is live."
                          : `Times are entered and displayed in this device's timezone (${tz}) and stored as absolute timestamps. There is no arbitrary timezone conversion in this phase.`
                      }
                    >
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

                    <div className="hidden lg:flex lg:justify-end">{saveButton}</div>
                  </form>
                ) : null}

                {canManage && canDeleteLaunch(status) ? (
                  <Section
                    variant="quiet"
                    title="Delete draft"
                    description="Only draft launches can be deleted. Once announced, a launch record is permanent."
                  >
                    <Button
                      variant="destructive"
                      className="min-h-11"
                      onClick={() => setConfirmDelete(true)}
                    >
                      <Trash2 className="size-4" aria-hidden="true" />
                      Delete draft launch
                    </Button>
                  </Section>
                ) : null}
              </div>

              <div className="min-w-0 space-y-4 sm:space-y-6">
                <Section
                  variant="surface"
                  title="Launch Watch"
                  leading={<Bell className="size-4" aria-hidden="true" />}
                >
                  {watchToken ? (
                    <div className="space-y-3">
                      <div className="min-w-0">
                        <p className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
                          Telegram deep link
                        </p>
                        <p className="mt-1 break-all rounded-md border border-border bg-background/40 px-3 py-2 font-mono text-xs text-foreground">
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

                      <div className="rounded-md border border-border/60 bg-background/30 p-3">
                        <p className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
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
                              <dd className="font-mono text-sm text-foreground">
                                {watchStatsReady ? watchSummary!.active_count : "—"}
                              </dd>
                            </div>
                            <div className="min-w-0">
                              <dt className="text-muted-foreground">Total opt-ins</dt>
                              <dd className="font-mono text-sm text-foreground">
                                {watchStatsReady ? watchSummary!.total_count : "—"}
                              </dd>
                            </div>
                            <div className="min-w-0">
                              <dt className="text-muted-foreground">Countdown reminders on</dt>
                              <dd className="font-mono text-sm text-foreground">
                                {notificationStatsReady
                                  ? notificationSummary!.reminder_enabled_watchers
                                  : "—"}
                              </dd>
                            </div>
                            <div className="min-w-0">
                              <dt className="text-muted-foreground">Countdown reminders muted</dt>
                              <dd className="font-mono text-sm text-foreground">
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

                      <div className="rounded-md border border-border/60 bg-background/30 p-3">
                        <p className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
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
                                <dd className="font-mono text-sm text-foreground">
                                  {confirmationStatsReady ? confirmationSummary!.delivered_count : "—"}
                                </dd>
                              </div>
                              <div className="min-w-0">
                                <dt className="text-muted-foreground">Confirmation failed</dt>
                                <dd className="font-mono text-sm text-foreground">
                                  {confirmationStatsReady ? confirmationSummary!.failed_count : "—"}
                                </dd>
                              </div>
                              <div className="min-w-0">
                                <dt className="text-muted-foreground">Outcome unconfirmed</dt>
                                <dd className="font-mono text-sm text-foreground">
                                  {confirmationStatsReady ? confirmationSummary!.ambiguous_count : "—"}
                                </dd>
                              </div>
                              <div className="min-w-0">
                                <dt className="text-muted-foreground">Pre-tracking opt-ins</dt>
                                <dd className="font-mono text-sm text-foreground">
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



                      <div className="rounded-md border border-border/60 bg-background/30 p-3">
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <StatusBadge tone={armingState.tone}>
                            <span>{armingState.badge}</span>
                          </StatusBadge>
                          <span className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
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

                      <details className="rounded-md border border-border/60 bg-background/30">
                        <summary className="cursor-pointer list-none px-3 py-3 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                          How Launch Watch works
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
                        Automated messages are the countdown reminders, the Verified Launch Packet
                        and the launch-live alert. Manual project updates are sent separately from
                        Watcher Updates below.
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

                      <div className="rounded-md border border-border/60 bg-background/30 p-3">
                        <p className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
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
                              <dd className="font-mono text-sm text-foreground">
                                {watcherUpdateStats ? watcherUpdateStats.active_watchers : "—"}
                              </dd>
                            </div>
                            <div className="min-w-0">
                              <dt className="text-muted-foreground">Project updates on</dt>
                              <dd className="font-mono text-sm text-foreground">
                                {watcherUpdateStats
                                  ? watcherUpdateStats.updates_enabled_watchers
                                  : "—"}
                              </dd>
                            </div>
                            <div className="min-w-0">
                              <dt className="text-muted-foreground">Project updates muted</dt>
                              <dd className="font-mono text-sm text-foreground">
                                {watcherUpdateStats ? watcherUpdateStats.updates_muted_watchers : "—"}
                              </dd>
                            </div>
                          </dl>
                        )}
                        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                          Watchers who opted in before Project Updates existed agreed to countdowns
                          and launch alerts only, so they start with Project Updates off. They keep
                          receiving countdowns, the Verified Launch Packet and the launch-live
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


                      <div className="rounded-md border border-border/60 bg-background/30 p-3">
                        <p className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
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
                                      <dt className="truncate uppercase tracking-[0.1em] text-muted-foreground">
                                        {label}
                                      </dt>
                                      <dd className="font-mono text-sm text-foreground">{value}</dd>
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

                <Section variant="surface" title="Official contract">
                  {status === "CONTRACT_PENDING" ? (
                    <div className="space-y-3">
                      <div className="min-w-0">
                        <Label htmlFor="contract-address">Official contract address</Label>
                        <Input
                          id="contract-address"
                          maxLength={CONTRACT_MAX}
                          disabled={readOnly}
                          value={contractInput}
                          onChange={(e) => setContractInput(e.target.value)}
                          placeholder="Paste the official contract address"
                        />
                      </div>
                      <p className="text-xs leading-relaxed text-muted-foreground">
                        Not registered yet. You can correct and re-save the address while the
                        launch is still contract pending.
                      </p>
                      {canManage ? (
                        <Button
                          className="min-h-11"
                          disabled={contractMutation.isPending || !contractInput.trim()}
                          onClick={() => contractMutation.mutate()}
                        >
                          {contractMutation.isPending ? (
                            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                          ) : (
                            <Save className="size-4" aria-hidden="true" />
                          )}
                          Save official contract address
                        </Button>
                      ) : (
                        <p className="text-xs text-muted-foreground">
                          Registering the official contract address requires the project owner
                          or admin role.
                        </p>
                      )}
                    </div>
                  ) : contractSaved ? (
                    <div className="space-y-2">
                      <p className="break-all rounded-md border border-border bg-background/40 px-3 py-2 font-mono text-xs text-foreground">
                        {selected.official_contract_address}
                      </p>
                      <p className="text-xs leading-relaxed text-muted-foreground">
                        Official contract registered by the authenticated project. This confirms
                        the address submitted by the authenticated project itself. It is
                        not a safety check, an audit, or an investment guarantee.
                      </p>
                      <p className="text-xs leading-relaxed text-muted-foreground">
                        Replacing a registered address is not available. It requires a future
                        controlled authorization and history flow.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <p className="text-xs leading-relaxed text-muted-foreground">
                        {status === "WATCHLIST_OPEN"
                          ? "Contract entry is not open yet. First confirm the schedule and arm countdowns. Then open Contract Registration. At Contract Pending, the official CA field becomes editable."
                          : "Contract registration becomes available later in the lifecycle, once the launch reaches Contract Pending."}
                      </p>
                    </div>
                  )}
                </Section>

                <VerifiedDeploymentEvidencePanel
                  evaluation={deploymentEvidence}
                  loading={deploymentEvidenceQuery.isLoading}
                  error={
                    deploymentEvidenceQuery.isError
                      ? "Could not load deployment evidence for this launch."
                      : null
                  }
                />



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
                    <Button asChild variant="outline" size="sm" className="mt-3 w-full">
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
              </div>
            </div>
          ) : null}

          {selected ? (
            <details className="min-w-0 rounded-lg border border-border/60 bg-background/20">
              <summary className="cursor-pointer list-none px-3 py-3 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Advanced &amp; technical
              </summary>
              <div className="min-w-0 space-y-3 px-3 pb-3">
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
                      <li>Official-contract Verified Launch Packet</li>
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
                              <dt className="truncate uppercase tracking-[0.12em] text-muted-foreground">
                                {label}
                              </dt>
                              <dd className="font-mono text-sm text-foreground">
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

                <Section variant="quiet" title="Lifecycle timestamps">
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
                </Section>
              </div>
            </details>
          ) : null}
        </div>
      )}


      {selected && saveButton ? (
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
