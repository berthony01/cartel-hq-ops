import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { BadgeCheck, Copy, ExternalLink } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { DeploymentRow } from "@/lib/chain-launcher";
import { mainnetExplorerAddressUrl } from "@/lib/chain-mainnet-registry";
import {
  classifyPcartP7,
  pcartP7ConfirmMatches,
  PCART_P7_BUTTON_COPY,
  PCART_P7_CHECKBOX_COPY,
  PCART_P7_SUCCESS_COPY,
  PCART_P7_WARNING_COPY,
} from "@/lib/pcart-production-register";
import { registerCanonicalPcartOfficialContract } from "@/lib/pcart-production-register.functions";

/** PCART P7 — official registration. Never sends, signs, goes LIVE or notifies. */
export function PcartOfficialRegistrationPanel({
  attempt,
  launch,
  onChanged,
}: {
  attempt: DeploymentRow;
  launch: { id: string; status: string | null; official_contract_address: string | null; official_contract_deployment_id: string | null };
  onChanged: () => void;
}) {
  const registerFn = useServerFn(registerCanonicalPcartOfficialContract);
  const [ack, setAck] = useState(false);
  const [typed, setTyped] = useState("");
  const [copied, setCopied] = useState(false);
  const state = classifyPcartP7({
    status: attempt.status,
    finalityState: attempt.finality_state,
    contractAddress: attempt.contract_address,
    launchStatus: launch.status,
    officialContractAddress: launch.official_contract_address,
    officialContractDeploymentId: launch.official_contract_deployment_id,
    deploymentId: attempt.id,
  });
  const reg = useMutation({
    mutationFn: (address: string) => registerFn({ data: { launchId: launch.id, deploymentId: attempt.id, expectedAddress: address } }),
    onSettled: onChanged,
  });
  const copy = async (a: string) => {
    try { await navigator.clipboard.writeText(a); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* ignore */ }
  };

  if (state.kind === "INERT") {
    return (
      <div className="rounded-md border border-border bg-card/40 p-3 text-xs text-muted-foreground">
        P7 — Official registration. {state.reason}
      </div>
    );
  }
  if (state.kind === "CONFLICT") {
    return (
      <div className="rounded-md border border-destructive/50 bg-destructive/5 p-3 text-xs text-destructive">
        P7 — A different or incomplete official binding exists. P7 never corrects or replaces it. Stop and review.
      </div>
    );
  }
  if (state.kind === "REGISTERED") {
    return (
      <section className="space-y-2 rounded-md border border-border bg-card/60 p-4" aria-label="P7 — Official PCART contract">
        <p className="text-sm font-semibold text-primary">{PCART_P7_SUCCESS_COPY}</p>
        <p className="break-all font-mono text-xs">{state.address}</p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => copy(state.address)}><Copy className="h-3.5 w-3.5" />{copied ? "Copied" : "Copy official address"}</Button>
          <Button size="sm" variant="outline" asChild>
            <a href={mainnetExplorerAddressUrl(state.address)} target="_blank" rel="noreferrer"><ExternalLink className="h-3.5 w-3.5" />Explorer</a>
          </Button>
        </div>
      </section>
    );
  }

  const address = state.address;
  const matches = pcartP7ConfirmMatches(typed, address);
  const last = reg.data;
  return (
    <section className="space-y-3 rounded-md border border-border bg-card/60 p-4" aria-label="P7 — Register official PCART contract">
      <h4 className="flex items-center gap-2 text-sm font-semibold">
        P7 — Register official PCART contract
        <span className="inline-flex items-center gap-1 rounded border border-primary/50 px-1.5 py-0.5 text-[10px] uppercase text-primary"><BadgeCheck className="h-3 w-3" />Verified &amp; finalized</span>
      </h4>
      <dl className="grid gap-1 text-xs">
        <div className="break-all"><dt className="inline text-muted-foreground">Verified contract: </dt><dd className="inline font-mono">{address}</dd></div>
        <div className="break-all"><dt className="inline text-muted-foreground">Transaction: </dt><dd className="inline font-mono">{attempt.tx_hash ?? "—"}</dd></div>
        <div><dt className="inline text-muted-foreground">Deployment block: </dt><dd className="inline font-mono">{attempt.block_number ?? "—"}</dd></div>
        <div className="break-all"><dt className="inline text-muted-foreground">Treasury Safe: </dt><dd className="inline font-mono">{attempt.token_recipient ?? "—"}</dd></div>
      </dl>
      <Button size="sm" variant="outline" onClick={() => copy(address)}><Copy className="h-3.5 w-3.5" />{copied ? "Copied" : "Copy verified address"}</Button>
      <p className="text-xs text-muted-foreground">{PCART_P7_WARNING_COPY}</p>
      <label className="flex items-start gap-2 text-xs">
        <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5" />
        {PCART_P7_CHECKBOX_COPY}
      </label>
      <Input
        aria-label="Confirm verified contract address"
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
        placeholder="Type or paste the verified address"
        autoComplete="off"
        spellCheck={false}
      />
      <Button size="sm" disabled={!ack || !matches || reg.isPending} onClick={() => reg.mutate(address)}>
        {reg.isPending ? "Registering…" : PCART_P7_BUTTON_COPY}
      </Button>
      {last && !last.ok ? <p className="text-xs text-destructive">Refused: {last.reason}</p> : null}
    </section>
  );
}
