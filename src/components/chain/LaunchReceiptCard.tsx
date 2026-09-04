import { useState } from "react";
import { AlertTriangle, CheckCircle2, Copy, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { REQUIRED_CONFIRMATIONS } from "@/lib/chain-registry";
import { truncateHash } from "@/lib/chain-simulation";
import type { LaunchReceipt } from "@/lib/launch-receipt";

/**
 * C8.5 — Launch Receipt (read-only).
 *
 * Presentational only: it never registers a contract address, never changes a
 * launch lifecycle status and never triggers a chain write. Every value is
 * derived from the authoritative deployment row.
 */

function Row({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex flex-col">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="break-all text-foreground">{value ?? "—"}</dd>
    </div>
  );
}

function CopyValue({ label, value, href }: { label: string; value: string; href?: string | null }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable — the value stays visible */
    }
  }
  return (
    <div className="flex flex-col">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="flex flex-wrap items-center gap-2 break-all text-foreground">
        {href ? (
          <a className="text-gold underline" href={href} target="_blank" rel="noreferrer">
            {truncateHash(value, 12, 10)}
            <ExternalLink className="ml-1 inline size-3" aria-hidden="true" />
          </a>
        ) : (
          <code>{truncateHash(value, 12, 10)}</code>
        )}
        <Button size="sm" variant="outline" onClick={() => void copy()}>
          <Copy className="size-3" aria-hidden="true" />
          {copied ? "Copied" : "Copy"}
        </Button>
      </dd>
    </div>
  );
}

export function LaunchReceiptCard({ receipt }: { receipt: LaunchReceipt }) {
  const badgeClass = receipt.verified
    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-500"
    : receipt.state === "FAILED"
      ? "border-destructive/40 bg-destructive/10 text-destructive"
      : "border-gold/40 bg-gold/10 text-gold";

  return (
    <div className="rounded-lg border border-border bg-surface-raised/40 p-4 text-xs">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="flex items-center gap-2 font-semibold uppercase tracking-wide text-gold">
          <AlertTriangle className="size-4" aria-hidden="true" />
          {receipt.header}
        </p>
        <span
          className={`rounded-full border px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide ${badgeClass}`}
        >
          {receipt.stateLabel}
        </span>
      </div>
      <p className="mt-1 text-muted-foreground">
        Launch receipt for attempt #{receipt.attemptNumber}. This is a CARTEL HQ record of a testnet
        deployment attempt — it is not itself an on-chain record and it registers nothing.
      </p>

      <section className="mt-4">
        <h4 className="text-[11px] font-semibold uppercase tracking-wide text-foreground">
          Platform record — what was requested
        </h4>
        <dl className="mt-2 grid gap-x-4 gap-y-1 sm:grid-cols-2">
          <Row label="Attempt" value={`#${receipt.attemptNumber}`} />
          <Row label="Attempt id" value={receipt.attemptId} />
          <Row
            label="Deployment kind"
            value={receipt.isToken ? "Fixed-supply ERC-20" : "Inert test artifact"}
          />
          <Row label="Artifact" value={receipt.artifactId} />
          <Row label="Network" value={`Robinhood Chain Testnet ${receipt.chainId}`} />
          <Row label="Environment" value={receipt.environment} />
          <Row label="Deployer" value={receipt.deployer} />
          {receipt.isToken ? (
            <>
              <Row label="Requested name" value={receipt.requestedName} />
              <Row label="Requested symbol" value={receipt.requestedSymbol} />
              <Row
                label="Requested decimals"
                value={
                  receipt.requestedDecimals === null ? null : String(receipt.requestedDecimals)
                }
              />
              <Row
                label="Requested supply (base units, exact)"
                value={receipt.requestedSupplyBaseUnits}
              />
              <Row label="Requested supply (whole tokens)" value={receipt.requestedSupplyWhole} />
              <Row label="Initial recipient" value={receipt.recipient} />
            </>
          ) : null}
          <Row label="Created" value={receipt.createdAt} />
          <Row label="Submitted" value={receipt.submittedAt} />
          <Row label="Verified at" value={receipt.verifiedAt} />
        </dl>
      </section>

      <section className="mt-4">
        <h4 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-foreground">
          Independently verified on-chain
          {receipt.verified ? (
            <CheckCircle2 className="size-3 text-emerald-500" aria-hidden="true" />
          ) : null}
        </h4>
        <p className="mt-1 text-muted-foreground">
          {receipt.verified
            ? "Confirmed server-side against Robinhood Chain Testnet."
            : "Not yet independently confirmed by the server verifier."}
        </p>
        <dl className="mt-2 grid gap-x-4 gap-y-1 sm:grid-cols-2">
          {receipt.txHash ? (
            <CopyValue label="Transaction hash" value={receipt.txHash} href={receipt.txUrl} />
          ) : (
            <Row label="Transaction hash" value={null} />
          )}
          {receipt.contractAddress ? (
            <CopyValue
              label="Contract address"
              value={receipt.contractAddress}
              href={receipt.contractUrl}
            />
          ) : (
            <Row label="Contract address" value={null} />
          )}
          <Row label="Block number" value={receipt.blockNumber} />
          <Row label="Block hash" value={receipt.blockHash} />
          <Row
            label="Confirmations"
            value={`${receipt.confirmations}/${receipt.requiredConfirmations || REQUIRED_CONFIRMATIONS}`}
          />
          {receipt.isToken ? (
            <>
              <Row label="Verified name" value={receipt.verifiedName} />
              <Row label="Verified symbol" value={receipt.verifiedSymbol} />
              <Row
                label="Verified decimals"
                value={receipt.verifiedDecimals === null ? null : String(receipt.verifiedDecimals)}
              />
              <Row
                label="Verified total supply (base units)"
                value={receipt.verifiedSupplyBaseUnits}
              />
              <Row
                label="Verified recipient balance (base units)"
                value={receipt.verifiedRecipientBalanceBaseUnits}
              />
            </>
          ) : null}
        </dl>
        {receipt.state === "FAILED" ? (
          <p className="mt-2 text-destructive">
            Failure {receipt.failureCode ?? "unknown"}
            {receipt.failureDetail ? ` — ${receipt.failureDetail}` : ""}
          </p>
        ) : null}
        {receipt.state === "ABANDONED" ? (
          <p className="mt-2 text-muted-foreground">
            This attempt was abandoned before or without a confirmed deployment.
            {receipt.failureDetail ? ` ${receipt.failureDetail}` : ""}
          </p>
        ) : null}
      </section>

      {receipt.isToken && receipt.fingerprint ? (
        <section className="mt-4">
          <h4 className="text-[11px] font-semibold uppercase tracking-wide text-foreground">
            Derived evidence
          </h4>
          <p className="mt-1 text-muted-foreground">
            {receipt.fingerprintProvenance === "SESSION"
              ? "As reviewed in this session."
              : "Re-derived from recorded intent."}{" "}
            Never stored in the database.
          </p>
          <dl className="mt-2 grid gap-x-4 gap-y-1 sm:grid-cols-2">
            <CopyValue label="Intent fingerprint" value={receipt.fingerprint} />
            {receipt.initCodeHash ? (
              <CopyValue label="Init code hash" value={receipt.initCodeHash} />
            ) : null}
          </dl>
        </section>
      ) : null}
    </div>
  );
}
