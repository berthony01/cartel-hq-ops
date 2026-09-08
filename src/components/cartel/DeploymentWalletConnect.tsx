import { useCallback, useEffect, useState } from "react";
import { ExternalLink, Loader2, Smartphone, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Section } from "@/components/cartel/Section";
import { ReadoutLine } from "@/components/cartel/CanaryReadout";
import {
  connectInjected,
  connectWalletConnect,
  disconnect,
  getActiveConnectorKind,
  getStandaloneAppUrl,
  isEmbeddedBrowserContext,
  isInjectedWalletAvailable,
  isWalletConnectConfigured,
  subscribeWalletConnector,
  WALLETCONNECT_CONNECT_TIMEOUT_MS,
  type WalletConnectorNotice,
} from "@/lib/wallet-connector";
import { inspectMainnetWalletForHandoff } from "@/lib/chain-mainnet-wallet";

/**
 * P3C-G — MAINNET deployment wallet panel.
 *
 * EXPLICIT CONNECT ONLY. Rendering this panel performs NO provider request:
 * mount-time work is limited to a presence check for an injected provider and a
 * read of the already-active connector kind. `inspectMainnetWalletForHandoff`
 * (eth_accounts / eth_chainId) runs only once a connector has been explicitly
 * activated by the operator clicking one of the two connect buttons.
 *
 * Connection only. This panel never signs, never sends, and never advances the
 * canary sequence: connecting cannot trigger Presign, Arm, Claim, Send Window
 * or Send.
 */

type Props = {
  expectedDeployer: string | null;
  expectedChainId: number;
};

const NOTICE_COPY: Record<WalletConnectorNotice, string> = {
  NO_INJECTED_PROVIDER: "No browser wallet detected on this device.",
  WALLETCONNECT_NOT_CONFIGURED:
    "WalletConnect is not configured for this deployment. A public WalletConnect project id must be present in the environment before mobile connection is possible.",
  WALLETCONNECT_LIBRARY_LOAD_FAILED:
    "Diagnostic code WALLETCONNECT_LIBRARY_LOAD_FAILED — the WalletConnect component could not be loaded in this browser. Nothing was connected. Try a standalone browser tab, or report this code.",
  WALLETCONNECT_INIT_FAILED:
    "Diagnostic code WALLETCONNECT_INIT_FAILED — WalletConnect loaded but could not start. Nothing was connected. Report this code.",
  WALLETCONNECT_TIMEOUT: `The wallet never completed the connection within ${Math.round(
    WALLETCONNECT_CONNECT_TIMEOUT_MS / 1000,
  )} seconds, so the attempt was cancelled and nothing was connected. This usually means the wallet hand-off could not return to this page. Open CARTEL HQ in a standalone browser tab, or inside the wallet's own browser, and choose the wallet again.`,
  WRONG_CHAIN_APPROVED:
    "The wallet connected, but Robinhood Chain mainnet (4663) was not approved. Nothing advanced and nothing stayed connected. Reconnect from a wallet or session that supports Robinhood Chain.",
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
  const [embedded, setEmbedded] = useState(false);
  const [standaloneUrl, setStandaloneUrl] = useState<string | null>(null);

  const clearInspection = useCallback(() => {
    setAccount(null);
    setChainId(null);
    setAccountMatches(false);
    setChainMatches(false);
  }, []);

  /**
   * Presence-only refresh. No provider request of any kind. Safe to run on
   * mount and on connector events.
   */
  const refreshAvailability = useCallback(() => {
    setInjectedAvailable(isInjectedWalletAvailable());
    setWalletConnectReady(isWalletConnectConfigured());
    setEmbedded(isEmbeddedBrowserContext());
    setStandaloneUrl(getStandaloneAppUrl());
    const active = getActiveConnectorKind();
    setKind(active);
    return active;
  }, []);

  /**
   * Read-only inspection. Runs ONLY when a connector is already explicitly
   * active; otherwise it clears the readout and touches no provider.
   */
  const refresh = useCallback(async () => {
    const active = refreshAvailability();
    if (!active) {
      clearInspection();
      return;
    }
    const inspection = await inspectMainnetWalletForHandoff(expectedDeployer ?? "");
    setAccount(inspection.account);
    setChainId(inspection.chainId);
    setAccountMatches(inspection.accountMatches);
    setChainMatches(inspection.chainMatches);
  }, [clearInspection, expectedDeployer, refreshAvailability]);

  useEffect(() => {
    // Mount does availability detection only — never an inspection.
    refreshAvailability();
    return subscribeWalletConnector(() => {
      void refresh();
    });
  }, [refresh, refreshAvailability]);

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
      title="Connect Deployment Wallet"
      description="Choose a wallet below. Nothing is read from any wallet until you click one of these buttons, and connecting never signs, sends or advances the sequence."
    >
      {embedded ? (
        <div className="mb-3 rounded-md border border-danger/40 bg-danger/5 p-3">
          <p className="text-xs text-danger">
            This page appears to be running inside an embedded preview or in-app browser. Mobile
            wallet hand-offs (deep links) often cannot return here, so a connection can appear to
            load forever. For mobile testing, open CARTEL HQ in a standalone browser tab or inside
            the wallet&apos;s own dapp browser.
          </p>
          {standaloneUrl ? (
            <Button
              className="mt-2"
              size="sm"
              variant="outline"
              onClick={() => {
                window.open(standaloneUrl, "_blank", "noopener,noreferrer");
              }}
            >
              <ExternalLink className="mr-2 h-3.5 w-3.5" />
              Open standalone preview
            </Button>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="secondary"
          disabled={busy !== null || !walletConnectReady || embedded}
          onClick={async () => {
            setBusy("walletconnect");
            setNotice(null);
            try {
              const result = await connectWalletConnect();
              setNotice(result.notice);
              setWalletLabel(result.state.walletName);
              await refresh();
            } catch {
              setNotice("CONNECTION_REJECTED_OR_FAILED");
            } finally {
              setBusy(null);
            }
          }}
        >
          {busy === "walletconnect" ? (
            <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Smartphone className="mr-2 h-3.5 w-3.5" />
          )}
          Mobile wallet / WalletConnect
        </Button>

        <Button
          size="sm"
          variant="outline"
          disabled={busy !== null || !injectedAvailable || embedded}
          onClick={async () => {
            setBusy("injected");
            setNotice(null);
            try {
              const result = await connectInjected();
              setNotice(result.notice);
              setWalletLabel(null);
              await refresh();
            } catch {
              setNotice("CONNECTION_REJECTED_OR_FAILED");
            } finally {
              setBusy(null);
            }
          }}
        >
          {busy === "injected" ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
          Browser wallet
        </Button>

        <Button
          size="sm"
          variant="outline"
          disabled={busy !== null || kind === null}
          onClick={async () => {
            setBusy("refresh");
            try {
              await refresh();
            } finally {
              setBusy(null);
            }
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
            try {
              await disconnect();
              setNotice(null);
              setWalletLabel(null);
              clearInspection();
              refreshAvailability();
            } finally {
              setBusy(null);
            }
          }}
        >
          Disconnect
        </Button>
      </div>

      {kind === null ? (
        <p className="mt-3 text-xs text-foreground">Not connected — choose a wallet above.</p>
      ) : null}
      {!walletConnectReady ? (
        <p className="mt-3 text-xs text-danger">{NOTICE_COPY.WALLETCONNECT_NOT_CONFIGURED}</p>
      ) : null}
      {!injectedAvailable ? (
        <p className="mt-1 text-xs text-muted-foreground">{NOTICE_COPY.NO_INJECTED_PROVIDER}</p>
      ) : null}
      {notice ? <p className="mt-2 text-xs text-danger">{NOTICE_COPY[notice]}</p> : null}

      <p className="mt-3 text-[11px] text-muted-foreground">
        Robinhood Wallet is the preferred wallet for this canary because it supports Robinhood Chain
        natively. MetaMask can only be used if Robinhood Chain (chain id {expectedChainId}) has
        already been added inside MetaMask yourself — CARTEL HQ never adds or switches a network for
        you. CARTEL HQ never asks for a private key, seed phrase or wallet password.
      </p>

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
