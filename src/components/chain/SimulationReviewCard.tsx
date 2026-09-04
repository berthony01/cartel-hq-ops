import { AlertTriangle, Check, Copy, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ROBINHOOD_TESTNET_CHAIN_ID } from "@/lib/chain-registry";
import {
  formatDecimalString,
  formatWeiExact,
  isQuoteFresh,
  truncateHash,
  type Simulation,
} from "@/lib/chain-simulation";

/**
 * C8.4 — pre-sign review card. Presentational only: it never triggers a chain
 * write, never creates a deployment attempt and never signs anything.
 */
export function SimulationReviewCard({
  simulation,
  stale,
  nowMs,
}: {
  simulation: Simulation;
  /** True when an intent field, the account or the chain changed after the run. */
  stale: boolean;
  nowMs: number;
}) {
  const [copied, setCopied] = useState(false);
  const { intent, preflight } = simulation;
  const fresh = isQuoteFresh(preflight, nowMs);

  const rows: { label: string; value: string }[] = [
    { label: "Chain", value: `Robinhood Chain Testnet ${ROBINHOOD_TESTNET_CHAIN_ID}` },
    { label: "Artifact", value: intent.artifactId },
    { label: "Deployer", value: intent.deployer },
    { label: "Initial recipient", value: intent.recipient },
    { label: "Name", value: intent.name },
    { label: "Symbol", value: intent.symbol },
    { label: "Decimals", value: String(intent.decimals) },
    { label: "Supply (whole tokens)", value: formatDecimalString(intent.supplyWhole) },
    { label: "Supply (base units, exact)", value: intent.totalSupplyBaseUnits },
    { label: "Transaction value", value: "0 ETH" },
    { label: "Wallet balance", value: `${formatWeiExact(preflight.balanceWei)} ETH` },
    { label: "Gas estimate", value: formatDecimalString(preflight.gasEstimate) },
    {
      label: "Fee estimate",
      value:
        preflight.feeWeiPerGas === null
          ? "Unavailable"
          : `${formatDecimalString(preflight.feeWeiPerGas)} wei/gas (${preflight.feeSource})`,
    },
    {
      label: "Estimated cost",
      value:
        preflight.estimatedCostWei === null
          ? "Unavailable"
          : `${formatWeiExact(preflight.estimatedCostWei)} ETH`,
    },
  ];

  const checks: { label: string; ok: boolean }[] = [
    { label: `Chain is ${ROBINHOOD_TESTNET_CHAIN_ID}`, ok: preflight.chainOk },
    { label: "Connected account matches deployer", ok: preflight.accountOk },
    { label: "Recipient valid and non-zero", ok: preflight.recipientOk },
    { label: "Creation simulated without revert", ok: preflight.callOk },
    { label: "Gas estimated", ok: preflight.gasEstimate !== null },
    {
      label: "Fee estimate available",
      ok: preflight.feeWeiPerGas !== null && preflight.estimatedCostWei !== null,
    },
    { label: "Balance covers estimated cost", ok: preflight.sufficientBalance === true },
  ];


  async function copyFingerprint() {
    try {
      await navigator.clipboard.writeText(intent.fingerprint);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable — the truncated value stays visible */
    }
  }

  return (
    <div className="mt-4 rounded-lg border border-border bg-surface-raised/40 p-4 text-xs">
      <p className="flex items-center gap-2 font-semibold uppercase tracking-wide text-gold">
        <AlertTriangle className="size-4" aria-hidden="true" />
        Simulation — testnet only, NOT the official PEPECARTEL token
      </p>
      <p className="mt-1 text-muted-foreground">
        Read-only preview. No deployment attempt is recorded and nothing is signed until you deploy.
      </p>

      <dl className="mt-3 grid gap-x-4 gap-y-1 sm:grid-cols-2">
        {rows.map((row) => (
          <div key={row.label} className="flex flex-col">
            <dt className="text-muted-foreground">{row.label}</dt>
            <dd className="break-all text-foreground">{row.value}</dd>
          </div>
        ))}
      </dl>

      <ul className="mt-3 grid gap-1 sm:grid-cols-2">
        {checks.map((check) => (
          <li key={check.label} className="flex items-center gap-2">
            {check.ok ? (
              <Check className="size-3 text-emerald-500" aria-hidden="true" />
            ) : (
              <X className="size-3 text-destructive" aria-hidden="true" />
            )}
            <span className={check.ok ? "text-muted-foreground" : "text-destructive"}>
              {check.label}
            </span>
          </li>
        ))}
      </ul>

      <ul className="mt-3 list-disc space-y-1 pl-4 text-muted-foreground">
        <li>No owner or admin role. No post-deployment minting.</li>
        <li>No tax or fee, no blacklist or freeze, no pause or trading toggle.</li>
        <li>No proxy and no upgrade path. The deployed code is immutable.</li>
      </ul>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="text-muted-foreground">Intent fingerprint:</span>
        <code className="text-foreground">{truncateHash(intent.fingerprint)}</code>
        <Button size="sm" variant="outline" onClick={() => void copyFingerprint()}>
          <Copy className="size-3" aria-hidden="true" />
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>

      {preflight.errors.length > 0 ? (
        <ul className="mt-3 list-disc space-y-1 pl-4 text-destructive">
          {preflight.errors.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      ) : null}

      <p className="mt-3 font-medium">
        {stale ? (
          <span className="text-destructive">
            Details changed since this simulation. Run the simulation again before deploying.
          </span>
        ) : !fresh ? (
          <span className="text-destructive">
            Estimate expired. Run the simulation again before deploying.
          </span>
        ) : preflight.passed ? (
          <span className="text-emerald-500">Simulation passed. Deployment is unlocked.</span>
        ) : (
          <span className="text-destructive">
            Simulation did not pass. Deployment stays locked.
          </span>
        )}
      </p>
    </div>
  );
}
