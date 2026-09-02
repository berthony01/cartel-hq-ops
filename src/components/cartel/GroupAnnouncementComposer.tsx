import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, HelpCircle, Loader2, Send } from "lucide-react";
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
import type { TelegramGroupSetup } from "@/components/cartel/TelegramGroupCard";

/**
 * Community Command → Broadcasts → Telegram community (C7).
 *
 * Posts ONE plain-text announcement to ONE connected community. Every rule that
 * matters — owner/admin authorization, live bot verification, idempotency and
 * the durable announcement ledger — lives in the `telegram-group` Edge Function.
 * This component is presentation and truthful disabling only.
 *
 * Outcomes are never collapsed: a delivery that could not be confirmed
 * (AMBIGUOUS) is reported as uncertain and is NEVER resent automatically.
 */
type Snapshot = {
  groupConnectionId: string;
  groupTitle: string;
  message: string;
  clientRequestId: string;
};

function newRequestId() {
  return crypto.randomUUID();
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
   * ONE client request id per intended announcement. It survives a failed or
   * uncertain attempt so an identical retry stays idempotent server-side, and is
   * rotated as soon as the draft is edited into a different message.
   */
  const [requestId, setRequestId] = useState<string | null>(null);
  const [attemptedMessage, setAttemptedMessage] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [outcome, setOutcome] = useState<GroupAnnouncementResult | null>(null);

  function resetComposer() {
    setMessage("");
    setRequestId(null);
    setAttemptedMessage(null);
    setConfirmOpen(false);
    setSnapshot(null);
    setOutcome(null);
  }

  // Switching community makes this a different intended announcement.
  useEffect(() => {
    resetComposer();
  }, [resolvedGroupId]);

  useEffect(() => {
    if (attemptedMessage === null) return;
    if (attemptedMessage !== message) {
      setRequestId(null);
      setAttemptedMessage(null);
      setOutcome(null);
    }
  }, [message, attemptedMessage]);

  const mutation = useMutation({
    mutationFn: (snap: Snapshot) =>
      sendGroupAnnouncement({
        workspaceId: workspaceId!,
        groupConnectionId: snap.groupConnectionId,
        message: snap.message,
        clientRequestId: snap.clientRequestId,
      }),
    onMutate: (snap) => {
      setAttemptedMessage(snap.message);
      setOutcome(null);
    },
    onSuccess: (result) => {
      if (result.reconnectRequired || !result.status) {
        // Recoverable lifecycle state — not an announcement outcome.
        setOutcome(null);
        setRequestId(null);
        setAttemptedMessage(null);
        toast.error(
          result.message ?? "@PepeCartelHQBot is no longer in this community. Nothing was posted.",
        );
        return;
      }
      setOutcome(result);

      if (result.status === "SENT") {
        toast.success(result.message ?? "Announcement posted.");
        return;
      }
      if (result.status === "FAILED") {
        toast.error(result.message ?? "The announcement was not posted.");
        return;
      }
      toast.warning(result.message ?? "Delivery could not be confirmed.");
    },
    onError: (err: unknown) => {
      setSnapshot(null);
      toast.error(
        err instanceof Error ? err.message : "Could not post the announcement.",
      );
    },
  });

  const trimmed = message.trim();
  const tooLong = message.length > GROUP_ANNOUNCEMENT_MAX;
  const busy = mutation.isPending || preparing;
  // Never claim a permission answer before permission is known.
  const blockReason: string | null = accessQuery.isPending
    ? "Checking your permissions…"
    : accessQuery.isError
      ? "Could not verify your permissions, so posting is blocked."
      : !canManage
        ? "Only workspace owners and admins can post community announcements."
        : groups.length === 0
          ? "Connect a Telegram community before posting an announcement."
          : readiness?.botRemoved
            ? "@PepeCartelHQBot is no longer in this community. Re-add the bot as an administrator, then re-check it in Communities."
            : outcome?.status === "AMBIGUOUS"
              ? "This announcement's delivery is unconfirmed. Check the community in Telegram before writing a new one."
              : outcome?.status === "SENT"
                ? "This announcement was posted. Start a new one to post again."
                : null;

  const sendDisabled =
    busy || !workspaceId || !group || !canManage || !trimmed || tooLong || !!blockReason;

  /**
   * Freeze the exact reviewed announcement. The confirmation is built only after
   * a fresh permission check and a live community verification that still match
   * the operator's current selection and draft — the dialog renders from this
   * snapshot and the mutation submits only this snapshot.
   */
  async function prepareConfirmation() {
    if (sendDisabled || !group || !workspaceId) return;
    const clicked = { groupConnectionId: group.id, message: trimmed };
    setPreparing(true);
    try {
      const [accessResult, liveResult] = await Promise.allSettled([
        accessQuery.refetch(),
        fetchTelegramGroupStatus({ workspaceId, groupConnectionId: group.id }),
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
        toast.error(
          live.message ??
            "@PepeCartelHQBot is no longer in this community. Nothing was posted.",
        );
        return;
      }
      // Drift across the await: the operator changed the draft or the community.
      if (clicked.groupConnectionId !== group.id || clicked.message !== message.trim()) {
        toast.error("The announcement changed while it was loading. Nothing was posted.");
        return;
      }
      const id = requestId ?? newRequestId();
      setRequestId(id);
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
          <p className="text-xs leading-relaxed text-muted-foreground">
            No Telegram community is connected to this workspace yet. Connect one in Communities
            first.
          </p>
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
                  {readiness.botRemoved
                    ? "@PepeCartelHQBot is not in this community right now."
                    : readiness.ready
                      ? "@PepeCartelHQBot is an administrator in this community."
                      : "This community has not been verified as ready. The bot is re-checked before anything is posted."}
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
                    CARTEL HQ will not resend this automatically. Open the community in Telegram to
                    check whether the message arrived before writing a new announcement.
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
          // Cancelling BEFORE any attempt starts a fresh idempotency id; after an
          // attempt the id is preserved so an identical retry cannot double-post.
          if (!open && !mutation.isPending && attemptedMessage === null) setRequestId(null);
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
