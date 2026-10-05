import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, Circle, ShieldAlert, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { DeploymentRow } from "@/lib/chain-launcher";
import { PCART_P6_NOT_OFFICIAL_COPY } from "@/lib/pcart-production-verify";
import { checkPcartProductionFinality, verifyPcartProductionDeployment } from "@/lib/pcart-production-verify.functions";

/** PCART P6 — manual post-broadcast verification. Never sends, signs, or registers. */
export function PcartVerificationPanel({
  attempt,
  predictedAddress,
  onChanged,
}: {
  attempt: DeploymentRow;
  predictedAddress: string | null;
  onChanged: () => void;
}) {
  const verifyFn = useServerFn(verifyPcartProductionDeployment);
  const finalityFn = useServerFn(checkPcartProductionFinality);
  const verify = useMutation({ mutationFn: () => verifyFn({ data: { deploymentId: attempt.id } }), onSettled: onChanged });
  const finality = useMutation({ mutationFn: () => finalityFn({ data: { deploymentId: attempt.id } }), onSettled: onChanged });
  const last = finality.data ?? verify.data;

  if (attempt.status === "DRAFT") {
    return (
      <div className="rounded-md border border-border bg-card/40 p-3 text-xs text-muted-foreground">
        P6 — Verification becomes available after mainnet broadcast.
      </div>
    );
  }

  const confirmed = attempt.status === "CONFIRMED";
  const finalized = confirmed && attempt.finality_state === "FINALIZED";
  const failed = attempt.status === "FAILED";
  const items: [string, boolean][] = [
    ["Transaction intent", confirmed],
    ["Successful receipt", confirmed],
    ["Predicted contract address", confirmed],
    ["Runtime bytecode", confirmed],
    ["Token name / symbol / decimals / supply", confirmed],
    ["Full initial supply delivered to Treasury Safe at deployment block", confirmed],
    ["Deployer initial token balance 0", confirmed],
    ["Provider finality", finalized],
  ];

  return (
    <section className="space-y-3 rounded-md border border-border bg-card/60 p-4" aria-label="P6 — Verify mainnet deployment">
      <h4 className="flex items-center gap-2 text-sm font-semibold">
        {failed ? <ShieldAlert className="h-4 w-4 text-destructive" /> : <ShieldCheck className="h-4 w-4 text-primary" />}
        P6 — Verify mainnet deployment
      </h4>
      {finalized ? (
        <p className="text-sm font-semibold text-primary">PCART CONTRACT VERIFIED &amp; FINALIZED — NOT YET OFFICIAL</p>
      ) : null}
      {failed ? (
        <p className="text-sm font-semibold text-destructive">
          Deployment verification failed ({attempt.failure_code ?? "UNKNOWN"}). Do not retry deployment — stop and review.
        </p>
      ) : null}
      <dl className="grid gap-1 text-xs">
        <div><dt className="inline text-muted-foreground">Status: </dt><dd className="inline font-mono">{attempt.status}{confirmed ? ` · ${attempt.finality_state}` : ""}</dd></div>
        <div className="break-all"><dt className="inline text-muted-foreground">Transaction: </dt><dd className="inline font-mono">{attempt.tx_hash ?? "—"}</dd></div>
        <div className="break-all"><dt className="inline text-muted-foreground">{confirmed ? "Contract: " : "Predicted address: "}</dt><dd className="inline font-mono">{attempt.contract_address ?? predictedAddress ?? "—"}</dd></div>
      </dl>
      {!failed ? (
        <ul className="space-y-1 text-xs">
          {items.map(([label, ok]) => (
            <li key={label} className="flex items-center gap-2">
              {ok ? <CheckCircle2 className="h-3.5 w-3.5 text-primary" /> : <Circle className="h-3.5 w-3.5 text-muted-foreground" />}
              {label}
            </li>
          ))}
        </ul>
      ) : null}
      {(attempt.status === "SUBMITTED" || attempt.status === "PENDING") ? (
        <Button size="sm" onClick={() => verify.mutate()} disabled={verify.isPending}>
          {verify.isPending ? "Verifying…" : "Verify deployment"}
        </Button>
      ) : null}
      {confirmed && !finalized ? (
        <Button size="sm" onClick={() => finality.mutate()} disabled={finality.isPending}>
          {finality.isPending ? "Checking…" : "Check finality"}
        </Button>
      ) : null}
      {last ? (
        <p className="text-xs text-muted-foreground">
          Last check: {last.ok ? `${last.outcome}${"reason" in last && last.reason ? ` (${last.reason})` : ""}${"failureCode" in last && last.failureCode ? ` — ${last.failureCode}` : ""}` : last.reason}
        </p>
      ) : null}
      <p className="text-xs text-muted-foreground">{PCART_P6_NOT_OFFICIAL_COPY}</p>
    </section>
  );
}
