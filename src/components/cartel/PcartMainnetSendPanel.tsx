import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, CalendarClock, Lock, Rocket } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import type { DeploymentRow } from "@/lib/chain-launcher";
import { pcartExecutionPermitQueryKey } from "@/lib/pcart-production-execution-permit";
import { isPcartExecutionPermitActive } from "@/lib/pcart-production-execution";
import {
  buildVerifiedPcartSendEnvelope,
  isPcartSendConfirmed,
  pcartSendBlocked,
  pcartSendWindowState,
  PCART_CLAIM_MIN_PERMIT_LIFETIME_MS,
  PCART_SEND_ACK_TEXT,
  PCART_SEND_CONFIRM_PHRASE,
  readPcartSendMarker,
  writePcartSendMarker,
  type PcartPermitForSend,
  type PcartSendMarker,
} from "@/lib/pcart-production-send";
import { claimPcartMainnetSend, recoverPcartMainnetSend } from "@/lib/pcart-production-send.functions";
import { pcartPreSendCheck, sendCanonicalPcartDeploymentOnce } from "@/lib/pcart-production-send-wallet";
import { getPcartBoundWallet, subscribePcartWallet } from "@/lib/pcart-production-wallet";

export type PcartSendClaim = {
  id: string;
  deployment_id: string;
  permit_id: string;
  claim_status: "CLAIMED" | "BROADCAST" | "RELEASED" | "AMBIGUOUS";
  tx_hash: string | null;
  predicted_contract_address: string;
  claimed_at: string;
};

export const pcartSendClaimQueryKey = (deploymentId: string) => ["pcart-production-send-claim", deploymentId] as const;

export async function fetchLatestPcartSendClaim(deploymentId: string): Promise<PcartSendClaim | null> {
  const { data, error } = await supabase
    .from("pcart_production_send_claims")
    .select("id, deployment_id, permit_id, claim_status, tx_hash, predicted_contract_address, claimed_at")
    .eq("deployment_id", deploymentId)
    .order("claimed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return null;
  return (data as PcartSendClaim | null) ?? null;
}

async function fetchFullPermit(deploymentId: string): Promise<PcartPermitForSend | null> {
  const { data, error } = await supabase
    .from("pcart_production_execution_permits")
    .select("*")
    .eq("deployment_id", deploymentId)
    .order("issued_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return null;
  return (data as unknown as PcartPermitForSend | null) ?? null;
}

const REASON: Record<string, string> = {
  OUTSIDE_WINDOW: "Mainnet send is only available inside the launch window.",
  WRONG_LIFECYCLE: "The launch must be in LAUNCH_APPROACHING.",
  PERMIT_NOT_ACTIVE: "The final send permit expired or was used. Run P3 and P4 again.",
  ALREADY_CLAIMED: "A send claim already exists. Do not retry.",
  WRONG_ACCOUNT: "Connected wallet is not the reviewed deployer.",
  WRONG_CHAIN: "Wallet is not on Robinhood Chain mainnet.",
  NONCE_PENDING: "This wallet has a pending transaction.",
  NONCE_CHANGED: "The deployer nonce changed.",
  INSUFFICIENT_BALANCE: "Balance does not cover the maximum gas cost.",
  PREDICTED_ADDRESS_HAS_CODE: "The predicted contract address already has code.",
  DRAFT_NOT_UNSENT: "The draft is no longer unsent.",
};

const fmtUtc = (iso: string) => {
  const d = new Date(iso);
  const utc = d.toLocaleString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
  const local = d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  return { utc: `${utc} UTC`, local };
};

/**
 * PCART P5 — one-time mainnet deployment. Window-gated: no send button exists
 * outside the launch window. Claims server-side first, then exactly one wallet send.
 */
export function PcartMainnetSendPanel({
  attempt,
  launchWindowStart,
  launchWindowEnd,
  lifecycle,
  onChanged,
}: {
  attempt: DeploymentRow;
  launchWindowStart: string | null;
  launchWindowEnd: string | null;
  lifecycle: string | null;
  onChanged?: () => void;
}) {
  const qc = useQueryClient();
  const runClaim = useServerFn(claimPcartMainnetSend);
  const runRecover = useServerFn(recoverPcartMainnetSend);
  const [now, setNow] = useState(() => Date.now());
  const [bound, setBound] = useState(getPcartBoundWallet());
  const [ack, setAck] = useState(false);
  const [typed, setTyped] = useState("");
  const [marker, setMarker] = useState<PcartSendMarker | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => subscribePcartWallet(() => setBound(getPcartBoundWallet())), []);
  useEffect(() => setMarker(readPcartSendMarker(attempt.id)), [attempt.id]);

  const claimQuery = useQuery({ queryKey: pcartSendClaimQueryKey(attempt.id), queryFn: () => fetchLatestPcartSendClaim(attempt.id), refetchInterval: 10_000 });
  const permitQuery = useQuery({ queryKey: [...pcartExecutionPermitQueryKey(attempt.id), "full"], queryFn: () => fetchFullPermit(attempt.id), refetchInterval: 5_000 });
  const claim = claimQuery.data ?? null;
  const permit = permitQuery.data ?? null;
  const windowState = pcartSendWindowState(launchWindowStart, launchWindowEnd, lifecycle, now);
  const permitActive = isPcartExecutionPermitActive(permit, now);
  const permitClaimable = permitActive && !!permit && Date.parse(permit.expires_at) - now >= PCART_CLAIM_MIN_PERMIT_LIFETIME_MS;
  const txHash = attempt.tx_hash ?? claim?.tx_hash ?? (marker?.txHash || null);
  const blocked = pcartSendBlocked(claim, marker, attempt.tx_hash);
  const refresh = () => {
    setMarker(readPcartSendMarker(attempt.id));
    qc.invalidateQueries({ queryKey: pcartSendClaimQueryKey(attempt.id) });
    qc.invalidateQueries({ queryKey: pcartExecutionPermitQueryKey(attempt.id) });
    onChanged?.();
  };
  const saveMarker = (m: PcartSendMarker) => { writePcartSendMarker(m); setMarker(m); };

  const recordHash = async (claimId: string, hash: string) => {
    const { error } = await supabase.rpc("record_canonical_pcart_mainnet_tx_hash", { _claim_id: claimId, _tx_hash: hash });
    if (error) throw new Error("Transaction was broadcast but recording failed. Do NOT send again — use Retry recording transaction.");
  };

  const deployMutation = useMutation({
    mutationFn: async () => {
      setNote(null);
      if (windowState !== "OPEN") throw new Error(REASON["OUTSIDE_WINDOW"]);
      if (!isPcartSendConfirmed(ack, typed)) throw new Error("Tick the confirmation and type DEPLOY PCART exactly.");
      if (blocked) throw new Error(REASON["ALREADY_CLAIMED"]);
      if (!permit || !permitClaimable) throw new Error(REASON["PERMIT_NOT_ACTIVE"]);
      const deployer = String(attempt.deployer_address ?? "");
      const nonce = BigInt(attempt.deployer_nonce_before ?? -1);
      const env = buildVerifiedPcartSendEnvelope(permit, { deployer, nonce, initCodeHash: String(attempt.init_code_hash ?? "") });
      if (!env.ok) throw new Error("The reviewed transaction does not match the draft. Nothing was sent.");
      const b = getPcartBoundWallet();
      if (!b) throw new Error(REASON["WRONG_ACCOUNT"]);

      // 1. Server claim (window/lifecycle/permit/controls re-checked; permit consumed atomically).
      const c = await runClaim({ data: { deploymentId: attempt.id, permitId: permit.id, wallet: b.account } });
      if (!c.ok) throw new Error(REASON[c.reason] ?? "Claim refused. Nothing was sent.");
      const base: PcartSendMarker = {
        claimId: c.claimId, permitId: permit.id, deploymentId: attempt.id, deployer, nonce: nonce.toString(),
        predicted: permit.predicted_contract_address, unsignedTxFingerprint: permit.unsigned_tx_fingerprint,
        status: "SEND_IN_PROGRESS", txHash: null,
      };

      // 2. Fresh checks on the SAME bound provider. If they fail, nothing was sent.
      const pre = await pcartPreSendCheck({ deployer, nonce, predicted: permit.predicted_contract_address, maxCostWei: env.maxCostWei });
      if (!pre.ok) {
        await runRecover({ data: { claimId: c.claimId, mode: "RELEASE_REJECTED" } }).catch(() => null);
        throw new Error(`${REASON[pre.reason] ?? "Wallet check failed."} Nothing was sent. Run P3 and P4 again.`);
      }

      // 3. Marker BEFORE the wallet call, then exactly one send.
      saveMarker(base);
      const r = await sendCanonicalPcartDeploymentOnce(c.claimId, env.envelope);
      if (r.outcome === "HASH" && r.txHash) {
        saveMarker({ ...base, status: "HASH_RETURNED", txHash: r.txHash });
        await recordHash(c.claimId, r.txHash);
        saveMarker({ ...base, status: "RECORDED", txHash: r.txHash });
        return;
      }
      if (r.outcome === "REJECTED") {
        saveMarker({ ...base, status: "REJECTED" });
        const rel = await runRecover({ data: { claimId: c.claimId, mode: "RELEASE_REJECTED" } }).catch(() => null);
        throw new Error(rel && rel.ok && rel.state === "RELEASED"
          ? "You rejected the request in your wallet. Nothing was sent. Run P3 and P4 again to retry."
          : "You rejected the request. The claim stays locked until a recovery check proves nothing was sent.");
      }
      saveMarker({ ...base, status: "AMBIGUOUS" });
      await supabase.rpc("mark_canonical_pcart_send_ambiguous", { _claim_id: c.claimId });
      throw new Error("Send result unknown — do not retry. Use Check transaction status.");
    },
    onSettled: refresh,
  });

  const retryRecordMutation = useMutation({
    mutationFn: async () => {
      if (!marker?.txHash || !marker.claimId) throw new Error("No returned transaction hash on this device.");
      await recordHash(marker.claimId, marker.txHash);
      saveMarker({ ...marker, status: "RECORDED" });
    },
    onSettled: refresh,
  });

  const recoverMutation = useMutation({
    mutationFn: async (mode: "CHECK" | "RELEASE_AMBIGUOUS") => {
      if (!claim) throw new Error("No claim to check.");
      if (claim.claim_status === "CLAIMED" && !deployMutation.isPending) {
        await supabase.rpc("mark_canonical_pcart_send_ambiguous", { _claim_id: claim.id });
      }
      const r = await runRecover({ data: { claimId: claim.id, mode } });
      if (!r.ok) throw new Error("Recovery check failed. Do not retry the send.");
      const text: Record<string, string> = {
        ATTACHED: "Found the matching transaction and recorded it.",
        ALREADY_RECORDED: "The transaction is already recorded.",
        RELEASED: "Proven unsent. Claim released. Run P3 and P4 again.",
        CLEAN_NOT_RELEASED: "No transaction found yet. Check again after 2 minutes before clearing.",
        POSSIBLE_BROADCAST: "A transaction may have been sent. Do not retry.",
      };
      setNote(text[r.state] ?? null);
      if (r.state === "ATTACHED" && "txHash" in r) saveMarker({ ...(marker ?? ({} as PcartSendMarker)), deploymentId: attempt.id, claimId: claim.id, status: "RECORDED", txHash: r.txHash } as PcartSendMarker);
    },
    onSettled: refresh,
  });

  const busy = deployMutation.isPending || retryRecordMutation.isPending || recoverMutation.isPending;
  const errorText = [deployMutation.error, retryRecordMutation.error, recoverMutation.error].find((e) => e instanceof Error) as Error | undefined;

  // SUBMITTED / BROADCAST — final state for P5.
  if (attempt.status === "SUBMITTED" || claim?.claim_status === "BROADCAST") {
    return (
      <section aria-label="Mainnet transaction broadcast" className="min-w-0 space-y-2 rounded-lg border border-gold bg-card/60 p-4">
        <p className="flex items-center gap-2 text-sm font-bold text-gold"><Rocket className="size-4" aria-hidden="true" /> PCART MAINNET TRANSACTION BROADCAST — VERIFICATION REQUIRED</p>
        <dl className="grid gap-2 text-xs">
          <div className="min-w-0"><dt className="text-muted-foreground">Transaction hash</dt><dd className="font-semibold [overflow-wrap:anywhere]">{txHash}</dd></div>
          <div className="min-w-0"><dt className="text-muted-foreground">Predicted contract</dt><dd className="font-semibold [overflow-wrap:anywhere]">{claim?.predicted_contract_address ?? marker?.predicted}</dd></div>
        </dl>
        <p className="text-xs text-muted-foreground">Contract verification (P6) is next. No further send is possible.</p>
      </section>
    );
  }

  // Returned hash on this device but not recorded yet.
  if (marker?.txHash && marker.status !== "RECORDED") {
    return (
      <section aria-label="Record mainnet transaction" className="min-w-0 space-y-3 rounded-lg border border-destructive/60 bg-card/60 p-4">
        <p className="text-sm font-bold text-destructive">Transaction broadcast — record pending. Do NOT send again.</p>
        <p className="text-xs [overflow-wrap:anywhere]">{marker.txHash}</p>
        <Button type="button" className="min-h-11 w-full" disabled={busy} onClick={() => retryRecordMutation.mutate()}>Retry recording transaction</Button>
        {errorText ? <p role="alert" className="text-xs text-destructive">{errorText.message}</p> : null}
      </section>
    );
  }

  // Open claim (in flight elsewhere, or ambiguous).
  if (claim && (claim.claim_status === "CLAIMED" || claim.claim_status === "AMBIGUOUS") && !deployMutation.isPending) {
    return (
      <section aria-label="Send result unknown" className="min-w-0 space-y-3 rounded-lg border border-destructive/60 bg-card/60 p-4">
        <p className="flex items-center gap-2 text-sm font-bold text-destructive"><AlertTriangle className="size-4" aria-hidden="true" /> {claim.claim_status === "AMBIGUOUS" ? "Send result unknown — do not retry" : "Deployment claimed — awaiting wallet decision"}</p>
        <p className="text-xs text-muted-foreground">Recovery checks the chain for the deployer nonce and the predicted contract. A claim is only cleared when the chain proves nothing was sent.</p>
        <Button type="button" variant="outline" className="min-h-11 w-full" disabled={busy} onClick={() => recoverMutation.mutate("CHECK")}>Check transaction status</Button>
        <Button type="button" variant="outline" className="min-h-11 w-full" disabled={busy} onClick={() => recoverMutation.mutate("RELEASE_AMBIGUOUS")}>Confirm unsent and clear</Button>
        {note ? <p className="text-xs">{note}</p> : null}
        {errorText ? <p role="alert" className="text-xs text-destructive">{errorText.message}</p> : null}
      </section>
    );
  }

  const header = (
    <div>
      <p className="type-eyebrow text-gold">P5 — Mainnet deployment</p>
      <p className="mt-1 text-xs text-muted-foreground">One real transaction, sent by your wallet, only inside the launch window.</p>
    </div>
  );

  if (windowState !== "OPEN") {
    const start = launchWindowStart ? fmtUtc(launchWindowStart) : null;
    const status =
      windowState === "BEFORE" && start ? `Scheduled — send available ${start.utc}`
      : windowState === "AFTER" ? "Launch window closed — mainnet send unavailable"
      : windowState === "WRONG_LIFECYCLE" ? "Unavailable — launch must be LAUNCH_APPROACHING"
      : "Unavailable — no valid launch window saved";
    return (
      <section aria-label="Mainnet deployment" className="min-w-0 space-y-2 rounded-lg border border-gold/35 bg-card/60 p-4">
        {header}
        <p className="flex items-center gap-2 text-sm font-semibold"><CalendarClock className="size-4 text-gold" aria-hidden="true" /> {status}</p>
        {windowState === "BEFORE" && start ? <p className="text-xs text-muted-foreground">Your time: {start.local}</p> : null}
        <p className="flex items-center gap-2 text-xs text-muted-foreground"><Lock className="size-3" aria-hidden="true" /> P3 and P4 can still be used for review. No transaction can be claimed or sent before the window.</p>
      </section>
    );
  }

  const confirmed = isPcartSendConfirmed(ack, typed);
  const left = permit ? Math.max(0, Math.ceil((Date.parse(permit.expires_at) - now) / 1000)) : 0;
  return (
    <section aria-label="Mainnet deployment" className="min-w-0 space-y-3 rounded-lg border border-destructive/60 bg-card/60 p-4">
      {header}
      <p className="flex items-center gap-2 text-xs font-bold text-destructive"><AlertTriangle className="size-4" aria-hidden="true" /> REAL ROBINHOOD CHAIN MAINNET · REAL ETH · ONE TIME</p>
      <dl className="grid gap-2 text-xs sm:grid-cols-2">
        <div className="min-w-0"><dt className="text-muted-foreground">Token</dt><dd className="font-semibold">PEPECARTEL / PCART · 1,000,000,000</dd></div>
        <div className="min-w-0"><dt className="text-muted-foreground">Deployer</dt><dd className="font-semibold [overflow-wrap:anywhere]">{attempt.deployer_address}</dd></div>
        <div className="min-w-0"><dt className="text-muted-foreground">Treasury Safe recipient</dt><dd className="font-semibold [overflow-wrap:anywhere]">{attempt.token_recipient}</dd></div>
        <div className="min-w-0"><dt className="text-muted-foreground">Predicted contract</dt><dd className="font-semibold [overflow-wrap:anywhere]">{permit?.predicted_contract_address ?? "Run P4"}</dd></div>
      </dl>
      <label className="flex items-start gap-2 text-xs">
        <Checkbox checked={ack} disabled={busy} onCheckedChange={(v) => setAck(v === true)} aria-label="Mainnet deployment authorization" />
        <span>{PCART_SEND_ACK_TEXT}</span>
      </label>
      <div className="space-y-1">
        <label htmlFor="pcart-deploy-phrase" className="text-xs text-muted-foreground">Type {PCART_SEND_CONFIRM_PHRASE}</label>
        <Input id="pcart-deploy-phrase" value={typed} disabled={busy} autoComplete="off" onChange={(e) => setTyped(e.target.value)} />
      </div>
      {!permitClaimable ? (
        <p className="text-xs text-muted-foreground">Fresh wallet preparation and final send review required. Complete P3 and P4 above, then deploy within the permit time.</p>
      ) : !bound ? (
        <p className="text-xs text-muted-foreground">Connect the deployer wallet above.</p>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">Permit valid for {left}s.</p>
          <Button type="button" variant="destructive" className="min-h-11 w-full" disabled={busy || !confirmed || blocked} onClick={() => deployMutation.mutate()}>
            {deployMutation.isPending ? "Waiting for wallet…" : "Deploy PEPECARTEL on mainnet"}
          </Button>
        </>
      )}
      {errorText ? <p role="alert" className="text-xs text-destructive">{errorText.message}</p> : null}
    </section>
  );
}
