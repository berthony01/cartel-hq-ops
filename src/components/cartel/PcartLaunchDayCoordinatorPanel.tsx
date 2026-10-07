import { useEffect, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { P9_1_STOP_COPY, validatePlanInput } from "@/lib/pcart-launch-coordinator-p9-live";
import { getPcartP9CoordinatorSnapshot, savePcartP9LaunchPlan } from "@/lib/pcart-launch-coordinator-p9.functions";

/** datetime-local (browser-local) <-> ISO UTC. */
const toLocalInput = (iso: string | null | undefined) => {
  if (!iso) return "";
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : null);
const fmt = (v: string | null | undefined) => (v ? new Date(v).toLocaleString() : "Not set");

function Section({ title, status, tone, children }: { title: string; status: string; tone: "ok" | "bad" | "neutral"; children?: ReactNode }) {
  const toneCls = tone === "ok" ? "text-primary" : tone === "bad" ? "text-destructive" : "text-muted-foreground";
  return (
    <div className="border-b border-border/40 py-2">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="font-medium">{title}</span>
        <span className={`font-medium ${toneCls}`}>{status}</span>
      </div>
      {children ? (
        <details className="mt-1 text-xs text-muted-foreground">
          <summary className="cursor-pointer select-none">Technical details</summary>
          <div className="mt-1 space-y-0.5 break-all font-mono">{children}</div>
        </details>
      ) : null}
    </div>
  );
}

/** PCART P9.1 — Launch Day coordinator. Read-only chain status + owner launch-plan editor. No execution controls. */
export function PcartLaunchDayCoordinatorPanel({ launchId }: { launchId: string }) {
  const qc = useQueryClient();
  const fn = useServerFn(getPcartP9CoordinatorSnapshot);
  const saveFn = useServerFn(savePcartP9LaunchPlan);
  const key = ["pcart-p9", launchId];
  const q = useQuery({ queryKey: key, queryFn: () => fn({ data: { launchId } }), staleTime: 60_000, refetchInterval: 120_000, refetchOnWindowFocus: false });
  const s = q.data && q.data.ok ? q.data : null;

  const [promo, setPromo] = useState("");
  const [auction, setAuction] = useState("");
  useEffect(() => {
    setPromo(toLocalInput(s?.plan?.promotionStartAt));
    setAuction(toLocalInput(s?.plan?.intendedAuctionStartAt));
  }, [s?.plan?.promotionStartAt, s?.plan?.intendedAuctionStartAt]);
  const validation = validatePlanInput(fromLocalInput(promo), fromLocalInput(auction));
  const save = useMutation({
    mutationFn: (v: { promotionStartAt: string | null; intendedAuctionStartAt: string | null }) => saveFn({ data: { launchId, ...v } }),
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  });
  const dirty = fromLocalInput(promo) !== (s?.plan?.promotionStartAt ? new Date(s.plan.promotionStartAt).toISOString() : null)
    || fromLocalInput(auction) !== (s?.plan?.intendedAuctionStartAt ? new Date(s.plan.intendedAuctionStartAt).toISOString() : null);

  return (
    <section className="rounded-lg border border-border bg-card p-4 text-card-foreground" aria-label="Launch Day coordinator">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-base font-semibold">Launch Day coordinator</h3>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => q.refetch()} disabled={q.isFetching}>{q.isFetching ? "Refreshing…" : "Refresh status"}</Button>
          <span className="rounded border border-border px-2 py-0.5 text-xs text-muted-foreground">P9.1 · read-only</span>
        </div>
      </div>
      <p className="mb-3 rounded border border-primary/40 bg-primary/10 p-2 text-sm font-medium">{P9_1_STOP_COPY}</p>
      {q.isLoading ? <p className="text-sm text-muted-foreground">Reading live status…</p> : null}
      {q.data && !q.data.ok ? <p className="text-sm text-destructive">Owner access required.</p> : null}
      {s ? (
        <div className="space-y-4">
          {/* 1. Launch plan */}
          <div className="rounded border border-border/60 p-3">
            <div className="mb-2 flex items-center justify-between text-sm">
              <span className="font-medium">1. Launch plan</span>
              <span className={s.planStatus.ok ? "text-primary" : s.planStatus.reason === "NOT_SET" || s.planStatus.reason === "PARTIAL" ? "text-muted-foreground" : "text-destructive"}>
                Promotion plan: {s.planStatus.ok ? "Valid" : s.planStatus.reason === "RUNWAY_TOO_SHORT" ? "Invalid" : s.planStatus.reason === "PARTIAL" ? "Partly set" : "Not set"}
              </span>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="text-xs text-muted-foreground">Promotion start (your local time)
                <Input type="datetime-local" value={promo} onChange={(e) => setPromo(e.target.value)} aria-label="Promotion start" />
              </label>
              <label className="text-xs text-muted-foreground">Intended auction start (your local time)
                <Input type="datetime-local" value={auction} onChange={(e) => setAuction(e.target.value)} aria-label="Intended auction start" />
              </label>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">Both may stay blank. The auction must start at least 21 days after promotion starts. Nothing starts automatically. Saved in UTC.</p>
            {!validation.ok ? <p className="mt-1 text-xs text-destructive">{validation.error === "RUNWAY_TOO_SHORT" ? "Auction start must be at least 21 days after promotion start." : "Invalid date."}</p> : null}
            {save.data && !save.data.ok ? <p className="mt-1 text-xs text-destructive">Not saved: {save.data.reason}</p> : null}
            {save.data && save.data.ok && !dirty ? <p className="mt-1 text-xs text-primary">Plan saved.</p> : null}
            <div className="mt-2 flex gap-2">
              <Button size="sm" disabled={!validation.ok || !dirty || save.isPending} onClick={() => save.mutate({ promotionStartAt: fromLocalInput(promo), intendedAuctionStartAt: fromLocalInput(auction) })}>Save plan</Button>
              <Button size="sm" variant="outline" disabled={save.isPending || (!s.plan?.promotionStartAt && !s.plan?.intendedAuctionStartAt)} onClick={() => { setPromo(""); setAuction(""); save.mutate({ promotionStartAt: null, intendedAuctionStartAt: null }); }}>Clear plan</Button>
            </div>
            <div className="mt-3 text-xs">
              {s.estimate.available ? (
                <div className="space-y-0.5">
                  <div>ESTIMATED auction start block: <span className="font-mono">{s.estimate.estimatedStartBlock}</span> (~{fmt(s.estimate.estimatedStartAt)})</div>
                  <div>ESTIMATED auction end block: <span className="font-mono">{s.estimate.estimatedEndBlock}</span> (~{fmt(s.estimate.estimatedEndAt)})</div>
                  <div className="text-muted-foreground">Estimates only, at {s.estimate.msPerBlock} ms/block. Exact blocks become authoritative only at final preparation.</div>
                </div>
              ) : (
                <div className="text-muted-foreground">Block estimate unavailable ({s.estimate.reason === "NO_AUCTION_DATE" ? "no auction date" : s.estimate.reason === "CHAIN_NOT_LIVE" ? "live chain reading not fresh" : s.estimate.reason === "START_IN_PAST" ? "date is in the past" : "no cadence"}).</div>
              )}
            </div>
          </div>

          <div>
            <Section title="2. Robinhood Chain" status={s.chain.status === "LIVE" ? "Connected" : s.chain.status === "STALE" ? "Stale" : "Unavailable"} tone={s.chain.status === "LIVE" ? "ok" : "bad"}>
              {"latestBlock" in s.chain ? (
                <>
                  <div>chain {s.chain.chainId} · block {s.chain.latestBlock} at {s.chain.latestBlockAt}</div>
                  <div>head age {Math.round(s.chain.headAgeMs / 1000)}s · {s.chain.msPerBlock ?? "?"} ms/block over {s.chain.sampleBlocks} blocks</div>
                  <div>gas price {s.chain.gasPriceWei ?? "n/a"} wei</div>
                </>
              ) : <div>{s.chain.reason}</div>}
              <div>captured {s.chain.capturedAt}</div>
            </Section>
            <Section title="3. Treasury Safe" status={s.safe.status === "READY" ? "Ready" : s.safe.status === "BLOCKED" ? "Blocked" : "Unavailable"} tone={s.safe.status === "READY" ? "ok" : "bad"}>
              <div>{s.safe.address} · v{s.safe.version ?? "?"} · {s.safe.threshold ?? "?"} of {s.safe.owners.length} · nonce {s.safe.nonce ?? "?"}</div>
              <div>stored address: {s.safe.storedAddress ?? "none"}</div>
              {s.safe.owners.map((o) => <div key={o}>owner {o}</div>)}
              {s.safe.reasons.length ? <div className="text-destructive">{s.safe.reasons.join(", ")}</div> : null}
              <div>captured {s.safe.capturedAt}</div>
            </Section>
            <Section title="4. Contract dependencies" status={s.dependencies.status === "VERIFIED" ? "Verified" : s.dependencies.status === "BLOCKED" ? "Blocked" : "Unavailable"} tone={s.dependencies.status === "VERIFIED" ? "ok" : "bad"}>
              {s.dependencies.items.map((d) => <div key={d.key}>{d.label}: {d.status}</div>)}
            </Section>
            <Section title="5. Deployment / official PCART" status={s.officialContractAddress ? "Registered" : `Attempt #${s.attempt?.number ?? "?"} ${s.attempt?.status ?? "none"} · not deployed`} tone="neutral">
              <div>tx {s.attempt?.txHash ?? "none"} · submitted {s.attempt?.submittedAt ?? "no"}</div>
              <div>contract {s.attempt?.contractAddress ?? "none"} · finality {s.attempt?.finalityState ?? "n/a"}</div>
              <div>official {s.officialContractAddress ?? "not registered"} · code hash {s.officialTokenCodeHash ?? "n/a"}</div>
              <div>send claims {s.claimsCount}</div>
            </Section>
            <Section title="6. Auction" status={s.auction.status === "NOT_CREATED" ? "Not created yet" : s.auction.status} tone="neutral">
              <div>minimum raise 5 ETH</div>
              {s.auction.status !== "NOT_CREATED" ? <div>blocks {s.auction.startBlock}–{s.auction.endBlock} · raised {s.auction.amountRaisedWei ?? "n/a"} · outcome {s.auction.outcome}</div> : null}
            </Section>
            <Section title="Mainnet execution" status={s.control?.executionEnabled ? "ON" : "OFF"} tone="neutral" />
            <Section title="Emergency stop" status={s.control?.emergencyStopEngaged === false ? "OFF" : "ON"} tone="neutral" />
            <Section title="P8A / P8B approval" status={`${s.p8a.status} / ${s.p8b.status}`} tone={s.p8a.status === "CURRENT" && s.p8b.status === "CURRENT" ? "ok" : "bad"} />
          </div>

          {/* 7. Blockers / Next step */}
          <div className="rounded border border-border/60 p-3">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">7. Next step</div>
            <div className="text-sm">{s.derivation.nextStep}</div>
            {s.derivation.blockers.length ? <div className="mt-1 text-xs text-destructive">Future live actions blocked by: {s.derivation.blockers.join(", ")}</div> : null}
            <details className="mt-1 text-xs text-muted-foreground">
              <summary className="cursor-pointer select-none">Technical details</summary>
              <div className="font-mono">state {s.derivation.state}</div>
              <ul className="mt-1">{s.milestones.map((m) => <li key={m.key}>{m.done ? "✓" : "○"} {m.label}</li>)}</ul>
            </details>
          </div>
        </div>
      ) : null}
    </section>
  );
}
