import { useEffect, useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
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
  ChecklistRow,
  Readout,
  ReadoutLine,
  useArmWindow,
  useBusy,
} from "@/components/cartel/CanaryReadout";

import { usePlatformAccess } from "@/hooks/usePlatformAccess";
import { useWorkspace } from "@/lib/workspace-context";
import { getProjectProfile } from "@/lib/project-profile";

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
import {
  inspectMainnetWalletForHandoff,
  sendClaimedMainnetDeployment,
  type MainnetWalletInspection,
} from "@/lib/chain-mainnet-wallet";
import { ProductionRequestQueuePanel } from "@/components/cartel/ProductionRequestQueuePanel";
import {
  beginPlatformProductionRequestExecution,
  canBeginExecution,
  isBoundExecutingRequest,
  listPlatformProductionRequests,
  setPlatformProductionRequestStatus,
  type PlatformRequestStatusTarget,
} from "@/lib/launch-production-request-platform.functions";

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

/** Launcher-B3 — literal confirmation for beginning a request-bound execution. */
export const BEGIN_EXECUTION_PHRASE = "BEGIN PROTECTED EXECUTION";

const REQUEST_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function CanaryConsole() {
  const { workspaceId } = useWorkspace();

  // Owner internal tooling: launches are scoped to the active project profile
  // and may include INTERNAL_TEST chain-test records.
  const canaryProfile = useQuery({
    queryKey: ["project-profile", workspaceId],
    queryFn: () => getProjectProfile(workspaceId as string),
    enabled: !!workspaceId,
  });
  const canaryProfileId = canaryProfile.data?.id ?? null;

  const launches = useQuery({
    queryKey: ["canary-launches", workspaceId, canaryProfileId],
    queryFn: () => listLaunches(workspaceId as string, canaryProfileId as string),
    enabled: !!workspaceId && !!canaryProfileId,
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

  /**
   * Launcher-B3 — platform-side production request wrappers. Each one re-checks
   * platform ownership server-side; none of them signs, arms, claims, sends,
   * registers, advances lifecycle or notifies anything.
   */
  const listRequests = useServerFn(listPlatformProductionRequests);
  const decideRequest = useServerFn(setPlatformProductionRequestStatus);
  const beginRequest = useServerFn(beginPlatformProductionRequestExecution);

  const { busy, run } = useBusy();

  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/mainnet-canary" });
  const requestQueue = useQuery({
    queryKey: ["b3-production-request-queue"],
    queryFn: () => listRequests({ data: undefined }),
    retry: false,
  });
  const requestRows = requestQueue.data?.requests ?? [];
  const selectedRequestId = search.request ?? null;
  const selectedRequest = useMemo(
    () => requestRows.find((row) => row.id === selectedRequestId) ?? null,
    [requestRows, selectedRequestId],
  );
  /** Request-bound mode: the exact request row is the only identity source. */
  const requestMode = !!selectedRequest;
  const [beginPhrase, setBeginPhrase] = useState("");


  const [launchId, setLaunchId] = useState("");
  const [deployer, setDeployer] = useState("");
  const [recipient, setRecipient] = useState("");
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [supply, setSupply] = useState("");
  const [armPhrase, setArmPhrase] = useState("");
  
  const [stopReason, setStopReason] = useState("");

  const [armSuccess, setArmSuccess] = useState(false);
  const [claimSuccess, setClaimSuccess] = useState(false);

  const [control, setControl] = useState<CanaryExecutionStateResult | null>(null);
  const [intent, setIntent] = useState<MainnetSimulationIntent | null>(null);
  const [intentError, setIntentError] = useState<string | null>(null);
  const [deploymentId, setDeploymentId] = useState<string | null>(null);
  const [authorizationId, setAuthorizationId] = useState<string | null>(null);
  /** Presentation-only expiry of the current presign authorization. */
  const [authorizationExpiresAt, setAuthorizationExpiresAt] = useState<string | null>(null);

  const [quote, setQuote] = useState<unknown>(null);
  const [claimed, setClaimed] = useState<unknown>(null);
  const [armed, setArmed] = useState<unknown>(null);
  const [windowResult, setWindowResult] = useState<{
    envelope: unknown;
    sendWindowExpiresAt: string | null;
    ok: boolean;
    notice: string | null;
  } | null>(null);
  /** READ-ONLY live wallet preflight result. Never authoritative for security. */
  const [preflight, setPreflight] = useState<MainnetWalletInspection | null>(null);
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
  /**
   * CROSS-LAUNCH LEAK GUARD. Every launch-scoped value is dropped before the
   * newly selected launch is applied, so no deployment id, authorization,
   * intent, wallet identity, envelope or result from launch X can ever survive
   * into launch Y. This clears local UI state only: it mutates nothing, calls
   * nothing and never touches a persisted row.
   */
  const resetLaunchScopedState = () => {
    setDeployer("");
    setRecipient("");
    setSupply("");
    setIntent(null);
    setIntentError(null);
    setDeploymentId(null);
    setAuthorizationId(null);
    setAuthorizationExpiresAt(null);
    setArmPhrase("");
    setArmSuccess(false);
    setClaimSuccess(false);
    setQuote(null);
    setClaimed(null);
    setArmed(null);
    setWindowResult(null);
    setPreflight(null);
    setSendResult(null);
    setTxHash(null);
    setTail(null);
  };

  const selectLaunch = (id: string) => {
    resetLaunchScopedState();
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
    // Request-bound mode owns the launch context; local memory never overrides it.
    if (search.request) return;
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
    // A restored selection is a launch change too: start from clean state.
    resetLaunchScopedState();
    setLaunchId(row.id);
    setName(row.token_name ?? "");
    setSymbol(deriveCanaryOnchainSymbol(row.ticker));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [launches.data, launchId, search.request]);

  /**
   * REQUEST-BOUND HYDRATION. The customer's approved request row is the ONLY
   * identity source in this mode: token name, onchain symbol, exact supply and
   * the immutable recipient are copied read-only from it, and the bound
   * deployment id (when execution has already begun) becomes the deployment
   * context for the existing protected stages.
   *
   * This hydration is local UI state only. It creates nothing, signs nothing,
   * arms nothing and advances no stage.
   */
  const requestHydrationKey = selectedRequest
    ? `${selectedRequest.id}:${selectedRequest.executionDeploymentId ?? ""}`
    : "";
  useEffect(() => {
    if (!selectedRequest) return;
    resetLaunchScopedState();
    setBeginPhrase("");
    setLaunchId(selectedRequest.launchId);
    setName(selectedRequest.tokenName);
    setSymbol(selectedRequest.tokenSymbol);
    setRecipient(selectedRequest.tokenRecipient);
    setSupply(selectedRequest.tokenSupplyWhole);
    setDeploymentId(selectedRequest.executionDeploymentId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestHydrationKey]);

  const selectRequest = (requestId: string | null) => {
    setBeginPhrase("");
    resetLaunchScopedState();
    setLaunchId("");
    void navigate({
      to: "/mainnet-canary",
      search: requestId ? { request: requestId } : {},
      replace: true,
    });
  };



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
  /** ACTIVE / RESUMABLE attempt only (DRAFT, SUBMITTED, PENDING). */
  const existingAttempt = existing.data?.attempt ?? null;
  /**
   * COMPLETED HISTORY (CONFIRMED). Display only: it never binds intent, never
   * becomes a deployment context and never reaches presign/ARM/CLAIM/send.
   */
  const confirmedDeployment = existing.data?.confirmed ?? null;
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
  const attemptBlocksCreation =
    existingUnverified || existingAttempt !== null || confirmedDeployment !== null;

  /**
   * DERIVED UI CONTEXT ONLY. Only a deployment created locally for the CURRENT
   * launch, or a verified ACTIVE/RESUMABLE attempt for the CURRENT launch, can
   * become the live deployment context. A CONFIRMED historical deployment is
   * deliberately excluded. This is pure derivation: no server call, no
   * mutation, no stage advancement and no wallet action happens because of it.
   */
  const activeDeploymentId = deploymentId ?? existingAttempt?.deploymentId ?? null;


  const hasActiveState = !!activeDeploymentId || !!authorizationId;

  const armReady = armPhrase === ARM_PHRASE;
  /** PRESENTATION ONLY: local clock derived from the presign expiry. */
  const armWindow = useArmWindow(authorizationExpiresAt);

  /**
   * The immutable deployer for the live wallet preflight. An existing attempt's
   * bound deployer always wins; editable form state is only ever a fallback
   * while no attempt exists.
   */
  const expectedSendDeployer =
    existingAttempt?.deployerAddress ?? intent?.deployer ?? (deployer.trim() || null);

  /** Gate for the single explicit final-send click. */
  const finalSendReady = !!activeDeploymentId && !!authorizationId && claimSuccess;

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

  /**
   * Exact-supply agreement between the locally reviewed intent and the
   * immutable request row. A mismatch FAILS CLOSED: begin stays disabled. Exact
   * decimal strings only — never `Number`.
   */
  const requestSupplyMatches =
    !!selectedRequest &&
    !!intent &&
    intent.totalSupplyBaseUnits === selectedRequest.tokenTotalSupplyBaseUnits &&
    intent.recipient === selectedRequest.tokenRecipient.trim().toLowerCase() &&
    intent.name === selectedRequest.tokenName &&
    intent.symbol === selectedRequest.tokenSymbol;

  const beginReady =
    canBeginExecution(selectedRequest) &&
    !!intent &&
    requestSupplyMatches &&
    beginPhrase.trim() === BEGIN_EXECUTION_PHRASE;

  const runDecision = (
    requestId: string,
    target: PlatformRequestStatusTarget,
    decisionNote: string,
  ) =>
    run(`request-${target}`, async () => {
      const result = await decideRequest({
        data: { requestId, targetStatus: target, note: decisionNote },
      });
      note(`Request ${target}: ${result.ok ? "recorded" : (result.notice ?? "refused")}.`);
      await requestQueue.refetch();
    });


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

      <ProductionRequestQueuePanel
        requests={requestRows}
        loading={requestQueue.isPending}
        notice={requestQueue.data && !requestQueue.data.ok ? requestQueue.data.notice : null}
        selectedRequestId={selectedRequestId}
        busy={busy !== null}
        onSelect={selectRequest}
        onDecision={(requestId, target, decisionNote) =>
          runDecision(requestId, target, decisionNote)
        }
      />

      {selectedRequest ? (
        <Section
          variant="surface"
          leading={<ShieldAlert className="h-4 w-4 text-danger" />}
          title="REQUEST-BOUND EXECUTION — customer production deployment"
          description="Identity comes from the approved request row and cannot be edited here. Beginning execution creates and binds a DRAFT attempt only: nothing is signed, armed, claimed, sent, registered or announced."
        >
          <div className="grid gap-1 sm:grid-cols-2">
            <ReadoutLine label={"Request id"} value={selectedRequest.id} />
            <ReadoutLine label={"Request status"} value={selectedRequest.status} />
            <ReadoutLine label={"Effective status"} value={selectedRequest.effectiveStatus} />
            <ReadoutLine label={"Launch kind"} value={selectedRequest.launchKind} />
            <ReadoutLine label={"Token name"} value={selectedRequest.tokenName} />
            <ReadoutLine label={"Onchain symbol"} value={selectedRequest.tokenSymbol} />
            <ReadoutLine label={"Supply (whole)"} value={selectedRequest.tokenSupplyWhole} />
            <ReadoutLine
              label={"Base units"}
              value={selectedRequest.tokenTotalSupplyBaseUnits}
            />
            <ReadoutLine label={"Immutable recipient"} value={selectedRequest.tokenRecipient} />
            <ReadoutLine
              label={"Bound deployment id"}
              value={selectedRequest.executionDeploymentId}
            />
          </div>

          <p className="mt-3 text-[11px] text-muted-foreground">
            The recipient is the customer&apos;s address and is expected to differ from the platform
            deployer wallet. Confirm both below before beginning.
          </p>

          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <Input
              value={deployer}
              onChange={(event) => setDeployer(event.target.value)}
              placeholder="Platform deployer wallet (0x…)"
              disabled={!canBeginExecution(selectedRequest)}
            />
            <Button
              variant="outline"
              size="sm"
              className="min-h-11"
              onClick={buildIntent}
              disabled={busy !== null}
            >
              Build request intent
            </Button>
          </div>

          {intentError ? <p className="mt-2 text-xs text-danger">{intentError}</p> : null}

          {intent ? (
            <div className="mt-3 grid gap-1 sm:grid-cols-2">
              <ReadoutLine label={"Deployer"} value={intent.deployer} />
              <ReadoutLine label={"Recipient"} value={intent.recipient} />
              <ReadoutLine label={"Base units"} value={intent.totalSupplyBaseUnits} />
              <ReadoutLine label={"Init code hash"} value={intent.initCodeHash} />
              <ReadoutLine label={"Review fingerprint"} value={intent.fingerprint} />
              <ReadoutLine
                label={"Matches request"}
                value={requestSupplyMatches ? "yes" : "NO — begin blocked"}
              />
            </div>
          ) : null}

          {canBeginExecution(selectedRequest) ? (
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <Input
                value={beginPhrase}
                onChange={(event) => setBeginPhrase(event.target.value)}
                placeholder={`Type ${BEGIN_EXECUTION_PHRASE} to confirm`}
              />
              <Button
                size="sm"
                className="min-h-11"
                disabled={busy !== null || !beginReady}
                onClick={() =>
                  run("begin", async () => {
                    if (!intent || !beginReady) return;
                    const result = await beginRequest({
                      data: {
                        requestId: selectedRequest.id,
                        deployerAddress: intent.deployer,
                        reviewFingerprint: intent.fingerprint,
                        initCodeHash: intent.initCodeHash,
                      },
                    });
                    if (result.ok && result.request?.executionDeploymentId) {
                      setDeploymentId(result.request.executionDeploymentId);
                      setBeginPhrase("");
                    }
                    note(
                      `Begin execution: ${
                        result.ok ? "DRAFT attempt bound" : (result.notice ?? "refused")
                      }${result.detail ? ` — ${result.detail}` : ""}.`,
                    );
                    await requestQueue.refetch();
                  })
                }
              >
                {busy === "begin" ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
                Begin protected execution
              </Button>
            </div>
          ) : isBoundExecutingRequest(selectedRequest) ? (
            <p className="mt-3 text-xs text-muted-foreground">
              Execution has begun and the DRAFT attempt is bound. Continue through the existing
              manual stages below; each one remains a separate explicit click.
            </p>
          ) : selectedRequest.effectiveStatus === "COMPLETED" ? (
            <p className="mt-3 text-xs text-success">
              Deployment is verified and final. The project owner can now register the official
              contract from Launch Control.
            </p>
          ) : (
            <p className="mt-3 text-xs text-danger">
              This request is not in an approved, unbound state, so execution cannot begin.
            </p>
          )}
        </Section>
      ) : null}

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

      {launchId && !existingAttempt && !confirmedDeployment ? (
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

      {confirmedDeployment ? (
        <Section
          variant="surface"
          leading={<ShieldCheck className="h-4 w-4 text-success" />}
          title={`Completed historical deployment #${confirmedDeployment.attemptNumber}`}
          description="This launch already has a CONFIRMED Robinhood Chain production deployment. It is permanent history: it is displayed read-only, it never binds new intent, and it is never loaded as a presign, ARM, CLAIM or send context."
        >
          <div className="grid gap-1 sm:grid-cols-2">
            <ReadoutLine label={"Status"} value={confirmedDeployment.status} />
            <ReadoutLine label={"Deployment id"} value={confirmedDeployment.deploymentId} />
            <ReadoutLine
              label={"Historical deployer"}
              value={confirmedDeployment.deployerAddress}
            />
            <ReadoutLine
              label={"Historical recipient"}
              value={confirmedDeployment.tokenRecipient}
            />
            <ReadoutLine label={"Token"} value={confirmedDeployment.tokenName} />
            <ReadoutLine label={"Onchain symbol"} value={confirmedDeployment.tokenSymbol} />
            <ReadoutLine
              label={"Base units"}
              value={confirmedDeployment.tokenTotalSupplyBaseUnits}
            />
            <ReadoutLine label={"Tx hash"} value={confirmedDeployment.txHash} />
            <ReadoutLine label={"Contract"} value={confirmedDeployment.contractAddress} />
            <ReadoutLine label={"Created"} value={confirmedDeployment.createdAt} />
          </div>
          <p className="mt-3 text-[11px] text-muted-foreground">
            Historical identity is never rewritten and never copied into a new attempt. Creating
            another production attempt for this launch is refused here to prevent an accidental
            duplicate mainnet deployment.
          </p>
        </Section>
      ) : null}


      <DeploymentWalletConnect
        expectedDeployer={
          existingAttempt?.deployerAddress ?? (deployer.trim() === "" ? null : deployer.trim())
        }
        expectedChainId={ROBINHOOD_MAINNET_CHAIN_ID}
      />


      {requestMode ? null : (
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
                setAuthorizationExpiresAt(null);
                setArmPhrase("");

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
            nonterminal ({existingAttempt.status}). Creating another attempt is refused here. That
            attempt is already loaded above as the active deployment context, with its immutable
            identity.
          </p>
        ) : confirmedDeployment ? (
          <p className="mt-2 text-xs text-danger">
            Blocked: this launch already has a confirmed production deployment (attempt #
            {confirmedDeployment.attemptNumber}). Creating another production attempt is refused
            here to prevent a duplicate mainnet deployment.
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
      )}


      <Section

        variant="surface"
        title="STEP 1 — Safety check (Managed Pre-sign)"
        description="Step B — Managed pre-sign and economic evidence. This single click first re-reads the authoritative runtime execution state read-only, then issues a short-lived authorization only if that read is verified with a numeric control revision."
      >
        <ul className="mb-3 space-y-1 text-xs text-muted-foreground">
          <li>Verifies the exact approved deployment and contract intent.</li>
          <li>Verifies Robinhood Chain {ROBINHOOD_MAINNET_CHAIN_ID} through the managed RPC.</li>
          <li>Simulates contract creation and checks gas, fees and deployer balance.</li>
          <li>Issues a short-lived authorization for the next manual step.</li>
          <li>
            Does NOT sign, open the wallet, spend ETH, ARM, CLAIM or send anything. Read runtime
            state in section A is no longer a separate prerequisite.
          </li>
        </ul>
        <ReadoutLine label={"Active deployment id"} value={activeDeploymentId} />
        <Button
          className="mt-3"
          size="sm"
          disabled={busy !== null || !activeDeploymentId}
          onClick={() =>
            run("presign", async () => {
              if (!activeDeploymentId) return;
              // A new presign always invalidates any previously typed confirmation.
              setArmPhrase("");
              setArmSuccess(false);
              setClaimSuccess(false);
              setAuthorizationExpiresAt(null);
              // READ-ONLY runtime-state refresh, exactly once, before any issuance.
              const state = await readState({ data: undefined });
              setControl(state);
              if (state.ok !== true || typeof state.revision !== "number") {
                setQuote(state);
                setAuthorizationId(null);
                setArmSuccess(false);
                setClaimSuccess(false);
                note(
                  `Presign NOT issued: runtime state could not be verified (${state.notice ?? "unverified"}).`,
                );
                return;
              }
              const result = await presign({
                data: {
                  deploymentId: activeDeploymentId,
                  clientRequestId: `presign-${crypto.randomUUID()}`,
                },
              });
              setQuote(result);
              setAuthorizationId(result.authorizationId);
              setAuthorizationExpiresAt(result.expiresAt ?? null);
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
        <div className="grid gap-1 sm:grid-cols-2">
          <ChecklistRow label="Deployment loaded" state={activeDeploymentId ? "ready" : "needed"} />
          <ChecklistRow
            label="Fresh presign authorization"
            state={authorizationId ? "ready" : "needed"}
          />
          <ChecklistRow
            label="Runtime control revision"
            state={typeof control?.revision === "number" ? "ready" : "needed"}
          />
          <ChecklistRow label="Exact ARM phrase entered" state={armReady ? "ready" : "needed"} />
          <ChecklistRow
            label="ARM timing window"
            state={!authorizationId ? "needed" : armWindow.expired ? "expired" : "ready"}
          />
        </div>

        <p className="mt-3 text-xs text-muted-foreground">
          ARM temporarily unlocks production for this one approved canary authorization. It does not
          send a transaction or spend ETH.
        </p>

        <p className="mt-3 text-[11px] uppercase tracking-wider text-muted-foreground">
          Type this exact confirmation:
        </p>
        <code className="mt-1 inline-block rounded-md border border-border/60 bg-surface-raised/60 px-2 py-1 font-mono text-xs text-foreground">
          {ARM_PHRASE}
        </code>
        <Input
          value={armPhrase}
          onChange={(event) => setArmPhrase(event.target.value)}
          placeholder="Type confirmation here"
          className="mt-2 max-w-md font-mono"
        />

        {authorizationId ? (
          <p className={`mt-2 text-xs ${armWindow.expired ? "text-danger" : "text-muted-foreground"}`}>
            {armWindow.expired
              ? "ARM window expired — run Managed Pre-sign again"
              : `ARM window: ${armWindow.secondsRemaining} seconds remaining`}
          </p>
        ) : null}

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
              armWindow.expired ||
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
            ARM this fresh authorization
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
        <p className={`mt-2 text-xs ${armSuccess ? "text-success" : "text-muted-foreground"}`}>
          {armSuccess ? "ARM succeeded — CLAIM is now your next manual click. " : ""}
          CLAIM locks this exact armed authorization as the one being used for the deployment
          handoff. It still does not send a blockchain transaction or spend ETH.
        </p>

        {/*
          FINAL HANDOFF — ONE EXPLICIT OPERATOR CLICK.
          Placed here, immediately after CLAIM and before the raw readout, so the
          short server-side send window is usable on a phone without scrolling.
          Nothing below runs on render, on a timer, or automatically: the wallet
          can only ever be invoked from this button's own click handler.
        */}
        <div className="mt-4 rounded-md border border-danger/40 bg-surface-raised/40 p-3">
          <p className={`text-xs ${claimSuccess ? "text-success" : "text-muted-foreground"}`}>
            {claimSuccess
              ? "CLAIM complete — ready for final wallet handoff"
              : "CLAIM is required before the final wallet handoff."}
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            This click performs a live wallet check, creates the one-time short send window, then
            opens the wallet. No ETH is spent unless you approve the wallet transaction. One wallet
            request only: no retry and no rebroadcast. If the outcome is ambiguous the attempt
            freezes for reconciliation.
          </p>
          <Button
            variant="destructive"
            size="lg"
            className="mt-3 w-full"
            disabled={busy !== null || !finalSendReady}
            onClick={() =>
              run("final-send", async () => {
                if (!activeDeploymentId || !authorizationId || !claimSuccess) return;
                if (!expectedSendDeployer) {
                  note("Final send blocked: no immutable deployer address is known.");
                  return;
                }
                // 1 — READ-ONLY live wallet preflight. No issuance, no send.
                const inspection = await inspectMainnetWalletForHandoff(expectedSendDeployer);
                setPreflight(inspection);
                if (!inspection.ok) {
                  note(
                    `Final send blocked at wallet check (${inspection.notice ?? "WALLET_NOT_READY"}). No send window was issued.`,
                  );
                  return;
                }
                // 2 — exactly one send-window issuance, immediately before the wallet.
                const issued = await sendWindow({
                  data: { deploymentId: activeDeploymentId, authorizationId },
                });
                setWindowResult({
                  ok: issued.ok,
                  notice: issued.notice,
                  envelope: issued.envelope,
                  sendWindowExpiresAt: issued.sendWindowExpiresAt,
                });
                if (
                  issued.ok !== true ||
                  !issued.envelope ||
                  typeof issued.sendWindowExpiresAt !== "string"
                ) {
                  note(
                    `Final send blocked: send window not issued (${issued.notice ?? "REFUSED"}).`,
                  );
                  return;
                }
                // 3 — exactly one wallet send, with the exact server envelope.
                const result = await sendClaimedMainnetDeployment({
                  envelope: issued.envelope as never,
                  sendWindowExpiresAt: issued.sendWindowExpiresAt,
                });
                setSendResult(result);
                setWindowResult(null);
                // Persisting the hash stays a separate explicit click in section G.
                if (result.txHash) setTxHash(result.txHash);
                note(`Send: phase ${result.phase}, ${result.notice ?? "hash known"}.`);
              })
            }
          >
            {busy === "final-send" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            SEND ONE MAINNET DEPLOYMENT
          </Button>

          {preflight && !preflight.ok ? (
            <p className="mt-2 text-xs text-danger">
              Wallet check failed ({preflight.notice ?? "WALLET_NOT_READY"}). No send window was
              created and the wallet was not asked to send anything. Expected deployer{" "}
              {expectedSendDeployer ?? "—"} on chain {ROBINHOOD_MAINNET_CHAIN_ID}.
            </p>
          ) : null}
          {windowResult && windowResult.ok !== true ? (
            <p className="mt-2 text-xs text-danger">
              Send window not issued ({windowResult.notice ?? "REFUSED"}). Nothing was sent.
            </p>
          ) : null}
          <Readout value={sendResult} />
        </div>

        <Readout value={{ armed, claimed }} />
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
