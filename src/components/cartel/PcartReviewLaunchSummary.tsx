import { Lock, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/cartel/StatusBadge";
import type { PcartReadiness } from "@/lib/pcart-launch-readiness";

type PcartReviewLaunchSummaryProps = {
  tokenName: string;
  ticker: string;
  chain: string;
  fixedSupply: string;
  readiness: PcartReadiness;
  /** Authoritative Mainnet row text (readiness approval + execution control + draft). */
  mainnetSummary: string;
  /** Saved schedule is in the past. Warning only; never mutated here. */
  scheduleExpired?: boolean;
};

function statusFor(readiness: PcartReadiness, id: "auction" | "treasury" | "review") {
  return readiness.steps.find((step) => step.id === id)?.status ?? "Pending setup";
}

/** Presentation-only review. It intentionally exposes no launch handler. */
export function PcartReviewLaunchSummary({
  tokenName,
  ticker,
  chain,
  fixedSupply,
  readiness,
  mainnetSummary,
  scheduleExpired = false,
}: PcartReviewLaunchSummaryProps) {
  const facts = [
    ["Token", tokenName],
    ["Ticker", ticker],
    ["Chain", chain],
    ["Fixed supply", fixedSupply],
    ["Treasury", statusFor(readiness, "treasury")],
    ["Test rehearsal", statusFor(readiness, "review")],
    ["Auction", statusFor(readiness, "auction")],
    ["Mainnet", mainnetSummary],
  ] as const;

  return (
    <section
      aria-label="Review and launch"
      className="min-w-0 overflow-hidden rounded-lg border border-gold/35 bg-card/60"
    >
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3 border-b border-border-subtle p-4">
        <div className="min-w-0">
          <p className="type-eyebrow text-gold">Final step</p>
          <h3 className="mt-1 text-lg font-semibold text-foreground">Review &amp; Launch</h3>
          <p className="mt-1 max-w-prose text-xs leading-relaxed text-muted-foreground">
            Review the authoritative launch setup. Nothing here can start the launch.
          </p>
        </div>
        <StatusBadge tone="muted">
          <Lock className="size-3" aria-hidden="true" />
          <span>Mainnet locked</span>
        </StatusBadge>
      </div>

      <dl className="grid min-w-0 gap-px bg-border-subtle sm:grid-cols-2">
        {facts.map(([label, value]) => (
          <div key={label} className="min-w-0 bg-card px-4 py-3">
            <dt className="type-eyebrow text-muted-foreground">{label}</dt>
            <dd className="mt-1 min-w-0 text-sm font-semibold leading-snug text-foreground [overflow-wrap:anywhere]">
              {value}
            </dd>
          </div>
        ))}
      </dl>

      <div className="min-w-0 space-y-3 p-4">
        {scheduleExpired ? (
          <p role="status" className="rounded-md border border-gold/40 bg-gold/10 px-3 py-2 text-xs leading-relaxed text-foreground">
            The saved launch window is in the past. Set a new launch time before announcing.
          </p>
        ) : null}
        <Button type="button" className="min-h-11 w-full whitespace-normal" disabled>
          <ShieldCheck className="size-4" aria-hidden="true" />
          Launch unavailable until setup is complete
        </Button>
      </div>
    </section>
  );
}