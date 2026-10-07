import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { P9_3A_STOP_COPY } from "@/lib/pcart-launch-coordinator-p9-3";
import { cancelPcartCoordinatorAction, getPcartP9_3Segment, preparePcartPreAuction, previewPcartPreAuction } from "@/lib/pcart-launch-coordinator-p9-3.functions";

/**
 * PCART P9.3A — Launch Day › Auction & Liquidity. Read-only status plus one explicit "prepare" record action.
 * No wallet, signer, execute, migrate or sweep controls exist in P9.3A. Passive refresh never prompts a wallet.
 */
export function PcartAuctionSegmentPanel({ launchId }: { launchId: string }) {
  const qc = useQueryClient();
  const segFn = useServerFn(getPcartP9_3Segment);
  const previewFn = useServerFn(previewPcartPreAuction);
  const prepareFn = useServerFn(preparePcartPreAuction);
  const cancelFn = useServerFn(cancelPcartCoordinatorAction);
  const key = ["pcart-p9-3", launchId];
  const q = useQuery({ queryKey: key, queryFn: () => segFn({ data: { launchId } }), staleTime: 60_000, refetchOnWindowFocus: false });
  const [preview, setPreview] = useState<{ startBlock: string; endBlock: string; headBlock: string; headCapturedAt: string } | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const previewM = useMutation({ mutationFn: () => previewFn({ data: { launchId } }), onSuccess: (r) => { setConfirmed(false); setPreview(r.ok ? r : null); } });
  const prepareM = useMutation({ mutationFn: () => prepareFn({ data: { launchId, confirmedStartBlock: preview!.startBlock } }), onSettled: () => { setPreview(null); setConfirmed(false); qc.invalidateQueries({ queryKey: key }); } });
  const cancelM = useMutation({ mutationFn: (id: string) => cancelFn({ data: { actionId: id, reason: cancelReason } }), onSettled: () => { setCancelReason(""); qc.invalidateQueries({ queryKey: key }); } });

  const s = q.data && q.data.ok && (q.data as any).segment && (q.data as any).steps ? q.data : null;
  const notReady = s && (s.segment.state === "OFFICIAL_CONTRACT_REQUIRED" || s.segment.state === "PROMOTION_PLAN_REQUIRED");

  return (
    <section className="space-y-3 rounded-md border border-border bg-card/60 p-4" aria-label="Auction & Liquidity">
      <div>
        <p className="text-sm font-semibold">Auction &amp; Liquidity</p>
        <p className="text-xs text-muted-foreground">{P9_3A_STOP_COPY}</p>
      </div>
      {q.isLoading ? <p className="text-xs text-muted-foreground">Reading auction status…</p> : null}
      {q.data && !q.data.ok ? <p className="text-xs text-destructive">{q.data.reason}</p> : null}
      {q.data && q.data.ok && !s ? <p className="text-xs text-muted-foreground">Status unavailable — refresh.</p> : null}
      {s ? (
        <>
          {notReady ? (
            <p className="text-sm">
              Auction phase not ready yet.{" "}
              {!s.officialRegistered ? "Finish official PCART deployment/registration" : null}
              {!s.officialRegistered && !s.planSet ? " and set the promotion plan first." : !s.officialRegistered ? " first." : !s.planSet ? "Set the promotion plan first." : null}
            </p>
          ) : null}
          <ol className="grid gap-1 text-xs sm:grid-cols-5" aria-label="Auction progress">
            {s.steps.map((st) => (
              <li key={st.key} className={`rounded border px-2 py-1 ${st.status === "CURRENT" ? "border-primary text-primary" : st.status === "BLOCKED" ? "border-destructive text-destructive" : st.status === "DONE" ? "border-border text-foreground" : "border-border/50 text-muted-foreground"}`}>
                {st.status === "DONE" ? "✓ " : ""}{st.label}
              </li>
            ))}
          </ol>
          <div className="rounded border border-border/60 p-3">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Next step</div>
            <div className="text-sm">{s.segment.nextStep}</div>
            {s.segment.blockers.length ? <div className="mt-1 text-xs text-destructive">Blocked by: {s.segment.blockers.join(", ")}</div> : null}
          </div>
          <div className="grid gap-1 text-xs sm:grid-cols-2">
            <div>Pre-auction Safe: {s.preAuction ? `${s.preAuction.status} (nonce ${s.preAuction.safeNonce})` : "Not prepared"}</div>
            <div>Auction: {s.auction.status === "NOT_CREATED" ? "Not created yet" : s.auction.status}</div>
            <div>Migration / refunds: not started</div>
            <div>Final Treasury cleanup: {s.sweepDisposition === "SAFE_SWEEP_REQUIRED" ? "Safe sweep of unsold PCART required after the auction (2 of 3)" : "No manual sweep required"}</div>
          </div>

          {s.segment.canPrepare && !s.preAuction ? (
            <div className="space-y-2 rounded border border-border/60 p-3 text-xs">
              <Button size="sm" variant="outline" disabled={previewM.isPending} onClick={() => previewM.mutate()}>Review exact auction blocks</Button>
              {previewM.data && !previewM.data.ok ? <p className="text-destructive">{previewM.data.reason}</p> : null}
              {preview ? (
                <div className="space-y-1">
                  <div>Authoritative start block <span className="font-mono">{preview.startBlock}</span> · end block <span className="font-mono">{preview.endBlock}</span> (fresh head {preview.headBlock} at {new Date(preview.headCapturedAt).toLocaleString()})</div>
                  <label className="flex items-center gap-2"><input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} /> I reviewed these exact blocks</label>
                  <Button size="sm" disabled={!confirmed || prepareM.isPending} onClick={() => prepareM.mutate()}>Prepare pre-auction transaction</Button>
                  <p className="text-muted-foreground">Creates a bound record only. Nothing is signed, proposed or sent.</p>
                </div>
              ) : null}
              {prepareM.data && !prepareM.data.ok ? <p className="text-destructive">{prepareM.data.reason}</p> : null}
            </div>
          ) : null}

          {s.preAuction && (s.preAuction.status === "PREPARED" || s.preAuction.status === "STALE") ? (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <Input className="h-8 max-w-xs" placeholder="Reason to cancel" value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} aria-label="Cancel reason" />
              <Button size="sm" variant="outline" disabled={cancelReason.trim().length < 3 || cancelM.isPending} onClick={() => cancelM.mutate(s.preAuction!.id)}>Cancel prepared transaction</Button>
            </div>
          ) : null}

          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer select-none">Technical details</summary>
            <div className="font-mono">state {s.segment.state}</div>
            {s.preAuction ? (
              <div className="font-mono break-all">
                safeTxHash {s.preAuction.safeTxHash} · blocks {s.preAuction.startBlock}→{s.preAuction.endBlock} · prepared {s.preAuction.preparedAt}
                {s.preAuction.staleReasons.length ? ` · stale: ${s.preAuction.staleReasons.join(", ")}` : ""}
              </div>
            ) : null}
          </details>
        </>
      ) : null}
    </section>
  );
}
