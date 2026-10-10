import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DeploymentWalletConnect } from "@/components/cartel/DeploymentWalletConnect";
import {
  claimPcartPreAuctionExecution, getPcartP9_3bSafeStatus, issuePcartPreAuctionPermit, reconcilePcartPreAuction, recordPcartPreAuctionTx,
  releasePcartPreAuctionHandoff, submitPcartSafeSignature,
} from "@/lib/pcart-launch-coordinator-p9-3b.functions";
import { checkTreasuryOwnerWallet, sendSafeExecutionOnce, signSafeTypedData } from "@/lib/pcart-p9-3b-safe-wallet";

const WALLET_COPY: Record<string, string> = {
  NO_WALLET: "Connect a Treasury Safe owner wallet first.",
  WRONG_WALLET: "This wallet is not one of the two eligible launch signers. Choose another wallet.",
  WRONG_CHAIN: "Switch the wallet to Robinhood Chain.",
  READ_FAILED: "Could not read the wallet. Try again.",
};

/**
 * PCART P9.3B — Pre-auction Safe: 2-of-3 owner signatures and one permit-bound execTransaction.
 * Mounted only when a pre-auction action exists. Passive load never prompts a wallet or writes anything.
 */
export function PcartPreAuctionSafePanel({ actionId, launchKey }: { actionId: string; launchKey: unknown[] }) {
  const qc = useQueryClient();
  const statusFn = useServerFn(getPcartP9_3bSafeStatus);
  const signFn = useServerFn(submitPcartSafeSignature);
  const permitFn = useServerFn(issuePcartPreAuctionPermit);
  const claimFn = useServerFn(claimPcartPreAuctionExecution);
  const recordFn = useServerFn(recordPcartPreAuctionTx);
  const reconcileFn = useServerFn(reconcilePcartPreAuction);
  const releaseFn = useServerFn(releasePcartPreAuctionHandoff);
  const key = ["pcart-p9-3b", actionId];
  const q = useQuery({ queryKey: key, queryFn: () => statusFn({ data: { actionId } }), staleTime: 30_000, refetchOnWindowFocus: false });
  const [msg, setMsg] = useState<string | null>(null);
  const [pasted, setPasted] = useState("");
  const refresh = () => { qc.invalidateQueries({ queryKey: key }); qc.invalidateQueries({ queryKey: launchKey }); };

  const signM = useMutation({
    mutationFn: async () => {
      setMsg(null);
      const s = q.data && q.data.ok ? q.data : null;
      if (!s?.canSign || !s.typedData) return "Signing is not available right now.";
      const w = await checkTreasuryOwnerWallet(s.eligibleSigners);
      if (!w.ok) return WALLET_COPY[w.reason] ?? "Wallet check failed.";
      if (s.owners.find((o) => o.address === w.account)?.signed) return "This owner already signed. Choose another wallet.";
      const r = await signSafeTypedData(w.account, s.typedData);
      if (!r.signature) return "Wallet closed — nothing was signed. You can try again.";
      const res = await signFn({ data: { actionId, signer: w.account, signature: r.signature } });
      return res.ok ? `${res.validCount} of 2 Treasury Safe signatures collected.` : res.message;
    },
    onSuccess: (m) => setMsg(m), onSettled: refresh,
  });

  const execM = useMutation({
    mutationFn: async () => {
      setMsg(null);
      const s = q.data && q.data.ok ? q.data : null;
      if (!s?.canExecute) return "Execution is not available right now.";
      const w = await checkTreasuryOwnerWallet(s.eligibleSigners);
      if (!w.ok) return WALLET_COPY[w.reason] ?? "Wallet check failed.";
      const permit = await permitFn({ data: { actionId } });
      if (!permit.ok) return `Execution blocked: ${permit.reason}`;
      const claim = await claimFn({ data: { actionId, permitId: permit.permitId, bindingFingerprint: permit.bindingFingerprint, signatureSetFingerprint: permit.signatureSetFingerprint, executor: w.account } });
      if (!claim.ok) return `Execution blocked: ${claim.reason}`;
      const sent = await sendSafeExecutionOnce(actionId, claim.tx);
      if (sent.outcome === "HASH" && sent.txHash) {
        const rec = await recordFn({ data: { actionId, txHash: sent.txHash } });
        return rec.ok ? "Submitted. Waiting for on-chain confirmation." : "Hash returned but not recorded — reconcile with the hash below. Do not resend.";
      }
      return "The wallet did not return a transaction hash. Status is UNCERTAIN — reconcile from chain. Do not resend.";
    },
    onSuccess: (m) => setMsg(m), onSettled: refresh,
  });
  const reconcileM = useMutation({
    mutationFn: async () => {
      const r = await reconcileFn({ data: { actionId, txHash: pasted.trim() || null } });
      if (!r.ok) return r.reason;
      if (r.outcome === "CONFIRMED") return "Confirmed on chain. Auction setup verified.";
      if (r.outcome === "REVERTED") return "The transaction reverted on chain. Prepare again.";
      if (r.outcome === "PENDING") return "Not mined yet. Check again shortly.";
      return `Not verified: ${(r as any).reasons?.join(", ")}`;
    },
    onSuccess: (m) => setMsg(m), onSettled: refresh,
  });
  const releaseM = useMutation({ mutationFn: async () => { const r = await releaseFn({ data: { actionId } }); return r.ok ? "Released. A fresh permit is required to execute." : r.reason; }, onSuccess: (m) => setMsg(m), onSettled: refresh });

  const s = q.data && q.data.ok ? q.data : null;
  if (q.isLoading) return <p className="text-xs text-muted-foreground">Reading Safe signatures…</p>;
  if (!s) return null;
  const busy = signM.isPending || execM.isPending;
  const showWallet = s.canSign || s.canExecute;

  return (
    <div className="space-y-2 rounded border border-border/60 p-3 text-xs" aria-label="Pre-auction Safe">
      <div className="text-sm font-medium">Pre-auction Safe · {s.approvals} of 2 approvals</div>
      {s.eligibleSigners.length !== 2 ? <p className="text-destructive">The eligible signer set changed on chain. Signing is blocked until re-audited.</p> : null}
      <ul className="space-y-0.5">
        {s.owners.map((o) => (
          <li key={o.address} className="font-mono break-all">
            {o.signed ? "✓ " : "○ "}{o.address}{o.eligible ? " (eligible signer)" : o.kind === "EIP7702_DELEGATED" ? " (delegated account — Safe owner, not a Cartel HQ launch signer)" : o.kind === "CONTRACT" ? " (contract — not a launch signer)" : " (not eligible)"}
          </li>
        ))}
      </ul>
      {showWallet ? <DeploymentWalletConnect expectedDeployer={null as any} expectedChainId={4663 as any} /> : null}
      {s.canSign ? <Button size="sm" disabled={busy} onClick={() => signM.mutate()}>Sign pre-auction Safe transaction</Button> : null}
      {s.canExecute && !s.txHash ? <Button size="sm" disabled={busy} onClick={() => execM.mutate()}>Execute pre-auction Safe transaction</Button> : null}
      {!s.canSign && !s.canExecute && s.status !== "SUBMITTED" && s.status !== "UNCERTAIN" && s.status !== "CONFIRMED" ? (
        <p className="text-muted-foreground">Blocked: {[...s.signBlocks, ...s.execBlocks].filter((v, i, a) => a.indexOf(v) === i).join(", ") || "waiting"}</p>
      ) : null}
      {s.status === "SUBMITTED" || s.status === "UNCERTAIN" ? (
        <div className="space-y-1">
          <p>{s.status === "UNCERTAIN" ? "Outcome uncertain. Never resend — reconcile from chain." : "Submitted. Waiting for confirmation."}</p>
          {s.txHash ? <p className="font-mono break-all">tx {s.txHash}</p> : <Input className="h-8" placeholder="Paste the transaction hash if your wallet shows one" value={pasted} onChange={(e) => setPasted(e.target.value)} aria-label="Transaction hash" />}
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={reconcileM.isPending} onClick={() => reconcileM.mutate()}>Check chain</Button>
            {s.status === "UNCERTAIN" && !s.txHash ? <Button size="sm" variant="ghost" disabled={releaseM.isPending} onClick={() => releaseM.mutate()}>My wallet sent nothing</Button> : null}
          </div>
        </div>
      ) : null}
      {s.status === "CONFIRMED" ? <p>Confirmed on chain{s.auctionAddress ? ` · auction ${s.auctionAddress}` : ""}.</p> : null}
      {msg ? <p role="status">{msg}</p> : null}
      <details className="text-muted-foreground"><summary className="cursor-pointer select-none">Technical details</summary>
        <div className="font-mono break-all">safeTxHash {s.safeTxHash} · nonce {s.safeNonce} · blocks {s.startBlock}→{s.endBlock} · Safe check {String(s.safeValidated)}</div>
      </details>
    </div>
  );
}
