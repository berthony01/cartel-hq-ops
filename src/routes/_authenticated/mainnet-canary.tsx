import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, Loader2, Lock, ShieldAlert } from "lucide-react";
import { PageHeader } from "@/components/cartel/PageHeader";
import { Section } from "@/components/cartel/Section";
import { EmptyState } from "@/components/cartel/EmptyState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ARM_PHRASE,
  Readout,
  ReadoutLine,
  SEND_PHRASE,
  useBusy,
} from "@/components/cartel/CanaryReadout";
import { usePlatformAccess } from "@/hooks/usePlatformAccess";
import { useWorkspace } from "@/lib/workspace-context";
import { listLaunches } from "@/lib/launch-control";
import {
  MAINNET_DEPLOYMENT_TX_ENABLED,
  MAINNET_LIQUIDITY_TX_ENABLED,
  ROBINHOOD_MAINNET_CHAIN_ID,
} from "@/lib/chain-mainnet-registry";
import {
  buildMainnetSimulationIntent,
  type MainnetSimulationIntent,
} from "@/lib/chain-mainnet-simulation";
import {
  armCanaryExecution,
  createCanaryDeploymentAttempt,
  engageCanaryEmergencyStop,
  readCanaryExecutionState,
  type CanaryExecutionStateResult,
} from "@/lib/chain-mainnet-canary.functions";
import { presignMainnetTokenDeployment } from "@/lib/chain-mainnet-presign.functions";
import {
  authorizeMainnetSendWindow,
  claimMainnetDeploymentHandoff,
  persistMainnetDeploymentTxHash,
} from "@/lib/chain-mainnet-handoff.functions";
import { getMainnetDeploymentReconciliationSnapshot } from "@/lib/chain-mainnet-reconciliation.functions";
import { verifyMainnetChainDeployment } from "@/lib/chain-mainnet-verify.functions";
import { sendClaimedMainnetDeployment } from "@/lib/chain-mainnet-wallet";

/**
 * P3C-F — OWNER-ONLY Robinhood Chain PRODUCTION canary orchestration.
 *
 * This surface only INVOKES the already-hardened pipeline. It contains no
 * authority of its own: every stage is a manual owner click, nothing runs on
 * render or on an interval, there is no auto-advance, no retry, no rebroadcast,
 * no batch mode, no liquidity and no registration action. Owner visibility is
 * a convenience; the server wrappers and RLS are the boundary.
 */

function CanaryConsole() {
  const { workspaceId } = useWorkspace();

  const launches = useQuery({
    queryKey: ["canary-launches", workspaceId],
    queryFn: () => listLaunches(workspaceId as string),
    enabled: !!workspaceId,
  });

  const readState = useServerFn(readCanaryExecutionState);
  const createAttempt = useServerFn(createCanaryDeploymentAttempt);
  const presign = useServerFn(presignMainnetTokenDeployment);
  const claim = useServerFn(claimMainnetDeploymentHandoff);
  const arm = useServerFn(armCanaryExecution);
  const sendWindow = useServerFn(authorizeMainnetSendWindow);
  const persist = useServerFn(persistMainnetDeploymentTxHash);
  const reconcile = useServerFn(getMainnetDeploymentReconciliationSnapshot);
  const verify = useServerFn(verifyMainnetChainDeployment);
  const stop = useServerFn(engageCanaryEmergencyStop);

  const { busy, run } = useBusy();

  const [launchId, setLaunchId] = useState("");
  const [deployer, setDeployer] = useState("");
  const [recipient, setRecipient] = useState("");
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [supply, setSupply] = useState("");
  const [armPhrase, setArmPhrase] = useState("");
  const [sendPhrase, setSendPhrase] = useState("");
  const [stopReason, setStopReason] = useState("");

  const [control, setControl] = useState<CanaryExecutionStateResult | null>(null);
  const [intent, setIntent] = useState<MainnetSimulationIntent | null>(null);
  const [intentError, setIntentError] = useState<string | null>(null);
  const [deploymentId, setDeploymentId] = useState<string | null>(null);
  const [authorizationId, setAuthorizationId] = useState<string | null>(null);
  const [quote, setQuote] = useState<unknown>(null);
  const [claimed, setClaimed] = useState<unknown>(null);
  const [armed, setArmed] = useState<unknown>(null);
  const [windowResult, setWindowResult] = useState<{
    envelope: unknown;
    sendWindowExpiresAt: string | null;
    ok: boolean;
    notice: string | null;
  } | null>(null);
  const [sendResult, setSendResult] = useState<unknown>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [tail, setTail] = useState<unknown>(null);
  const [log, setLog] = useState<string[]>([]);

  const note = (message: string) =>
    setLog((prev) => [`${new Date().toISOString()} — ${message}`, ...prev].slice(0, 30));

  const selected = useMemo(
    () => (launches.data ?? []).find((row) => row.id === launchId) ?? null,
    [launches.data, launchId],
  );

  const hasActiveState = !!deploymentId || !!authorizationId;
  const armReady = armPhrase === ARM_PHRASE;
  const sendReady =
    sendPhrase === SEND_PHRASE &&
    windowResult?.ok === true &&
    !!windowResult.envelope &&
    typeof windowResult.sendWindowExpiresAt === "string";

  const buildIntent = () => {
    setIntentError(null);
    try {
      const built = buildMainnetSimulationIntent({
        deployer,
        recipient,
        name,
        symbol,
        supplyWhole: supply,
      });
      setIntent(built);
      note("Intent built (pure, local, nothing persisted).");
    } catch (error) {
      setIntent(null);
      setIntentError(error instanceof Error ? error.message : "Check the token details.");
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Owner only"
        title="Mainnet Canary"
        description="One controlled Robinhood Chain production deployment. Real ETH is spent when the final send is executed."
        status={`Chain ${ROBINHOOD_MAINNET_CHAIN_ID}`}
      />

      <Section
        variant="primary"
        leading={<AlertTriangle className="h-4 w-4 text-danger" />}
        title="Robinhood Chain MAINNET — real value"
        description="Every stage below is manual. Nothing here runs automatically, retries, rebroadcasts or adds liquidity."
      >
        <div className="grid gap-1 sm:grid-cols-2">
          <ReadoutLine label={"Deployment capability"} value={MAINNET_DEPLOYMENT_TX_ENABLED ? "COMPILED IN" : "OFF"} />
          <ReadoutLine label={"Liquidity capability"} value={MAINNET_LIQUIDITY_TX_ENABLED ? "ON" : "OFF"} />
          <ReadoutLine label={"Runtime execution"} value={control?.executionEnabled ?? "unknown"} />
          <ReadoutLine label={"Emergency stop"} value={control?.emergencyStopEngaged ?? "unknown"} />
          <ReadoutLine label={"Control revision"} value={control?.revision ?? "unknown"} />
          <ReadoutLine label={"Control reason"} value={control?.reason ?? "unknown"} />
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={busy !== null}
            onClick={() =>
              run("state", async () => {
                const result = await readState({ data: undefined });
                setControl(result);
                note(`Runtime state read (${result.notice ?? "ok"}).`);
              })
            }
          >
            {busy === "state" ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
            Read runtime state
          </Button>
        </div>
      </Section>

      {hasActiveState ? (
        <Section
          variant="surface"
          leading={<ShieldAlert className="h-4 w-4 text-danger" />}
          title="Emergency stop"
          description="One-way. It engages the production stop and can never clear it or re-arm."
        >
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              value={stopReason}
              onChange={(event) => setStopReason(event.target.value)}
              placeholder="Reason (min 8 characters)"
            />
            <Button
              variant="destructive"
              disabled={busy !== null || stopReason.trim().length < 8}
              onClick={() =>
                run("stop", async () => {
                  const result = await stop({ data: { reason: stopReason.trim() } });
                  setControl({
                    ok: result.ok,
                    notice: result.notice,
                    controlKey: null,
                    executionEnabled: result.executionEnabled,
                    emergencyStopEngaged: result.emergencyStopEngaged,
                    revision: result.revision,
                    reason: result.reason,
                    updatedAt: null,
                  });
                  note(`EMERGENCY STOP requested (${result.notice ?? "engaged"}).`);
                })
              }
            >
              EMERGENCY STOP
            </Button>
          </div>
        </Section>
      ) : null}

      <Section
        variant="surface"
        title="A — Exact production intent"
        description="One launch only. Identity is bound immutably to the attempt row."
      >
        <CanaryIntentForm
          launches={launches.data ?? []}
          launchId={launchId}
          onSelectLaunch={(id) => {
            setLaunchId(id);
            const row = (launches.data ?? []).find((item) => item.id === id);
            if (row) {
              setName(row.token_name ?? "");
              // Display ticker is NEVER mutated; only this input is prefilled.
              setSymbol(deriveCanaryOnchainSymbol(row.ticker));
            }
          }}
          deployer={deployer}
          onDeployer={setDeployer}
          recipient={recipient}
          onRecipient={setRecipient}
          name={name}
          onName={setName}
          symbol={symbol}
          onSymbol={setSymbol}
          supplyWhole={supply}
          onSupplyWhole={setSupply}
          selectedChain={selected?.chain ?? null}
          chainEligible={chainEligible}
        />

        {intentError ? <p className="mt-2 text-xs text-danger">{intentError}</p> : null}

        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={buildIntent} disabled={busy !== null}>
            Build intent
          </Button>
          <Button
            size="sm"
            disabled={busy !== null || !intent || !launchId || !chainEligible || !!deploymentId}
            onClick={() =>
              run("attempt", async () => {
                if (!intent || !chainEligible) return;
                const result = await createAttempt({
                  data: {
                    launchId,
                    deployerAddress: intent.deployer,
                    tokenRecipient: intent.recipient,
                    tokenName: intent.name,
                    tokenSymbol: intent.symbol,
                    // BASE UNITS. Exact decimal string, never whole tokens.
                    tokenTotalSupplyBaseUnits: intent.totalSupplyBaseUnits,
                    initCodeHash: intent.initCodeHash,
                    reviewFingerprint: intent.fingerprint,
                    clientRequestId: `canary-${crypto.randomUUID()}`,
                  },
                });
                setDeploymentId(result.deploymentId);
                note(`Attempt: ${result.notice ?? result.status ?? "created"}.`);
              })
            }
          >
            {busy === "attempt" ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
            Create production attempt
          </Button>
        </div>


        {intent ? (
          <div className="mt-3 grid gap-1 sm:grid-cols-2">
            <ReadoutLine label={"Deployer"} value={intent.deployer} />
            <ReadoutLine label={"Recipient"} value={intent.recipient} />
            <ReadoutLine label={"Supply (whole)"} value={intent.supplyWhole} />
            <ReadoutLine label={"Base units"} value={intent.totalSupplyBaseUnits} />
            <ReadoutLine label={"Init code hash"} value={intent.initCodeHash} />
            <ReadoutLine label={"Review fingerprint"} value={intent.fingerprint} />
            <ReadoutLine label={"Launch"} value={selected?.public_slug ?? "—"} />
            <ReadoutLine label={"Deployment id"} value={deploymentId} />
          </div>
        ) : null}
      </Section>

      <Section
        variant="surface"
        title="B — Managed pre-sign and economic evidence"
        description="Server-side managed RPC simulation, gas, fees and balance. Issues an authorization; nothing is sendable yet."
      >
        <Button
          size="sm"
          disabled={busy !== null || !deploymentId}
          onClick={() =>
            run("presign", async () => {
              if (!deploymentId) return;
              const result = await presign({
                data: { deploymentId, clientRequestId: `presign-${crypto.randomUUID()}` },
              });
              setQuote(result);
              setAuthorizationId(result.authorizationId);
              note(`Presign: ${result.notice ?? "issued"}.`);
            })
          }
        >
          {busy === "presign" ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
          Run managed pre-sign
        </Button>
        <Readout value={quote} />
      </Section>

      <Section
        variant="surface"
        title="C–E — Typed confirmation, claim and arm"
        description={`Type exactly "${ARM_PHRASE}" to unlock CLAIM and ARM. Each is a separate explicit click.`}
      >
        <Input
          value={armPhrase}
          onChange={(event) => setArmPhrase(event.target.value)}
          placeholder={ARM_PHRASE}
          className="max-w-md font-mono"
        />
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            size="sm"
            disabled={busy !== null || !armReady || !deploymentId || !authorizationId}
            onClick={() =>
              run("claim", async () => {
                if (!deploymentId || !authorizationId) return;
                const result = await claim({ data: { deploymentId, authorizationId } });
                setClaimed(result);
                note(`Claim: ${result.notice ?? "claimed"}.`);
              })
            }
          >
            {busy === "claim" ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
            Claim authorization
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={
              busy !== null ||
              !armReady ||
              !deploymentId ||
              !authorizationId ||
              typeof control?.revision !== "number"
            }
            onClick={() =>
              run("arm", async () => {
                if (!deploymentId || !authorizationId || typeof control?.revision !== "number") return;
                const result = await arm({
                  data: {
                    deploymentId,
                    authorizationId,
                    expectedControlRevision: control.revision,
                    reason: "Owner-authorized first production canary.",
                  },
                });
                setArmed(result);
                note(`Arm: ${result.notice ?? "requested"}.`);
              })
            }
          >
            {busy === "arm" ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
            Arm this authorization
          </Button>
        </div>
        <Readout value={{ claimed, armed }} />
      </Section>

      <Section
        variant="surface"
        title="F — Final send window and one-shot send"
        description="The server issues a short-lived envelope. The wallet is only ever prompted by the explicit send click below."
      >
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={busy !== null || !deploymentId || !authorizationId}
            onClick={() =>
              run("window", async () => {
                if (!deploymentId || !authorizationId) return;
                const result = await sendWindow({ data: { deploymentId, authorizationId } });
                setWindowResult({
                  ok: result.ok,
                  notice: result.notice,
                  envelope: result.envelope,
                  sendWindowExpiresAt: result.sendWindowExpiresAt,
                });
                note(`Send window: ${result.notice ?? "issued"}.`);
              })
            }
          >
            {busy === "window" ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
            Issue final send window
          </Button>
        </div>

        <Input
          value={sendPhrase}
          onChange={(event) => setSendPhrase(event.target.value)}
          placeholder={SEND_PHRASE}
          className="mt-3 max-w-md font-mono"
        />
        <p className="mt-2 text-xs text-muted-foreground">
          One wallet request. No retry and no rebroadcast: if the outcome is ambiguous the attempt
          freezes for reconciliation.
        </p>
        <Button
          variant="destructive"
          className="mt-2"
          disabled={busy !== null || !sendReady}
          onClick={() =>
            run("send", async () => {
              if (!windowResult?.envelope || !windowResult.sendWindowExpiresAt) return;
              const result = await sendClaimedMainnetDeployment({
                envelope: windowResult.envelope as never,
                sendWindowExpiresAt: windowResult.sendWindowExpiresAt,
              });
              setSendResult(result);
              setWindowResult(null);
              setSendPhrase("");
              if (result.txHash) setTxHash(result.txHash);
              note(`Send: phase ${result.phase}, ${result.notice ?? "hash known"}.`);
            })
          }
        >
          Send one mainnet deployment
        </Button>
        <Readout value={sendResult} />
      </Section>

      <Section
        variant="surface"
        title="G — Persist, reconcile, verify"
        description="Record the exact hash once, then read managed reconciliation and finality. Official contract registration stays separate in Launch Control."
      >
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            disabled={busy !== null || !deploymentId || !authorizationId || !txHash}
            onClick={() =>
              run("persist", async () => {
                if (!deploymentId || !authorizationId || !txHash) return;
                const result = await persist({ data: { deploymentId, authorizationId, txHash } });
                setTail(result);
                note(`Persist: ${result.notice ?? "recorded"}.`);
              })
            }
          >
            {busy === "persist" ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
            Persist tx hash once
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy !== null || !deploymentId}
            onClick={() =>
              run("reconcile", async () => {
                if (!deploymentId) return;
                setTail(await reconcile({ data: { deploymentId } }));
                note("Reconciliation snapshot read.");
              })
            }
          >
            Reconciliation snapshot
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy !== null || !deploymentId}
            onClick={() =>
              run("verify", async () => {
                if (!deploymentId) return;
                setTail(await verify({ data: { deploymentId } }));
                note("Verifier run.");
              })
            }
          >
            Verify and finalize
          </Button>
        </div>
        <Readout value={tail} />
      </Section>

      {log.length ? (
        <Section variant="quiet" title="Operator log">
          <ul className="space-y-1 font-mono text-[11px] text-muted-foreground">
            {log.map((entry) => (
              <li key={entry}>{entry}</li>
            ))}
          </ul>
        </Section>
      ) : null}
    </div>
  );
}

function MainnetCanaryPage() {
  const { isPlatformOwner, loading } = usePlatformAccess({ fresh: true });

  if (loading) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Checking access…
      </div>
    );
  }

  if (!isPlatformOwner) {
    return (
      <EmptyState
        icon={Lock}
        title="Owner only"
        description="This surface is restricted to the platform owner. Server authorization is re-checked on every action."
      />
    );
  }

  return <CanaryConsole />;
}

export const Route = createFileRoute("/_authenticated/mainnet-canary")({
  head: () => ({
    meta: [
      { title: "Mainnet Canary — CARTEL HQ" },
      {
        name: "description",
        content:
          "Owner-only controlled Robinhood Chain production canary console for CARTEL HQ launches.",
      },
      { property: "og:title", content: "Mainnet Canary — CARTEL HQ" },
      {
        property: "og:description",
        content:
          "Owner-only controlled Robinhood Chain production canary console for CARTEL HQ launches.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: MainnetCanaryPage,
});
