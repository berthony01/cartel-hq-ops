import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Lock, ShieldCheck } from "lucide-react";
import { formatEther } from "viem";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
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
import { chainDeploymentsQueryKey, type DeploymentRow } from "@/lib/chain-launcher";
import {
  PCART_PRODUCTION_ABANDON_REASON_MIN,
  abandonPcartProductionDraft,
  isUnsentPcartDraft,
  savePcartProductionDraft,
} from "@/lib/pcart-production-draft";
import { isPcartReviewFresh, shortAddress } from "@/lib/pcart-production-intent";
import {
  reviewPcartProductionDeployment,
  type PcartProductionReview,
} from "@/lib/pcart-production-review.functions";
import { pcartReadinessQueryKey } from "@/lib/pcart-production-readiness";

const REASONS: Record<string, string> = {
  NOT_PLATFORM_OWNER: "Only the platform owner can run this review.",
  APPROVAL_MISSING_OR_STALE: "Production readiness approval is missing or no longer matches.",
  EXECUTION_NOT_LOCKED: "Mainnet execution is not locked. Review refused.",
  DEPLOYER_NOT_SIGNER: "The deployer must be one of the three Treasury signers.",
  SAFE_MISMATCH: "Treasury Safe does not match the approved Safe.",
  NONCE_PENDING_MISMATCH: "This wallet has a pending transaction. Wait for it to settle, then review again.",
  PREDICTED_ADDRESS_HAS_CODE: "The predicted contract address already has code. Review refused.",
  SAFE_HAS_NO_CODE: "The Treasury Safe has no code on Robinhood Chain. Review refused.",
  CHAIN_MISMATCH: "The mainnet provider is not Robinhood Chain (4663).",
  CREATION_CALL_REVERTED: "The simulated deployment reverted.",
  MANAGED_RPC_UNCONFIGURED: "The mainnet provider is not configured.",
};

type Props = {
  launchId: string;
  signers: readonly string[];
  attempt: DeploymentRow | null;
};

/**
 * PCART P2 — production deployment REVIEW only. There is no sign, send,
 * presign, send-window or arming action in this component.
 */
export function PcartProductionReviewPanel({ launchId, signers, attempt }: Props) {
  const qc = useQueryClient();
  const runReview = useServerFn(reviewPcartProductionDeployment);
  const [deployer, setDeployer] = useState<string>("");
  const [review, setReview] = useState<PcartProductionReview | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [requestId] = useState(() => `pcart-prod-${crypto.randomUUID()}`);
  const [abandonOpen, setAbandonOpen] = useState(false);
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (!review) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [review]);

  const fresh = !!review && isPcartReviewFresh(review.reviewedAt, now);
  const secondsLeft = review ? Math.max(0, Math.ceil((review.expiresAt - now) / 1000)) : 0;

  const reviewMutation = useMutation({
    mutationFn: async () => {
      const r = await runReview({ data: { launchId, deployer } });
      if (!r.ok) throw new Error(REASONS[r.reason] ?? "Review could not be completed. Nothing was saved.");
      return r;
    },
    onMutate: () => {
      setReview(null);
      setConfirmed(false);
    },
    onSuccess: (r) => {
      setReview(r);
      setNow(Date.now());
    },
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: chainDeploymentsQueryKey(launchId) });
    qc.invalidateQueries({ queryKey: pcartReadinessQueryKey(launchId) });
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!review || !isPcartReviewFresh(review.reviewedAt, Date.now())) throw new Error("Review expired. Run it again.");
      return savePcartProductionDraft(review, requestId);
    },
    onSuccess: () => {
      setReview(null);
      setConfirmed(false);
      invalidate();
    },
  });

  const abandonMutation = useMutation({
    mutationFn: () => abandonPcartProductionDraft(attempt!.id, reason),
    onSuccess: () => {
      setAbandonOpen(false);
      setReason("");
      invalidate();
    },
  });

  const rows = useMemo(
    () =>
      review
        ? ([
            ["Chain", `Robinhood Chain (${review.chainId})`],
            ["Token", "PEPECARTEL (PCART), 18 decimals"],
            ["Supply", "1,000,000,000 PCART"],
            ["Artifact", review.artifactId],
            ["Deployer", review.deployer],
            ["Treasury Safe recipient", review.safeRecipient],
            ["Nonce", review.nonce],
            ["Predicted contract", review.predictedAddress],
            ["Gas estimate", review.gasEstimate],
            ["Estimated max cost", `${formatEther(BigInt(review.estimatedMaxCostWei))} ETH`],
            ["Creation simulation", review.ethCall === "OK" ? "Passed" : "Not supported by provider"],
          ] as const)
        : [],
    [review],
  );

  if (attempt) {
    const unsent = isUnsentPcartDraft(attempt);
    return (
      <section aria-label="Production draft" className="min-w-0 space-y-3 rounded-lg border border-gold/35 bg-card/60 p-4">
        <p className="type-eyebrow text-gold">Production draft</p>
        <p className="text-sm font-semibold text-foreground">
          {attempt.status === "DRAFT" ? "PRODUCTION DRAFT SAVED — SEND LOCKED" : `Production attempt ${attempt.status}`}
        </p>
        <dl className="grid gap-2 text-xs sm:grid-cols-2">
          <div className="min-w-0"><dt className="text-muted-foreground">Attempt</dt><dd className="font-semibold">#{attempt.attempt_number}</dd></div>
          <div className="min-w-0"><dt className="text-muted-foreground">Deployer</dt><dd className="font-semibold [overflow-wrap:anywhere]">{attempt.deployer_address}</dd></div>
          <div className="min-w-0"><dt className="text-muted-foreground">Recipient</dt><dd className="font-semibold [overflow-wrap:anywhere]">{attempt.token_recipient}</dd></div>
          <div className="min-w-0"><dt className="text-muted-foreground">Nonce</dt><dd className="font-semibold">{attempt.deployer_nonce_before ?? "—"}</dd></div>
        </dl>
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Lock className="size-3" aria-hidden="true" /> MAINNET EXECUTION LOCKED. No transaction can be sent in this phase.
        </p>
        {unsent ? (
          <>
            <Button type="button" variant="outline" className="min-h-11" onClick={() => setAbandonOpen(true)}>
              Abandon draft
            </Button>
            <AlertDialog open={abandonOpen} onOpenChange={setAbandonOpen}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Abandon production draft?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This marks the unsent draft as abandoned. Nothing was ever sent. You can review again afterwards.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <Textarea
                  aria-label="Reason"
                  placeholder="Reason"
                  value={reason}
                  maxLength={500}
                  onChange={(e) => setReason(e.target.value)}
                />
                {abandonMutation.error instanceof Error ? (
                  <p role="alert" className="text-xs text-destructive">{abandonMutation.error.message}</p>
                ) : null}
                <AlertDialogFooter>
                  <AlertDialogCancel>Keep draft</AlertDialogCancel>
                  <AlertDialogAction
                    disabled={reason.trim().length < PCART_PRODUCTION_ABANDON_REASON_MIN || abandonMutation.isPending}
                    onClick={(e) => {
                      e.preventDefault();
                      abandonMutation.mutate();
                    }}
                  >
                    Abandon draft
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </>
        ) : null}
      </section>
    );
  }

  return (
    <section aria-label="Review production deployment" className="min-w-0 space-y-3 rounded-lg border border-gold/35 bg-card/60 p-4">
      <div>
        <p className="type-eyebrow text-gold">Next step</p>
        <h3 className="mt-1 text-base font-semibold text-foreground">Review production deployment</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Preparation only. The full supply goes to the verified Treasury Safe. No transaction will be sent.
        </p>
      </div>

      <fieldset className="min-w-0 space-y-2">
        <legend className="text-xs font-semibold text-foreground">Deployer (one of the three Treasury signers)</legend>
        {signers.map((s) => (
          <label key={s} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-border-subtle px-3 text-sm">
            <input
              type="radio"
              name="pcart-deployer"
              value={s}
              checked={deployer === s}
              onChange={() => {
                setDeployer(s);
                setReview(null);
                setConfirmed(false);
              }}
            />
            <span className="font-mono">{shortAddress(s)}</span>
          </label>
        ))}
      </fieldset>

      <Button
        type="button"
        className="min-h-11 w-full"
        disabled={!deployer || reviewMutation.isPending}
        onClick={() => reviewMutation.mutate()}
      >
        {reviewMutation.isPending ? "Reviewing…" : "Run production review"}
      </Button>
      {reviewMutation.error instanceof Error ? (
        <p role="alert" className="text-xs text-destructive">{reviewMutation.error.message}</p>
      ) : null}

      {review ? (
        <div className="min-w-0 space-y-3 rounded-md border border-border-subtle p-3">
          <dl className="grid gap-2 text-xs sm:grid-cols-2">
            {rows.map(([k, v]) => (
              <div key={k} className="min-w-0">
                <dt className="text-muted-foreground">{k}</dt>
                <dd className="font-semibold [overflow-wrap:anywhere]">{v}</dd>
              </div>
            ))}
          </dl>
          <p className="flex items-center gap-2 text-xs font-semibold text-gold">
            <Lock className="size-3" aria-hidden="true" /> MAINNET EXECUTION LOCKED
          </p>
          <p className="text-xs text-muted-foreground">
            {fresh ? `Review valid for ${secondsLeft}s.` : "Review expired. Run it again before saving."}
          </p>
          <label className="flex items-start gap-2 text-xs">
            <Checkbox checked={confirmed} onCheckedChange={(v) => setConfirmed(v === true)} aria-label="Confirm preparation only" />
            <span>I confirm this review is for preparation only. No transaction will be sent.</span>
          </label>
          <Button
            type="button"
            className="min-h-11 w-full"
            disabled={!fresh || !confirmed || saveMutation.isPending}
            onClick={() => saveMutation.mutate()}
          >
            <ShieldCheck className="size-4" aria-hidden="true" />
            Save reviewed draft
          </Button>
          {saveMutation.error instanceof Error ? (
            <p role="alert" className="text-xs text-destructive">{saveMutation.error.message}</p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
