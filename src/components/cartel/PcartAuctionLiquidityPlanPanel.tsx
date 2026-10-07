import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { Button } from "@/components/ui/button";
import {
  dep,
  formatEth,
  formatPcart,
  P8A_MANIFEST,
  P8A_STOP_COPY,
  p8aSummaryText,
} from "@/lib/pcart-auction-liquidity-plan";
import { getPcartP8aStatus, reviewPcartP8aPlan } from "@/lib/pcart-auction-liquidity.functions";

/** PCART P8A — auction & liquidity plan review. Review/simulation only; no transaction controls exist here. */
export function PcartAuctionLiquidityPlanPanel({ launchId, officialContractAddress }: { launchId: string; officialContractAddress: string | null }) {
  const qc = useQueryClient();
  const statusFn = useServerFn(getPcartP8aStatus);
  const reviewFn = useServerFn(reviewPcartP8aPlan);
  const key = ["pcart-p8a", launchId];
  const status = useQuery({ queryKey: key, queryFn: () => statusFn({ data: { launchId } }), staleTime: 60_000 });
  const review = useMutation({ mutationFn: () => reviewFn({ data: { launchId } }), onSettled: () => qc.invalidateQueries({ queryKey: key }) });
  const m = P8A_MANIFEST;
  const s = status.data && status.data.ok ? status.data : null;
  const latest = s?.latestReview ?? null;
  const active = !!latest && new Date(latest.expires_at).getTime() > Date.now() && latest.manifest_fingerprint === s?.manifestFingerprint;

  const rows: [string, string][] = [
    ["Auction allocation", formatPcart(m.auctionAllocation)],
    ["Liquidity reserve (first pool)", formatPcart(m.initialLiquidityReserve)],
    ["Future liquidity reserve", `${formatPcart(m.futureLiquidityReserve)} — stays in Treasury Safe, not used now`],
    ["Floor / target / cap", `${formatEth(m.floorWei)} floor · ${formatEth(m.targetWei)} target (not a gate) · no hard cap`],
    ["Auction", `~${m.durationHours}h public auction · native ETH · no whitelist, presale or extension`],
    ["Pool", `Uniswap v4 · ${m.pool.feeLabel} fee`],
    ["LP custody", m.lpCustodyLabel],
    ["Unsold tokens", "Return to Treasury Safe — must be re-confirmed before live auction"],
  ];

  return (
    <section className="space-y-3 rounded-md border border-border bg-card/60 p-4" aria-label="P8A — Auction & Liquidity Plan">
      <div>
        <p className="text-sm font-semibold">P8A — Auction &amp; Liquidity Plan</p>
        <p className="text-xs text-muted-foreground">{p8aSummaryText({ officialContractAddress, latestReviewActive: active })}</p>
      </div>
      <dl className="grid gap-1 text-xs sm:grid-cols-[12rem_1fr]">
        {rows.map(([k, v]) => (<><dt key={`${k}-k`} className="text-muted-foreground">{k}</dt><dd key={`${k}-v`}>{v}</dd></>))}
      </dl>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead><tr className="text-left text-muted-foreground"><th className="py-1">ETH raised</th><th>To liquidity</th><th>To treasury</th></tr></thead>
          <tbody>
            <tr><td className="py-1">Under 5 ETH</td><td colSpan={2}>Refund to bidders — no pool</td></tr>
            <tr><td className="py-1">5 to under 15 ETH</td><td>100%</td><td>0%</td></tr>
            <tr><td className="py-1">15 to under 30 ETH</td><td>90%</td><td>10%</td></tr>
            <tr><td className="py-1">30 ETH or more</td><td>80%</td><td>20%</td></tr>
          </tbody>
        </table>
      </div>
      <div className="space-y-1 text-xs">
        <p className="font-medium">Contract checks</p>
        {status.isLoading ? <p className="text-muted-foreground">Checking Robinhood Chain…</p> : null}
        {status.data && !status.data.ok ? <p className="text-destructive">{status.data.reason}</p> : null}
        {s ? (
          <ul className="space-y-0.5">
            {s.attestation.mainnet.map((r, i) => (
              <li key={r.key} className="flex flex-wrap justify-between gap-2">
                <span>{dep(r.key).label}</span>
                <span className={r.status === "MATCH" ? "text-primary" : "text-destructive"}>
                  Mainnet {r.status} · Testnet {s.attestation.testnet[i]?.status}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        {s ? (
          <p className="text-muted-foreground">
            Rehearsal mode: {s.attestation.rehearsalMode === "FORKED_MAINNET" ? "Forked mainnet (testnet lacks required contracts)" : "Testnet"} ·
            Simulation: success path {s.simulation.success.ok ? "passed" : "blocked"}, below-floor refund path {s.simulation.failure.ok ? "passed" : "failed"}
          </p>
        ) : null}
      </div>
      {active ? (
        <p className="text-sm font-semibold text-primary">{P8A_STOP_COPY}</p>
      ) : (
        <Button size="sm" disabled={!s || !s.attestation.mainnetOk || review.isPending} onClick={() => review.mutate()}>
          {review.isPending ? "Reviewing…" : "Review P8A plan"}
        </Button>
      )}
      {review.data && !review.data.ok ? <p className="text-xs text-destructive">{review.data.reason}</p> : null}
      <p className="text-[11px] text-muted-foreground">Review only. No approval, deposit, auction, pool or Safe proposal can be started from here.</p>
    </section>
  );
}
