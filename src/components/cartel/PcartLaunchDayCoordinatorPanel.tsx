import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { P9_STOP_COPY } from "@/lib/pcart-launch-coordinator-p9";
import { P8B_REAL_TREASURY_SAFE } from "@/lib/pcart-auction-execution-p8b";
import { getPcartP9CoordinatorSnapshot } from "@/lib/pcart-launch-coordinator-p9.functions";

/** PCART P9.0 — Launch Day coordinator. Read-only: no execution controls exist here. */
export function PcartLaunchDayCoordinatorPanel({ launchId }: { launchId: string }) {
  const fn = useServerFn(getPcartP9CoordinatorSnapshot);
  const q = useQuery({ queryKey: ["pcart-p9", launchId], queryFn: () => fn({ data: { launchId } }), staleTime: 60_000 });
  const s = q.data && q.data.ok ? q.data : null;
  const fmt = (v: string | null | undefined) => (v ? new Date(v).toUTCString() : "Not set");
  const row = (k: string, v: string) => (
    <div className="flex justify-between gap-4 border-b border-border/40 py-1 text-sm">
      <span className="text-muted-foreground">{k}</span>
      <span className="text-right font-mono text-foreground">{v}</span>
    </div>
  );

  return (
    <section className="rounded-lg border border-border bg-card p-4 text-card-foreground" aria-label="Launch Day coordinator">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-base font-semibold">Launch Day coordinator</h3>
        <span className="rounded border border-border px-2 py-0.5 text-xs text-muted-foreground">P9.0 · read-only</span>
      </div>
      <p className="mb-3 rounded border border-primary/40 bg-primary/10 p-2 text-sm font-medium">{P9_STOP_COPY}</p>
      {q.isLoading ? <p className="text-sm text-muted-foreground">Loading coordinator state…</p> : null}
      {q.data && !q.data.ok ? <p className="text-sm text-destructive">Owner access required.</p> : null}
      {s ? (
        <div className="space-y-4">
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Current state</div>
            <div className="font-mono text-sm">{s.derivation.state}</div>
            <div className="mt-2 text-xs uppercase tracking-wide text-muted-foreground">Next step</div>
            <div className="text-sm">{s.derivation.nextStep}</div>
            {s.derivation.blockers.length ? (
              <div className="mt-2 text-xs text-destructive">Blocked by: {s.derivation.blockers.join(", ")}</div>
            ) : null}
          </div>
          <div>
            <div className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">Milestones</div>
            <ul className="space-y-0.5 text-sm">
              {s.milestones.map((m) => (
                <li key={m.key}>{m.done ? "✓" : "○"} {m.label}</li>
              ))}
            </ul>
          </div>
          <div>
            {row("Attempt", s.attempt ? `#${s.attempt.number} ${s.attempt.status}` : "None")}
            {row("Transaction", s.attempt?.txHash ?? "None")}
            {row("Official PCART", s.officialContractAddress ?? "Not registered")}
            {row("Launch lifecycle", s.launchStatus ?? "Unknown")}
            {row("Treasury Safe", `${P8B_REAL_TREASURY_SAFE.address.slice(0, 8)}… · 2 of 3`)}
            {row("P8A policy approval", `${s.p8a.status}${s.p8a.reviewedAt ? ` · ${fmt(s.p8a.reviewedAt)}` : ""}`)}
            {row("P8B policy approval", `${s.p8b.status}${s.p8b.reviewedAt ? ` · ${fmt(s.p8b.reviewedAt)}` : ""}`)}
            {row("Execution switch", s.control?.executionEnabled ? "ON" : "OFF")}
            {row("Emergency stop", s.control?.emergencyStopEngaged === false ? "OFF" : "ON")}
            {row("Uncertain transaction", s.derivation.blockers.includes("UNCERTAIN_TRANSACTION") ? "YES — blocked" : "None")}
            {row("Send claims", String(s.claimsCount))}
          </div>
          <div>
            <div className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">Timeline preview</div>
            {row("Promotion start", fmt(s.plan?.promotionStartAt))}
            {row("Intended auction start", fmt(s.plan?.intendedAuctionStartAt))}
            {row("Plan status", s.planStatus.reason)}
            {row("Auction start block", s.plan?.authoritativeStartBlock ?? "Not known yet")}
            {row("Auction end block", s.plan?.endBlock ?? "Not known yet")}
            <p className="mt-1 text-xs text-muted-foreground">Auction start must be at least 21 days after promotion start. Nothing starts automatically.</p>
          </div>
        </div>
      ) : null}
    </section>
  );
}
