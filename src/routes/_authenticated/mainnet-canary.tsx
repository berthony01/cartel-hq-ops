import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, Loader2, Lock, ShieldAlert, ShieldCheck } from "lucide-react";
import { PageHeader } from "@/components/cartel/PageHeader";
import { Section } from "@/components/cartel/Section";
import { EmptyState } from "@/components/cartel/EmptyState";
import { CanaryIntentForm } from "@/components/cartel/CanaryIntentForm";
import { DeploymentWalletConnect } from "@/components/cartel/DeploymentWalletConnect";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  deriveCanaryOnchainSymbol,
  isRobinhoodChainLaunchMetadata,
} from "@/lib/chain-mainnet-canary-intent";
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
  readCanaryExistingAttempt,
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

/** Browser-local, non-authoritative memory of the selected launch id only. */
const LAUNCH_SELECTION_STORAGE_KEY = "cartel-hq:mainnet-canary:selected-launch";

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

  const [armSuccess, setArmSuccess] = useState(false);
  const [claimSuccess, setClaimSuccess] = useState(false);

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

  const chainEligible = isRobinhoodChainLaunchMetadata(selected?.chain);

  /**
   * LOCAL UI CONTEXT ONLY. A mobile wallet hand-off can remount this route, and
   * losing the selected launch also silently loses the existing-attempt lookup.
   * Only the launch id is remembered, only in this browser's localStorage,
   * and only if it still exists in the operator's current launch list.
   *
   * Restoring is NOT resuming: it never builds intent, never creates, presigns,
   * arms, claims, sends, persists or verifies anything, never touches the wallet
   * account and never changes a network. It only re-enables the READ-ONLY
   * existing-attempt lookup, whose immutable deployer/recipient still win.
   */
  const selectLaunch = (id: string) => {
    setLaunchId(id);
    if (typeof window === "undefined") return;
    try {
      if (id) window.localStorage.setItem(LAUNCH_SELECTION_STORAGE_KEY, id);
      else window.localStorage.removeItem(LAUNCH_SELECTION_STORAGE_KEY);
    } catch {
      // Storage being unavailable is never fatal: selection stays in memory.
    }
  };

  useEffect(() => {
    if (launchId) return;
    if (typeof window === "undefined") return;
    const rows = launches.data;
    if (!rows) return;
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(LAUNCH_SELECTION_STORAGE_KEY);
    } catch {
      stored = null;
    }
    if (!stored) return;
    const row = rows.find((item) => item.id === stored) ?? null;
    if (!row) {
      try {
        window.localStorage.removeItem(LAUNCH_SELECTION_STORAGE_KEY);
      } catch {
        /* ignore */
      }
      return;
    }
    setLaunchId(row.id);
    setName(row.token_name ?? "");
    setSymbol(deriveCanaryOnchainSymbol(row.ticker));
  }, [launches.data, launchId]);

  /**
   * READ-ONLY awareness of an existing nonterminal production attempt for the
   * selected launch. Nothing here creates, mutates or advances any stage, and
   * nothing is auto-resumed: the operator must click Resume explicitly.
   */
  const readExisting = useServerFn(readCanaryExistingAttempt);
  const existing = useQuery({
    queryKey: ["canary-existing-attempt", launchId],
    queryFn: () => readExisting({ data: { launchId } }),
    enabled: !!launchId,
    retry: false,
  });
  const existingAttempt = existing.data?.attempt ?? null;
  /**
   * FAIL CLOSED. Only an explicit successful lookup (ok === true) counts as a
   * verified answer. Loading, errors, refused reads and notices are all treated
   * as "unverified", which BLOCKS creating a new production attempt.
   */
  const existingVerified = !!launchId && existing.isSuccess && existing.data?.ok === true;
  const existingUnverified = !!launchId && !existingVerified;
  const existingNotice =
    existing.data && existing.data.ok !== true
      ? (existing.data.notice ?? "LOOKUP_REFUSED")
      : existing.isError
        ? "LOOKUP_ERROR"
        : null;
  const existingDetail = existing.data?.detail ?? null;
  const attemptBlocksCreation = existingUnverified || existingAttempt !== null;

  /**
   * DERIVED UI CONTEXT ONLY. A verified nonterminal existing attempt supplies its
   * immutable deployment id for continuation, so the operator never lands on a
   * dead-end after a wallet hand-off. This is pure derivation: no server call, no
   * mutation, no stage advancement and no wallet action happens because of it.
   */
  const activeDeploymentId = deploymentId ?? existingAttempt?.deploymentId ?? null;

  const hasActiveState = !!activeDeploymentId || !!authorizationId;

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

      <div className="rounded-md border border-border/40 bg-surface-raised/40 p-2 text-[11px] font-mono text-foreground">
        Intent → Attempt → Presign → Arm → Claim → Send Window → Send → Persist/Verify
      </div>

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

      {launchId && !existingAttempt ? (
        <Section
          variant="surface"
          leading={
            existingUnverified ? (
              <AlertTriangle className="h-4 w-4 text-danger" />
            ) : (
              <ShieldCheck className="h-4 w-4 text-success" />
            )
          }
          title={
            existing.isPending || existing.isFetching
              ? "Checking existing production attempt…"
              : existingVerified
                ? "No existing production attempt for this launch"
                : "Existing-attempt check could not be verified"
          }
          description={
            existingVerified
              ? "Verified read: no nonterminal Robinhood Chain production attempt exists for this launch."
              : "Fail closed: an unverified lookup is never treated as “no attempt”. Creating a production attempt stays blocked."
          }
        >
          {existingUnverified ? (
            <div className="grid gap-1 sm:grid-cols-2">
              <ReadoutLine label={"Lookup state"} value={existingNotice ?? "PENDING"} />
              <ReadoutLine label={"Detail"} value={existingDetail} />
            </div>
          ) : null}
        </Section>
      ) : null}

      {existingAttempt ? (

        <Section
          variant="surface"
          leading={<AlertTriangle className="h-4 w-4 text-danger" />}
          title={`Existing production attempt #${existingAttempt.attemptNumber} found`}
          description="A nonterminal Robinhood Chain production attempt already exists for this launch. Its identity is immutable and no new attempt may be created."
        >
          <div className="grid gap-1 sm:grid-cols-2">
            <ReadoutLine label={"Status"} value={existingAttempt.status} />
            <ReadoutLine label={"Deployment id"} value={existingAttempt.deploymentId} />
            <ReadoutLine label={"Immutable deployer"} value={existingAttempt.deployerAddress} />
            <ReadoutLine label={"Immutable recipient"} value={existingAttempt.tokenRecipient} />
            <ReadoutLine label={"Token"} value={existingAttempt.tokenName} />
            <ReadoutLine label={"Onchain symbol"} value={existingAttempt.tokenSymbol} />
            <ReadoutLine
              label={"Base units"}
              value={existingAttempt.tokenTotalSupplyBaseUnits}
            />
            <ReadoutLine label={"Tx hash"} value={existingAttempt.txHash} />
            <ReadoutLine label={"Contract"} value={existingAttempt.contractAddress} />
            <ReadoutLine label={"Created"} value={existingAttempt.createdAt} />
          </div>
          <p className="mt-3 text-[11px] text-muted-foreground">
            This attempt is automatically loaded for continuation: its immutable deployment id is
            used by the manual stages below. Loading it presigns, arms, claims, sends, persists and
            verifies nothing — every stage remains a separate explicit click.
          </p>
        </Section>
      ) : null}

      <DeploymentWalletConnect
        expectedDeployer={
          existingAttempt?.deployerAddress ?? (deployer.trim() === "" ? null : deployer.trim())
        }
        expectedChainId={ROBINHOOD_MAINNET_CHAIN_ID}
      />


      <Section

        variant="surface"
        title="A — Exact production intent"
        description="One launch only. Identity is bound immutably to the attempt row."
      >
        <CanaryIntentForm
          launches={launches.data ?? []}
          launchId={launchId}
          onSelectLaunch={(id) => {
            selectLaunch(id);
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
          attemptBoundDeployer={existingAttempt?.deployerAddress ?? null}
          attemptBoundRecipient={existingAttempt?.tokenRecipient ?? null}
        />


        {intentError ? <p className="mt-2 text-xs text-danger">{intentError}</p> : null}

        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={buildIntent} disabled={busy !== null}>
            Build intent
          </Button>
          <Button
            size="sm"
            disabled={
              busy !== null ||
              !intent ||
              !launchId ||
              !chainEligible ||
              !!deploymentId ||
              attemptBlocksCreation
            }
            onClick={() =>
              run("attempt", async () => {
                if (!intent || !chainEligible || attemptBlocksCreation) return;

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
                setAuthorizationId(null);
                setArmSuccess(false);
                setClaimSuccess(false);
                note(`Attempt: ${result.notice ?? result.status ?? "created"}.`);
              })
            }
          >
            {busy === "attempt" ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
            Create production attempt
          </Button>
        </div>

        {existingAttempt ? (
          <p className="mt-2 text-xs text-danger">
            Blocked: production attempt #{existingAttempt.attemptNumber} for this launch is still
            nonterminal ({existingAttempt.status}). Creating another attempt is refused here. Use
            Resume existing attempt above to continue with its immutable identity.
          </p>
        ) : existingUnverified ? (
          <p className="mt-2 text-xs text-danger">
            Blocked: the existing-attempt check has not returned a verified result
            {existingNotice ? ` (${existingNotice})` : " yet"}. Creating a production attempt stays
            disabled until the check succeeds.
          </p>
        ) : null}




        {intent ? (
          <div className="mt-3 grid gap-1 sm:grid-cols-2">
            <ReadoutLine label={"Deployer"} value={intent.deployer} />
            <ReadoutLine label={"Recipient"} value={intent.recipient} />
            <ReadoutLine label={"Supply (whole)"} value={intent.supplyWhole} />
            <ReadoutLine label={"Base units"} value={intent.totalSupplyBaseUnits} />
            <ReadoutLine label={"Init code hash"} value={intent.initCodeHash} />
            <ReadoutLine label={"Review fingerprint"} value={intent.fingerprint} />
            <ReadoutLine label={"Launch"} value={selected?.public_slug ?? "—"} />
            <ReadoutLine label={"Deployment id"} value={activeDeploymentId} />
          </div>
        ) : null}
      </Section>


      <Section

        variant="surface"
        title="B — Managed pre-sign and economic evidence"
        description="Server-side managed RPC simulation, gas, fees and balance. Issues an authorization; nothing is sendable yet."
      >
        <ReadoutLine label={"Active deployment id"} value={activeDeploymentId} />
        <Button
          className="mt-3"
          size="sm"
          disabled={busy !== null || !activeDeploymentId}
          onClick={() =>
            run("presign", async () => {
              if (!activeDeploymentId) return;
              const result = await presign({
                data: {
                  deploymentId: activeDeploymentId,
                  clientRequestId: `presign-${crypto.randomUUID()}`,
                },
              });
              setQuote(result);
              setAuthorizationId(result.authorizationId);
              setArmSuccess(false);
              setClaimSuccess(false);
              note(`Presign: ${result.notice ?? "issued"}.`);
            })
          }
        >
          {busy === "presign" ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
          Run managed pre-sign
        </Button>
        {!activeDeploymentId ? (
          <p className="mt-2 text-xs text-danger">
            Managed pre-sign is unavailable because there is no active deployment context. Select
            the launch in section A so its existing production attempt can be recovered, or create
            a production attempt when none exists.
          </p>
        ) : null}
        <Readout value={quote} />
      </Section>

      <Section
        variant="surface"
        title="C–E — Typed confirmation: ARM first, then CLAIM"
        description={`Type exactly "${ARM_PHRASE}" to unlock ARM. A successful ARM enables CLAIM. Each is a separate explicit click.`}
      >
        <Input
          value={armPhrase}
          onChange={(event) => setArmPhrase(event.target.value)}
          placeholder={ARM_PHRASE}
          className="max-w-md font-mono"
        />
        <p className="mt-2 text-xs text-muted-foreground">
          Required order: ARM the authorization, then immediately CLAIM it. The final send window
          after a successful CLAIM is intentionally very short (approximately 10 seconds).
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={
              busy !== null ||
              !armReady ||
              !activeDeploymentId ||
              !authorizationId ||
              typeof control?.revision !== "number"
            }
            onClick={() =>
              run("arm", async () => {
                if (!activeDeploymentId || !authorizationId || typeof control?.revision !== "number") return;
                const result = await arm({
                  data: {
                    deploymentId: activeDeploymentId,
                    authorizationId,
                    expectedControlRevision: control.revision,
                    reason: "Owner-authorized first production canary.",
                  },
                });
                setArmed(result);
                setArmSuccess(result.ok === true);
                note(`Arm: ${result.notice ?? "requested"}.`);
              })
            }
          >
            {busy === "arm" ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
            Arm this authorization
          </Button>
          <Button
            size="sm"
            disabled={
              busy !== null ||
              !armReady ||
              !activeDeploymentId ||
              !authorizationId ||
              !armSuccess
            }
            onClick={() =>
              run("claim", async () => {
                if (!activeDeploymentId || !authorizationId) return;
                const result = await claim({ data: { deploymentId: activeDeploymentId, authorizationId } });
                setClaimed(result);
                setClaimSuccess(result.ok === true);
                note(`Claim: ${result.notice ?? "claimed"}.`);
              })
            }
          >
            {busy === "claim" ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
            Claim authorization
          </Button>
        </div>
        <Readout value={{ armed, claimed }} />
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
            disabled={busy !== null || !activeDeploymentId || !authorizationId || !claimSuccess}
            onClick={() =>
              run("window", async () => {
                if (!activeDeploymentId || !authorizationId) return;
                const result = await sendWindow({ data: { deploymentId: activeDeploymentId, authorizationId } });
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
          Issue the final send window only after CLAIM succeeds. The envelope expires on a short
          server clock (approximately 10 seconds from CLAIM). One wallet request. No retry and no
          rebroadcast: if the outcome is ambiguous the attempt freezes for reconciliation.
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
            disabled={busy !== null || !activeDeploymentId || !authorizationId || !txHash}
            onClick={() =>
              run("persist", async () => {
                if (!activeDeploymentId || !authorizationId || !txHash) return;
                const result = await persist({ data: { deploymentId: activeDeploymentId, authorizationId, txHash } });
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
            disabled={busy !== null || !activeDeploymentId}
            onClick={() =>
              run("reconcile", async () => {
                if (!activeDeploymentId) return;
                setTail(await reconcile({ data: { deploymentId: activeDeploymentId } }));
                note("Reconciliation snapshot read.");
              })
            }
          >
            Reconciliation snapshot
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy !== null || !activeDeploymentId}
            onClick={() =>
              run("verify", async () => {
                if (!activeDeploymentId) return;
                setTail(await verify({ data: { deploymentId: activeDeploymentId } }));
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
