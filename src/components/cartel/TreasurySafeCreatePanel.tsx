import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getAddress } from "viem";
import { CheckCircle2, Loader2, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/cartel/StatusBadge";
import {
  getTreasurySafeStatus,
  preflightTreasurySafeCreation,
  verifyAndRecordTreasurySafe,
  type TreasurySafePreflightResponse,
} from "@/lib/treasury-safe-create.functions";
import {
  SAFE_FALLBACK_HANDLER,
  SAFE_PROXY_FACTORY,
  SAFE_CREATE_SINGLETON,
} from "@/lib/treasury-safe-create";
import { sendTreasurySafeCreation } from "@/lib/treasury-safe-wallet";
import {
  getLaunchTreasurySigners,
  treasurySignerConfigQueryKey,
  type TreasurySignerConfig,
} from "@/lib/treasury-signers";
import {
  connectInjected,
  connectWalletConnectOnRobinhoodChain,
  getActiveAccount,
  isInjectedWalletAvailable,
  isWalletConnectConfigured,
} from "@/lib/wallet-connector";

/**
 * PCART treasury Safe creation card. One explicit wallet confirmation, no
 * automatic retry. After any send attempt the button is permanently replaced
 * by read-only checking of the predicted Safe address for this session.
 * Treasury setup only — never touches PCART token deployment controls.
 */

export function treasurySafeStatusQueryKey(launchId: string | null | undefined) {
  return ["treasury-safe-status", launchId ?? "none"] as const;
}

const show = (a: string) => {
  try {
    return getAddress(a);
  } catch {
    return a;
  }
};

type Phase =
  | "idle"
  | "preflighting"
  | "awaiting_wallet"
  | "submitted"
  | "verifying"
  | "verified"
  | "ambiguous"
  | "error";

export function TreasurySafeCreatePanel({
  launchId,
  isWorkspaceOwner,
  signerConfig,
  disabled,
}: {
  launchId: string;
  isWorkspaceOwner: boolean;
  signerConfig?: TreasurySignerConfig | undefined;
  disabled?: boolean;
}) {
  const qc = useQueryClient();
  const preflightFn = useServerFn(preflightTreasurySafeCreation);
  const recordFn = useServerFn(verifyAndRecordTreasurySafe);
  const statusFn = useServerFn(getTreasurySafeStatus);

  const signerQuery = useQuery({
    queryKey: treasurySignerConfigQueryKey(launchId),
    queryFn: () => getLaunchTreasurySigners(launchId),
    enabled: !signerConfig,
  });
  const statusQuery = useQuery({
    queryKey: treasurySafeStatusQueryKey(launchId),
    queryFn: () => statusFn({ data: { launchId } }),
    enabled: !!signerQuery.data,
  });
  const reviewQuery = useQuery({
    queryKey: ["treasury-safe-preflight", launchId, signerQuery.data?.updatedAt ?? "none"],
    queryFn: () => preflightFn({ data: { launchId } }),
    enabled: !!signerQuery.data && isWorkspaceOwner && statusQuery.data?.ready !== true,
    staleTime: 30_000,
  });

  const [phase, setPhase] = useState<Phase>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [sendAttempted, setSendAttempted] = useState(false);
  const [account, setAccount] = useState<string | null>(null);

  useEffect(() => {
    setAccount(getActiveAccount());
  }, []);

  const savedSignerConfig = signerConfig ?? signerQuery.data ?? null;
  const signers = savedSignerConfig?.signers ?? null;
  const review: TreasurySafePreflightResponse | undefined = reviewQuery.data;
  const predicted = review?.preflight.predictedAddress ?? null;
  const ready = statusQuery.data?.ready === true;

  if (!signers) return null;

  async function connect() {
    setMessage(null);
    if (isInjectedWalletAvailable()) {
      const r = await connectInjected();
      setAccount(r.ok ? r.state.account : null);
      if (!r.ok) setMessage("The wallet could not be connected.");
      return;
    }
    if (isWalletConnectConfigured()) {
      const r = await connectWalletConnectOnRobinhoodChain();
      setAccount(r.connect.ok ? r.connect.state.account : null);
      if (!r.connect.ok) setMessage("The wallet could not be connected.");
      return;
    }
    setMessage("No wallet is available on this device.");
  }

  async function verifyOnly(hash: string | null) {
    setPhase("verifying");
    try {
      const r = await recordFn({ data: { launchId, txHash: hash } });
      setMessage(r.message);
      if (r.status === "VERIFIED_SAVED") {
        setPhase("verified");
        await qc.invalidateQueries({ queryKey: treasurySafeStatusQueryKey(launchId) });
      } else if (r.status === "PENDING_RECEIPT") {
        setPhase(hash ? "submitted" : "ambiguous");
      } else {
        setPhase("error");
      }
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Verification failed.");
      setPhase(hash ? "submitted" : "ambiguous");
    }
  }

  async function createSafe() {
    if (sendAttempted || !signers) return;
    setMessage(null);
    setPhase("preflighting");
    let fresh: TreasurySafePreflightResponse;
    try {
      fresh = await preflightFn({ data: { launchId } });
    } catch (e) {
      setPhase("error");
      setMessage(e instanceof Error ? e.message : "Preflight failed.");
      return;
    }
    if (fresh.preflight.alreadyDeployed) {
      await verifyOnly(null);
      return;
    }
    if (!fresh.preflight.ok || fresh.preflight.predictedAddress !== predicted) {
      setPhase("error");
      setMessage(fresh.preflight.message || "Preflight did not pass. Nothing was sent.");
      return;
    }
    setPhase("awaiting_wallet");
    const result = await sendTreasurySafeCreation({
      plan: fresh.plan,
      launchId,
      savedSigners: signers,
      preflightOk: fresh.preflight.ok,
    });
    if (result.sendInvoked) setSendAttempted(true);
    if (!result.sendInvoked) {
      setPhase("idle");
      setMessage(
        result.notice === "NOT_A_SIGNER"
          ? "The connected wallet is not one of the three signer wallets."
          : result.notice === "WRONG_CHAIN"
            ? "Switch your wallet to Robinhood Chain, then try again."
            : result.notice === "NO_WALLET" || result.notice === "ACCOUNT_UNVERIFIED"
              ? "Connect a signer wallet first."
              : "The transaction did not match the reviewed plan. Nothing was sent.",
      );
      return;
    }
    if (!result.ok || !result.txHash) {
      setPhase("ambiguous");
      setMessage(
        `The wallet did not return a clear result. Nothing will be resent. Check the predicted Safe address: ${predicted ?? "unavailable"}.`,
      );
      return;
    }
    setTxHash(result.txHash);
    setPhase("submitted");
    await verifyOnly(result.txHash);
  }

  const busy = phase === "preflighting" || phase === "awaiting_wallet" || phase === "verifying";
  const canCreate =
    isWorkspaceOwner &&
    !disabled &&
    !busy &&
    !sendAttempted &&
    !!account &&
    review?.preflight.ok === true &&
    !!predicted;

  return (
    <div className="min-w-0 space-y-3 rounded-lg border border-border-subtle bg-surface-raised/30 p-4">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <ShieldCheck className="h-4 w-4 shrink-0 text-primary" aria-hidden />
          Create treasury Safe
        </p>
        {ready ? <StatusBadge tone="green">Treasury Ready</StatusBadge> : null}
      </div>

      {ready && statusQuery.data?.persistedSafeAddress ? (
        <div className="min-w-0 space-y-1 text-xs text-muted-foreground">
          <p className="flex items-center gap-1.5 text-foreground">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" aria-hidden />
            Safe verified just now on Robinhood Chain.
          </p>
          <p className="font-semibold text-foreground">Treasury Safe address</p>
          <p className="break-all font-mono text-foreground">{show(statusQuery.data.persistedSafeAddress)}</p>
          <p className="text-[11px]">
            This is the treasury contract address. It is not a signer wallet.
          </p>
        </div>
      ) : (
        <>
          <ul className="min-w-0 space-y-1 text-xs leading-relaxed text-muted-foreground">
            <li>Network: Robinhood Chain mainnet</li>
            <li>3 owners, 2 approvals required</li>
          </ul>
          {!account ? (
            <p className="text-xs text-muted-foreground">
              Connect one of your 3 signer wallets to create the treasury Safe.
            </p>
          ) : null}

          {!isWorkspaceOwner ? (
            <p className="text-xs text-muted-foreground">Only the workspace owner can create the Safe.</p>
          ) : review?.preflight.alreadyDeployed ? (
            <Button size="sm" className="w-full sm:w-auto" disabled={busy} onClick={() => void verifyOnly(null)}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : null}
              Verify existing Safe
            </Button>
          ) : !account ? (
            <Button size="sm" variant="outline" className="w-full sm:w-auto" onClick={() => void connect()}>
              Connect wallet
            </Button>
          ) : sendAttempted ? (
            <Button
              size="sm"
              variant="outline"
              className="w-full sm:w-auto"
              disabled={busy}
              onClick={() => void verifyOnly(txHash)}
            >
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : null}
              Check Safe status
            </Button>
          ) : (
            <Button size="sm" className="w-full sm:w-auto" disabled={!canCreate} onClick={() => void createSafe()}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : null}
              Create treasury Safe
            </Button>
          )}
          {account ? (
            <div className="min-w-0 space-y-0.5">
              <p className="text-xs font-semibold text-foreground">Connected signer wallet</p>
              <p className="break-all font-mono text-[11px] text-muted-foreground">{show(account)}</p>
              <p className="text-[11px] text-muted-foreground">
                Used only to approve this creation transaction. It must be one of your 3 signer
                wallets. It is not added as another owner.
              </p>
            </div>
          ) : null}
          {phase === "awaiting_wallet" ? (
            <p className="text-xs text-muted-foreground">Confirm the transaction in your wallet.</p>
          ) : null}
          {txHash ? (
            <p className="break-all text-[11px] text-muted-foreground">Transaction: {txHash}</p>
          ) : null}
          {message ? <p className="text-xs text-foreground">{message}</p> : null}
        </>
      )}

      <details className="min-w-0 text-[11px] text-muted-foreground">
        <summary className="cursor-pointer">Technical details</summary>
        <div className="mt-2 min-w-0 space-y-3">
          <div className="min-w-0 space-y-1">
            <p className="font-semibold text-foreground">Owners (your 3 signer wallets)</p>
            {signers.map((s) => (
              <p key={s} className="break-all font-mono text-foreground">{show(s)}</p>
            ))}
          </div>
          {!ready ? (
            <div className="min-w-0 space-y-1">
              <p className="font-semibold text-foreground">Predicted Safe contract address</p>
              <p>
                This is a new contract address for the treasury. It is not a wallet and it is not a
                fourth signer.
              </p>
              {reviewQuery.isLoading ? (
                <p>Checking Robinhood Chain…</p>
              ) : predicted ? (
                <p className="break-all font-mono text-foreground">{show(predicted)}</p>
              ) : (
                <p className="text-destructive">
                  {review?.preflight.message ?? "The Safe could not be prepared."}
                </p>
              )}
              {review?.preflight.alreadyDeployed ? (
                <p>A Safe already exists here. It will be checked; nothing will be sent.</p>
              ) : null}
            </div>
          ) : null}
          <div className="min-w-0 space-y-1 break-all font-mono">
            <p>Safe: Official v1.4.1 with its standard fallback handler</p>
            <p>Modules: None</p>
            <p>Guard: None</p>
          <p>Factory: {SAFE_PROXY_FACTORY}</p>
          <p>Singleton (SafeL2 1.4.1): {SAFE_CREATE_SINGLETON}</p>
          <p>Fallback handler: {SAFE_FALLBACK_HANDLER}</p>
          {review ? <p>Salt nonce: {review.plan.saltNonce}</p> : null}
          {review?.preflight.blockNumber ? <p>Preflight block: {review.preflight.blockNumber}</p> : null}
          </div>
        </div>
      </details>
    </div>
  );
}
