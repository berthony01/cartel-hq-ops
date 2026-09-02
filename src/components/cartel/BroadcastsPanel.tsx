import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Megaphone, Users } from "lucide-react";
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
import {
  LAUNCH_STATUS_LABELS,
  WATCHER_UPDATE_BODY_MAX,
  WATCHER_UPDATE_TITLE_MAX,
  canSendWatcherUpdate,
  createLaunchWatcherUpdate,
  getLaunchAccess,
  getLaunchWatcherUpdateStats,
  listLaunches,
  toLaunchStatus,
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

  /**
   * M2: the confirmation must be based on a fresh, successful audience read —
   * never on whatever happened to be cached. Any failure, any zero audience and
   * any change of permission/lifecycle/draft validity keeps the dialog closed.
   */
  async function prepareConfirmation() {
    if (!selected || sendDisabled) return;
    setPreparing(true);
    try {
      const result = await statsQuery.refetch();
      if (result.isError || !result.data) {
        toast.error("Could not confirm the current audience. Nothing was sent.");
        return;
      }
      const fresh = result.data.updates_enabled_watchers;
      if (!canManage || !canSendWatcherUpdate(toLaunchStatus(selected.status))) {
        toast.error("This launch can no longer receive an update. Nothing was sent.");
        return;
      }
      if (!body.trim() || bodyTooLong || titleTooLong) {
        toast.error("Check the update text before sending.");
        return;
      }
      if (fresh < 1) {
        toast.error("No active watcher currently allows project updates. Nothing was sent.");
        return;
      }
      setConfirmCount(fresh);
      // Mint (or reuse) the idempotency id for this intended send.
      setRequestId((current) => current ?? crypto.randomUUID());
      setConfirmOpen(true);
    } finally {
      setPreparing(false);
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
              disabled={!canManage}
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
              disabled={!canManage}
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
          if (!open) setConfirmCount(null);
          // Explicit cancel BEFORE any send attempt: the next confirmation
          // starts a fresh idempotency id. After a failed attempt the id is
          // preserved so an identical retry stays idempotent.
          if (!open && !mutation.isPending && !attemptedDraft) setRequestId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Send this update to {confirmCount ?? 0} watcher(s)?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {selected
                ? `${selected.token_name} (${selected.ticker}) — ${LAUNCH_STATUS_LABELS[status!]}. `
                : ""}
              Only active watchers who currently allow project updates will receive it. Nothing is
              posted to your community group.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="max-h-48 overflow-y-auto rounded-md border border-border/60 bg-background/40 p-3">
            {title.trim() ? (
              <p className="text-xs font-semibold text-foreground [overflow-wrap:anywhere]">
                {title.trim()}
              </p>
            ) : null}
            <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">
              {body}
            </p>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={mutation.isPending || !confirmCount || confirmCount < 1}
              onClick={(e) => {
                e.preventDefault();
                mutation.mutate();
                setConfirmOpen(false);
              }}
            >

              Send watcher update
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
