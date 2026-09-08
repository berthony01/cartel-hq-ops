import { useCallback, useEffect, useState } from "react";
import { Loader2, Smartphone, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Section } from "@/components/cartel/Section";
import { ReadoutLine } from "@/components/cartel/CanaryReadout";
import {
  connectInjected,
  connectWalletConnect,
  disconnect,
  getActiveConnectorKind,
  isInjectedWalletAvailable,
  isWalletConnectConfigured,
  subscribeWalletConnector,
  type WalletConnectorNotice,
} from "@/lib/wallet-connector";
import { inspectMainnetWalletForHandoff } from "@/lib/chain-mainnet-wallet";

/**
 * P3C-G — MAINNET deployment wallet panel.
 *
 * Connection only. This panel never signs, never sends, and never advances the
 * canary sequence: connecting cannot trigger Presign, Arm, Claim, Send Window
 * or Send. Every inspection is read-only (`eth_accounts` / `eth_chainId`).
 */

type Props = {
  expectedDeployer: string | null;
  expectedChainId: number;
};

const NOTICE_COPY: Record<WalletConnectorNotice, string> = {
  NO_INJECTED_PROVIDER: "No browser wallet detected on this device.",
  WALLETCONNECT_NOT_CONFIGURED:
    "WalletConnect is not configured for this deployment. A public WalletConnect project id must be present in the environment before mobile connection is possible.",
  WALLETCONNECT_INIT_FAILED: "WalletConnect could not start. Nothing was connected.",
  CONNECTION_REJECTED_OR_FAILED: "The wallet connection was rejected or failed. Nothing changed.",
  NO_ACCOUNT: "The wallet is reachable but exposed no account.",
};

export function DeploymentWalletConnect({ expectedDeployer, expectedChainId }: Props) {
  const [busy, setBusy] = useState<"injected" | "walletconnect" | "refresh" | "disconnect" | null>(
    null,
  );
  const [notice, setNotice] = useState<WalletConnectorNotice | null>(null);
  const [kind, setKind] = useState<string | null>(null);
  const [walletLabel, setWalletLabel] = useState<string | null>(null);
  const [account, setAccount] = useState<string | null>(null);
  const [chainId, setChainId] = useState<string | null>(null);
  const [accountMatches, setAccountMatches] = useState(false);
  const [chainMatches, setChainMatches] = useState(false);
  const [injectedAvailable, setInjectedAvailable] = useState(false);
  const [walletConnectReady, setWalletConnectReady] = useState(false);

  const refresh = useCallback(async () => {
    setInjectedAvailable(isInjectedWalletAvailable());
    setWalletConnectReady(isWalletConnectConfigured());
    setKind(getActiveConnectorKind());
    const inspection = await inspectMainnetWalletForHandoff(expectedDeployer ?? "");
    setAccount(inspection.account);
    setChainId(inspection.chainId);
    setAccountMatches(inspection.accountMatches);
    setChainMatches(inspection.chainMatches);
  }, [expectedDeployer]);

  useEffect(() => {
    void refresh();
    return subscribeWalletConnector(() => {
      void refresh();
    });
  }, [refresh]);

  const chainIdDecimal = (() => {
    if (!chainId) return null;
    try {
      return BigInt(chainId).toString(10);
    } catch {
      return null;
    }
  })();

  return (
    <Section
      variant="surface"
      leading={<Wallet className="h-4 w-4" />}
      title="Deployment wallet connection"
      description="Connect the deployer wallet before any transaction stage. Connecting never signs, sends or advances the sequence."
    >
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="secondary"
          disabled={busy !== null || !walletConnectReady}
          onClick={async () => {
            setBusy("walletconnect");
            setNotice(null);
            const result = await connectWalletConnect();
            setNotice(result.notice);
            setWalletLabel(result.state.walletName);
            await refresh();
            setBusy(null);
          }}
        >
          {busy === "walletconnect" ? (
            <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Smartphone className="mr-2 h-3.5 w-3.5" />
          )}
          Robinhood Wallet / WalletConnect
        </Button>

        <Button
          size="sm"
          variant="outline"
          disabled={busy !== null || !injectedAvailable}
          onClick={async () => {
            setBusy("injected");
            setNotice(null);
            const result = await connectInjected();
            setNotice(result.notice);
            setWalletLabel(null);
            await refresh();
            setBusy(null);
          }}
        >
          {busy === "injected" ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
          Browser wallet
        </Button>

        <Button
          size="sm"
          variant="outline"
          disabled={busy !== null}
          onClick={async () => {
            setBusy("refresh");
            await refresh();
            setBusy(null);
          }}
        >
          Re-check wallet
        </Button>

        <Button
          size="sm"
          variant="outline"
          disabled={busy !== null || kind === null}
          onClick={async () => {
            setBusy("disconnect");
            await disconnect();
            setNotice(null);
            setWalletLabel(null);
            await refresh();
            setBusy(null);
          }}
        >
          Disconnect
        </Button>
      </div>

      {!walletConnectReady ? (
        <p className="mt-3 text-xs text-danger">{NOTICE_COPY.WALLETCONNECT_NOT_CONFIGURED}</p>
      ) : null}
      {!injectedAvailable ? (
        <p className="mt-1 text-xs text-muted-foreground">{NOTICE_COPY.NO_INJECTED_PROVIDER}</p>
      ) : null}
      {notice ? <p className="mt-2 text-xs text-danger">{NOTICE_COPY[notice]}</p> : null}

      <div className="mt-3 grid gap-1 sm:grid-cols-2">
        <ReadoutLine
          label={"Connector"}
          value={
            kind === "walletconnect"
              ? walletLabel
                ? `WalletConnect — ${walletLabel}`
                : "WalletConnect"
              : kind === "injected"
                ? "Browser wallet"
                : "Not connected"
          }
        />
        <ReadoutLine label={"Session"} value={account ? "Connected" : "Disconnected"} />
        <ReadoutLine label={"Wallet address"} value={account ?? "—"} />
        <ReadoutLine label={"Expected deployer"} value={expectedDeployer ?? "—"} />
        <ReadoutLine
          label={"Account check"}
          value={!account ? "—" : accountMatches ? "MATCH" : "MISMATCH"}
        />
        <ReadoutLine
          label={"Detected chain"}
          value={
            chainIdDecimal
              ? `${chainIdDecimal}${chainIdDecimal === String(expectedChainId) ? " (Robinhood Chain mainnet)" : ""}`
              : "—"
          }
        />
        <ReadoutLine label={"Expected chain"} value={String(expectedChainId)} />
        <ReadoutLine
          label={"Chain check"}
          value={!chainId ? "—" : chainMatches ? "MATCH" : "MISMATCH"}
        />
      </div>

      <p className="mt-3 text-[11px] text-muted-foreground">
        A wrong network or wrong account fails closed. Switch networks or accounts inside the wallet
        itself — CARTEL HQ never changes your wallet network for you.
      </p>
    </Section>
  );
}
