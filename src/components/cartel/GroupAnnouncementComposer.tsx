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
import { Switch } from "@/components/ui/switch";
import { useWorkspace } from "@/lib/workspace-context";
import { getLaunchAccess } from "@/lib/launch-control";
import { getProjectProfile } from "@/lib/project-profile";
import { listWorkspaceAssets, signedUrl } from "@/lib/media";
import {
  BRANDED_BROADCAST_CAPTION_MAX,
  GROUP_ANNOUNCEMENT_MAX,
  buildBrandedBroadcastCaption,
  fetchTelegramGroupStatus,
  sendGroupAnnouncement,
  type GroupAnnouncementResult,
  type ReviewedBroadcastBranding,
} from "@/lib/telegram-group";
import type { GroupReadiness, TelegramGroupSetup } from "@/components/cartel/TelegramGroupCard";

/**
 * Community Command → Broadcasts → Official Community Broadcast (C7).
 *
 * Posts ONE announcement to ONE connected community. Every rule that
 * matters — owner/admin authorization, live bot verification, exact
 * target+message idempotency, branding validation against the saved Project
 * Profile, and the durable announcement ledger — lives in the `telegram-group`
 * Edge Function. This component is presentation, truthful disabling, and
 * correct client-request-id lifecycle only.
 *
 * Outcomes are never collapsed: a delivery that could not be confirmed
 * (AMBIGUOUS) is reported as uncertain and is NEVER resent automatically.
 *
 * C7.2 — branding is OPTIONAL and OFF by default; plain text stays the default
 * delivery. The branding shown here is a preview of what the server will
 * rebuild from the saved profile, never the source of what gets posted.
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
  /** Exactly what will be posted: plain body, or the branded caption. */
  deliveredText: string;
  branding: ReviewedBroadcastBranding | null;
  brandingLogoUrl: string | null;
};

/** The exact intent already submitted to the server under `clientRequestId`. */
type Attempt = {
  groupConnectionId: string;
  message: string;
  clientRequestId: string;
  branded: boolean;
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
    return "This connected chat is not a supported Telegram group, so an official broadcast cannot be posted to it.";
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

  /**
   * C7.2 — saved Project Profile identity. Read-only here: the server re-reads
   * the same rows and refuses to post if they no longer match what was reviewed.
   */
  const profileQuery = useQuery({
    queryKey: ["project-profile", workspaceId],
    enabled: !!workspaceId,
    queryFn: () => getProjectProfile(workspaceId!),
  });
  const logosQuery = useQuery({
    queryKey: ["project-profile-logos", workspaceId],
    enabled: !!workspaceId,
    queryFn: async () => {
      const all = await listWorkspaceAssets(workspaceId!);
      return all.filter((a) => a.asset_type === "logo");
    },
  });

  const profile = profileQuery.data ?? null;
  const logoAsset =
    profile?.logo_asset_id
      ? ((logosQuery.data ?? []).find((a) => a.id === profile.logo_asset_id) ?? null)
      : null;
  const logoMime = (logoAsset?.mime_type ?? "").toLowerCase();
  const logoSupported = logoMime === "image/png" || logoMime === "image/jpeg";
  const brandingReady = !!profile?.project_name?.trim() && !!logoAsset && logoSupported;

  const brandingIdentity: ReviewedBroadcastBranding | null =
    brandingReady && profile && logoAsset
      ? {
          projectName: profile.project_name.trim(),
          ticker: (profile.ticker ?? "").trim(),
          logoAssetId: logoAsset.id,
        }
      : null;

  const brandingUnavailableReason = profileQuery.isPending || logosQuery.isPending
    ? "Checking your project branding…"
    : profileQuery.isError || logosQuery.isError
      ? "Could not read your project branding, so branded posting is unavailable."
      : !profile
        ? "Save a Project Profile to post branded broadcasts."
        : !profile.project_name?.trim()
          ? "Add a project name in Project Profile to post branded broadcasts."
          : !logoAsset
            ? "Select a project logo in Project Profile to post branded broadcasts."
            : !logoSupported
              ? "Branded broadcasts need a PNG or JPEG project logo. Upload one in Project Profile."
              : null;

  const [message, setMessage] = useState("");
  const [brandedRequested, setBrandedRequested] = useState(false);
  const branded = brandedRequested && brandingReady;
  const [logoPreviewUrl, setLogoPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    if (!branded || !logoAsset) {
      setLogoPreviewUrl(null);
      return;
    }
    void signedUrl(logoAsset.storage_path, 300).then((url) => {
      if (active) setLogoPreviewUrl(url);
    });
    return () => {
      active = false;
    };
  }, [branded, logoAsset]);

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

  /** Local preview of the exact text the server will post. */
  const previewText =
    branded && brandingIdentity
      ? buildBrandedBroadcastCaption(
          brandingIdentity.projectName,
          brandingIdentity.ticker || null,
          trimmed,
        )
      : trimmed;
  const brandedOverLimit = branded && previewText.length > BRANDED_BROADCAST_CAPTION_MAX;

  /**
   * Latest committed selection + draft, readable across an await. Preparation
   * compares against this ref rather than its own captured closure values, so a
   * reviewed announcement can never differ from the submitted one.
   */
  const latestRef = useRef<{
    groupConnectionId: string | null;
    message: string;
    branded: boolean;
    brandingKey: string;
  }>({
    groupConnectionId: resolvedGroupId,
    message: trimmed,
    branded,
    brandingKey: "",
  });
  const brandingKey = brandingIdentity
    ? `${brandingIdentity.projectName}\u0000${brandingIdentity.ticker}\u0000${brandingIdentity.logoAssetId}`
    : "";
  latestRef.current = {
    groupConnectionId: resolvedGroupId,
    message: trimmed,
    branded,
    brandingKey,
  };

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
    if (
      attempt.message !== trimmed ||
      attempt.groupConnectionId !== resolvedGroupId ||
      attempt.branded !== branded
    ) {
      setAttempt(null);
      setOutcome(null);
    }
  }, [attempt, trimmed, resolvedGroupId, branded]);

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
        toast.success(`Official broadcast posted to ${snap.groupTitle}.`);
        return;
      }
      if (result.status === "FAILED") {
        // Definite no-send: keep the draft for correction, retire the id so a
        // deliberate retry is submitted as a new request.
        setAttempt(null);
        toast.error(`Official broadcast was not posted to ${snap.groupTitle}.`);
        return;
      }
      // AMBIGUOUS: keep the id so an identical retry stays idempotent.
      toast.warning(result.message ?? "Delivery could not be confirmed.");
    },
    onError: (err: unknown) => {
      setSnapshot(null);
      toast.error(err instanceof Error ? err.message : "Could not post the official broadcast.");
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
        ? "Only workspace owners and admins can post official community broadcasts."
        : groups.length === 0
          ? "Connect a Telegram community before posting an official broadcast."
          : readinessBlock
            ? readinessBlock
            : outcome?.status === "AMBIGUOUS"
              ? "This broadcast's delivery is unconfirmed. Check the community in Telegram before writing a new one."
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
        toast.error("The official broadcast changed while it was loading. Nothing was posted.");
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
        title="Official Community Broadcast"
        leading={<Send className="size-4" aria-hidden="true" />}
        description="Post an official project message to a connected Telegram community through @PepeCartelHQBot."
      >
        {groups.length === 0 ? (
          <div className="min-w-0 space-y-3">
            <p className="text-xs leading-relaxed text-muted-foreground">
              No Telegram community is connected to this workspace yet. Connect one in Communities
              before posting official broadcasts.
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
                    ? "@PepeCartelHQBot is an administrator in this community. It is re-checked live before any official broadcast is posted."
                    : (unreadyReason(readiness) ??
                      "This community has not been verified as ready.")}
                </p>
              ) : null}
            </div>

            <div className="min-w-0">
              <Label htmlFor="group-announcement-message">Official broadcast</Label>
              <Textarea
                id="group-announcement-message"
                rows={6}
                maxLength={GROUP_ANNOUNCEMENT_MAX}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="What official message should this community see?"
                disabled={busy || !canManage}
              />
              <p className="mt-1 text-right text-xs text-muted-foreground">
                {message.length}/{GROUP_ANNOUNCEMENT_MAX}
              </p>
            </div>

            {trimmed ? (
              <div className="min-w-0 rounded-md border border-border/60 bg-background/30 p-3">
                <p className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
                  Community broadcast preview
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
                Post Official Broadcast
              </Button>
              {outcome ? (
                <Button
                  variant="outline"
                  className="min-h-11"
                  disabled={busy}
                  onClick={resetComposer}
                >
                  New broadcast
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
                  {outcome.status === "SENT"
                    ? `Official broadcast posted to ${outcome.groupTitle ?? group?.title ?? "this community"}.`
                    : outcome.status === "FAILED"
                      ? `Official broadcast was not posted to ${outcome.groupTitle ?? group?.title ?? "this community"}.`
                      : outcome.message ?? "The broadcast outcome was recorded."}
                </p>
                {outcome.status === "AMBIGUOUS" ? (
                  <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                    Do not assume this was delivered. CARTEL HQ will not resend it automatically.
                    Open the community in Telegram to check whether the official broadcast arrived
                    before writing a new one.
                  </p>
                ) : null}
                {outcome.status === "FAILED" ? (
                  <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                    Nothing was posted. Your text is still here — fix it and post again as a new
                    official broadcast.
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
              This posts an official project message publicly in the community. It is not a Launch
              Watch watcher DM and it does not create or change any launch notification.
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
              Post this official broadcast to {snapshot?.groupTitle ?? "this community"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Everyone in the community can see it. It is posted as plain text by
              @PepeCartelHQBot for official project/team communications and does not replace normal
              everyday conversation. No watcher DM is sent.
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
              Post Official Broadcast
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
