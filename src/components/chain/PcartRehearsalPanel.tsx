import { useState } from "react";
import { toast } from "sonner";
import { FlaskConical, Loader2, RefreshCw } from "lucide-react";
import { Section } from "@/components/cartel/Section";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ROBINHOOD_TESTNET_CHAIN_ID, explorerAddressUrl, explorerTxUrl } from "@/lib/chain-registry";
import {
  abandonDeploymentAttempt,
  broadcastTokenDeployment,
  isUserRejection,
  newClientRequestId,
  submitDeploymentTx,
  type DeploymentRow,
} from "@/lib/chain-launcher";
import {
  PCART_FIXED_INTENT,
  buildPcartInitCode,
  normalizePcartRehearsalRecipient,
} from "@/lib/launch-artifact-registry";
import {
  PcartRehearsalUnavailableError,
  createPcartRehearsalAttempt,
  isPcartRehearsalRow,
} from "@/lib/pcart-rehearsal";

const TERMINAL = new Set(["CONFIRMED", "FAILED", "ABANDONED"]);

/**
 * PCART-L3 — exact-artifact TESTNET rehearsal for the canonical PEPECARTEL
 * launch only. Fixed intent; the only input is a rehearsal recipient. Never
 * the production treasury, never mainnet, never an official contract record,
 * lifecycle change, notification or liquidity action. Evidence list shows
 * PCART rehearsal attempts ONLY; verification is manual (no polling).
 */
export function PcartRehearsalPanel(props: {
  launchId: string;
  account: string | null;
  onTestnet: boolean;
  onChanged: () => Promise<unknown> | void;
  attempts: DeploymentRow[];
  onVerify: (deploymentId: string) => void;
  verifying: boolean;
}) {
  const [recipient, setRecipient] = useState("");
  const [busy, setBusy] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const pcartAttempts = props.attempts.filter(isPcartRehearsalRow);

  let recipientError: string | null = null;
  if (recipient.trim()) {
    try {
      normalizePcartRehearsalRecipient(recipient);
    } catch (e) {
      recipientError = e instanceof Error ? e.message : "Invalid recipient.";
    }
  }
  const canRun =
    !busy && !unavailable && !!props.account && props.onTestnet && !!recipient.trim() && !recipientError;

  async function run() {
    if (!props.account || !canRun) return;
    setBusy(true);
    let attemptId: string | null = null;
    let txHash: string | null = null;
    try {
      const initCode = buildPcartInitCode(recipient);
      const attempt = await createPcartRehearsalAttempt({
        launchId: props.launchId,
        clientRequestId: newClientRequestId(),
        deployerAddress: props.account,
        rehearsalRecipient: recipient,
      });
      attemptId = attempt.id;
      await props.onChanged();
      txHash = await broadcastTokenDeployment(props.account, initCode);
      await submitDeploymentTx(attempt.id, txHash);
      await props.onChanged();
      toast.success("Rehearsal broadcast on testnet. Verify it once it is mined.");
    } catch (e) {
      if (e instanceof PcartRehearsalUnavailableError) {
        setUnavailable(true);
        toast.error(e.message);
      } else if (attemptId && !txHash) {
        try {
          await abandonDeploymentAttempt(
            attemptId,
            isUserRejection(e) ? "Cancelled in wallet" : "Wallet request ended before broadcast",
          );
          await props.onChanged();
        } catch {
          /* history is never rewritten */
        }
        toast.info("Rehearsal not broadcast. The draft attempt was abandoned.");
      } else {
        toast.error(e instanceof Error ? e.message : "Rehearsal failed.");
      }
    } finally {
      setBusy(false);
    }
  }

  const rows: Array<[string, string]> = [
    ["Artifact", PCART_FIXED_INTENT.artifactId],
    ["Name", PCART_FIXED_INTENT.name],
    ["Symbol", PCART_FIXED_INTENT.symbol],
    ["Decimals", String(PCART_FIXED_INTENT.decimals)],
    ["Total supply", `${PCART_FIXED_INTENT.totalSupplyWhole.toLocaleString("en-US")} PCART`],
    ["Creation hash", PCART_FIXED_INTENT.creationHash],
    ["Runtime hash", PCART_FIXED_INTENT.runtimeHash],
  ];

  return (
    <Section
      variant="primary"
      title="PCART exact-artifact rehearsal — testnet only"
      description={`Deploys the frozen PEPECARTEL artifact to Robinhood Chain Testnet ${ROBINHOOD_TESTNET_CHAIN_ID} as rehearsal evidence.`}
      actions={
        <Button size="sm" onClick={() => void run()} disabled={!canRun}>
          {busy ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <FlaskConical className="size-4" aria-hidden="true" />
          )}
          Run PCART rehearsal
        </Button>
      }
    >
      <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-xs leading-relaxed">
        <p className="font-semibold uppercase tracking-wide text-destructive">
          Testnet rehearsal — not the official PEPECARTEL token
        </p>
        <p className="mt-1 text-muted-foreground">
          The recipient below is a rehearsal wallet, NOT the production treasury. Nothing here
          registers an official contract address, changes the launch lifecycle, sends
          notifications or creates liquidity.
        </p>
      </div>
      <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
        {rows.map(([k, v]) => (
          <div key={k} className="min-w-0 rounded-md border border-border p-2">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="mt-0.5 font-mono text-foreground [overflow-wrap:anywhere]">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-3 flex flex-col gap-1">
        <label htmlFor="pcart-rehearsal-recipient" className="text-xs font-medium text-muted-foreground">
          Rehearsal recipient (testnet only, not the treasury)
        </label>
        <Input
          id="pcart-rehearsal-recipient"
          placeholder="0x…"
          value={recipient}
          onChange={(e) => setRecipient(e.target.value)}
        />
        {recipientError ? <p className="text-xs text-destructive">{recipientError}</p> : null}
        {unavailable ? (
          <p className="text-xs text-destructive">
            The PCART rehearsal path is not enabled on the database yet. Nothing was created or
            broadcast.
          </p>
        ) : null}
        {!props.onTestnet && props.account ? (
          <p className="text-xs text-destructive">
            Switch the wallet to chain {ROBINHOOD_TESTNET_CHAIN_ID} first.
          </p>
        ) : null}
      </div>

      <div className="mt-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          PCART rehearsal evidence
        </p>
        {pcartAttempts.length === 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">No PCART rehearsal attempt yet.</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-2">
            {pcartAttempts.map((a) => (
              <li key={a.id} className="rounded-md border border-border p-3 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-foreground">
                    Attempt #{a.attempt_number} · {a.status}
                  </span>
                  <span className="text-muted-foreground">{a.confirmations} confirmations</span>
                </div>
                <p className="mt-1 break-all text-muted-foreground">
                  Recipient (rehearsal): {a.token_recipient}
                </p>
                {a.tx_hash ? (
                  <p className="mt-1 break-all text-muted-foreground">
                    Tx:{" "}
                    <a className="text-gold underline" href={explorerTxUrl(a.tx_hash)} target="_blank" rel="noreferrer">
                      {a.tx_hash}
                    </a>
                  </p>
                ) : null}
                {a.contract_address ? (
                  <p className="mt-1 break-all text-muted-foreground">
                    Verified rehearsal contract (testnet):{" "}
                    <a className="text-gold underline" href={explorerAddressUrl(a.contract_address)} target="_blank" rel="noreferrer">
                      {a.contract_address}
                    </a>
                  </p>
                ) : null}
                {a.failure_detail ? <p className="mt-1 text-destructive">{a.failure_detail}</p> : null}
                {!TERMINAL.has(a.status) && a.tx_hash ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-2 min-h-11"
                    disabled={props.verifying}
                    onClick={() => props.onVerify(a.id)}
                  >
                    <RefreshCw className="size-4" aria-hidden="true" />
                    Check verification
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-muted-foreground">
          Verification is manual and runs only when you click it. No automatic polling.
        </p>
      </div>
    </Section>
  );
}
