import { Fragment } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { Button } from "@/components/ui/button";
import { formatEth, formatPcart } from "@/lib/pcart-auction-liquidity-plan";
import {
  P8B_FORK_BANNER,
  P8B_FORK_EVIDENCE,
  P8B_MANIFEST,
  P8B_MANIFEST_VERSION,
  P8B_STOP_COPY,
  p8bSummaryText,
} from "@/lib/pcart-auction-execution-p8b";
import { getPcartP8bStatus, reviewPcartP8bRehearsal } from "@/lib/pcart-auction-execution-p8b.functions";

/** PCART P8B — forked-mainnet rehearsal review. Review only; no transaction controls exist here. */
export function PcartP8bRehearsalPanel({ launchId }: { launchId: string }) {
  const qc = useQueryClient();
  const statusFn = useServerFn(getPcartP8bStatus);
  const reviewFn = useServerFn(reviewPcartP8bRehearsal);
  const key = ["pcart-p8b", launchId];
  const status = useQuery({ queryKey: key, queryFn: () => statusFn({ data: { launchId } }), staleTime: 60_000 });
  const review = useMutation({ mutationFn: () => reviewFn({ data: { launchId } }), onSettled: () => qc.invalidateQueries({ queryKey: key }) });
  const s = status.data && status.data.ok ? status.data : null;
  const now = Date.now();
  const p8aCurrent = !!s?.latestP8a && s.latestP8a.manifest_version === P8B_MANIFEST.p8a.version && s.latestP8a.manifest_fingerprint === P8B_MANIFEST.p8a.fingerprint && new Date(s.latestP8a.expires_at).getTime() > now;
  const p8bCurrent = !!s?.latestP8b && s.latestP8b.manifest_version === P8B_MANIFEST_VERSION && s.latestP8b.manifest_fingerprint === s.manifestFingerprint && new Date(s.latestP8b.expires_at).getTime() > now;
  const ev = P8B_FORK_EVIDENCE.success30Eth;
  const pass = (ok: boolean | undefined) => (ok ? "PASS" : ok === false ? "FAIL" : "…");

  const checks: [string, string][] = [
    ["P8A v2 review", s ? (p8aCurrent ? "CURRENT" : "STALE — re-review P8A first") : "…"],
    ["Deployed Uniswap source/code", s ? `${pass(s.live.codeHashesOk)} (live code hashes; pinned v3.3.0 / CCA v2.1.0)` : "…"],
    ["Protocol fee", "0 (fee controller is the zero address; measured 0 wei)"],
    ["Real Treasury Safe (read-only)", s ? `${pass(s.live.safeOk)} — Safe ${s.live.safe.version ?? "?"}, ${s.live.safe.threshold ?? "?"}-of-${s.live.safe.owners.length}, nonce ${s.live.safe.nonce ?? "?"}` : "…"],
    ["Fork PCART artifact", "PASS — frozen pepecartel-token-v1, fork-only token"],
    ["30 ETH success rehearsal", `PASS — ${formatEth(ev.lpEthWei)} to liquidity / ${formatEth(ev.treasuryEthWei)} to Treasury (1 wei rounding)`],
    ["Below-5 ETH refund rehearsal", "PASS — no pool, bidders refunded, all PCART back to the Safe"],
  ];
  const params: [string, string][] = [
    ["Minimum raise threshold", `${formatEth(P8B_MANIFEST.minimumRaiseThresholdWei)} — below this the auction fails and everyone is refunded`],
    ["Fundraising target", `${formatEth(P8B_MANIFEST.fundraisingTargetWei)} — not a cap`],
    ["Starting token price floor", `~${P8B_MANIFEST.startingTokenPriceFloor.approxEthPerPcartText} ETH per PCART (equal to 10 ETH for all ${formatPcart(P8B_MANIFEST.auctionInventory)} at the floor)`],
    ["Price step", "1% of the starting floor"],
    ["Release", P8B_MANIFEST.releaseSchedule.label],
    ["Duration", `${P8B_MANIFEST.durationBlocks.toLocaleString("en-US")} blocks (~7 days at measured cadence; block-based, end time is approximate)`],
    ["Before auction", "1 Safe transaction · 2 of 3 owner signatures"],
    ["During auction", "No owner action"],
    ["After auction", "1 public migrate call (anyone) + 1 Safe sweep · 2 of 3 owner signatures"],
    ["Refunds", "Claim-based (each bid exits via exitBid)"],
    ["Pool creation", "Explicit permissionless migrate · Uniswap v4 · 0.25% fee"],
    ["LP custody", "Automatic, permanent, fees-off FeeSplitter"],
    ["Measured at 30 ETH", `${formatPcart(ev.lpTokensConsumed)} LP PCART used; unused reserve and future 150M stay with the Safe`],
  ];

  return (
    <section className="space-y-3 rounded-md border border-border bg-card/60 p-4" aria-label="P8B — Forked Mainnet Rehearsal">
      <div>
        <p className="text-sm font-semibold">P8B — Forked Mainnet Rehearsal</p>
        <p className="mt-1 rounded border border-destructive/60 px-2 py-1 text-xs font-semibold text-destructive">{P8B_FORK_BANNER}</p>
        <p className="mt-1 text-xs text-muted-foreground">{p8bSummaryText(p8bCurrent)}</p>
      </div>
      {status.isLoading ? <p className="text-xs text-muted-foreground">Checking Robinhood Chain (read-only)…</p> : null}
      {status.data && !status.data.ok ? <p className="text-xs text-destructive">{status.data.reason}</p> : null}
      <dl className="grid gap-1 text-xs sm:grid-cols-[14rem_1fr]">
        {checks.map(([k, v]) => (<Fragment key={k}><dt className="text-muted-foreground">{k}</dt><dd>{v}</dd></Fragment>))}
      </dl>
      <dl className="grid gap-1 border-t border-border pt-2 text-xs sm:grid-cols-[14rem_1fr]">
        {params.map(([k, v]) => (<Fragment key={k}><dt className="text-muted-foreground">{k}</dt><dd>{v}</dd></Fragment>))}
      </dl>
      {p8bCurrent ? (
        <p className="text-sm font-semibold text-primary">{P8B_STOP_COPY}</p>
      ) : (
        <Button size="sm" disabled={!s || !p8aCurrent || !s.live.codeHashesOk || !s.live.safeOk || review.isPending} onClick={() => review.mutate()}>
          {review.isPending ? "Reviewing…" : "Review P8B rehearsal"}
        </Button>
      )}
      {review.data && !review.data.ok ? <p className="text-xs text-destructive">{review.data.reason}</p> : null}
      <p className="text-[11px] text-muted-foreground">Review only. Nothing here can sign, propose or send a Safe transaction, start the auction, migrate, sweep or launch.</p>
    </section>
  );
}
