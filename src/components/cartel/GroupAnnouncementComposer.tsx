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
  BROADCAST_BRANDING_TEMPLATE_VERSION,
  GROUP_ANNOUNCEMENT_MAX,
  GROUP_BRANDED_CAPTION_MAX,
  buildBrandedBroadcastCaption,
  fetchBroadcastLaunchOptions,
  fetchTelegramGroupStatus,
  sendGroupAnnouncement,
  type GroupAnnouncementResult,
  type LaunchWatchCtaOption,
  type ReviewedBroadcastBranding,
} from "@/lib/telegram-group";
import type { MediaAsset } from "@/lib/media";
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
  /** Frozen Launch Watch CTA intent. The private token stays server-side. */
  cta: LaunchWatchCtaOption | null;
};

/** The exact intent already submitted to the server under `clientRequestId`. */
type Attempt = {
  groupConnectionId: string;
  message: string;
  clientRequestId: string;
  branded: boolean;
  /** Stable branding identity of that intent; empty string for plain text. */
  brandingKey: string;
  /** Selected Launch Watch launch id; empty string when no CTA was attached. */
  ctaKey: string;
};

function newRequestId() {
  return crypto.randomUUID();
}

/**
 * The branded intent, reduced to one comparable string. It must change whenever
 * anything the server treats as branding identity changes.
 */
function makeBrandingKey(branding: ReviewedBroadcastBranding | null): string {
  if (!branding) return "";
  return [
    branding.templateVersion,
    branding.projectName,
    branding.ticker,
    branding.logoAssetId,
  ].join("\u0000");
}

/**
 * Honest saved-logo compatibility, derived only from stored metadata using the
 * same known rules the server enforces. Unknown dimensions stay eligible: the
 * server remains authoritative on the actual download and the Telegram call.
 */
function logoCompatibilityReason(asset: MediaAsset | null): string | null {
  if (!asset) return "Select a project logo in Project Profile to post branded broadcasts.";
  if (asset.asset_type !== "logo") {
    return "The selected asset is not a project logo. Choose a logo in Project Profile.";
  }
  const mime = (asset.mime_type ?? "").toLowerCase();
  if (mime !== "image/png" && mime !== "image/jpeg") {
    return "Branded broadcasts need a PNG or JPEG project logo. Upload one in Project Profile.";
  }
  const size = typeof asset.file_size_bytes === "number" ? asset.file_size_bytes : null;
  if (size !== null && (size <= 0 || size > 10 * 1024 * 1024)) {
    return "Branded broadcasts need a project logo of 10MB or less. Upload a smaller PNG or JPEG in Project Profile.";
  }
  const w = typeof asset.width === "number" ? asset.width : null;
  const h = typeof asset.height === "number" ? asset.height : null;
  const dimsBad =
    (w !== null && w <= 0) ||
    (h !== null && h <= 0) ||
    (w !== null && h !== null && (w + h > 10000 || Math.max(w, h) / Math.max(1, Math.min(w, h)) > 20));
  if (dimsBad) {
    return "Telegram cannot post this logo's dimensions. Upload a more standard PNG or JPEG logo in Project Profile.";
  }

  return null;
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
  const logoReason = logoCompatibilityReason(logoAsset);
  const brandingReady = !!profile?.project_name?.trim() && !!logoAsset && !logoReason;

  const brandingIdentity: ReviewedBroadcastBranding | null =
    brandingReady && profile && logoAsset
      ? {
          projectName: profile.project_name.trim(),
          ticker: (profile.ticker ?? "").trim(),
          logoAssetId: logoAsset.id,
          templateVersion: BROADCAST_BRANDING_TEMPLATE_VERSION,
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
          : logoReason;

  const [message, setMessage] = useState("");
  /**
   * Branding is the NORMAL delivery when saved branding is valid: the toggle
   * defaults ON once readiness is positively known, and only until the operator
   * takes over the decision for this draft.
   */
  const [brandedRequested, setBrandedRequested] = useState(false);
  const [brandingTouched, setBrandingTouched] = useState(false);
  useEffect(() => {
    if (brandingTouched) return;
    if (brandingReady) setBrandedRequested(true);
  }, [brandingReady, brandingTouched]);
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
   * Optional Launch Watch CTA. The server validates eligibility again at send
   * time and builds the deep link itself — the browser never sees the token.
   */
  const [ctaRequested, setCtaRequested] = useState(false);
  const [ctaLaunchId, setCtaLaunchId] = useState<string | null>(null);
  const ctaQuery = useQuery({
    queryKey: ["broadcast-launch-cta-options", workspaceId, resolvedGroupId],
    enabled: !!workspaceId && !!resolvedGroupId && canManage,
    queryFn: () =>
      fetchBroadcastLaunchOptions({
        workspaceId: workspaceId!,
        groupConnectionId: resolvedGroupId!,
      }),
  });
  const ctaOptions = ctaQuery.data?.options ?? [];
  const ctaSelected = ctaLaunchId
    ? (ctaOptions.find((o) => o.launchId === ctaLaunchId) ?? null)
    : null;
  const ctaActive = ctaRequested && !!ctaSelected;
  const ctaKey = ctaActive ? ctaSelected!.launchId : "";
  const ctaUnavailableReason = ctaQuery.isPending
    ? "Checking eligible launches…"
    : ctaQuery.isError
      ? "Could not read your eligible launches, so the Launch Watch button is unavailable."
      : ctaOptions.length === 0
        ? "No launch is currently open for Launch Watch signups with a published Project Profile."
        : null;

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
  const brandedOverLimit = branded && previewText.length > GROUP_BRANDED_CAPTION_MAX;

  const brandingKey = makeBrandingKey(branded ? brandingIdentity : null);

  /**
   * Latest committed selection + draft, readable across an await. Preparation
   * compares against this ref rather than its own captured closure values, so a
   * reviewed broadcast can never differ from the submitted one.
   */
  const latestRef = useRef<{
    groupConnectionId: string | null;
    message: string;
    branded: boolean;
    brandingKey: string;
    ctaKey: string;
  }>({
    groupConnectionId: resolvedGroupId,
    message: trimmed,
    branded,
    brandingKey,
    ctaKey,
  });
  latestRef.current = {
    groupConnectionId: resolvedGroupId,
    message: trimmed,
    branded,
    brandingKey,
    ctaKey,
  };

  function resetComposer() {
    setMessage("");
    // A genuinely new broadcast recomputes the branding default from readiness.
    setBrandingTouched(false);
    setBrandedRequested(brandingReady);
    setCtaRequested(false);
    setCtaLaunchId(null);
    setAttempt(null);
    setConfirmOpen(false);
    setSnapshot(null);
    setOutcome(null);
  }

  // Switching community makes this a different intended broadcast.
  useEffect(() => {
    resetComposer();
  }, [resolvedGroupId]);

  /**
   * Editing away from a submitted intent retires that request id and outcome —
   * including when the SAVED branding identity behind a branded attempt changed.
   */
  useEffect(() => {
    if (!attempt) return;
    if (
      attempt.message !== trimmed ||
      attempt.groupConnectionId !== resolvedGroupId ||
      attempt.branded !== branded ||
      attempt.brandingKey !== brandingKey ||
      attempt.ctaKey !== ctaKey
    ) {
      setAttempt(null);
      setOutcome(null);
    }
  }, [attempt, trimmed, resolvedGroupId, branded, brandingKey, ctaKey]);

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
        branding: snap.branding,
        ctaLaunchId: snap.cta?.launchId ?? null,
      }),
    onMutate: (snap) => {
      setAttempt({
        groupConnectionId: snap.groupConnectionId,
        message: snap.message,
        clientRequestId: snap.clientRequestId,
        branded: !!snap.branding,
        brandingKey: makeBrandingKey(snap.branding),
        ctaKey: snap.cta?.launchId ?? "",
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
              : brandedRequested && !brandingReady
                ? (brandingUnavailableReason ??
                  "Branded posting is unavailable for this project right now.")
                : ctaRequested && !ctaSelected
                  ? (ctaUnavailableReason ??
                    "Select the launch this Launch Watch button should point to.")
                : brandedOverLimit
                  ? `Branded broadcasts are limited to ${GROUP_BRANDED_CAPTION_MAX} characters including the branding header and footer. Shorten the message or turn branding off.`
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
    const clicked = {
      groupConnectionId: group.id,
      message: trimmed,
      branded,
      branding: brandingIdentity,
      brandingKey,
      ctaActive,
      ctaKey,
      cta: ctaSelected,
    };
    setPreparing(true);
    try {
      const [accessResult, liveResult, profileResult, logosResult, ctaResult] = await Promise.allSettled([
        accessQuery.refetch(),
        fetchTelegramGroupStatus({ workspaceId, groupConnectionId: clicked.groupConnectionId }),
        profileQuery.refetch(),
        logosQuery.refetch(),
        ctaQuery.refetch(),
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
      /**
       * Branded posting is reviewed against freshly re-read Project Profile
       * identity, including the locked template version. Any disagreement stops
       * here; the server performs the same check again and is the authority.
       */
      let freshBranding: ReviewedBroadcastBranding | null = null;
      let freshLogoUrl: string | null = null;
      if (clicked.branded) {
        if (
          profileResult.status !== "fulfilled" ||
          profileResult.value.isError ||
          logosResult.status !== "fulfilled" ||
          logosResult.value.isError
        ) {
          toast.error("Could not confirm your project branding. Nothing was posted.");
          return;
        }
        const freshProfile = profileResult.value.data ?? null;
        const freshLogo = freshProfile?.logo_asset_id
          ? ((logosResult.value.data ?? []).find((a) => a.id === freshProfile.logo_asset_id) ?? null)
          : null;
        const freshIdentity: ReviewedBroadcastBranding | null =
          freshProfile?.project_name?.trim() && freshLogo && !logoCompatibilityReason(freshLogo)
            ? {
                projectName: freshProfile.project_name.trim(),
                ticker: (freshProfile.ticker ?? "").trim(),
                logoAssetId: freshLogo.id,
                templateVersion: BROADCAST_BRANDING_TEMPLATE_VERSION,
              }
            : null;
        const freshKey = makeBrandingKey(freshIdentity);
        if (!freshKey || freshKey !== clicked.brandingKey) {
          toast.error(
            "Your project branding changed while this broadcast was loading. Review it again — nothing was posted.",
          );
          return;
        }
        freshBranding = freshIdentity;
        // The reviewed image must be the freshly resolved logo, never a stale preview URL.
        freshLogoUrl = freshLogo ? await signedUrl(freshLogo.storage_path, 300) : null;
        if (!freshLogoUrl) {
          toast.error("Could not load your project logo for review. Nothing was posted.");
          return;
        }
      }
      /**
       * The selected launch is re-read before review. A launch that stopped
       * accepting Launch Watch signups blocks the send truthfully — it is never
       * silently dropped and never silently replaced.
       */
      let freshCta: LaunchWatchCtaOption | null = null;
      if (clicked.ctaActive) {
        if (ctaResult.status !== "fulfilled") {
          toast.error("Could not confirm the selected launch. Nothing was posted.");
          return;
        }
        freshCta =
          (ctaResult.value.data?.options ?? []).find((o) => o.launchId === clicked.ctaKey) ?? null;
        if (!freshCta) {
          toast.error(
            "The selected launch can no longer accept new Launch Watch signups. Review the broadcast again — nothing was posted.",
          );
          return;
        }
      }
      // Drift across the await, measured against the LATEST state, not a closure.
      if (
        latestRef.current.groupConnectionId !== clicked.groupConnectionId ||
        latestRef.current.message !== clicked.message ||
        latestRef.current.branded !== clicked.branded ||
        latestRef.current.brandingKey !== clicked.brandingKey ||
        latestRef.current.ctaKey !== clicked.ctaKey
      ) {
        toast.error("The official broadcast changed while it was loading. Nothing was posted.");
        return;
      }
      const id =
        attempt &&
        attempt.groupConnectionId === clicked.groupConnectionId &&
        attempt.message === clicked.message &&
        attempt.branded === clicked.branded &&
        attempt.brandingKey === clicked.brandingKey &&
        attempt.ctaKey === clicked.ctaKey
          ? attempt.clientRequestId
          : newRequestId();
      const brandingForSend = clicked.branded ? freshBranding : null;
      setSnapshot({
        groupConnectionId: clicked.groupConnectionId,
        groupTitle: live.group?.title ?? group.title,
        message: clicked.message,
        clientRequestId: id,
        deliveredText: brandingForSend
          ? buildBrandedBroadcastCaption(
              brandingForSend.projectName,
              brandingForSend.ticker || null,
              clicked.message,
            )
          : clicked.message,
        branding: brandingForSend,
        brandingLogoUrl: brandingForSend ? freshLogoUrl : null,
        cta: clicked.ctaActive ? freshCta : null,
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

            <div className="min-w-0 rounded-md border border-border/60 bg-background/30 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <Label htmlFor="group-announcement-branded">Post with project branding</Label>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    Adds your saved project logo and identity header from Project Profile. Plain
                    text stays the default.
                  </p>
                </div>
                <Switch
                  id="group-announcement-branded"
                  checked={brandedRequested}
                  disabled={busy || !canManage || !brandingReady}
                  onCheckedChange={(checked) => setBrandedRequested(checked)}
                />
              </div>
              {brandingUnavailableReason ? (
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                  {brandingUnavailableReason}{" "}
                  <Link to="/project-profile" className="underline underline-offset-2">
                    Open Project Profile
                  </Link>
                </p>
              ) : branded ? (
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                  Branded posts are limited to {GROUP_BRANDED_CAPTION_MAX} characters including the
                  branding header and footer. The branding is re-checked against your saved Project
                  Profile before anything is posted.

                </p>
              ) : null}
              <p className="mt-2 border-t border-border/60 pt-2 text-xs leading-relaxed text-muted-foreground">
                Project branding helps members recognize an official project communication. It is
                not proof of token safety, team identity/KYC, contract safety, or investment
                quality.
              </p>
            </div>

            {trimmed ? (
              <div className="min-w-0 rounded-md border border-border/60 bg-background/30 p-3">
                <p className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
                  Community broadcast preview
                </p>
                {branded && logoPreviewUrl ? (
                  <img
                    src={logoPreviewUrl}
                    alt="Project logo used for this branded broadcast"
                    className="mt-2 size-20 rounded-md border border-border/60 object-contain"
                  />
                ) : null}
                <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">
                  {previewText}
                </p>
                {branded ? (
                  <p
                    className={`mt-1 text-right text-xs ${brandedOverLimit ? "text-destructive" : "text-muted-foreground"}`}
                  >
                    {previewText.length}/{GROUP_BRANDED_CAPTION_MAX}
                  </p>
                ) : null}
                <p className="mt-2 border-t border-border/60 pt-2 text-xs leading-relaxed text-muted-foreground">
                  {branded
                    ? "Posted as your project logo with this caption. No formatting is applied to your text."
                    : "Sent as plain text exactly as written. No formatting is applied and link previews are turned off."}
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
              Everyone in the community can see it. It is posted by @PepeCartelHQBot
              {snapshot?.branding
                ? " as your project logo with an unformatted caption"
                : " as plain text"}{" "}
              for official project/team communications and does not replace normal everyday
              conversation. No watcher DM is sent.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="min-w-0 space-y-1 rounded-md border border-border/60 bg-background/30 p-3 text-xs">
            <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span className="uppercase tracking-[0.12em] text-muted-foreground">Delivery</span>
              <span className="min-w-0 font-medium text-foreground [overflow-wrap:anywhere]">
                {snapshot?.branding ? "Branded project post" : "Plain text"}
              </span>
            </div>
            {snapshot?.branding ? (
              <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className="uppercase tracking-[0.12em] text-muted-foreground">Project</span>
                <span className="min-w-0 font-medium text-foreground [overflow-wrap:anywhere]">
                  {snapshot.branding.projectName}
                  {snapshot.branding.ticker ? ` · ${snapshot.branding.ticker}` : ""}
                </span>
              </div>
            ) : null}
          </div>
          <div className="max-h-48 overflow-y-auto rounded-md border border-border/60 bg-background/40 p-3">
            {snapshot?.branding && snapshot.brandingLogoUrl ? (
              <img
                src={snapshot.brandingLogoUrl}
                alt="Project logo used for this branded broadcast"
                className="mb-2 size-16 rounded-md border border-border/60 object-contain"
              />
            ) : null}
            <p className="whitespace-pre-wrap text-xs leading-relaxed text-foreground [overflow-wrap:anywhere]">
              {snapshot?.deliveredText ?? snapshot?.message ?? ""}
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
