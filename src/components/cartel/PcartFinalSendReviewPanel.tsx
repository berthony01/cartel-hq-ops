import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, Lock, ShieldCheck } from "lucide-react";
import { formatEther } from "viem";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import type { DeploymentRow } from "@/lib/chain-launcher";
import { shortAddress } from "@/lib/pcart-production-intent";
import { fetchLatestPcartPreparation, isPcartPreparationActive, pcartPreparationQueryKey } from "@/lib/pcart-production-preparation";
import { evaluatePcartWalletBinding, getPcartBoundWallet, readPcartWalletEvidence, subscribePcartWallet } from "@/lib/pcart-production-wallet";
import { isPcartAddressConfirmation, isPcartExecutionPermitActive } from "@/lib/pcart-production-execution";
import { preparePcartFinalSend, reviewPcartFinalSend, type PcartFinalSendReview } from "@/lib/pcart-production-execution.functions";
import { cancelPcartExecutionPermit, fetchLatestPcartExecutionPermit, pcartExecutionPermitQueryKey } from "@/lib/pcart-production-execution-permit";

const TEXT: Record<string, string> = {
  PREPARATION_NOT_ACTIVE: "Wallet preparation expired. Re-authorize wallet preparation above.",
  INSUFFICIENT_BALANCE: "Deployer balance does not cover the maximum gas cost.",
  ADDRESS_CONFIRMATION_MISMATCH: "Typed address does not match the predicted contract.",
  REVIEW_CHANGED: "Gas or fees changed since review. Run the final send review again.",
  ALREADY_ACTIVE: "A final send permit is already active.",
  APPROVAL_MISSING_OR_STALE: "Production readiness approval no longer matches.",
  DRAFT_CHANGED: "The saved draft no longer matches. Abandon it and review again.",
  NONCE_CHANGED: "The deployer nonce changed since review.",
  NONCE_PENDING: "This wallet has a pending transaction.",
  EXECUTION_NOT_LOCKED: "Global mainnet execution is not locked. Refused.",
  PREDICTED_ADDRESS_HAS_CODE: "The predicted contract address already has code.",
  SEND_STAGE_ALREADY_EXISTS: "A generic send stage exists for this draft. Refused.",
  WRONG_ACCOUNT: "Connected wallet is not the reviewed deployer.",
};

/**
 * PCART P4 — final mainnet send review. Ends at READY TO SEND — NO TRANSACTION SENT.
 * This component has NO sign, send, broadcast or deploy action.
 */
export function PcartFinalSendReviewPanel({ attempt }: { attempt: DeploymentRow }) {
  const qc = useQueryClient();
  const runReview = useServerFn(reviewPcartFinalSend);
  const runPrepare = useServerFn(preparePcartFinalSend);
  const [now, setNow] = useState(() => Date.now());
  const [bound, setBound] = useState(getPcartBoundWallet());
  const [review, setReview] = useState<PcartFinalSendReview | null>(null);
  const [ack, setAck] = useState(false);
  const [typed, setTyped] = useState("");
  const [copied, setCopied] = useState<string | null>(null);

  const copyPredicted = async () => {
    if (!review) return;
    try {
      if (!navigator.clipboard?.writeText) throw new Error("unavailable");
      await navigator.clipboard.writeText(review.predictedAddress);
      setCopied("Copied predicted address.");
    } catch {
      setCopied("Copy unavailable — type or paste the address manually.");
    }
  };

  const deployer = String(attempt.deployer_address ?? "");
  const nonce = BigInt(attempt.deployer_nonce_before ?? -1);

  const prepQuery = useQuery({ queryKey: pcartPreparationQueryKey(attempt.id), queryFn: () => fetchLatestPcartPreparation(attempt.id) });
  const permitQuery = useQuery({ queryKey: pcartExecutionPermitQueryKey(attempt.id), queryFn: () => fetchLatestPcartExecutionPermit(attempt.id), refetchInterval: 10_000 });
  const prepActive = isPcartPreparationActive(prepQuery.data, now);
  const permit = permitQuery.data;
  const permitActive = isPcartExecutionPermitActive(permit, now);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => subscribePcartWallet(() => { setBound(getPcartBoundWallet()); setReview(null); setAck(false); setTyped(""); }), []);

  const reviewFresh = !!review && now < review.expiresAt;

  const reviewMutation = useMutation({
    mutationFn: async () => {
      const ev = await readPcartWalletEvidence();
      const b = evaluatePcartWalletBinding(ev, { deployer, nonce });
      if (!b.ok || !ev) throw new Error("Bind the exact deployer wallet on Robinhood Chain with the saved nonce first.");
      if (!prepQuery.data || !prepActive) throw new Error(TEXT["PREPARATION_NOT_ACTIVE"]);
      const r = await runReview({ data: { deploymentId: attempt.id, preparationAuthorizationId: prepQuery.data.id, wallet: ev.account } });
      if (!r.ok) throw new Error(TEXT[r.reason] ?? "Final send review failed. Nothing was saved or sent.");
      return r;
    },
    onMutate: () => { setCopied(null); },
    onSuccess: (r) => {
      // Preserve typed confirmation only when the predicted address is unchanged.
      if (!review || review.predictedAddress.toLowerCase() !== r.predictedAddress.toLowerCase()) { setTyped(""); setAck(false); }
      setReview(r);
    },
    onError: () => { setReview(null); setAck(false); },
  });

  const prepareMutation = useMutation({
    mutationFn: async () => {
      if (!review || Date.now() >= review.expiresAt) throw new Error("Review expired. Run it again.");
      if (!ack || !isPcartAddressConfirmation(typed, review.predictedAddress)) throw new Error(TEXT["ADDRESS_CONFIRMATION_MISMATCH"]);
      const ev = await readPcartWalletEvidence();
      if (!evaluatePcartWalletBinding(ev, { deployer, nonce }).ok || !ev) throw new Error("Wallet evidence changed. Run the review again.");
      const r = await runPrepare({ data: { deploymentId: attempt.id, preparationAuthorizationId: review.preparationAuthorizationId, wallet: ev.account, reviewedUnsignedTxFingerprint: review.unsignedTxFingerprint, typedPredictedAddress: typed } });
      if (!r.ok) throw new Error(TEXT[r.reason] ?? "Permit refused. Nothing was sent.");
      return r.permit;
    },
    onSuccess: () => { setReview(null); setAck(false); setTyped(""); qc.invalidateQueries({ queryKey: pcartExecutionPermitQueryKey(attempt.id) }); },
  });

  const cancelMutation = useMutation({
    mutationFn: () => cancelPcartExecutionPermit(permit!.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: pcartExecutionPermitQueryKey(attempt.id) }),
  });

  if (permitActive && permit) {
    const left = Math.max(0, Math.ceil((Date.parse(permit.expires_at) - now) / 1000));
    return (
      <section aria-label="Ready to send" className="min-w-0 space-y-3 rounded-lg border border-gold bg-card/60 p-4">
        <p className="flex items-center gap-2 text-sm font-bold text-gold"><ShieldCheck className="size-4" aria-hidden="true" /> READY TO SEND — NO TRANSACTION SENT</p>
        <dl className="grid gap-2 text-xs sm:grid-cols-2">
          <div className="min-w-0"><dt className="text-muted-foreground">Deployer</dt><dd className="font-semibold [overflow-wrap:anywhere]">{permit.wallet_account}</dd></div>
          <div className="min-w-0"><dt className="text-muted-foreground">Predicted contract</dt><dd className="font-semibold [overflow-wrap:anywhere]">{permit.predicted_contract_address}</dd></div>
          <div className="min-w-0"><dt className="text-muted-foreground">Unsigned tx fingerprint</dt><dd className="font-semibold">{permit.unsigned_tx_fingerprint.slice(0, 14)}…</dd></div>
          <div><dt className="text-muted-foreground">Permit expires</dt><dd className="font-semibold">{left}s</dd></div>
        </dl>
        <p className="flex items-center gap-2 text-xs text-muted-foreground"><Lock className="size-3" aria-hidden="true" /> Global emergency stop remains engaged. Sending is a separate later phase.</p>
        <Button type="button" variant="outline" className="min-h-11 w-full" disabled={cancelMutation.isPending} onClick={() => cancelMutation.mutate()}>Cancel permit</Button>
        {cancelMutation.error instanceof Error ? <p role="alert" className="text-xs text-destructive">{cancelMutation.error.message}</p> : null}
      </section>
    );
  }

  return (
    <section aria-label="Final mainnet send review" className="min-w-0 space-y-3 rounded-lg border border-gold/35 bg-card/60 p-4">
      <div>
        <p className="type-eyebrow text-gold">P4 — Final mainnet send review</p>
        <p className="mt-1 text-xs text-muted-foreground">Freeze the exact transaction. Nothing is signed or sent.</p>
      </div>
      {!prepActive ? (
        <p className="text-xs text-muted-foreground">Re-authorize wallet preparation above (P3) to continue. It lasts 90 seconds.</p>
      ) : !bound ? (
        <p className="text-xs text-muted-foreground">Connect the deployer wallet above.</p>
      ) : (
        <Button type="button" className="min-h-11 w-full" disabled={reviewMutation.isPending} onClick={() => reviewMutation.mutate()}>
          {reviewMutation.isPending ? "Reviewing…" : "Run final send review"}
        </Button>
      )}
      {reviewMutation.error instanceof Error ? <p role="alert" className="text-xs text-destructive">{reviewMutation.error.message}</p> : null}

      {review ? (
        <div className="min-w-0 space-y-3 rounded-md border border-destructive/60 p-3 text-xs">
          <p className="flex items-center gap-2 font-bold text-destructive"><AlertTriangle className="size-4" aria-hidden="true" /> REAL ROBINHOOD CHAIN MAINNET · REAL ETH</p>
          <dl className="grid gap-2 sm:grid-cols-2">
            {([
              ["Token", "PEPECARTEL / PCART"],
              ["Supply", "1,000,000,000 PCART"],
              ["Artifact", "pepecartel-token-v1"],
              ["Deployer", review.deployer],
              ["Treasury Safe recipient", review.safeRecipient],
              ["Nonce", review.nonce],
              ["Predicted contract", review.predictedAddress],
              ["Gas limit", `${review.gasLimit} (estimate ${review.gasEstimate})`],
              ["Estimated max cost", `${formatEther(BigInt(review.estimatedMaxCostWei))} ETH`],
              ["Balance", `${formatEther(BigInt(review.balanceWei))} ETH`],
              ["Unsigned tx fingerprint", `${review.unsignedTxFingerprint.slice(0, 14)}…`],
            ] as [string, string][]).map(([k, v]) => (
              <div key={k} className="min-w-0"><dt className="text-muted-foreground">{k}</dt><dd className="font-semibold [overflow-wrap:anywhere]">{v}</dd></div>
            ))}
          </dl>
          <p className="flex items-center gap-2 font-semibold"><Lock className="size-3" aria-hidden="true" /> GLOBAL MAINNET EXECUTION REMAINS LOCKED</p>
          <p className={reviewFresh ? "text-muted-foreground" : "font-semibold text-destructive"}>{reviewFresh ? `Review valid for ${Math.max(0, Math.ceil((review.expiresAt - now) / 1000))}s.` : "Review expired. Run final send review again."}</p>
          <label className="flex items-start gap-2">
            <Checkbox checked={ack} onCheckedChange={(v) => setAck(v === true)} aria-label="Confirm real mainnet preparation" />
            <span>I understand this is the real Robinhood Chain mainnet deployment preparation.</span>
          </label>
          <div className="space-y-1">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label htmlFor="pcart-predicted-confirm">Enter the predicted contract address ({shortAddress(review.predictedAddress)})</label>
              <Button type="button" variant="outline" size="sm" className="min-h-9" onClick={() => void copyPredicted()}>Copy predicted address</Button>
            </div>
            <Input id="pcart-predicted-confirm" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck={false} placeholder="0x…" aria-label="Type predicted contract address" />
            {copied ? <p className="text-muted-foreground">{copied}</p> : null}
          </div>
          <Button type="button" className="min-h-11 w-full" disabled={!reviewFresh || !ack || !isPcartAddressConfirmation(typed, review.predictedAddress) || prepareMutation.isPending} onClick={() => prepareMutation.mutate()}>
            <ShieldCheck className="size-4" aria-hidden="true" /> Prepare final send
          </Button>
          {!reviewFresh ? <p className="text-destructive">Prepare is disabled because the review expired. Run final send review again — your typed address is kept if unchanged.</p> : null}
          {prepareMutation.error instanceof Error ? <p role="alert" className="text-destructive">{prepareMutation.error.message}</p> : null}
        </div>
      ) : null}
    </section>
  );
}
