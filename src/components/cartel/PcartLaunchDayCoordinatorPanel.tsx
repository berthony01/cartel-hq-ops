import { useEffect, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { P9_1_STOP_COPY, validatePlanInput } from "@/lib/pcart-launch-coordinator-p9-live";
import { deriveDeploymentSegment, P9_2_STEPS, type P92Attempt, type P92Panel } from "@/lib/pcart-launch-coordinator-p9-2";
import { PcartAuctionSegmentPanel } from "@/components/cartel/PcartAuctionSegmentPanel";
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

export type P92DeploymentFacts = {
  attempt: P92Attempt;
  claimStatus: string | null;
  readinessApproved: boolean;
  preparationActive: boolean;
  permitActive: boolean;
  launch: { status: string | null; officialContractAddress: string | null };
};

/**
 * PCART P9.2 — Launch Day coordinator. Guided deployment segment renders exactly ONE existing
 * canonical P2–P7 panel (passed in by Launch Control) for the current state. It adds no send,
 * sign, Safe, registration, auction, migrate or sweep primitive of its own.
 */
export function PcartLaunchDayCoordinatorPanel({ launchId, deployment, panels }: { launchId: string; deployment?: P92DeploymentFacts; panels?: Partial<Record<Exclude<P92Panel, null>, ReactNode>> }) {
  const qc = useQueryClient();
  const fn = useServerFn(getPcartP9CoordinatorSnapshot);
  const saveFn = useServerFn(savePcartP9LaunchPlan);
  const key = ["pcart-p9", launchId];
  const q = useQuery({ queryKey: key, queryFn: () => fn({ data: { launchId } }), staleTime: 60_000, refetchInterval: 120_000, refetchOnWindowFocus: false });
  // Fail closed on an incomplete snapshot (e.g. cached data from an older server shape).
  const s = q.data && q.data.ok && q.data.preflight && q.data.estimate ? q.data : null;

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

  const seg = deployment
    ? deriveDeploymentSegment({ ...deployment, preflight: s ? s.preflight : null, planValid: !!s?.planStatus.ok })
    : null;
  const activePanel = seg?.panel ? panels?.[seg.panel] ?? null : null;

  return (
    <section className="rounded-lg border border-border bg-card p-4 text-card-foreground" aria-label="Launch Day coordinator">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-base font-semibold">Launch Day coordinator</h3>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => q.refetch()} disabled={q.isFetching}>{q.isFetching ? "Refreshing…" : "Refresh status"}</Button>
          <span className="rounded border border-border px-2 py-0.5 text-xs text-muted-foreground">P9.2 · guided</span>
        </div>
      </div>
      {!s?.preflight.sendGateOpen ? <p className="mb-3 rounded border border-primary/40 bg-primary/10 p-2 text-sm font-medium">{P9_1_STOP_COPY}</p> : null}
      {q.isLoading ? <p className="text-sm text-muted-foreground">Reading live status…</p> : null}
      {q.data && !q.data.ok ? <p className="text-sm text-destructive">Owner access required.</p> : null}
      {seg ? (
        <div className="mb-4 rounded border border-border/60 p-3" aria-label="Deployment segment">
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="font-medium">Deployment</span>
            <span className="text-xs text-muted-foreground">Step {Math.min(seg.step + 1, P9_2_STEPS.length)} of {P9_2_STEPS.length} · {P9_2_STEPS[seg.step]}</span>
          </div>
          <ol className="mb-2 flex flex-wrap gap-1" aria-label="Deployment progress">
            {P9_2_STEPS.map((label, i) => (
              <li key={label} title={label} className={`h-1.5 w-6 rounded ${i < seg.step || seg.complete ? "bg-primary" : i === seg.step ? "bg-primary/50" : "bg-muted"}`} />
            ))}
          </ol>
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Next action</div>
          <div className={`text-sm font-medium ${seg.blockers.length ? "text-destructive" : ""}`}>{seg.nextAction}</div>
          {seg.blockers.length ? <div className="mt-1 text-xs text-destructive">Blocked by: {seg.blockers.join(", ")}</div> : null}
          {deployment?.attempt?.txHash ? <div className="mt-1 break-all font-mono text-xs">tx {deployment.attempt.txHash}</div> : null}
          <div className="mt-1 text-xs text-muted-foreground">Official contract: {deployment?.launch.officialContractAddress ?? "not registered"}</div>
          {s ? (
            <details className="mt-2 text-xs">
              <summary className="cursor-pointer select-none text-muted-foreground">Final preflight ({s.preflight.checks.filter((c) => c.status === "BLOCKED").length} blocked)</summary>
              <ul className="mt-1 space-y-0.5">
                {s.preflight.checks.map((c) => (
                  <li key={c.key} className="flex justify-between gap-2">
                    <span>{c.label}{c.detail ? <span className="block break-all text-muted-foreground">{c.detail}</span> : null}</span>
                    <span className={c.status === "PASS" ? "text-primary" : c.status === "BLOCKED" ? "text-destructive" : "text-muted-foreground"}>{c.status === "AT_SEND_STEP" ? "At send step" : c.status}</span>
                  </li>
                ))}
                {s.preflight.controlBlockers.map((b) => <li key={b} className="flex justify-between gap-2"><span>{b}</span><span className="text-destructive">Blocks live send</span></li>)}
              </ul>
              <div className="mt-1 font-mono text-muted-foreground">state {seg.state}</div>
            </details>
          ) : null}
          {activePanel ? <div className="mt-3">{activePanel}</div> : null}
        </div>
      ) : null}
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

          <PcartAuctionSegmentPanel launchId={launchId} />

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
