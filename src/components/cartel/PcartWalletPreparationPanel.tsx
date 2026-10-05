import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Lock, ShieldCheck, Wallet } from "lucide-react";
import { formatEther } from "viem";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import type { DeploymentRow } from "@/lib/chain-launcher";
import { predictPcartProductionAddress, shortAddress } from "@/lib/pcart-production-intent";
import {
  authorizePcartProductionPreparation,
  checkPcartProductionPreparation,
  type PcartPreparationCheck,
} from "@/lib/pcart-production-preparation.functions";
import {
  PCART_PREPARATION_MAX_TTL_MS,
  cancelPcartPreparation,
  fetchLatestPcartPreparation,
  isPcartPreparationActive,
  pcartPreparationQueryKey,
} from "@/lib/pcart-production-preparation";
import {
  chooseAnotherPcartWallet,
  connectPcartChooser,
  connectPcartInjected,
  disconnectPcartWallet,
  evaluatePcartWalletBinding,
  getPcartBoundWallet,
  isPcartChooserConfigured,
  isPcartInjectedAvailable,
  readPcartWalletEvidence,
  requestPcartMainnetSwitch,
  subscribePcartWallet,
  type PcartWalletEvidence,
} from "@/lib/pcart-production-wallet";

const BINDING_TEXT: Record<string, string> = {
  NO_WALLET: "Connect the deployer wallet.",
  WRONG_ACCOUNT: "This is not the reviewed deployer wallet. Choose another wallet.",
  WRONG_CHAIN: "Wallet is not on Robinhood Chain mainnet (4663).",
  NONCE_UNREADABLE: "Could not read the wallet nonce.",
  NONCE_PENDING: "This wallet has a pending transaction. Wait for it to settle.",
  NONCE_CHANGED: "The deployer nonce changed since review. Abandon the draft and review again.",
};
const CHECK_TEXT: Record<string, string> = {
  NOT_PLATFORM_OWNER: "Only the platform owner can prepare the wallet.",
  DRAFT_CHANGED: "The saved draft no longer matches. Abandon it and review again.",
  NONCE_CHANGED: "The deployer nonce changed since review. Abandon the draft and review again.",
  NONCE_PENDING: "This wallet has a pending transaction. Wait for it to settle.",
  WRONG_ACCOUNT: "This is not the reviewed deployer wallet.",
  EXECUTION_NOT_LOCKED: "Mainnet execution is not locked. Preparation refused.",
  APPROVAL_MISSING_OR_STALE: "Production readiness approval no longer matches.",
  PREDICTED_ADDRESS_HAS_CODE: "The predicted contract address already has code. Preparation refused.",
  SAFE_HAS_NO_CODE: "The Treasury Safe has no code on Robinhood Chain.",
  SEND_STAGE_ALREADY_EXISTS: "A later send stage already exists for this draft. Preparation refused.",
  WALLET_EVIDENCE_MISMATCH: "Wallet evidence changed. Run the check again.",
  ALREADY_ACTIVE: "A wallet preparation is already active.",
};

type Props = { attempt: DeploymentRow };

/**
 * PCART P3 — wallet-ready preparation. There is NO send, sign, presign-send,
 * send-window, arming or registration action in this component.
 */
export function PcartWalletPreparationPanel({ attempt }: Props) {
  const qc = useQueryClient();
  const runCheck = useServerFn(checkPcartProductionPreparation);
  const runAuthorize = useServerFn(authorizePcartProductionPreparation);
  const [bound, setBound] = useState(getPcartBoundWallet());
  const [evidence, setEvidence] = useState<PcartWalletEvidence | null>(null);
  const [check, setCheck] = useState<PcartPreparationCheck | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [requestId, setRequestId] = useState(() => `pcart-prep-${crypto.randomUUID()}`);

  const nonce = BigInt(attempt.deployer_nonce_before ?? -1);
  const deployer = String(attempt.deployer_address ?? "");
  const predicted = nonce >= 0n && deployer ? predictPcartProductionAddress(deployer, nonce) : "—";

  const authQuery = useQuery({
    queryKey: pcartPreparationQueryKey(attempt.id),
    queryFn: () => fetchLatestPcartPreparation(attempt.id),
  });
  const active = isPcartPreparationActive(authQuery.data, now);

  useEffect(() => subscribePcartWallet(() => {
    setBound(getPcartBoundWallet());
    setEvidence(null);
    setCheck(null);
    setConfirmed(false);
  }), []);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const refreshEvidence = async () => setEvidence(await readPcartWalletEvidence());
  const binding = evaluatePcartWalletBinding(evidence, { deployer, nonce });
  const checkFresh = !!check && now - check.checkedAt < PCART_PREPARATION_MAX_TTL_MS;

  const connect = async (fn: () => Promise<{ ok: boolean; reason?: string }>) => {
    setBusy(true);
    setNotice(null);
    try {
      const r = await fn();
      if (!r.ok) setNotice((r as { reason: string }).reason);
      else await refreshEvidence();
    } finally {
      setBusy(false);
    }
  };

  const checkMutation = useMutation({
    mutationFn: async () => {
      await refreshEvidence();
      const ev = await readPcartWalletEvidence();
      const b = evaluatePcartWalletBinding(ev, { deployer, nonce });
      if (!b.ok) throw new Error(BINDING_TEXT[b.reason]);
      const r = await runCheck({ data: { deploymentId: attempt.id, wallet: ev!.account } });
      if (!r.ok) throw new Error(CHECK_TEXT[r.reason] ?? "Preparation check failed. Nothing was saved.");
      return r;
    },
    onMutate: () => {
      setCheck(null);
      setConfirmed(false);
    },
    onSuccess: (r) => setCheck(r),
  });

  const authorizeMutation = useMutation({
    mutationFn: async () => {
      if (!check || Date.now() - check.checkedAt >= PCART_PREPARATION_MAX_TTL_MS) throw new Error("Check expired. Run it again.");
      const ev = await readPcartWalletEvidence();
      const b = evaluatePcartWalletBinding(ev, { deployer, nonce });
      if (!b.ok || !ev) throw new Error(BINDING_TEXT[b.ok ? "NO_WALLET" : b.reason]);
      const r = await runAuthorize({
        data: {
          deploymentId: attempt.id,
          wallet: ev.account,
          clientRequestId: requestId,
          observedChainId: ev.chainId ?? 0,
          observedLatestNonce: String(ev.latestNonce),
          observedPendingNonce: String(ev.pendingNonce),
        },
      });
      if (!r.ok) throw new Error(CHECK_TEXT[r.reason] ?? "Authorization refused. Nothing was sent.");
      return r.authorization;
    },
    onSuccess: () => {
      setCheck(null);
      setConfirmed(false);
      setRequestId(`pcart-prep-${crypto.randomUUID()}`);
      qc.invalidateQueries({ queryKey: pcartPreparationQueryKey(attempt.id) });
    },
  });

  const cancelMutation = useMutation({
    mutationFn: () => cancelPcartPreparation(authQuery.data!.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: pcartPreparationQueryKey(attempt.id) }),
  });

  const summary: [string, string][] = [
    ["Artifact", "pepecartel-token-v1"],
    ["Deployer", deployer],
    ["Nonce", String(attempt.deployer_nonce_before ?? "—")],
    ["Safe recipient", String(attempt.token_recipient ?? "—")],
    ["Predicted contract", predicted],
    ["Review fingerprint", attempt.review_fingerprint ? `${attempt.review_fingerprint.slice(0, 10)}…` : "—"],
  ];

  if (active && authQuery.data) {
    const left = Math.max(0, Math.ceil((Date.parse(authQuery.data.expires_at) - now) / 1000));
    return (
      <section aria-label="Wallet ready" className="min-w-0 space-y-3 rounded-lg border border-gold/50 bg-card/60 p-4">
        <p className="flex items-center gap-2 text-sm font-bold text-gold">
          <Lock className="size-4" aria-hidden="true" /> WALLET READY — MAINNET SEND LOCKED
        </p>
        <p className="text-xs text-muted-foreground">
          Expires in {left}s ({new Date(authQuery.data.expires_at).toLocaleTimeString()}). No transaction has been or can be sent in this phase.
        </p>
        <Button type="button" variant="outline" className="min-h-11 w-full" disabled={cancelMutation.isPending} onClick={() => cancelMutation.mutate()}>
          Cancel authorization
        </Button>
        {cancelMutation.error instanceof Error ? <p role="alert" className="text-xs text-destructive">{cancelMutation.error.message}</p> : null}
      </section>
    );
  }

  return (
    <section aria-label="Prepare wallet" className="min-w-0 space-y-3 rounded-lg border border-gold/35 bg-card/60 p-4">
      <div>
        <p className="type-eyebrow text-gold">P3 — Prepare wallet</p>
        <p className="mt-1 text-xs text-muted-foreground">Bind the reviewed deployer wallet. Nothing is signed or sent.</p>
      </div>
      <dl className="grid gap-2 text-xs sm:grid-cols-2">
        {summary.map(([k, v]) => (
          <div key={k} className="min-w-0">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="font-semibold [overflow-wrap:anywhere]">{v}</dd>
          </div>
        ))}
      </dl>

      {!bound ? (
        <div className="grid gap-2 sm:grid-cols-2">
          <Button type="button" className="min-h-11" disabled={busy || !isPcartChooserConfigured()} onClick={() => connect(connectPcartChooser)}>
            <Wallet className="size-4" aria-hidden="true" /> Connect deployer wallet
          </Button>
          {isPcartInjectedAvailable() ? (
            <Button type="button" variant="outline" className="min-h-11" disabled={busy} onClick={() => connect(connectPcartInjected)}>
              Use browser extension
            </Button>
          ) : null}
        </div>
      ) : (
        <div className="min-w-0 space-y-2 rounded-md border border-border-subtle p-3 text-xs">
          <dl className="grid gap-2 sm:grid-cols-2">
            <div className="min-w-0"><dt className="text-muted-foreground">Account</dt><dd className="font-semibold [overflow-wrap:anywhere]">{evidence?.account || bound.account}</dd></div>
            <div><dt className="text-muted-foreground">Network</dt><dd className="font-semibold">{evidence?.chainId ?? "—"}</dd></div>
            <div><dt className="text-muted-foreground">Nonce (latest / pending)</dt><dd className="font-semibold">{evidence ? `${evidence.latestNonce ?? "—"} / ${evidence.pendingNonce ?? "—"}` : "—"}</dd></div>
            <div><dt className="text-muted-foreground">Balance</dt><dd className="font-semibold">{evidence?.balanceWei != null ? `${formatEther(evidence.balanceWei)} ETH` : "—"}</dd></div>
          </dl>
          {!binding.ok && evidence ? <p role="alert" className="text-destructive">{BINDING_TEXT[binding.reason]}</p> : null}
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" className="min-h-11" disabled={busy} onClick={() => connect(async () => { await refreshEvidence(); return { ok: true }; })}>Refresh</Button>
            {!binding.ok && binding.reason === "WRONG_CHAIN" ? (
              <Button type="button" variant="outline" size="sm" className="min-h-11" disabled={busy} onClick={() => connect(async () => ({ ok: await requestPcartMainnetSwitch(), reason: "Network switch was not completed." }))}>
                Switch to Robinhood Chain
              </Button>
            ) : null}
            <Button type="button" variant="outline" size="sm" className="min-h-11" disabled={busy || !isPcartChooserConfigured()} onClick={() => connect(chooseAnotherPcartWallet)}>Choose another wallet</Button>
            <Button type="button" variant="ghost" size="sm" className="min-h-11" disabled={busy} onClick={() => connect(async () => { await disconnectPcartWallet(); return { ok: true }; })}>Disconnect</Button>
          </div>
        </div>
      )}
      {notice ? <p role="alert" className="text-xs text-destructive">{notice}</p> : null}

      {bound && binding.ok ? (
        <Button type="button" className="min-h-11 w-full" disabled={checkMutation.isPending} onClick={() => checkMutation.mutate()}>
          {checkMutation.isPending ? "Checking…" : "Run final preparation check"}
        </Button>
      ) : null}
      {checkMutation.error instanceof Error ? <p role="alert" className="text-xs text-destructive">{checkMutation.error.message}</p> : null}

      {check ? (
        <div className="min-w-0 space-y-3 rounded-md border border-border-subtle p-3 text-xs">
          <p>Gas estimate {check.gasEstimate} · max cost ≈ {formatEther(BigInt(check.estimatedMaxCostWei))} ETH</p>
          <p className="text-muted-foreground">{checkFresh ? `Check valid for ${Math.max(0, Math.ceil((check.checkedAt + PCART_PREPARATION_MAX_TTL_MS - now) / 1000))}s.` : "Check expired. Run it again."}</p>
          <label className="flex items-start gap-2">
            <Checkbox checked={confirmed} onCheckedChange={(v) => setConfirmed(v === true)} aria-label="Confirm preparation only" />
            <span>I understand this only prepares the reviewed deployment. No transaction will be sent.</span>
          </label>
          <Button type="button" className="min-h-11 w-full" disabled={!checkFresh || !confirmed || authorizeMutation.isPending} onClick={() => authorizeMutation.mutate()}>
            <ShieldCheck className="size-4" aria-hidden="true" /> Authorize wallet-ready state
          </Button>
          {authorizeMutation.error instanceof Error ? <p role="alert" className="text-destructive">{authorizeMutation.error.message}</p> : null}
        </div>
      ) : null}
      <p className="flex items-center gap-2 text-xs text-muted-foreground"><Lock className="size-3" aria-hidden="true" /> MAINNET EXECUTION LOCKED</p>
    </section>
  );
}
