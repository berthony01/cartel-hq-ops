import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  Coins,
  ExternalLink,
  FlaskConical,
  Loader2,
  Lock,
  ShieldCheck,
  RefreshCw,
  Wallet,
} from "lucide-react";
import { PageHeader } from "@/components/cartel/PageHeader";
import { Section } from "@/components/cartel/Section";
import { EmptyState } from "@/components/cartel/EmptyState";
import { Button } from "@/components/ui/button";
import { usePlatformAccess } from "@/hooks/usePlatformAccess";
import { useWorkspace } from "@/lib/workspace-context";
import { getProjectProfile } from "@/lib/project-profile";

import { listLaunches, type LaunchRow } from "@/lib/launch-control";
import {
  ROBINHOOD_TESTNET_CHAIN_ID,
  REQUIRED_CONFIRMATIONS,
  explorerAddressUrl,
  explorerTxUrl,
} from "@/lib/chain-registry";
import {
  DEPLOYMENT_STATUS_LABEL,
  abandonDeploymentAttempt,
  broadcastTestDeployment,
  buildTokenInitCode,
  broadcastTokenDeployment,
  chainDeploymentsQueryKey,
  connectWallet,
  createDeploymentAttempt,
  createTokenDeploymentAttempt,
  formatEth,
  formatWholeSupply,
  tokenSupplyText,
  getInjectedProvider,
  isTerminal,
  isUserRejection,
  isValidTxHash,
  listChainDeployments,
  newClientRequestId,
  readAccount,
  readBalanceWei,
  readChainId,
  submitDeploymentTx,
  ensureTestnet,
  type DeploymentRow,
} from "@/lib/chain-launcher";
import { verifyChainDeployment } from "@/lib/chain-verify.functions";
import {
  CARTEL_FIXED_ERC20_ARTIFACT_ID,
  CARTEL_FIXED_ERC20_DECIMALS,
} from "@/lib/cartel-fixed-erc20.artifact";
import { Input } from "@/components/ui/input";
import { SimulationReviewCard } from "@/components/chain/SimulationReviewCard";
import {
  SIMULATION_QUOTE_TTL_MS,
  SimulationError,
  evaluatePreSignGate,
  isQuoteFresh,
  runSimulation,
  bindSimulationSession,
  isSessionBound,
  type SimulationSession,
} from "@/lib/chain-simulation";
import { LaunchReceiptCard } from "@/components/chain/LaunchReceiptCard";
import {
  clearRecoveryRecord,
  deriveLaunchReceipt,
  isRecoveryRestorable,
  parseRecoveryRecord,
  readRecoveryRecord,
  saveRecoveryRecord,
  type RecoveryRecord,
} from "@/lib/launch-receipt";
import { LiquidityPlanCard } from "@/components/chain/LiquidityPlanCard";
import {
  DEADLINE_MINUTES_MAX,
  DEADLINE_MINUTES_MIN,
  LIQUIDITY_PLAN_TTL_MS,
  LiquidityPlanError,
  SLIPPAGE_BPS_MAX,
  SLIPPAGE_BPS_MIN,
  buildLiquidityPlan,
  isLiquidityPlanFresh,
  type LiquidityPlan,
} from "@/lib/liquidity-plan";
import { PcartRehearsalPanel } from "@/components/chain/PcartRehearsalPanel";
import { isCanonicalPcartLaunch } from "@/lib/launch-artifact-registry";

export const Route = createFileRoute("/_authenticated/chain-launcher")({
  head: () => ({
    meta: [
      { title: "Chain Launcher — CARTEL HQ" },
      {
        name: "description",
        content:
          "Owner-only Robinhood Chain testnet deployment harness for CARTEL HQ. Test artifacts only — never an official token contract.",
      },
      { property: "og:title", content: "Chain Launcher — CARTEL HQ" },
      {
        property: "og:description",
        content: "Internal testnet deployment plumbing for the PEPECARTEL operating layer.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ChainLauncherPage,
});

function ChainLauncherPage() {
  // Server-verified, fails closed. The route is UX; the RPCs and the verifier
  // enforce platform owner + workspace operator independently.
  const { loading, error, isPlatformOwner } = usePlatformAccess({ fresh: true });
  const { workspaceId } = useWorkspace();
  const queryClient = useQueryClient();
  const verify = useServerFn(verifyChainDeployment);

  const [launchId, setLaunchId] = useState<string | null>(null);
  const [account, setAccount] = useState<string | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [busy, setBusy] = useState(false);
  const [tokenBusy, setTokenBusy] = useState(false);
  const [tokenName, setTokenName] = useState("");
  const [tokenSymbol, setTokenSymbol] = useState("");
  const [tokenSupply, setTokenSupply] = useState("1000000");
  const [tokenRecipient, setTokenRecipient] = useState("");
  // C8.5 — the passing simulation and its stable client request id travel
  // together. Discarding the session discards the id, so a new intent can
  // never reuse an earlier request id.
  const [simSession, setSimSession] = useState<SimulationSession | null>(null);
  const simulation = simSession && isSessionBound(simSession) ? simSession.simulation : null;
  const [recovery, setRecovery] = useState<RecoveryRecord | null>(null);
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  // Synchronous in-flight lock. `tokenBusy` only takes effect after a React
  // rerender, so it cannot stop two events fired in the same tick.
  const tokenInFlight = useRef(false);
  const [simBusy, setSimBusy] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());

  // C8.6A — liquidity readiness planning only. No transaction state exists here.
  const [liqSourceId, setLiqSourceId] = useState<string | null>(null);
  const [liqTokenAmount, setLiqTokenAmount] = useState("");
  const [liqEthAmount, setLiqEthAmount] = useState("");
  const [liqSlippage, setLiqSlippage] = useState("100");
  const [liqDeadline, setLiqDeadline] = useState("20");
  const [liqPlan, setLiqPlan] = useState<LiquidityPlan | null>(null);

  const hasProvider = typeof window !== "undefined" && getInjectedProvider() !== null;
  const onTestnet = chainId === ROBINHOOD_TESTNET_CHAIN_ID;

  // Owner internal tooling: scoped to the active project profile and may
  // include INTERNAL_TEST chain-test records.
  const launcherProfileQuery = useQuery({
    queryKey: ["project-profile", workspaceId],
    queryFn: () => getProjectProfile(workspaceId as string),
    enabled: isPlatformOwner === true && !!workspaceId,
  });
  const launcherProfileId = launcherProfileQuery.data?.id ?? null;

  const launchesQuery = useQuery({
    queryKey: ["chain-launcher-launches", workspaceId ?? "none", launcherProfileId],
    queryFn: () => listLaunches(workspaceId as string, launcherProfileId as string),
    enabled: isPlatformOwner === true && !!workspaceId && !!launcherProfileId,
  });


  const launchesData = launchesQuery.data;
  const launches: LaunchRow[] = useMemo(() => launchesData ?? [], [launchesData]);

  useEffect(() => {
    if (!launchId && launches.length > 0) setLaunchId(launches[0]!.id);
  }, [launches, launchId]);

  const deploymentsQuery = useQuery({
    queryKey: chainDeploymentsQueryKey(launchId),
    queryFn: () => listChainDeployments(launchId as string),
    enabled: isPlatformOwner === true && !!launchId,
  });

  const deploymentsData = deploymentsQuery.data;
  const attempts: DeploymentRow[] = useMemo(() => deploymentsData ?? [], [deploymentsData]);
  const latest = attempts[0] ?? null;
  const selectedLaunch = useMemo(
    () => launches.find((l) => l.id === launchId) ?? null,
    [launches, launchId],
  );
  const isCanonical = isCanonicalPcartLaunch(selectedLaunch);

  const refreshWallet = useCallback(async (address: string | null) => {
    setChainId(await readChainId());
    setBalance(address ? await readBalanceWei(address) : null);
  }, []);

  useEffect(() => {
    if (!hasProvider) return;
    void refreshWallet(account);
    const provider = getInjectedProvider();
    const onChanged = () => void refreshWallet(account);
    provider?.on?.("chainChanged", onChanged);
    provider?.on?.("accountsChanged", onChanged);
    return () => {
      provider?.removeListener?.("chainChanged", onChanged);
      provider?.removeListener?.("accountsChanged", onChanged);
    };
  }, [hasProvider, account, refreshWallet]);

  // Any change to the reviewed intent, the account or the chain invalidates the
  // simulation immediately. Deployment stays locked until a fresh run passes.
  useEffect(() => {
    setSimSession(null);
  }, [tokenName, tokenSymbol, tokenSupply, tokenRecipient, account, chainId]);

  useEffect(() => {
    if (!simulation) return;
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [simulation]);

  // Expiry is not just a disabled button: the stale session and its stable
  // request id are destroyed once the 90-second quote is no longer fresh.
  useEffect(() => {
    if (simSession && !isQuoteFresh(simSession.simulation.preflight, nowMs)) {
      setSimSession(null);
    }
  }, [simSession, nowMs]);

  // C8.6A — CONFIRMED fixed-supply test tokens that can be planned against.
  const liquiditySources = useMemo(
    () =>
      isCanonical
        ? []
        : attempts.filter(
        (a) =>
          a.status === "CONFIRMED" &&
          a.deployment_kind === "FIXED_SUPPLY_ERC20" &&
          // PCART rehearsal evidence never feeds any liquidity planning.
          a.artifact_id !== "pepecartel-token-v1" &&
          typeof a.contract_address === "string" &&
          /^0x[0-9a-fA-F]{40}$/.test(a.contract_address),
      ),
    [attempts, isCanonical],
  );

  const liquiditySource = useMemo(
    () => liquiditySources.find((a) => a.id === liqSourceId) ?? liquiditySources[0] ?? null,
    [liquiditySources, liqSourceId],
  );

  useEffect(() => {
    if (!liqSourceId && liquiditySources.length > 0) setLiqSourceId(liquiditySources[0]!.id);
  }, [liquiditySources, liqSourceId]);

  // Any change to the plan inputs, the source attempt, the account or the chain
  // destroys the plan. It is never silently reused.
  useEffect(() => {
    setLiqPlan(null);
  }, [
    liqSourceId,
    liqTokenAmount,
    liqEthAmount,
    liqSlippage,
    liqDeadline,
    account,
    chainId,
    balance,
  ]);

  useEffect(() => {
    if (!liqPlan) return;
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [liqPlan]);

  // Fail closed: an expired plan is destroyed, not merely greyed out.
  useEffect(() => {
    if (liqPlan && !isLiquidityPlanFresh(liqPlan, nowMs)) setLiqPlan(null);
  }, [liqPlan, nowMs]);

  /**
   * C8.6A — pure, local plan derivation. Reads no chain data of its own and
   * never contacts the wallet: only values already held in component state are
   * passed in. Nothing is persisted and nothing is signed.
   */
  const handleBuildLiquidityPlan = () => {
    if (!liquiditySource) {
      toast.error("Select a confirmed test-token attempt first.");
      return;
    }
    if (!account) {
      toast.error("Connect a wallet first.");
      return;
    }
    // Only a balance actually verified on chain for THIS operator counts.
    const availableTokenBaseUnits =
      liquiditySource.token_recipient &&
      liquiditySource.token_recipient.toLowerCase() === account.toLowerCase()
        ? liquiditySource.verified_recipient_balance_text
        : null;

    if (!/^[0-9]{1,6}$/.test(liqSlippage.trim()) || !/^[0-9]{1,6}$/.test(liqDeadline.trim())) {
      toast.error("Slippage and deadline must be whole numbers.");
      return;
    }

    try {
      const plan = buildLiquidityPlan({
        source: {
          deploymentId: liquiditySource.id,
          status: liquiditySource.status,
          deploymentKind: liquiditySource.deployment_kind,
          artifactId: liquiditySource.artifact_id,
          chainId: Number(liquiditySource.chain_id),
          contractAddress: liquiditySource.contract_address,
          tokenName: liquiditySource.verified_token_name ?? liquiditySource.token_name,
          tokenSymbol: liquiditySource.verified_token_symbol ?? liquiditySource.token_symbol,
          tokenDecimals: liquiditySource.verified_token_decimals ?? liquiditySource.token_decimals,
          availableTokenBaseUnits,
        },
        operator: account,
        liveAccount: account,
        liveChainId: chainId,
        walletBalanceWei: balance === null ? null : balance.toString(),
        tokenAmount: liqTokenAmount,
        ethAmount: liqEthAmount,
        slippageBps: Number.parseInt(liqSlippage.trim(), 10),
        deadlineMinutes: Number.parseInt(liqDeadline.trim(), 10),
      });
      setLiqPlan(plan);
      setNowMs(Date.now());
    } catch (planError) {
      setLiqPlan(null);
      toast.error(
        planError instanceof LiquidityPlanError
          ? planError.message
          : "Could not build a liquidity plan from these values.",
      );
    }
  };

  // B — same-tab recovery restore. Only ever restores a record that still
  // matches a DRAFT row without a server-side tx hash in the CURRENT scope.
  useEffect(() => {
    if (!workspaceId || !launchId) return;
    if (recovery) return;
    if (!deploymentsQuery.isSuccess) return;
    const scope = { workspaceId, launchId };
    const stored = readRecoveryRecord(scope);
    if (!stored) return;
    if (isRecoveryRestorable(stored, attempts)) setRecovery(stored);
    else clearRecoveryRecord(scope);
  }, [workspaceId, launchId, recovery, deploymentsQuery.isSuccess, attempts]);

  // Never surface another launch's or workspace's recovery record.
  useEffect(() => {
    setRecovery((current) =>
      current && current.launchId === launchId && current.workspaceId === workspaceId
        ? current
        : null,
    );
  }, [launchId, workspaceId]);

  useEffect(() => {
    // The connected wallet is the default recipient; the operator may change it.
    if (account && !tokenRecipient) setTokenRecipient(account);
  }, [account, tokenRecipient]);

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: chainDeploymentsQueryKey(launchId) });

  const verifyMutation = useMutation({
    mutationFn: (deploymentId: string) => verify({ data: { deploymentId } }),
    onSuccess: async (result) => {
      await invalidate();
      if (result.notice) toast.info(result.notice);
      else if (result.status === "CONFIRMED") toast.success("Verified on testnet.");
      else if (result.status === "PENDING") {
        toast.info(`${result.confirmations}/${result.requiredConfirmations} confirmations.`);
      }
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Verification failed."),
  });

  async function handleConnect() {
    try {
      const address = await connectWallet();
      setAccount(address);
      await refreshWallet(address);
    } catch (e) {
      toast.error(
        isUserRejection(e) ? "Wallet connection cancelled." : "Could not connect wallet.",
      );
    }
  }

  async function handleSwitch() {
    try {
      await ensureTestnet();
      await refreshWallet(account);
    } catch (e) {
      toast.error(
        isUserRejection(e) ? "Network switch cancelled." : "Could not switch to the testnet.",
      );
    }
  }

  async function handleDeploy() {
    if (!launchId || !account || !onTestnet || isCanonical) return;
    setBusy(true);
    let attemptId: string | null = null;
    let txHash: string | null = null;
    try {
      const attempt = await createDeploymentAttempt({
        launchId,
        clientRequestId: newClientRequestId(),
        deployerAddress: account,
      });
      attemptId = attempt.id;
      await invalidate();

      txHash = await broadcastTestDeployment(account);
      await submitDeploymentTx(attempt.id, txHash);
      await invalidate();
      toast.success("Transaction broadcast. Verify once it is mined.");
    } catch (e) {
      // Only an unbroadcast DRAFT is abandoned; a broadcast tx is never discarded.
      if (attemptId && !txHash) {
        const userCancelled = isUserRejection(e);
        try {
          await abandonDeploymentAttempt(
            attemptId,
            userCancelled ? "Cancelled in wallet" : "Wallet request ended before broadcast",
          );
          await invalidate();
        } catch {
          /* leave the attempt as-is; history is never rewritten */
        }
        toast.info(
          userCancelled
            ? "Deployment cancelled in wallet."
            : "Wallet request ended before broadcast. The draft attempt was abandoned.",
        );
      } else {
        toast.error(e instanceof Error ? e.message : "Deployment failed.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleRunSimulation() {
    if (!account) return;
    setSimBusy(true);
    try {
      const result = await runSimulation({
        deployer: account,
        name: tokenName,
        symbol: tokenSymbol,
        supplyWhole: tokenSupply,
        recipient: tokenRecipient,
      });
      setNowMs(Date.now());
      if (result.preflight.passed) {
        // A request id exists ONLY for a passing simulation.
        setSimSession(bindSimulationSession(result, newClientRequestId()));
      } else {
        setSimSession(null);
        toast.error("Simulation did not pass. Review the checks.");
      }
    } catch (e) {
      setSimSession(null);
      toast.error(e instanceof SimulationError ? e.message : "Could not simulate this deployment.");
    } finally {
      setSimBusy(false);
    }
  }

  async function handleDeployToken() {
    // PCART-L3: generic test-token path is never reachable for the canonical launch.
    if (isCanonical) return;
    // Synchronous duplicate-broadcast guard: claimed BEFORE any await, so a
    // second invocation in the same tick returns before an attempt row is
    // created and before any wallet request is made.
    if (tokenInFlight.current) return;
    tokenInFlight.current = true;
    try {
      await runTokenDeployment();
    } finally {
      tokenInFlight.current = false;
    }
  }

  async function runTokenDeployment() {
    if (!launchId || !account || !onTestnet) return;
    if (!simulation || !simSession) {
      toast.error("Run the simulation before deploying.");
      return;
    }
    const clientRequestId = simSession.clientRequestId;

    // Pre-sign gate: re-read live chain/account, re-normalize the current form
    // values and require an exact fingerprint match against the reviewed
    // simulation. Any mismatch aborts BEFORE a deployment attempt is created.
    const liveChainId = await readChainId();
    const liveAccount = await readAccount();
    const gate = evaluatePreSignGate({
      simulation,
      current: {
        deployer: account,
        name: tokenName,
        symbol: tokenSymbol,
        supplyWhole: tokenSupply,
        recipient: tokenRecipient,
      },
      liveChainId,
      liveAccount,
    });
    if (!gate.ok) {
      setSimSession(null);
      toast.error(gate.reason);
      return;
    }

    // The reviewed intent is authoritative from here on. Nothing is rebuilt
    // from raw form state after the gate.
    const intent = simulation.intent.tokenIntent;
    if (buildTokenInitCode(intent) !== simulation.intent.initCode) {
      toast.error("The reviewed deployment payload could not be re-derived. Simulate again.");
      setSimSession(null);
      return;
    }

    setTokenBusy(true);
    let attemptId: string | null = null;
    let txHash: string | null = null;
    try {
      const attempt = await createTokenDeploymentAttempt({
        launchId,
        // Stable for this simulation: a duplicate click resolves to the SAME
        // row through the server-side idempotency guard, never a second one.
        clientRequestId,
        deployerAddress: account,
        intent,
      });
      attemptId = attempt.id;
      await invalidate();

      // The wallet receives the EXACT reviewed bytes, not a re-encoded copy.
      txHash = await broadcastTokenDeployment(account, simulation.intent.initCode);
      try {
        await submitDeploymentTx(attempt.id, txHash);
      } catch (submitError) {
        // Broadcast succeeded but the record write failed. The transaction may
        // be on chain, so the attempt is NEVER abandoned: the hash is surfaced
        // for manual attachment to this same attempt.
        const record = parseRecoveryRecord(
          {
            attemptId: attempt.id,
            attemptNumber: attempt.attempt_number,
            txHash,
            launchId,
            workspaceId: workspaceId ?? "",
          },
          { workspaceId: workspaceId ?? "", launchId },
        );
        if (record) {
          setRecovery(record);
          saveRecoveryRecord(record);
        }
        throw submitError;
      }
      await invalidate();
      setRecovery(null);
      if (workspaceId) clearRecoveryRecord({ workspaceId, launchId });
      toast.success("Token transaction broadcast. Verify once it is mined.");
    } catch (e) {
      // Identical pre/post-broadcast rule as the inert path: a broadcast
      // transaction is never discarded.
      if (attemptId && !txHash) {
        const userCancelled = isUserRejection(e);
        try {
          await abandonDeploymentAttempt(
            attemptId,
            userCancelled ? "Cancelled in wallet" : "Wallet request ended before broadcast",
          );
          await invalidate();
        } catch {
          /* leave the attempt as-is; history is never rewritten */
        }
        toast.info(
          userCancelled
            ? "Deployment cancelled in wallet."
            : "Wallet request ended before broadcast. The draft attempt was abandoned.",
        );
      } else {
        toast.error(e instanceof Error ? e.message : "Token deployment failed.");
      }
    } finally {
      setTokenBusy(false);
    }
  }

  /**
   * Recovery only: attaches an ALREADY BROADCAST transaction hash to the same
   * DRAFT attempt through the existing RPC. It never signs, never broadcasts
   * and never creates a second attempt.
   */
  async function handleRecordTxHash() {
    if (!recovery || recoveryBusy) return;
    if (!isValidTxHash(recovery.txHash)) {
      toast.error("That transaction hash is not valid.");
      return;
    }
    setRecoveryBusy(true);
    try {
      await submitDeploymentTx(recovery.attemptId, recovery.txHash);
      await invalidate();
      clearRecoveryRecord({ workspaceId: recovery.workspaceId, launchId: recovery.launchId });
      setRecovery(null);
      toast.success("Transaction hash recorded. Verify once it is mined.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not record the transaction hash.");
    } finally {
      setRecoveryBusy(false);
    }
  }

  /**
   * Shared (single) recovery handoff: used by the generic token path's UI and by
   * the PCART rehearsal panel. Broadcast succeeded but the record write failed,
   * so the same scoped RecoveryRecord is validated + saved; never abandoned.
   */
  function handleBroadcastUnrecorded(
    attempt: { id: string; attempt_number: number },
    txHash: string,
  ) {
    if (!launchId) return;
    const record = parseRecoveryRecord(
      {
        attemptId: attempt.id,
        attemptNumber: attempt.attempt_number,
        txHash,
        launchId,
        workspaceId: workspaceId ?? "",
      },
      { workspaceId: workspaceId ?? "", launchId },
    );
    if (record) {
      setRecovery(record);
      saveRecoveryRecord(record);
    }
  }

  function handleBroadcastRecorded() {
    setRecovery(null);
    if (workspaceId && launchId) clearRecoveryRecord({ workspaceId, launchId });
  }

  const recoveryPanel = recovery ? (
          <div className="mt-3 rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-xs leading-relaxed">
            <p className="flex items-center gap-2 font-semibold uppercase tracking-wide text-destructive">
              <AlertTriangle className="size-4" aria-hidden="true" />
              Transaction broadcast but not recorded
            </p>
            <p className="mt-1 text-muted-foreground">
              Attempt #{recovery.attemptNumber} on Robinhood Chain Testnet{" "}
              {ROBINHOOD_TESTNET_CHAIN_ID}. The wallet returned a transaction hash but CARTEL HQ
              could not save it. The transaction may already be on chain —{" "}
              <span className="text-foreground">do not deploy again</span> while this is pending.
              Record the hash against this same attempt.
            </p>
            <p className="mt-1 break-all text-muted-foreground">
              Attempt id <span className="text-foreground">{recovery.attemptId}</span>
            </p>
            <p className="mt-1 break-all text-foreground">{recovery.txHash}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Button size="sm" disabled={recoveryBusy} onClick={() => void handleRecordTxHash()}>
                {recoveryBusy ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <ShieldCheck className="size-4" aria-hidden="true" />
                )}
                Record transaction hash
              </Button>
              <a
                className="text-gold underline"
                href={explorerTxUrl(recovery.txHash)}
                target="_blank"
                rel="noreferrer"
              >
                View on explorer
                <ExternalLink className="ml-1 inline size-3" aria-hidden="true" />
              </a>
            </div>
          </div>
  ) : null;

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <span className="flex items-center gap-3 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin text-gold" aria-hidden="true" />
          Checking access…
        </span>
      </div>
    );
  }

  if (!isPlatformOwner) {
    return (
      <div className="flex min-w-0 flex-col gap-5">
        <PageHeader
          eyebrow="System"
          title="Unavailable"
          description="This area is restricted."
          status="Restricted"
        />
        <EmptyState
          icon={Lock}
          title="Access restricted"
          description={
            error
              ? "We couldn't verify access for this account right now. Try again in a moment."
              : "This section isn't available for your account."
          }
        />
      </div>
    );
  }

  const canDeploy =
    !isCanonical &&
    !!launchId && !!account && onTestnet && !busy && (!latest || isTerminal(latest.status));
  const simulationFresh = simulation ? isQuoteFresh(simulation.preflight, nowMs) : false;
  const simulationReady = !!simulation && simulation.preflight.passed && simulationFresh;
  const canSimulate = !!account && onTestnet && !simBusy && !tokenBusy;
  const canDeployToken =
    !isCanonical &&
    !!launchId &&
    !!account &&
    onTestnet &&
    !tokenBusy &&
    simulationReady &&
    (!latest || isTerminal(latest.status));

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <PageHeader
        eyebrow="System"
        title="Chain Launcher"
        description="Internal deployment harness for Robinhood Chain Testnet."
        status="Owner only"
      />

      <div className="rounded-lg border border-gold/40 bg-gold/10 p-3 text-xs leading-relaxed text-foreground">
        <p className="flex items-center gap-2 font-semibold uppercase tracking-wide text-gold">
          <AlertTriangle className="size-4" aria-hidden="true" />
          Robinhood Chain Testnet only
        </p>
        <p className="mt-1 text-muted-foreground">
          TEST DEPLOYMENT — NOT AN OFFICIAL TOKEN CONTRACT. This deploys a fixed, inert test
          artifact that reverts on every call. It has no token behaviour and no value. Nothing here
          registers an official contract address or changes a launch status.
        </p>
      </div>

      <Section
        variant="primary"
        title="Launch"
        description="Select a launch in this workspace. Its lifecycle is not modified."
      >
        {!workspaceId ? (
          <EmptyState
            icon={FlaskConical}
            title="No workspace"
            description="Select a workspace first."
            compact
          />
        ) : launchesQuery.isPending ? (
          <p className="text-xs text-muted-foreground">Loading launches…</p>
        ) : launches.length === 0 ? (
          <EmptyState
            icon={FlaskConical}
            title="No launches"
            description="Create a launch in Launch Control first."
            compact
          />
        ) : (
          <div className="flex flex-col gap-2">
            <label htmlFor="launch-select" className="text-xs font-medium text-muted-foreground">
              Launch
            </label>
            <select
              id="launch-select"
              className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
              value={launchId ?? ""}
              onChange={(e) => setLaunchId(e.target.value || null)}
            >
              {launches.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.token_name} ({l.ticker}) — {l.status}
                </option>
              ))}
            </select>
            {selectedLaunch ? (
              <p className="text-xs text-muted-foreground">
                Declared chain: {selectedLaunch.chain} · Lifecycle status: {selectedLaunch.status}
              </p>
            ) : null}
          </div>
        )}
      </Section>

      <Section
        variant="primary"
        title="Wallet"
        description="Your browser wallet is the only signer. CARTEL HQ never holds keys."
      >
        {!hasProvider ? (
          <EmptyState
            icon={Wallet}
            title="No browser wallet detected"
            description="Install an injected EIP-1193 wallet extension to use the launcher."
            compact
          />
        ) : (
          <div className="flex flex-col gap-3">
            <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-3">
              <p>
                Address: <span className="text-foreground">{account ?? "Not connected"}</span>
              </p>
              <p>
                Network:{" "}
                <span className={onTestnet ? "text-foreground" : "text-destructive"}>
                  {chainId === null
                    ? "Unknown"
                    : onTestnet
                      ? "Robinhood Chain Testnet"
                      : `Chain ${chainId}`}
                </span>
              </p>
              <p>
                Balance: <span className="text-foreground">{formatEth(balance)}</span>
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => void handleConnect()}>
                <Wallet className="size-4" aria-hidden="true" />
                {account ? "Reconnect" : "Connect wallet"}
              </Button>
              {account && !onTestnet ? (
                <Button size="sm" variant="outline" onClick={() => void handleSwitch()}>
                  Switch to testnet {ROBINHOOD_TESTNET_CHAIN_ID}
                </Button>
              ) : null}
            </div>
            {account && !onTestnet ? (
              <p className="text-xs text-destructive">
                Deployment is disabled until the wallet is on chain {ROBINHOOD_TESTNET_CHAIN_ID}.
              </p>
            ) : null}
          </div>
        )}
      </Section>

      {/* PCART-L3: the canonical PEPECARTEL launch sees ONLY the exact-artifact
          rehearsal panel. Generic inert/test-token deploy and liquidity
          planning are not rendered for it; unchanged for every other launch. */}
      {launchId && isCanonical ? (
        <PcartRehearsalPanel
          launchId={launchId}
          account={account}
          onTestnet={onTestnet}
          onChanged={invalidate}
          attempts={attempts}
          onVerify={(id) => verifyMutation.mutate(id)}
          verifying={verifyMutation.isPending}
          onBroadcastUnrecorded={handleBroadcastUnrecorded}
          onBroadcastRecorded={handleBroadcastRecorded}
          recoveryPanel={recoveryPanel}
        />
      ) : (
        <>
      <Section
        variant="primary"
        title="Test deployment"
        description={`Confirmed only after ${REQUIRED_CONFIRMATIONS} confirmations verified server-side.`}
        actions={
          <Button size="sm" onClick={() => void handleDeploy()} disabled={!canDeploy}>
            {busy ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <FlaskConical className="size-4" aria-hidden="true" />
            )}
            Deploy Test Contract
          </Button>
        }
      >
        {deploymentsQuery.isPending && launchId ? (
          <p className="text-xs text-muted-foreground">Loading attempts…</p>
        ) : attempts.length === 0 ? (
          <EmptyState
            icon={FlaskConical}
            title="No attempts yet"
            description="No test deployment has been attempted for this launch."
            compact
          />
        ) : (
          <ul className="flex flex-col gap-3">
            {attempts.map((a) => (
              <li
                key={a.id}
                className="rounded-md border border-border bg-surface-raised/40 p-3 text-xs"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-foreground">
                    Attempt #{a.attempt_number} · {DEPLOYMENT_STATUS_LABEL[a.status] ?? a.status} ·{" "}
                    {a.deployment_kind === "FIXED_SUPPLY_ERC20" ? "Test token" : "Inert artifact"}
                  </span>
                  <span className="text-muted-foreground">
                    {a.confirmations}/{REQUIRED_CONFIRMATIONS} confirmations
                  </span>
                </div>
                <p className="mt-1 break-all text-muted-foreground">
                  Deployer: {a.deployer_address}
                </p>
                {a.deployment_kind === "FIXED_SUPPLY_ERC20" ? (
                  <p className="mt-1 break-all text-muted-foreground">
                    {a.token_name} ({a.token_symbol}) · {formatWholeSupply(tokenSupplyText(a))}{" "}
                    tokens · {CARTEL_FIXED_ERC20_DECIMALS} decimals · recipient {a.token_recipient}
                  </p>
                ) : null}
                {a.tx_hash ? (
                  <p className="mt-1 break-all text-muted-foreground">
                    Tx:{" "}
                    <a
                      className="text-gold underline"
                      href={explorerTxUrl(a.tx_hash)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {a.tx_hash} <ExternalLink className="inline size-3" aria-hidden="true" />
                    </a>
                  </p>
                ) : null}
                {a.contract_address ? (
                  <p className="mt-1 flex flex-wrap items-center gap-1 break-all text-muted-foreground">
                    <CheckCircle2 className="size-3 text-emerald-500" aria-hidden="true" />
                    Verified test contract:{" "}
                    <a
                      className="text-gold underline"
                      href={explorerAddressUrl(a.contract_address)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {a.contract_address}
                    </a>
                  </p>
                ) : null}
                {a.failure_detail ? (
                  <p className="mt-1 text-destructive">{a.failure_detail}</p>
                ) : null}
                {!isTerminal(a.status) && a.tx_hash ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-2"
                    disabled={verifyMutation.isPending}
                    onClick={() => verifyMutation.mutate(a.id)}
                  >
                    <RefreshCw className="size-4" aria-hidden="true" />
                    Check verification
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          Retrying creates a new attempt; earlier attempts are preserved. Verification is manual to
          avoid hammering the public testnet RPC.
        </p>
      </Section>

      <Section
        variant="primary"
        title="Testnet token — internal test only"
        description="Fixed-supply ERC-20 from a frozen, pre-compiled artifact. Testnet only."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => void handleRunSimulation()}
              disabled={!canSimulate}
            >
              {simBusy ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <ShieldCheck className="size-4" aria-hidden="true" />
              )}
              Run simulation
            </Button>
            <Button size="sm" onClick={() => void handleDeployToken()} disabled={!canDeployToken}>
              {tokenBusy ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Coins className="size-4" aria-hidden="true" />
              )}
              Deploy Test Token
            </Button>
          </div>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <label htmlFor="token-name" className="text-xs font-medium text-muted-foreground">
              Token name
            </label>
            <Input
              id="token-name"
              value={tokenName}
              maxLength={32}
              placeholder="Cartel Test Token"
              onChange={(e) => setTokenName(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="token-symbol" className="text-xs font-medium text-muted-foreground">
              Symbol
            </label>
            <Input
              id="token-symbol"
              value={tokenSymbol}
              maxLength={11}
              placeholder="CTEST"
              onChange={(e) => setTokenSymbol(e.target.value.toUpperCase())}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="token-supply" className="text-xs font-medium text-muted-foreground">
              Total supply (whole tokens)
            </label>
            <Input
              id="token-supply"
              inputMode="numeric"
              value={tokenSupply}
              onChange={(e) => setTokenSupply(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="token-recipient" className="text-xs font-medium text-muted-foreground">
              Initial recipient
            </label>
            <Input
              id="token-recipient"
              value={tokenRecipient}
              placeholder="0x…"
              onChange={(e) => setTokenRecipient(e.target.value)}
            />
          </div>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Decimals: {CARTEL_FIXED_ERC20_DECIMALS} (fixed) · Artifact:{" "}
          {CARTEL_FIXED_ERC20_ARTIFACT_ID}
        </p>

        {simulation ? (
          <SimulationReviewCard simulation={simulation} stale={false} nowMs={nowMs} />
        ) : (
          <p className="mt-3 text-xs text-destructive">
            Deployment is locked until a simulation passes. Editing any field above requires a new
            simulation. Estimates expire after {SIMULATION_QUOTE_TTL_MS / 1000} seconds.
          </p>
        )}

        {recoveryPanel}

        {latest ? (
          <div className="mt-3">
            <LaunchReceiptCard
              receipt={deriveLaunchReceipt({ row: latest, activeSimulation: simulation })}
            />
          </div>
        ) : null}

        <div className="mt-3 rounded-lg border border-gold/40 bg-gold/10 p-3 text-xs leading-relaxed">
          <p className="flex items-center gap-2 font-semibold uppercase tracking-wide text-gold">
            <AlertTriangle className="size-4" aria-hidden="true" />
            Immutable — read before signing
          </p>
          <ul className="mt-1 list-disc space-y-1 pl-4 text-muted-foreground">
            <li>
              Name <span className="text-foreground">{tokenName.trim() || "—"}</span>, symbol{" "}
              <span className="text-foreground">{tokenSymbol.trim().toUpperCase() || "—"}</span>,
              supply <span className="text-foreground">{tokenSupply.trim() || "—"}</span> whole
              tokens, {CARTEL_FIXED_ERC20_DECIMALS} decimals.
            </li>
            <li className="break-all">
              100% of the supply is minted once, at deployment, to{" "}
              <span className="text-foreground">{tokenRecipient.trim() || "—"}</span>.
            </li>
            <li>No owner or admin role exists after deployment. No post-deployment minting.</li>
            <li>No tax or fee, no blacklist or freeze, no pause or trading toggle, no limits.</li>
            <li>Robinhood Chain TESTNET {ROBINHOOD_TESTNET_CHAIN_ID} only. No mainnet path.</li>
            <li>
              This is NOT the official PEPECARTEL token. No liquidity and no trading are created,
              and no launch record or contract address is changed.
            </li>
          </ul>
        </div>
      </Section>

      <Section
        title="Liquidity readiness — testnet plan only"
        description="Derives a deterministic liquidity plan for a confirmed test token. No approval, pool or liquidity transaction is ever sent from this panel."
      >
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-xs leading-relaxed">
          <p className="font-semibold uppercase tracking-wide text-destructive">
            Plan only — no approval or liquidity transaction will be sent.
          </p>
          <p className="mt-1 text-muted-foreground">
            Robinhood Chain Testnet liquidity infrastructure is not yet verified, so execution
            remains blocked.
          </p>
        </div>

        {liquiditySources.length === 0 ? (
          <p className="mt-3 text-xs text-muted-foreground">
            No confirmed fixed-supply test token exists for this launch yet. Deploy and verify one
            above first.
          </p>
        ) : (
          <>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1">
                <label htmlFor="liq-source" className="text-xs font-medium text-muted-foreground">
                  Confirmed test token
                </label>
                <select
                  id="liq-source"
                  className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                  value={liquiditySource?.id ?? ""}
                  onChange={(e) => setLiqSourceId(e.target.value)}
                >
                  {liquiditySources.map((a) => (
                    <option key={a.id} value={a.id}>
                      #{a.attempt_number} · {a.verified_token_symbol ?? a.token_symbol ?? "—"} ·{" "}
                      {a.contract_address}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label
                  htmlFor="liq-token-amount"
                  className="text-xs font-medium text-muted-foreground"
                >
                  Token amount (whole tokens)
                </label>
                <Input
                  id="liq-token-amount"
                  inputMode="decimal"
                  placeholder="100000"
                  value={liqTokenAmount}
                  onChange={(e) => setLiqTokenAmount(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1">
                <label
                  htmlFor="liq-eth-amount"
                  className="text-xs font-medium text-muted-foreground"
                >
                  Pair amount (ETH)
                </label>
                <Input
                  id="liq-eth-amount"
                  inputMode="decimal"
                  placeholder="0.5"
                  value={liqEthAmount}
                  onChange={(e) => setLiqEthAmount(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="liq-slippage" className="text-xs font-medium text-muted-foreground">
                  Slippage (bps, {SLIPPAGE_BPS_MIN}–{SLIPPAGE_BPS_MAX})
                </label>
                <Input
                  id="liq-slippage"
                  inputMode="numeric"
                  value={liqSlippage}
                  onChange={(e) => setLiqSlippage(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="liq-deadline" className="text-xs font-medium text-muted-foreground">
                  Deadline (minutes, {DEADLINE_MINUTES_MIN}–{DEADLINE_MINUTES_MAX})
                </label>
                <Input
                  id="liq-deadline"
                  inputMode="numeric"
                  value={liqDeadline}
                  onChange={(e) => setLiqDeadline(e.target.value)}
                />
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" onClick={handleBuildLiquidityPlan}>
                Build Liquidity Plan
              </Button>
              <span className="text-xs text-muted-foreground">
                Plans expire after {LIQUIDITY_PLAN_TTL_MS / 1000} seconds and are discarded when any
                input, the wallet or the network changes.
              </span>
            </div>

            {liqPlan ? <LiquidityPlanCard plan={liqPlan} nowMs={nowMs} /> : null}
          </>
        )}
      </Section>
        </>
      )}
    </div>
  );
}
