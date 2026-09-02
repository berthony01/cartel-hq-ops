import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, HelpCircle, Loader2, Send, Users } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";

import { Section } from "@/components/cartel/Section";
import { StatusBadge } from "@/components/cartel/StatusBadge";
import { Button } from "@/components/ui/button";
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
import { getLaunchAccess } from "@/lib/launch-control";
import {
  GROUP_ANNOUNCEMENT_MAX,
  fetchTelegramGroupStatus,
  sendGroupAnnouncement,
  type GroupAnnouncementResult,
} from "@/lib/telegram-group";
import type { GroupReadiness, TelegramGroupSetup } from "@/components/cartel/TelegramGroupCard";

/**
 * Community Command → Broadcasts → Official Community Broadcast (C7).
 *
 * Posts ONE plain-text announcement to ONE connected community. Every rule that
 * matters — owner/admin authorization, live bot verification, exact
 * target+message idempotency and the durable announcement ledger — lives in the
 * `telegram-group` Edge Function. This component is presentation, truthful
 * disabling, and correct client-request-id lifecycle only.
 *
 * Outcomes are never collapsed: a delivery that could not be confirmed
 * (AMBIGUOUS) is reported as uncertain and is NEVER resent automatically.
 *
 * Shared community state stays owned by the single page-level
 * `useTelegramGroupSetup()` hook; this component only reads it and asks it to
 * refresh. It never calls that hook itself.
 */
type Snapshot = {
  groupConnectionId: string;
  groupTitle: string;
  message: string;
  clientRequestId: string;
};

/** The exact intent already submitted to the server under `clientRequestId`. */
type Attempt = {
  groupConnectionId: string;
  message: string;
  clientRequestId: string;
};

function newRequestId() {
  return crypto.randomUUID();
}

/** The most truthful blocking reason derivable from stored/live readiness. */
function unreadyReason(readiness: GroupReadiness): string | null {
  if (readiness.ready) return null;
  if (readiness.botRemoved) {
    return "@PepeCartelHQBot is no longer in this community. Re-add the bot as an administrator, then re-check it in Communities.";
  }
  if (!readiness.supportedChatType) {
    return "This connected chat is not a supported Telegram group, so an announcement cannot be posted to it.";
  }
  if (!readiness.botAdmin) {
    return "@PepeCartelHQBot is not an administrator in this community. Promote the bot, then re-check it in Communities.";
  }
  if (readiness.botCanChangeInfo === false) {
    return "@PepeCartelHQBot is missing the Change Group Info permission in this community. Grant it, then re-check it in Communities.";
  }
  return "This community has not been verified as ready. Re-check it in Communities before posting.";
}

export function GroupAnnouncementComposer({ setup }: { setup: TelegramGroupSetup }) {
  const { workspaceId, workspace } = useWorkspace();

  const accessQuery = useQuery({
    queryKey: ["launch-access", workspaceId, workspace?.owner_id ?? null],
    enabled: !!workspaceId,
    queryFn: () => getLaunchAccess(workspaceId!, workspace?.owner_id ?? null),
  });
  const canManage = accessQuery.data?.canManage ?? false;

  const groups = setup.groups;
  const [groupId, setGroupId] = useState<string | null>(null);
  const resolvedGroupId = useMemo(() => {
    if (groups.length === 0) return null;
    if (groupId && groups.some((g) => g.id === groupId)) return groupId;
    return (groups.find((g) => setup.readinessById[g.id]?.ready) ?? groups[0]!).id;
  }, [groups, groupId, setup.readinessById]);
  const group = groups.find((g) => g.id === resolvedGroupId) ?? null;
  const readiness = resolvedGroupId ? (setup.readinessById[resolvedGroupId] ?? null) : null;

  const [message, setMessage] = useState("");
  /**
   * ONE client request id per exact intended announcement (target + text). It
   * survives only an uncertain attempt, so an identical retry stays idempotent
   * server-side. A confirmed SENT or a definite FAILED retires it immediately:
   * the server refuses to re-send any id, so a deliberate retry needs a new one.
   */
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [outcome, setOutcome] = useState<GroupAnnouncementResult | null>(null);

  const trimmed = message.trim();

  /**
   * Latest committed selection + draft, readable across an await. Preparation
   * compares against this ref rather than its own captured closure values, so a
   * reviewed announcement can never differ from the submitted one.
   */
  const latestRef = useRef<{ groupConnectionId: string | null; message: string }>({
    groupConnectionId: resolvedGroupId,
    message: trimmed,
  });
  latestRef.current = { groupConnectionId: resolvedGroupId, message: trimmed };

  function resetComposer() {
    setMessage("");
    setAttempt(null);
    setConfirmOpen(false);
    setSnapshot(null);
    setOutcome(null);
  }

  // Switching community makes this a different intended announcement.
  useEffect(() => {
    resetComposer();
  }, [resolvedGroupId]);

  // Editing away from a submitted intent retires that request id and outcome.
  useEffect(() => {
    if (!attempt) return;
    if (attempt.message !== trimmed || attempt.groupConnectionId !== resolvedGroupId) {
      setAttempt(null);
      setOutcome(null);
    }
  }, [attempt, trimmed, resolvedGroupId]);

  /** Shared community state is page-level; ask it to refresh, never re-own it. */
  function refreshSharedCommunityState(id?: string | null) {
    void setup.groupQuery.refetch();
    if (id) void setup.recheckGroup(id, true);
  }

  const mutation = useMutation({
    mutationFn: (snap: Snapshot) =>
      sendGroupAnnouncement({
        workspaceId: workspaceId!,
        groupConnectionId: snap.groupConnectionId,
        message: snap.message,
        clientRequestId: snap.clientRequestId,
      }),
    onMutate: (snap) => {
      setAttempt({
        groupConnectionId: snap.groupConnectionId,
        message: snap.message,
        clientRequestId: snap.clientRequestId,
      });
      setOutcome(null);
    },
    onSuccess: (result, snap) => {
      if (result.reconnectRequired || !result.status) {
        // Recoverable lifecycle state — not an announcement outcome.
        setOutcome(null);
        setAttempt(null);
        refreshSharedCommunityState(snap.groupConnectionId);
        toast.error(
          result.message ?? "@PepeCartelHQBot is no longer in this community. Nothing was posted.",
        );
        return;
      }
      setOutcome(result);

      if (result.status === "SENT") {
        // Confirmed post: retire the id and the draft so the same intent can
        // never be posted twice. The truthful outcome card stays visible.
        setAttempt(null);
        setMessage("");
        toast.success(result.message ?? "Announcement posted.");
        return;
      }
      if (result.status === "FAILED") {
        // Definite no-send: keep the draft for correction, retire the id so a
        // deliberate retry is submitted as a new request.
        setAttempt(null);
        toast.error(result.message ?? "The announcement was not posted.");
        return;
      }
      // AMBIGUOUS: keep the id so an identical retry stays idempotent.
      toast.warning(result.message ?? "Delivery could not be confirmed.");
    },
    onError: (err: unknown) => {
      setSnapshot(null);
      toast.error(err instanceof Error ? err.message : "Could not post the announcement.");
    },
  });

  const tooLong = message.length > GROUP_ANNOUNCEMENT_MAX;
  const busy = mutation.isPending || preparing;
  const readinessBlock = readiness ? unreadyReason(readiness) : null;
  // Never claim a permission answer before permission is known.
  const blockReason: string | null = accessQuery.isPending
    ? "Checking your permissions…"
    : accessQuery.isError
      ? "Could not verify your permissions, so posting is blocked."
      : !canManage
        ? "Only workspace owners and admins can post community announcements."
        : groups.length === 0
          ? "Connect a Telegram community before posting an announcement."
          : readinessBlock
            ? readinessBlock
            : outcome?.status === "AMBIGUOUS"
              ? "This announcement's delivery is unconfirmed. Check the community in Telegram before writing a new one."
              : null;

  const sendDisabled =
    busy || !workspaceId || !group || !canManage || !trimmed || tooLong || !!blockReason;

  /**
   * Freeze the exact reviewed announcement. The confirmation is built only after
   * a fresh permission check and a live community verification, and only if the
   * latest selection and draft still match what was clicked — the dialog renders
   * from this snapshot and the mutation submits only this snapshot.
   */
  async function prepareConfirmation() {
    if (sendDisabled || !group || !workspaceId) return;
    const clicked = { groupConnectionId: group.id, message: trimmed };
    setPreparing(true);
    try {
      const [accessResult, liveResult] = await Promise.allSettled([
        accessQuery.refetch(),
        fetchTelegramGroupStatus({ workspaceId, groupConnectionId: clicked.groupConnectionId }),
      ]);
      if (
        accessResult.status !== "fulfilled" ||
        accessResult.value.isError ||
        !accessResult.value.data?.canManage
      ) {
        toast.error("Could not confirm your permissions. Nothing was posted.");
        return;
      }
      if (liveResult.status !== "fulfilled") {
        toast.error(
          liveResult.reason instanceof Error
            ? liveResult.reason.message
            : "Could not verify the community. Nothing was posted.",
        );
        return;
      }
      const live = liveResult.value;
      if (live.reconnectRequired || live.connectionState === "bot_removed") {
        refreshSharedCommunityState(clicked.groupConnectionId);
        toast.error(
          live.message ??
            "@PepeCartelHQBot is no longer in this community. Nothing was posted.",
        );
        return;
      }
      // Drift across the await, measured against the LATEST state, not a closure.
      if (
        latestRef.current.groupConnectionId !== clicked.groupConnectionId ||
        latestRef.current.message !== clicked.message
      ) {
        toast.error("The announcement changed while it was loading. Nothing was posted.");
        return;
      }
      const id =
        attempt &&
        attempt.groupConnectionId === clicked.groupConnectionId &&
        attempt.message === clicked.message
          ? attempt.clientRequestId
          : newRequestId();
      setSnapshot({
        groupConnectionId: clicked.groupConnectionId,
        groupTitle: live.group?.title ?? group.title,
        message: clicked.message,
        clientRequestId: id,
      });
      setConfirmOpen(true);
    } finally {
      setPreparing(false);
    }
  }

  return (
    <>
      <Section
        variant="surface"
        title="Community announcement"
        leading={<Send className="size-4" aria-hidden="true" />}
        description="Posts one plain-text message from @PepeCartelHQBot into the selected connected community."
      >
        {groups.length === 0 ? (
          <div className="min-w-0 space-y-3">
            <p className="text-xs leading-relaxed text-muted-foreground">
              No Telegram community is connected to this workspace yet. Connect one in Communities
              first.
            </p>
            <Button asChild variant="outline" className="min-h-11">
              <Link to="/telegram" search={{ tab: "communities" }}>
                <Users className="size-4" aria-hidden="true" />
                Go to Communities
              </Link>
            </Button>
          </div>
        ) : (
          <div className="min-w-0 space-y-3">
            <div className="min-w-0 space-y-2">
              <Label htmlFor="group-announcement-target">Community</Label>
              <Select
                value={resolvedGroupId ?? ""}
                disabled={busy}
                onValueChange={(value) => setGroupId(value)}
              >
                <SelectTrigger id="group-announcement-target" className="min-h-11 w-full">
                  <SelectValue placeholder="Select a community" />
                </SelectTrigger>
                <SelectContent>
                  {groups.map((g) => (
                    <SelectItem key={g.id} value={g.id}>
                      {g.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {readiness ? (
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {readiness.ready
                    ? "@PepeCartelHQBot is an administrator in this community. It is re-checked live before anything is posted."
                    : (unreadyReason(readiness) ??
                      "This community has not been verified as ready.")}
                </p>
              ) : null}
            </div>

            <div className="min-w-0">
              <Label htmlFor="group-announcement-message">Announcement</Label>
              <Textarea
                id="group-announcement-message"
                rows={6}
                maxLength={GROUP_ANNOUNCEMENT_MAX}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="What should this community see?"
                disabled={busy || !canManage}
              />
              <p className="mt-1 text-right text-xs text-muted-foreground">
                {message.length}/{GROUP_ANNOUNCEMENT_MAX}
              </p>
            </div>

            {trimmed ? (
              <div className="min-w-0 rounded-md border border-border/60 bg-background/30 p-3">
                <p className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
                  Group message preview
                </p>
                <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">
                  {message}
                </p>
                <p className="mt-2 border-t border-border/60 pt-2 text-xs leading-relaxed text-muted-foreground">
                  Sent as plain text exactly as written. No formatting is applied and link previews
                  are turned off.
                </p>
              </div>
            ) : null}

            <div className="flex flex-wrap items-center gap-2">
              <Button
                className="min-h-11"
                disabled={sendDisabled}
                onClick={() => void prepareConfirmation()}
              >
                {busy ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Send className="size-4" aria-hidden="true" />
                )}
                Post announcement
              </Button>
              {outcome ? (
                <Button
                  variant="outline"
                  className="min-h-11"
                  disabled={busy}
                  onClick={resetComposer}
                >
                  New announcement
                </Button>
              ) : null}
            </div>

            {outcome ? (
              <div
                className="min-w-0 rounded-md border border-border/70 bg-background/40 p-3"
                role="status"
              >
                <div className="flex items-center gap-2">
                  {outcome.status === "SENT" ? (
                    <CheckCircle2 className="size-4 text-primary" aria-hidden="true" />
                  ) : outcome.status === "FAILED" ? (
                    <AlertTriangle className="size-4 text-destructive" aria-hidden="true" />
                  ) : (
                    <HelpCircle className="size-4 text-muted-foreground" aria-hidden="true" />
                  )}
                  <StatusBadge
                    tone={
                      outcome.status === "SENT"
                        ? "green"
                        : outcome.status === "FAILED"
                          ? "red"
                          : "muted"
                    }
                  >
                    {outcome.status === "SENT"
                      ? "Posted"
                      : outcome.status === "FAILED"
                        ? "Not posted"
                        : "Delivery unconfirmed"}
                  </StatusBadge>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                  {outcome.message ??
                    (outcome.status === "SENT"
                      ? "Announcement posted."
                      : "The announcement outcome was recorded.")}
                </p>
                {outcome.status === "AMBIGUOUS" ? (
                  <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                    Do not assume this was delivered. CARTEL HQ will not resend it automatically.
                    Open the community in Telegram to check whether the message arrived before
                    writing a new announcement.
                  </p>
                ) : null}
                {outcome.status === "FAILED" ? (
                  <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                    Nothing was posted. Your text is still here — fix it and post again as a new
                    announcement.
                  </p>
                ) : null}
                {outcome.technical ? (
                  <p className="mt-2 text-xs leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">
                    {outcome.technical}
                  </p>
                ) : null}
              </div>
            ) : null}

            {blockReason ? (
              <p className="text-xs leading-relaxed text-muted-foreground">{blockReason}</p>
            ) : null}
            <p className="text-xs leading-relaxed text-muted-foreground">
              This posts publicly in the community. It is not a Launch Watch watcher DM and it does
              not create or change any launch notification.
            </p>
          </div>
        )}
      </Section>

      <AlertDialog
        open={confirmOpen}
        onOpenChange={(open) => {
          setConfirmOpen(open);
          if (!open) setSnapshot(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Post this announcement to {snapshot?.groupTitle ?? "this community"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Everyone in the community can see it. It is posted as plain text by
              @PepeCartelHQBot and no watcher DM is sent.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="max-h-48 overflow-y-auto rounded-md border border-border/60 bg-background/40 p-3">
            <p className="whitespace-pre-wrap text-xs leading-relaxed text-foreground [overflow-wrap:anywhere]">
              {snapshot?.message ?? ""}
            </p>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={mutation.isPending || !snapshot}
              onClick={(e) => {
                e.preventDefault();
                if (!snapshot) return;
                mutation.mutate(snapshot);
                setConfirmOpen(false);
              }}
            >
              Post announcement
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
