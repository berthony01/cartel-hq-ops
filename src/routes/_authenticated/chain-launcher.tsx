import { useCallback, useEffect, useMemo, useState } from "react";
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
  type Simulation,
} from "@/lib/chain-simulation";

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
  const [simulation, setSimulation] = useState<Simulation | null>(null);
  const [simBusy, setSimBusy] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const hasProvider = typeof window !== "undefined" && getInjectedProvider() !== null;
  const onTestnet = chainId === ROBINHOOD_TESTNET_CHAIN_ID;

  const launchesQuery = useQuery({
    queryKey: ["chain-launcher-launches", workspaceId ?? "none"],
    queryFn: () => listLaunches(workspaceId as string),
    enabled: isPlatformOwner === true && !!workspaceId,
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

  const attempts: DeploymentRow[] = deploymentsQuery.data ?? [];
  const latest = attempts[0] ?? null;
  const selectedLaunch = useMemo(
    () => launches.find((l) => l.id === launchId) ?? null,
    [launches, launchId],
  );

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
    setSimulation(null);
  }, [tokenName, tokenSymbol, tokenSupply, tokenRecipient, account, chainId]);

  useEffect(() => {
    if (!simulation) return;
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [simulation]);

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
    if (!launchId || !account || !onTestnet) return;
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
      setSimulation(result);
      if (!result.preflight.passed) toast.error("Simulation did not pass. Review the checks.");
    } catch (e) {
      setSimulation(null);
      toast.error(
        e instanceof SimulationError ? e.message : "Could not simulate this deployment.",
      );
    } finally {
      setSimBusy(false);
    }
  }

  async function handleDeployToken() {
    if (!launchId || !account || !onTestnet) return;
    if (!simulation) {
      toast.error("Run the simulation before deploying.");
      return;
    }

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
      setSimulation(null);
      toast.error(gate.reason);
      return;
    }

    // The reviewed intent is authoritative from here on. Nothing is rebuilt
    // from raw form state after the gate.
    const intent = simulation.intent.tokenIntent;
    if (buildTokenInitCode(intent) !== simulation.intent.initCode) {
      toast.error("The reviewed deployment payload could not be re-derived. Simulate again.");
      setSimulation(null);
      return;
    }

    setTokenBusy(true);
    let attemptId: string | null = null;
    let txHash: string | null = null;
    try {
      const attempt = await createTokenDeploymentAttempt({
        launchId,
        clientRequestId: newClientRequestId(),
        deployerAddress: account,
        intent,
      });
      attemptId = attempt.id;
      await invalidate();

      txHash = await broadcastTokenDeployment(account, intent);
      await submitDeploymentTx(attempt.id, txHash);
      await invalidate();
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
    !!launchId && !!account && onTestnet && !busy && (!latest || isTerminal(latest.status));
  const canDeployToken =
    !!launchId && !!account && onTestnet && !tokenBusy && (!latest || isTerminal(latest.status));

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
          <Button size="sm" onClick={() => void handleDeployToken()} disabled={!canDeployToken}>
            {tokenBusy ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Coins className="size-4" aria-hidden="true" />
            )}
            Deploy Test Token
          </Button>
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
    </div>
  );
}
