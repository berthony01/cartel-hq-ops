import { useEffect, useState } from "react";
import { CheckCircle2, Copy, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import {
  fetchCommunityVerificationStatus,
  prepareCommunityVerificationLink,
  rotateCommunityVerificationLink,
  setCommunityVerificationEnabled,
  type CommunityVerificationResult,
  type CommunityVerificationStatus,
  type TelegramGroupConnection,
} from "@/lib/telegram-group";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

/**
 * Owner-only, connected-group verification control. All reads are lazy;
 * the dialog never auto-creates links or changes Telegram group settings.
 * The server remains the authority for group/actor identity and rights.
 */
export function CommunityVerificationDialog({
  open, onOpenChange, workspaceId, group,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  workspaceId: string | null | undefined;
  group: TelegramGroupConnection;
}) {
  const [status, setStatus] = useState<CommunityVerificationStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [joinRoutesReviewed, setJoinRoutesReviewed] = useState(false);
  const [rotationConfirmed, setRotationConfirmed] = useState(false);
  const [oldLinkWarning, setOldLinkWarning] = useState(false);

  useEffect(() => {
    if (!open || !workspaceId) return;
    let cancelled = false;
    setStatus(null);
    setLoading(true);
    setProblem(null);
    setJoinRoutesReviewed(false);
    setRotationConfirmed(false);
    setOldLinkWarning(false);
    fetchCommunityVerificationStatus({workspaceId, groupConnectionId:group.id})
      .then((result) => { if (!cancelled) setStatus(result.status); })
      .catch((error: unknown) => {
        if (!cancelled) setProblem(error instanceof Error ? error.message : "Verification settings are unavailable.");
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => {cancelled = true;};
  }, [open, workspaceId, group.id]);

  const perform = async (task: () => Promise<CommunityVerificationResult>, done: string) => {
    if (!workspaceId || busy) return;
    setBusy(true);
    setProblem(null);
    try {
      const result = await task();
      setStatus(result.status);
      setOldLinkWarning(result.priorRevokeFailed === true);
      setRotationConfirmed(false);
      setJoinRoutesReviewed(false);
      toast.success(done);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "Telegram verification could not be changed.");
    } finally {
      setBusy(false);
    }
  };

  const copyInvite = async () => {
    if (!status?.inviteLink) return;
    try {
      await navigator.clipboard.writeText(status.inviteLink);
      toast.success("Invite link copied.");
    } catch {
      toast.error("Could not copy. Select and copy the link manually.");
    }
  };

  const canPrepare = !!status?.rolloutReady && !!status.telegramStatusKnown &&
    !!status.botCanInvite && !!status.actorIsTelegramAdmin && !!status.webhookSubscribed &&
    (!status.groupIsPublic || status.groupApprovalRequired === true);
  const canEnable = canPrepare && !!status?.configured;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="size-5" aria-hidden="true" />
            Member Verification
          </DialogTitle>
          <DialogDescription>
            {group.title}: optional Telegram join-request checks before the bot admits an applicant.
            This does not prove human identity or guarantee that other invite links are gated.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
            <Loader2 className="size-4 animate-spin" /> Checking this community…
          </p>
        ) : problem && !status ? (
          <p className="rounded-md border border-signal/50 p-3 text-sm text-signal" role="alert">{problem}</p>
        ) : status ? (
          <div className="space-y-4">
            <div className="rounded-md border border-border p-3 text-sm">
              <p className="font-semibold">Automatic verification: {status.enabled ? "ON" : "OFF"}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {status.enabled
                  ? "Only matching managed-link join requests can be approved by the bot after a valid challenge."
                  : "Nothing is automatically approved through Cartel HQ verification."}
              </p>
              {status.pendingCount > 0 ? (
                <p className="mt-2 text-xs">{status.pendingCount} requests need checking or manual review in Telegram.</p>
              ) : null}
            </div>

            {!status.rolloutReady ? (
              <p className="rounded-md border border-gold/40 bg-gold/5 p-3 text-xs leading-relaxed">
                Member Verification is not activated on this server. No invite links or admission settings
                can be changed until deployment and the approved security rollout are complete.
              </p>
            ) : null}

            <div className="space-y-1 text-xs">
              <p>Your Telegram administrator status: <strong>{status.actorIsTelegramAdmin ? "Confirmed" : "Missing or unavailable"}</strong></p>
              <p>Telegram bot Invite Users permission: <strong>{status.botCanInvite ? "Confirmed" : "Missing or unavailable"}</strong></p>
              <p>Webhook receives join requests: <strong>{status.webhookSubscribed ? "Confirmed" : "Not confirmed"}</strong></p>
              <p>Group-wide approval: <strong>{status.groupApprovalRequired === true ? "Reported enabled" : "Not confirmed"}</strong></p>
              <p className="text-muted-foreground">
                Review any existing invite links and alternate joining methods inside Telegram.
                A managed link alone cannot secure the whole group.
              </p>
            </div>

            <div className="space-y-2 rounded-md border border-border p-3">
              <Label htmlFor={"verification-link-" + group.id}>Bot-managed verification invite link</Label>
              {status.inviteLink ? (
                <div className="space-y-2">
                  <p id={"verification-link-" + group.id} className="break-all rounded-md bg-surface-raised p-2 text-xs">
                    {status.inviteLink}
                  </p>
                  <Button type="button" variant="outline" className="min-h-11" onClick={() => void copyInvite()}>
                    <Copy className="size-4" /> Copy link
                  </Button>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">No link generated. Preparing a link is an explicit owner action.</p>
              )}
              {!status.configured ? (
                <Button type="button" className="min-h-11" disabled={!canPrepare || busy || !workspaceId}
                  onClick={() => void perform(() => prepareCommunityVerificationLink({workspaceId:workspaceId!,groupConnectionId:group.id}),"Telegram invite link prepared.")}>
                  {busy ? <Loader2 className="size-4 animate-spin"/> : null} Prepare approval-required link
                </Button>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-start gap-2">
                    <Checkbox id={"verification-rotate-" + group.id} checked={rotationConfirmed}
                      onCheckedChange={(value) => setRotationConfirmed(value===true)} />
                    <Label htmlFor={"verification-rotate-" + group.id} className="text-xs leading-relaxed">
                      I understand rotating this link invalidates the previous bot-managed link when Telegram confirms revocation.
                    </Label>
                  </div>
                  <Button type="button" variant="outline" className="min-h-11"
                    disabled={!canPrepare || !rotationConfirmed || busy || !workspaceId}
                    onClick={() => void perform(
                      () => rotateCommunityVerificationLink({workspaceId:workspaceId!,groupConnectionId:group.id,confirmRotate:true}),
                      "New verification link created."
                    )}>Rotate link</Button>
                </div>
              )}
              {oldLinkWarning ? (
                <p className="text-xs text-signal" role="alert">
                  Telegram did not confirm revocation of the previous link. Review and revoke it directly in Telegram.
                </p>
              ) : null}
            </div>

            <div className="space-y-3 rounded-md border border-border p-3">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="size-4" aria-hidden="true"/>
                <p className="text-sm font-semibold">Enable automatic verification</p>
              </div>
              <div className="flex items-start gap-2">
                <Checkbox id={"verification-join-routes-" + group.id}
                  checked={joinRoutesReviewed} onCheckedChange={(value) => setJoinRoutesReviewed(value===true)} />
                <Label htmlFor={"verification-join-routes-" + group.id} className="text-xs leading-relaxed">
                  I reviewed public-group admission settings and other active invite links in Telegram.
                  I understand Cartel HQ cannot ensure every joining path requires its challenge.
                </Label>
              </div>
              <Button type="button" className="min-h-11"
                disabled={!canEnable || busy || !joinRoutesReviewed || status.enabled || !workspaceId}
                onClick={() => void perform(
                  () => setCommunityVerificationEnabled({workspaceId:workspaceId!,groupConnectionId:group.id,enabled:true,reviewedAllJoinRoutes:true}),
                  "Member verification enabled for managed-link requests."
                )}>Enable verification</Button>
              <Button type="button" variant="outline" className="min-h-11"
                disabled={!status.enabled || busy || !workspaceId}
                onClick={() => void perform(
                  () => setCommunityVerificationEnabled({workspaceId:workspaceId!,groupConnectionId:group.id,enabled:false,reviewedAllJoinRoutes:false}),
                  "Member verification disabled."
                )}>Disable verification</Button>
            </div>
            {problem ? <p role="alert" className="text-xs text-signal">{problem}</p> : null}
            <p className="text-xs text-muted-foreground">
              Incorrect, expired or undeliverable challenges remain pending for administrator review.
              Cartel HQ will not automatically kick, ban or mute current members.
            </p>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
