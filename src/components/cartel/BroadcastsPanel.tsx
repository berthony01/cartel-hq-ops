import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CalendarClock, Loader2, Megaphone, Users } from "lucide-react";
import { toast } from "sonner";

import { Section } from "@/components/cartel/Section";
import { StatusBadge } from "@/components/cartel/StatusBadge";
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
import { useWorkspace } from "@/lib/workspace-context";
import { ScheduleChangeSummary } from "@/components/cartel/ScheduleChangeSummary";
import {
  LAUNCH_STATUS_LABELS,
  SCHEDULE_NOTE_MAX,
  WATCHER_UPDATE_BODY_MAX,
  WATCHER_UPDATE_TITLE_MAX,
  canSendWatcherUpdate,
  createLaunchWatcherUpdate,
  dismissLaunchScheduleCommunication,
  expectedScheduleSnapshot,
  getLaunchAccess,
  getLaunchWatcherUpdateStats,
  getPendingScheduleCommunication,
  listLaunches,
  scheduleCommunicationQueryKey,
  scheduleSnapshotPair,
  sendLaunchScheduleCommunication,
  toLaunchStatus,
  workspaceScheduleCommunicationsQueryKey,
  type ExpectedScheduleSnapshot,
  type LaunchScheduleCommunication,
} from "@/lib/launch-control";


/**
 * Community Command → Broadcasts (C2).
 *
 * Canonical UI for the EXISTING send-now Launch Watcher Update capability.
 * Every server rule — operator authorization, lifecycle and profile gates,
 * audience eligibility, anti-spam, daily cap, idempotency and fan-out — stays
 * in the `create_launch_watcher_update` SECURITY DEFINER RPC. Everything here
 * is presentation: truthful disabling, never security.
 */
export function BroadcastsPanel({
  selectedLaunchId,
  onLaunchChange,
}: {
  /** Validated `launch` search param. The URL owns the selection. */
  selectedLaunchId?: string | null;
  onLaunchChange: (launchId: string) => void;
}) {
  const { workspaceId, workspace } = useWorkspace();
  const queryClient = useQueryClient();

  // Same query keys/wrappers as Launch Control so cache stays shared.
  const launchesQuery = useQuery({
    queryKey: ["launches", workspaceId],
    enabled: !!workspaceId,
    queryFn: () => listLaunches(workspaceId!),
  });
  const launches = useMemo(() => launchesQuery.data ?? [], [launchesQuery.data]);

  const accessQuery = useQuery({
    queryKey: ["launch-access", workspaceId, workspace?.owner_id ?? null],
    enabled: !!workspaceId,
    queryFn: () => getLaunchAccess(workspaceId!, workspace?.owner_id ?? null),
  });
  const accessKnown = accessQuery.isSuccess;
  const canManage = accessQuery.data?.canManage ?? false;

  // The URL param is only honoured when it names a launch in THIS workspace
  // (the list itself is RLS-scoped). Anything else falls back to the newest
  // update-eligible launch, then the newest launch.
  const resolvedId = useMemo(() => {
    if (launches.length === 0) return null;
    if (selectedLaunchId && launches.some((l) => l.id === selectedLaunchId)) {
      return selectedLaunchId;
    }
    const eligible = launches.find((l) => canSendWatcherUpdate(toLaunchStatus(l.status)));
    return (eligible ?? launches[0]!).id;
  }, [launches, selectedLaunchId]);

  // Normalize the URL once a fallback resolved, so reload/back-forward keep the
  // launch the operator is actually looking at. Guarded: only fires when the
  // param genuinely differs, so it cannot loop.
  useEffect(() => {
    if (resolvedId && resolvedId !== selectedLaunchId) onLaunchChange(resolvedId);
  }, [resolvedId, selectedLaunchId, onLaunchChange]);

  const selected = launches.find((l) => l.id === resolvedId) ?? null;
  const status = selected ? toLaunchStatus(selected.status) : null;
  const lifecycleEligible = status ? canSendWatcherUpdate(status) : false;

  const statsQuery = useQuery({
    queryKey: ["launch-watcher-update-stats", selected?.id ?? null],
    enabled: !!selected?.id,
    queryFn: () => getLaunchWatcherUpdateStats(selected!.id),
  });
  const stats = statsQuery.data ?? null;
  const statsReady = statsQuery.isSuccess && !!stats;

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  // ONE client request id per intended send. It survives a failed attempt so an
  // ambiguous retry of the SAME draft stays idempotent server-side, and is
  // rotated as soon as that draft is edited into a different message.
  const [requestId, setRequestId] = useState<string | null>(null);
  const [attemptedDraft, setAttemptedDraft] = useState<{ title: string; body: string } | null>(
    null,
  );
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [preparing, setPreparing] = useState(false);

  /**
   * The exact reviewed send. Captured only after a fresh, successful stats
   * refetch that still matches the operator's current selection and draft.
   * The dialog renders from this and the mutation submits this — nothing in the
   * confirm/send path reads live render state.
   */
  type ConfirmSnapshot = {
    launchId: string;
    launchLabel: string;
    statusLabel: string;
    rawTitle: string;
    rawBody: string;
    sendTitle: string | null;
    sendBody: string;
    eligibleCount: number;
    clientRequestId: string;
  };
  const [confirmSnapshot, setConfirmSnapshot] = useState<ConfirmSnapshot | null>(null);

  // Latest-render mirror, used only to detect drift across an await.
  const latestRef = useRef({
    launchId: null as string | null,
    title: "",
    body: "",
    canManage: false,
    status: null as ReturnType<typeof toLaunchStatus> | null,
  });

  function resetComposer() {
    setTitle("");
    setBody("");
    setRequestId(null);
    setAttemptedDraft(null);
    setConfirmOpen(false);
    setConfirmSnapshot(null);
  }


  useEffect(() => {
    resetComposer();
  }, [selected?.id]);

  // M1: an edit AFTER a real send attempt makes this a different intended
  // message, so it must not reuse the previous idempotency id.
  useEffect(() => {
    if (!attemptedDraft) return;
    if (attemptedDraft.title !== title || attemptedDraft.body !== body) {
      setRequestId(null);
      setAttemptedDraft(null);
    }
  }, [title, body, attemptedDraft]);

  const mutation = useMutation({
    mutationFn: async (snapshot: ConfirmSnapshot) => {
      if (!snapshot?.launchId || !snapshot.clientRequestId) {
        throw new Error("Confirm the send again to continue.");
      }
      return createLaunchWatcherUpdate({
        launchId: snapshot.launchId,
        clientRequestId: snapshot.clientRequestId,
        title: snapshot.sendTitle,
        body: snapshot.sendBody,
      });
    },
    onMutate: (snapshot) => {
      // The confirmed draft — never the possibly-changed live inputs.
      setAttemptedDraft({ title: snapshot.rawTitle, body: snapshot.rawBody });
    },
    onSuccess: (eventId, snapshot) => {
      toast.success(
        eventId
          ? "Update queued for delivery to eligible watchers"
          : "Update recorded",
      );
      const id = snapshot.launchId;
      if (latestRef.current.launchId === id) {
        // Success clears the draft; the NEXT send mints a fresh id.
        resetComposer();
      } else {
        // The operator moved to another launch mid-flight: only retire this
        // send's metadata, never wipe the other launch's draft.
        setRequestId(null);
        setAttemptedDraft(null);
        setConfirmSnapshot(null);
        setConfirmOpen(false);
      }
      void queryClient.invalidateQueries({ queryKey: ["launch-watcher-update-stats", id] });
      void queryClient.invalidateQueries({ queryKey: ["launch-watcher-updates", id] });
      void queryClient.invalidateQueries({ queryKey: ["launch-notification-summary", id] });
    },
    // The id + attempted draft are deliberately NOT cleared here: an identical
    // retry must stay idempotent against an ambiguous outcome. Only the stale
    // confirmation snapshot is dropped, so a retry must re-read the audience.
    onError: (err: unknown) => {
      setConfirmSnapshot(null);
      toast.error(err instanceof Error ? err.message : "Could not send the update.");
    },
  });

  const eligibleCount = stats?.updates_enabled_watchers ?? 0;
  const titleTooLong = title.length > WATCHER_UPDATE_TITLE_MAX;
  const bodyTooLong = body.length > WATCHER_UPDATE_BODY_MAX;

  // N1: never claim the operator lacks permission before permission is known.
  const blockReason: string | null = accessQuery.isPending
    ? "Checking your permissions…"
    : accessQuery.isError
      ? "Could not verify your permissions, so sending is blocked."
      : !canManage
        ? "Only project owners and admins can send updates. The audience counts below are read-only for you."
        : !selected
      ? "Select a launch to send an update."
      : !lifecycleEligible
        ? `Updates can be sent from Watchlist open through Live. This launch is currently ${LAUNCH_STATUS_LABELS[status!]}.`
        : statsQuery.isError
          ? "Audience counts could not be loaded, so sending is blocked until they load."
          : !statsReady
            ? "Loading the current audience…"
            : eligibleCount < 1
              ? "No active watcher currently allows project updates, so there is nobody to send this to yet."
              : null;

  const sendDisabled =
    !!blockReason ||
    mutation.isPending ||
    preparing ||
    !body.trim() ||
    bodyTooLong ||
    titleTooLong;

  // Race guard: nothing about the intended send may change while a
  // confirmation is being prepared, reviewed, or submitted.
  const composerLocked = preparing || confirmOpen || mutation.isPending;
  const inputsDisabled = !accessKnown || !canManage || composerLocked;

  // Latest-render mirror, read only after an await to detect drift.
  latestRef.current = {
    launchId: selected?.id ?? null,
    title,
    body,
    canManage,
    status,
  };


  /**
   * M2: the confirmation must be based on a fresh, successful audience read —
   * never on whatever happened to be cached. Any failure, any zero audience and
   * any change of permission/lifecycle/draft validity keeps the dialog closed.
   */
  async function prepareConfirmation() {
    if (!selected || sendDisabled) return;
    // Click-time intent, captured BEFORE any await.
    const clicked = { launchId: selected.id, title, body };
    setPreparing(true);
    try {
      const result = await statsQuery.refetch();
      const latest = latestRef.current;
      // B1: anything the operator changed while the audience was refetching
      // invalidates this confirmation. Reviewed must equal submitted.
      if (
        latest.launchId !== clicked.launchId ||
        latest.title !== clicked.title ||
        latest.body !== clicked.body
      ) {
        toast.error(
          "Your selection or message changed while the audience was loading. Nothing was sent — review it and send again.",
        );
        return;
      }
      if (result.isError || !result.data) {
        toast.error("Could not confirm the current audience. Nothing was sent.");
        return;
      }
      const fresh = result.data.updates_enabled_watchers;
      // Re-check permission and lifecycle from the latest render, not the click.
      const freshLaunch = latest.launchId
        ? (launchesQuery.data ?? []).find((l) => l.id === latest.launchId)
        : undefined;
      const freshStatus = freshLaunch ? toLaunchStatus(freshLaunch.status) : null;
      if (!latest.canManage || !freshLaunch || !freshStatus || !canSendWatcherUpdate(freshStatus)) {
        toast.error("This launch can no longer receive an update. Nothing was sent.");
        return;
      }
      if (!latest.body.trim() || latest.body.length > WATCHER_UPDATE_BODY_MAX) {
        toast.error("Check the update text before sending.");
        return;
      }
      if (latest.title.length > WATCHER_UPDATE_TITLE_MAX) {
        toast.error("Check the update text before sending.");
        return;
      }
      if (fresh < 1) {
        toast.error("No active watcher currently allows project updates. Nothing was sent.");
        return;
      }
      // Mint (or reuse, for an identical failed retry) the idempotency id.
      const idForSend = requestId ?? crypto.randomUUID();
      setRequestId(idForSend);
      setConfirmSnapshot({
        launchId: freshLaunch.id,
        launchLabel: `${freshLaunch.token_name} (${freshLaunch.ticker})`,
        statusLabel: LAUNCH_STATUS_LABELS[freshStatus],
        rawTitle: latest.title,
        rawBody: latest.body,
        sendTitle: latest.title.trim() ? latest.title.trim() : null,
        sendBody: latest.body,
        eligibleCount: fresh,
        clientRequestId: idForSend,
      });
      setConfirmOpen(true);
    } finally {
      setPreparing(false);
    }
  }

  // -------------------------------------------------------------------------
  // C6 — Launch schedule update decision.
  //
  // The C5 trigger detects a real schedule change and opens exactly one PENDING
  // row per launch. The factual Previous/New text is composed SERVER-SIDE by
  // `send_launch_schedule_communication`, which reuses the existing
  // `create_launch_watcher_update` engine, so every lifecycle/audience/anti-spam
  // rule stays authoritative. The operator only supplies an optional note and
  // the decision (notify or dismiss).
  // -------------------------------------------------------------------------
  const scheduleCommQuery = useQuery({
    queryKey: scheduleCommunicationQueryKey(selected?.id ?? null),
    enabled: !!selected?.id,
    queryFn: () => getPendingScheduleCommunication(selected!.id),
  });
  const pendingComm = scheduleCommQuery.data ?? null;

  const [note, setNote] = useState("");
  const [scheduleRequestId, setScheduleRequestId] = useState<string | null>(null);
  const [attemptedSchedule, setAttemptedSchedule] = useState<{
    note: string;
    identity: string;
  } | null>(null);
  const [scheduleConfirmOpen, setScheduleConfirmOpen] = useState(false);
  const [dismissConfirmOpen, setDismissConfirmOpen] = useState(false);
  const [schedulePreparing, setSchedulePreparing] = useState(false);
  const [dismissPreparing, setDismissPreparing] = useState(false);

  type ScheduleSnapshot = {
    communicationId: string;
    identity: string;
    launchId: string;
    launchLabel: string;
    statusLabel: string;
    previous: string;
    current: string;
    note: string;
    eligibleCount: number;
    clientRequestId: string;
    /** Exact C5 row state the operator reviewed; the server re-checks it. */
    expected: ExpectedScheduleSnapshot;
  };
  const [scheduleSnapshot, setScheduleSnapshot] = useState<ScheduleSnapshot | null>(null);

  /** The frozen decision behind the dismiss confirmation. */
  type DismissSnapshot = {
    communicationId: string;
    launchId: string;
    launchLabel: string;
    previous: string;
    current: string;
    expected: ExpectedScheduleSnapshot;
  };
  const [dismissSnapshot, setDismissSnapshot] = useState<DismissSnapshot | null>(null);


  /** Stable identity of the exact pending row + its current schedule facts. */
  const commIdentity = (row: LaunchScheduleCommunication) =>
    [
      row.id,
      row.status,
      row.change_count,
      row.current_launch_at ?? "",
      row.current_window_start ?? "",
      row.current_window_end ?? "",
      row.current_timezone,
      row.updated_at,
    ].join("|");

  const scheduleLatestRef = useRef({
    launchId: null as string | null,
    identity: null as string | null,
    note: "",
    canManage: false,
  });
  scheduleLatestRef.current = {
    launchId: selected?.id ?? null,
    identity: pendingComm ? commIdentity(pendingComm) : null,
    note,
    canManage,
  };

  // A new launch selection, or a changed pending row, is a different intended
  // send: never reuse the previous idempotency id across it.
  useEffect(() => {
    setNote("");
    setScheduleRequestId(null);
    setAttemptedSchedule(null);
    setScheduleSnapshot(null);
    setDismissSnapshot(null);
    setScheduleConfirmOpen(false);
    setDismissConfirmOpen(false);
  }, [selected?.id, pendingComm?.id]);

  useEffect(() => {
    if (!attemptedSchedule || !pendingComm) return;
    if (
      attemptedSchedule.note !== note ||
      attemptedSchedule.identity !== commIdentity(pendingComm)
    ) {
      setScheduleRequestId(null);
      setAttemptedSchedule(null);
    }
  }, [note, pendingComm, attemptedSchedule]);

  const scheduleMutation = useMutation({
    mutationFn: async (snapshot: ScheduleSnapshot) =>
      sendLaunchScheduleCommunication({
        communicationId: snapshot.communicationId,
        clientRequestId: snapshot.clientRequestId,
        note: snapshot.note.trim() ? snapshot.note.trim() : null,
        // Only the frozen reviewed values are submitted, never live state.
        ...snapshot.expected,
      }),
    onMutate: (snapshot) =>
      setAttemptedSchedule({ note: snapshot.note, identity: snapshot.identity }),
    onSuccess: (_eventId, snapshot) => {
      toast.success("Schedule update queued for delivery to eligible watchers");
      setScheduleRequestId(null);
      setAttemptedSchedule(null);
      setScheduleSnapshot(null);
      setScheduleConfirmOpen(false);
      if (scheduleLatestRef.current.launchId === snapshot.launchId) setNote("");
      refreshAfterScheduleDecision(snapshot.launchId);
    },
    onError: (err: unknown) => {
      // The request id is kept so an identical retry of an ambiguous outcome
      // resolves to the same event server-side.
      setScheduleSnapshot(null);
      toast.error(err instanceof Error ? err.message : "Could not send the schedule update.");
    },
  });

  const dismissMutation = useMutation({
    mutationFn: async (snapshot: DismissSnapshot) =>
      dismissLaunchScheduleCommunication({
        communicationId: snapshot.communicationId,
        ...snapshot.expected,
      }),
    onSuccess: (_void, snapshot) => {
      toast.success("Schedule change dismissed. No watcher message was created.");
      setDismissConfirmOpen(false);
      setDismissSnapshot(null);
      refreshAfterScheduleDecision(snapshot.launchId);
    },
    onError: (err: unknown) => {
      setDismissSnapshot(null);
      setDismissConfirmOpen(false);
      toast.error(err instanceof Error ? err.message : "Could not dismiss this schedule change.");
    },
  });


  function refreshAfterScheduleDecision(launchId: string | null) {
    void queryClient.invalidateQueries({ queryKey: scheduleCommunicationQueryKey(launchId) });
    void queryClient.invalidateQueries({
      queryKey: workspaceScheduleCommunicationsQueryKey(workspaceId ?? null),
    });
    void queryClient.invalidateQueries({ queryKey: ["launch-watcher-update-stats", launchId] });
    void queryClient.invalidateQueries({ queryKey: ["launch-watcher-updates", launchId] });
    void queryClient.invalidateQueries({ queryKey: ["launch-notification-summary", launchId] });
  }

  const noteTooLong = note.length > SCHEDULE_NOTE_MAX;
  const scheduleBusy =
    schedulePreparing ||
    dismissPreparing ||
    scheduleMutation.isPending ||
    dismissMutation.isPending ||
    scheduleConfirmOpen ||
    dismissConfirmOpen;
  const scheduleBlockReason: string | null = accessQuery.isPending
    ? "Checking your permissions…"
    : accessQuery.isError
      ? "Could not verify your permissions, so notifying is blocked."
      : !canManage
        ? "Only project owners and admins can notify watchers or dismiss this."
        : !lifecycleEligible
          ? `Watcher updates can be sent from Watchlist open through Live. This launch is currently ${LAUNCH_STATUS_LABELS[status!]}.`
          : statsQuery.isError
            ? "Audience counts could not be loaded, so notifying is blocked until they load."
            : !statsReady
              ? "Loading the current audience…"
              : eligibleCount < 1
                ? "No active watcher currently allows project updates, so there is nobody to notify yet."
                : null;

  /**
   * Refetches the audience, the pending row, the launches list AND the access
   * check, then freezes the exact reviewed send — including the C5 snapshot the
   * server will re-verify. Any drift or query error across the await aborts
   * without sending.
   */
  async function prepareScheduleConfirmation() {
    if (!selected || !pendingComm || scheduleBlockReason || noteTooLong) return;
    const clicked = {
      launchId: selected.id,
      identity: commIdentity(pendingComm),
      note,
    };
    setSchedulePreparing(true);
    try {
      const [statsResult, commResult, launchesResult, accessResult] = await Promise.all([
        statsQuery.refetch(),
        scheduleCommQuery.refetch(),
        launchesQuery.refetch(),
        accessQuery.refetch(),
      ]);
      const latest = scheduleLatestRef.current;
      const freshComm = commResult.data ?? null;
      if (
        latest.launchId !== clicked.launchId ||
        latest.note !== clicked.note ||
        !freshComm ||
        commIdentity(freshComm) !== clicked.identity ||
        latest.identity !== clicked.identity
      ) {
        toast.error(
          "The launch, schedule change or your note changed while this was loading. Nothing was sent — review it and try again.",
        );
        return;
      }
      if (
        commResult.isError ||
        statsResult.isError ||
        launchesResult.isError ||
        accessResult.isError ||
        !statsResult.data ||
        !launchesResult.data ||
        !accessResult.data
      ) {
        toast.error(
          "Could not confirm your permissions, the current audience or the schedule change. Nothing was sent.",
        );
        return;
      }
      // Freshly fetched permission/lifecycle — never the pre-await cache.
      const freshLaunch = launchesResult.data.find((l) => l.id === clicked.launchId);
      const freshStatus = freshLaunch ? toLaunchStatus(freshLaunch.status) : null;
      if (
        !accessResult.data.canManage ||
        !freshLaunch ||
        !freshStatus ||
        !canSendWatcherUpdate(freshStatus)
      ) {
        toast.error("This launch can no longer receive an update. Nothing was sent.");
        return;
      }
      const fresh = statsResult.data.updates_enabled_watchers;
      if (fresh < 1) {
        toast.error("No active watcher currently allows project updates. Nothing was sent.");
        return;
      }
      if (latest.note.length > SCHEDULE_NOTE_MAX) {
        toast.error("Shorten your explanation before sending.");
        return;
      }
      const idForSend = scheduleRequestId ?? crypto.randomUUID();
      setScheduleRequestId(idForSend);
      const pair = scheduleSnapshotPair(freshComm);
      setScheduleSnapshot({
        communicationId: freshComm.id,
        identity: commIdentity(freshComm),
        launchId: freshLaunch.id,
        launchLabel: `${freshLaunch.token_name} (${freshLaunch.ticker})`,
        statusLabel: LAUNCH_STATUS_LABELS[freshStatus],
        previous: pair.previous,
        current: pair.current,
        note: latest.note,
        eligibleCount: fresh,
        clientRequestId: idForSend,
        expected: expectedScheduleSnapshot(freshComm),
      });
      setScheduleConfirmOpen(true);
    } finally {
      setSchedulePreparing(false);
    }
  }

  /**
   * Dismiss carries the same review-to-submit risk: a newer version of the SAME
   * pending row must never be dismissed as if it were the reviewed one. The
   * confirmation is built from a fresh read and the mutation submits only that
   * frozen snapshot; the server rejects it if the row moved on.
   */
  async function prepareDismissConfirmation() {
    if (!selected || !pendingComm || !accessKnown || !canManage || scheduleBusy) return;
    const clicked = { launchId: selected.id, identity: commIdentity(pendingComm) };
    setDismissPreparing(true);
    try {
      const [commResult, accessResult] = await Promise.all([
        scheduleCommQuery.refetch(),
        accessQuery.refetch(),
      ]);
      const latest = scheduleLatestRef.current;
      const freshComm = commResult.data ?? null;
      if (commResult.isError || accessResult.isError || !accessResult.data) {
        toast.error(
          "Could not confirm your permissions or the schedule change. Nothing was dismissed.",
        );
        return;
      }
      if (
        latest.launchId !== clicked.launchId ||
        !freshComm ||
        commIdentity(freshComm) !== clicked.identity
      ) {
        toast.error(
          "This schedule change was updated while it was loading. Nothing was dismissed — review it again.",
        );
        return;
      }
      if (!accessResult.data.canManage) {
        toast.error("You can no longer resolve this schedule change. Nothing was dismissed.");
        return;
      }
      const pair = scheduleSnapshotPair(freshComm);
      setDismissSnapshot({
        communicationId: freshComm.id,
        launchId: clicked.launchId,
        launchLabel: `${selected.token_name} (${selected.ticker})`,
        previous: pair.previous,
        current: pair.current,
        expected: expectedScheduleSnapshot(freshComm),
      });
      setDismissConfirmOpen(true);
    } finally {
      setDismissPreparing(false);
    }
  }




  return (
    <div className="flex min-w-0 flex-col gap-4 sm:gap-6">
      <Section
        variant="hero"
        title="Broadcasts"
        description="Send a private project update to Launch Watch watchers who allow project updates."
        leading={<Megaphone className="size-4" aria-hidden="true" />}
        actions={<StatusBadge tone="green">Watcher DM live</StatusBadge>}
      >
        <ul className="grid gap-2 sm:grid-cols-2">
          <li className="min-w-0 rounded-md border border-border/70 bg-background/40 p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-foreground">
                Watcher DM
              </p>
              <StatusBadge tone="green">Available</StatusBadge>
            </div>
            <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
              A private @PepeCartelHQBot message to active watchers of the selected launch who
              currently allow project updates.
            </p>
          </li>
          <li
            className="min-w-0 rounded-md border border-dashed border-border/70 bg-background/30 p-3 opacity-70"
            aria-disabled="true"
          >
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-foreground">
                Telegram community
              </p>
              <StatusBadge tone="muted">Planned</StatusBadge>
            </div>
            <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
              Posting an announcement into a connected community group is not built yet. Nothing
              here can post to a group.
            </p>
          </li>
        </ul>
      </Section>

      <Section variant="surface" title="Launch">
        {launchesQuery.isError ? (
          <div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Launches could not be loaded right now.
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-2 min-h-11"
              onClick={() => void launchesQuery.refetch()}
            >
              Retry
            </Button>
          </div>
        ) : launchesQuery.isPending ? (
          <p className="text-xs text-muted-foreground">Loading launches…</p>
        ) : launches.length === 0 ? (
          <p className="text-xs leading-relaxed text-muted-foreground">
            No launches exist in this workspace yet. Create one in Launch Control first.
          </p>
        ) : (
          <div className="min-w-0 space-y-2">
            <Label htmlFor="broadcast-launch">Selected launch</Label>
            <Select
              value={resolvedId ?? ""}
              disabled={composerLocked}
              onValueChange={(value) => onLaunchChange(value)}
            >
              <SelectTrigger id="broadcast-launch" className="min-h-11 w-full">
                <SelectValue placeholder="Select a launch" />
              </SelectTrigger>
              <SelectContent>
                {launches.map((launch) => (
                  <SelectItem key={launch.id} value={launch.id}>
                    {launch.token_name} · {launch.ticker} ·{" "}
                    {LAUNCH_STATUS_LABELS[toLaunchStatus(launch.status)]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selected ? (
              <p className="text-xs leading-relaxed text-muted-foreground">
                {selected.token_name} ({selected.ticker}) on {selected.chain} —{" "}
                {LAUNCH_STATUS_LABELS[status!]}.
              </p>
            ) : null}
          </div>
        )}
      </Section>

      <Section
        variant="surface"
        title="Audience"
        leading={<Users className="size-4" aria-hidden="true" />}
        description="Only active watchers who currently allow project updates receive this send."
      >
        {!selected ? (
          <p className="text-xs text-muted-foreground">Select a launch to see its audience.</p>
        ) : statsQuery.isError ? (
          <div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Audience counts could not be loaded right now.
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-2 min-h-11"
              onClick={() => void statsQuery.refetch()}
            >
              Retry
            </Button>
          </div>
        ) : (
          <>
            <dl className="grid grid-cols-1 gap-x-4 gap-y-2 text-xs min-[420px]:grid-cols-2 sm:grid-cols-3">
              <div className="min-w-0">
                <dt className="text-muted-foreground">Active watchers</dt>
                <dd className="font-mono text-sm text-foreground">
                  {stats ? stats.active_watchers : "—"}
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="text-muted-foreground">Updates enabled</dt>
                <dd className="font-mono text-sm text-foreground">
                  {stats ? stats.updates_enabled_watchers : "—"}
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="text-muted-foreground">Updates muted</dt>
                <dd className="font-mono text-sm text-foreground">
                  {stats ? stats.updates_muted_watchers : "—"}
                </dd>
              </div>
            </dl>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              Counts only. Telegram identities, usernames and per-recipient records are never shown
              in CARTEL HQ. Watchers control their own project-update preference in
              @PepeCartelHQBot.
            </p>
          </>
        )}
      </Section>

      {/* C6 — schedule change decision, shown only when C5 detected one. */}
      {selected && scheduleCommQuery.isError ? (
        <Section variant="surface" title="Launch schedule update">
          <p className="text-xs leading-relaxed text-muted-foreground">
            Whether this launch has an unnotified schedule change could not be checked. This is not
            a confirmation that nothing changed.
          </p>
          <Button
            variant="outline"
            size="sm"
            className="mt-2 min-h-11"
            onClick={() => void scheduleCommQuery.refetch()}
          >
            Retry
          </Button>
        </Section>
      ) : null}

      {selected && pendingComm ? (
        <Section
          variant="primary"
          title="Launch schedule update"
          description="This launch’s schedule changed. Watchers have not been notified yet."
          leading={<CalendarClock className="size-4" aria-hidden="true" />}
          actions={<StatusBadge tone="gold">Decision needed</StatusBadge>}
        >
          <div className="rounded-md border border-border/70 bg-background/40 p-3">
            <ScheduleChangeSummary row={pendingComm} />
          </div>

          <div className="mt-4 min-w-0 space-y-3">
            <div className="min-w-0">
              <Label htmlFor="schedule-note">Optional explanation</Label>
              <Textarea
                id="schedule-note"
                rows={4}
                maxLength={SCHEDULE_NOTE_MAX}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Why the schedule moved, in your own words (optional)"
                disabled={!accessKnown || !canManage || scheduleBusy}
              />
              <p className="mt-1 text-right text-xs text-muted-foreground">
                {note.length}/{SCHEDULE_NOTE_MAX}
              </p>
            </div>

            <div className="min-w-0 rounded-md border border-border/60 bg-background/30 p-3">
              <p className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
                Watcher message preview
              </p>
              <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-foreground [overflow-wrap:anywhere]">
                {`Previous: ${scheduleSnapshotPair(pendingComm).previous}\nNew: ${scheduleSnapshotPair(pendingComm).current}`}
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Automatic schedule facts, written by CARTEL HQ from the recorded change.
              </p>
              {note.trim() ? (
                <>
                  <p className="mt-3 border-t border-border/60 pt-3 text-xs uppercase tracking-[0.12em] text-muted-foreground">
                    Your explanation
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">
                    {note.trim()}
                  </p>
                </>
              ) : null}
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                className="min-h-11"
                disabled={!!scheduleBlockReason || noteTooLong || scheduleBusy}
                onClick={() => void prepareScheduleConfirmation()}
              >
                {schedulePreparing || scheduleMutation.isPending ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <AlertTriangle className="size-4" aria-hidden="true" />
                )}
                Notify watchers
              </Button>
              <Button
                variant="outline"
                className="min-h-11"
                disabled={!accessKnown || !canManage || scheduleBusy}
                onClick={() => setDismissConfirmOpen(true)}
              >
                Dismiss without notifying
              </Button>
            </div>

            {scheduleBlockReason ? (
              <p className="text-xs leading-relaxed text-muted-foreground">{scheduleBlockReason}</p>
            ) : null}
            <p className="text-xs leading-relaxed text-muted-foreground">
              The Previous and New schedule text is written by CARTEL HQ from the recorded change,
              not by you. Notifying sends one private watcher update through the same engine as any
              other broadcast.
            </p>
          </div>
        </Section>
      ) : null}


      <Section
        variant="surface"
        title="Your message"
        description="Text only. No scheduling, attachments or formatting modes in this phase."
      >
        <div className="min-w-0 space-y-3">
          <div className="min-w-0">
            <Label htmlFor="broadcast-title">Title (optional)</Label>
            <Input
              id="broadcast-title"
              maxLength={WATCHER_UPDATE_TITLE_MAX}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Short headline for this update"
              disabled={inputsDisabled}
            />
            <p className="mt-1 text-right text-xs text-muted-foreground">
              {title.length}/{WATCHER_UPDATE_TITLE_MAX}
            </p>
          </div>
          <div className="min-w-0">
            <Label htmlFor="broadcast-body">Update text</Label>
            <Textarea
              id="broadcast-body"
              rows={6}
              maxLength={WATCHER_UPDATE_BODY_MAX}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="What do your watchers need to know?"
              disabled={inputsDisabled}
            />
            <p className="mt-1 text-right text-xs text-muted-foreground">
              {body.length}/{WATCHER_UPDATE_BODY_MAX}
            </p>
          </div>

          {body.trim() ? (
            <div className="min-w-0 rounded-md border border-border/60 bg-background/30 p-3">
              <p className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
                Operator message preview
              </p>
              {title.trim() ? (
                <p className="mt-2 text-xs font-semibold text-foreground [overflow-wrap:anywhere]">
                  {title.trim()}
                </p>
              ) : null}
              <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">
                {body}
              </p>
              <p className="mt-2 border-t border-border/60 pt-2 text-xs leading-relaxed text-muted-foreground">
                This shows your own text only. The delivered Telegram message also carries the
                authenticated-project identity, official links and the standard disclaimer added by
                the notification worker.
              </p>
            </div>
          ) : null}

          <Button
            className="min-h-11"
            disabled={sendDisabled}
            onClick={() => void prepareConfirmation()}
          >
            {mutation.isPending || preparing ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Megaphone className="size-4" aria-hidden="true" />
            )}
            Send watcher update
          </Button>


          {blockReason ? (
            <p className="text-xs leading-relaxed text-muted-foreground">{blockReason}</p>
          ) : null}
          <p className="text-xs leading-relaxed text-muted-foreground">
            Sending queues one private bot message per eligible watcher. Delivery happens
            asynchronously, so outcomes appear afterwards in the launch’s recent updates in Launch
            Control.
          </p>
        </div>
      </Section>

      <AlertDialog
        open={confirmOpen}
        onOpenChange={(open) => {
          setConfirmOpen(open);
          if (!open) setConfirmSnapshot(null);
          // Explicit cancel BEFORE any send attempt: the next confirmation
          // starts a fresh idempotency id. After a failed attempt the id is
          // preserved so an identical retry stays idempotent.
          if (!open && !mutation.isPending && !attemptedDraft) setRequestId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Send this update to {confirmSnapshot?.eligibleCount ?? 0} watcher(s)?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmSnapshot
                ? `${confirmSnapshot.launchLabel} — ${confirmSnapshot.statusLabel}. `
                : ""}
              Only active watchers who currently allow project updates will receive it. Nothing is
              posted to your community group.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="max-h-48 overflow-y-auto rounded-md border border-border/60 bg-background/40 p-3">
            {confirmSnapshot?.sendTitle ? (
              <p className="text-xs font-semibold text-foreground [overflow-wrap:anywhere]">
                {confirmSnapshot.sendTitle}
              </p>
            ) : null}
            <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">
              {confirmSnapshot?.sendBody ?? ""}
            </p>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={
                mutation.isPending || !confirmSnapshot || confirmSnapshot.eligibleCount < 1
              }
              onClick={(e) => {
                e.preventDefault();
                if (!confirmSnapshot || confirmSnapshot.eligibleCount < 1) return;
                mutation.mutate(confirmSnapshot);
                setConfirmOpen(false);
              }}
            >
              Send watcher update
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={scheduleConfirmOpen}
        onOpenChange={(open) => {
          setScheduleConfirmOpen(open);
          if (!open) setScheduleSnapshot(null);
          // Cancel before any attempt starts a fresh id; after a failed attempt
          // the id is preserved so an identical retry stays idempotent.
          if (!open && !scheduleMutation.isPending && !attemptedSchedule) {
            setScheduleRequestId(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Notify {scheduleSnapshot?.eligibleCount ?? 0} watcher(s) about this schedule change?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {scheduleSnapshot
                ? `${scheduleSnapshot.launchLabel} — ${scheduleSnapshot.statusLabel}. `
                : ""}
              Only active watchers who currently allow project updates will receive it. Nothing is
              posted to your community group.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="max-h-48 overflow-y-auto rounded-md border border-border/60 bg-background/40 p-3">
            <p className="whitespace-pre-wrap text-xs leading-relaxed text-foreground [overflow-wrap:anywhere]">
              {`Previous: ${scheduleSnapshot?.previous ?? ""}\nNew: ${scheduleSnapshot?.current ?? ""}`}
            </p>
            {scheduleSnapshot?.note.trim() ? (
              <p className="mt-3 whitespace-pre-wrap border-t border-border/60 pt-3 text-xs leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">
                {scheduleSnapshot.note.trim()}
              </p>
            ) : null}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={
                scheduleMutation.isPending ||
                !scheduleSnapshot ||
                scheduleSnapshot.eligibleCount < 1
              }
              onClick={(e) => {
                e.preventDefault();
                if (!scheduleSnapshot || scheduleSnapshot.eligibleCount < 1) return;
                scheduleMutation.mutate(scheduleSnapshot);
                setScheduleConfirmOpen(false);
              }}
            >
              Notify watchers
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={dismissConfirmOpen}
        onOpenChange={(open) => {
          setDismissConfirmOpen(open);
          if (!open) setDismissSnapshot(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Dismiss this schedule change?</AlertDialogTitle>
            <AlertDialogDescription>
              No watcher message will be created. The decision is recorded as dismissed, and
              watchers will not be told that the schedule moved.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {dismissSnapshot ? (
            <div className="space-y-2 rounded-md border border-border bg-muted/40 p-3 text-sm">
              <p className="font-medium">{dismissSnapshot.launchLabel}</p>
              <p className="text-muted-foreground">
                <span className="text-foreground">Previous:</span> {dismissSnapshot.previous}
              </p>
              <p className="text-muted-foreground">
                <span className="text-foreground">New:</span> {dismissSnapshot.current}
              </p>
            </div>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={dismissMutation.isPending || !dismissSnapshot}
              onClick={(e) => {
                e.preventDefault();
                if (!dismissSnapshot) return;
                dismissMutation.mutate(dismissSnapshot);
              }}
            >
              Dismiss
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </div>

  );
}
