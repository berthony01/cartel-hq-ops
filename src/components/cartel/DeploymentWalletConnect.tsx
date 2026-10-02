import { useCallback, useEffect, useState } from "react";
import { ExternalLink, Loader2, Network, Smartphone, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Section } from "@/components/cartel/Section";
import { ReadoutLine } from "@/components/cartel/CanaryReadout";
import {
  classifyWalletConnection,
  connectInjected,
  connectWalletConnect,
  disconnect,
  getActiveConnectorKind,
  getConnectorOrigin,
  getStandaloneAppUrl,
  isChainUnavailableSwitchNotice,
  isEmbeddedBrowserContext,
  isInjectedWalletAvailable,
  isWalletConnectConfigured,
  normalizeChainId,
  readWalletConnectorState,
  requestRobinhoodChainSwitch,
  
  subscribeWalletConnector,
  WALLETCONNECT_CONNECT_TIMEOUT_MS,
  type WalletConnectorNotice,
  type WalletSwitchNotice,
} from "@/lib/wallet-connector";


/**
 * P3C-G — MAINNET deployment wallet panel.
 *
 * TWO SEPARATE GATES, NEVER COLLAPSED:
 *   GATE 1 — CONNECTION. One explicit "Connect Wallet" click opens the official
 *   wallet chooser. A wallet that connects on another EVM network STAYS
 *   CONNECTED; connecting alone never requests a network change.
 *   GATE 2 — ROBINHOOD CHAIN ELIGIBILITY. Classified from a live chain read
 *   into CONNECTED_WRONG_CHAIN, CONNECTED_CHAIN_UNAVAILABLE or CONNECTED_READY,
 *   and only ever changed by the operator's separate explicit
 *   "Switch to Robinhood Chain" click.
 *
 * EXPLICIT CONNECT ONLY. Rendering this panel performs NO provider request:
 * mount-time work is limited to a presence check for an injected provider and a
 * read of the already-active connector kind. `inspectMainnetWalletForHandoff`
 * (eth_accounts / eth_chainId) runs only once a connector has been explicitly
 * activated by the operator.
 *
 * Connection only. This panel never signs, never sends, and never advances the
 * canary sequence: connecting or switching cannot trigger Presign, Arm, Claim,
 * Send Window or Send. Every downstream deployment guard keeps its own
 * independent expected-deployer, live-chain, attempt-identity and authorization
 * checks — none of them is ever replaced by the UI state below.
 */

type Props = {
  expectedDeployer: string | null;
  expectedChainId: number;
};

const NOTICE_COPY: Record<WalletConnectorNotice, string> = {
  NO_INJECTED_PROVIDER: "No browser wallet detected on this device.",
  WALLETCONNECT_NOT_CONFIGURED:
    "The wallet chooser is not configured for this deployment. A public project id must be present in the environment before mobile connection is possible.",
  REOWN_LIBRARY_LOAD_FAILED:
    "Diagnostic code REOWN_LIBRARY_LOAD_FAILED — the wallet chooser component could not be downloaded in this browser. Nothing was connected. Try a standalone browser tab or a different network, or report this code.",
  REOWN_CHUNK_FETCH_FAILED:
    "Diagnostic code REOWN_CHUNK_FETCH_FAILED — the wallet connection files are out of date or could not be loaded. Nothing was connected. Reload this page and try again.",
  REOWN_MODULE_EVAL_FAILED:
    "Diagnostic code REOWN_MODULE_EVAL_FAILED — the wallet chooser loaded but could not start in this browser. Nothing was connected. Try Chrome or your wallet's dapp browser.",
  REOWN_CUSTOM_ELEMENT_CONFLICT:
    "Diagnostic code REOWN_CUSTOM_ELEMENT_CONFLICT — the wallet interface did not initialize cleanly. Nothing was connected. Reload this page once and try again.",
  REOWN_ADAPTER_LOAD_FAILED:
    "Diagnostic code REOWN_ADAPTER_LOAD_FAILED — the wallet connection adapter could not load. Nothing was connected. Reload the page and try again.",
  REOWN_ORIGIN_NOT_ALLOWED:
    "Diagnostic code REOWN_ORIGIN_NOT_ALLOWED — the wallet service refused this website address. Nothing was connected. The exact origin shown below must be listed under Project Domains in the Reown dashboard; this is external configuration and cannot be fixed in the app code.",
  REOWN_PROJECT_ID_INVALID_OR_MISSING:
    "Diagnostic code REOWN_PROJECT_ID_INVALID_OR_MISSING — the wallet service rejected the public project identifier. Nothing was connected. Report this code.",
  REOWN_CONFIG_SERVER_ERROR:
    "Diagnostic code REOWN_CONFIG_SERVER_ERROR — the wallet service configuration endpoint failed. Nothing was connected. This is usually temporary; report this code if it persists.",
  REOWN_RATE_LIMITED:
    "Diagnostic code REOWN_RATE_LIMITED — the wallet service is rate limiting this project. Nothing was connected. Wait and try again.",
  REOWN_APPKIT_INIT_FAILED:
    "Diagnostic code REOWN_APPKIT_INIT_FAILED — the wallet chooser loaded but could not start. Nothing was connected. Report this code.",
  REOWN_CONNECT_FAILED:
    "Diagnostic code REOWN_CONNECT_FAILED — the wallet chooser could not be opened. Nothing was connected. Report this code.",
  STALE_SESSION_TEARDOWN_FAILED:
    "Diagnostic code STALE_SESSION_TEARDOWN_FAILED — a previous wallet session could not be proven closed, so this connection attempt was refused and no wallet address is shown. Nothing was connected and nothing advanced. Reload this page and connect again.",
  STALE_SESSION_REUSE_REFUSED:
    "Diagnostic code STALE_SESSION_REUSE_REFUSED — an earlier wallet connection was still present, and it can never stand in for the wallet you just chose. Nothing was connected and no address is shown. Reload this page and connect again.",
  WALLET_ACCOUNT_MISMATCH:
    "Diagnostic code WALLET_ACCOUNT_MISMATCH — the wallet reported conflicting account information for this session, so it was disconnected and no address is shown. Nothing was connected and nothing advanced. Connect again and confirm a single account in the wallet.",
  WALLET_ACCOUNT_AMBIGUOUS:
    "Diagnostic code WALLET_ACCOUNT_AMBIGUOUS — the wallet exposed several accounts and did not identify which one you selected. CARTEL HQ never guesses an account, so nothing was connected and no address is shown. Leave a single account connected to this site in the wallet, then connect again.",
  ACTIVE_ACCOUNT_CHANGED:
    "Diagnostic code ACTIVE_ACCOUNT_CHANGED — the wallet changed its active account, so the connection was dropped rather than silently moving to a different address. Nothing advanced. Connect again and confirm the account you intend to deploy from.",
  WALLETCONNECT_TIMEOUT: `The wallet never completed the connection within ${Math.round(
    WALLETCONNECT_CONNECT_TIMEOUT_MS / 1000,
  )} seconds, so the attempt was cancelled and nothing was connected. This usually means the wallet hand-off could not return to this page. Open CARTEL HQ in a standalone browser tab, or inside the wallet's own browser, and choose the wallet again.`,
  CONNECTION_REJECTED_OR_FAILED: "The wallet connection was rejected or failed. Nothing changed.",
  NO_ACCOUNT: "The wallet is reachable but exposed no account.",
};

const SWITCH_NOTICE_COPY: Record<WalletSwitchNotice, string> = {
  NO_ACTIVE_CONNECTOR: "No wallet is connected, so no network change was requested.",
  NETWORK_SWITCH_REJECTED:
    "Diagnostic code NETWORK_SWITCH_REJECTED — the network change was declined in the wallet. Your wallet stays connected, still on its current network. Nothing advanced.",
  NETWORK_SWITCH_UNSUPPORTED:
    "Diagnostic code NETWORK_SWITCH_UNSUPPORTED — this wallet cannot change networks from a website. Select Robinhood Chain inside the wallet itself, then re-check.",
  NETWORK_UNKNOWN_TO_WALLET:
    "Diagnostic code NETWORK_UNKNOWN_TO_WALLET — Robinhood Chain is not present in this wallet. CARTEL HQ never adds a network for you: add Robinhood Chain (chain id 4663) in the wallet yourself, then re-check.",
  NETWORK_SWITCH_FAILED:
    "Diagnostic code NETWORK_SWITCH_FAILED — the network change did not complete. Your wallet stays connected and nothing advanced.",
};

/** Chooser-level failures that justify the injected fallback attempt. */
const APPKIT_UNAVAILABLE_NOTICES: WalletConnectorNotice[] = [
  "WALLETCONNECT_NOT_CONFIGURED",
  "REOWN_LIBRARY_LOAD_FAILED",
  "REOWN_APPKIT_INIT_FAILED",
  "REOWN_CONNECT_FAILED",
];

export function DeploymentWalletConnect({ expectedDeployer, expectedChainId }: Props) {
  const [busy, setBusy] = useState<"connect" | "refresh" | "disconnect" | "switch" | null>(null);
  const [notice, setNotice] = useState<WalletConnectorNotice | null>(null);
  const [switchNotice, setSwitchNotice] = useState<WalletSwitchNotice | null>(null);
  const [chainUnavailable, setChainUnavailable] = useState(false);
  const [kind, setKind] = useState<string | null>(null);

  const [walletLabel, setWalletLabel] = useState<string | null>(null);
  const [account, setAccount] = useState<string | null>(null);
  const [chainId, setChainId] = useState<string | null>(null);
  const [accountMatches, setAccountMatches] = useState(false);
  const [chainMatches, setChainMatches] = useState(false);
  const [accountVerified, setAccountVerified] = useState(false);
  const [injectedAvailable, setInjectedAvailable] = useState(false);
  const [walletConnectReady, setWalletConnectReady] = useState(false);
  const [embedded, setEmbedded] = useState(false);
  const [standaloneUrl, setStandaloneUrl] = useState<string | null>(null);

  const clearInspection = useCallback(() => {
    setAccount(null);
    setChainId(null);
    setAccountMatches(false);
    setChainMatches(false);
    setAccountVerified(false);
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
   * Read-only inspection of the CONNECTOR's canonical validated account. The
   * displayed address is never re-derived from the wallet's account array here:
   * it is the account proven for the current explicit connection, and it is
   * blank whenever that proof does not exist.
   */
  const refresh = useCallback(async () => {
    const active = refreshAvailability();
    if (!active) {
      clearInspection();
      return;
    }
    const state = await readWalletConnectorState();
    const expected = expectedDeployer ? expectedDeployer.trim().toLowerCase() : null;
    const expectedChainHex = normalizeChainId(expectedChainId);
    setAccount(state.account);
    setChainId(state.chainId);
    setAccountVerified(state.accountVerified);
    setAccountMatches(state.account !== null && expected !== null && state.account === expected);
    setChainMatches(state.chainId !== null && state.chainId === expectedChainHex);
    if (state.notice !== null) setNotice(state.notice);
  }, [clearInspection, expectedChainId, expectedDeployer, refreshAvailability]);

  useEffect(() => {
    // Mount does availability detection only — never an inspection. The
    // read-only inspection re-runs ONLY when a connector is already explicitly
    // active, which is also what keeps the displayed account check in step with
    // a changed `expectedDeployer` instead of showing a stale verdict.
    const active = refreshAvailability();
    if (active) void refresh();
    return subscribeWalletConnector(() => {
      void refresh();
    });
  }, [refresh, refreshAvailability]);

  /**
   * GATE 1 ONLY. One explicit operator click opens the chooser. It never
   * requests, implies or triggers a network change: `requestRobinhoodChainSwitch`
   * is not reachable from here.
   */
  const runConnect = useCallback(async () => {
    setBusy("connect");
    setNotice(null);
    setSwitchNotice(null);
    setChainUnavailable(false);
    // No previously shown address may survive into a new connect attempt.
    setWalletLabel(null);
    clearInspection();
    try {
      let result = await connectWalletConnect();
      // Fallback ONLY when the chooser itself is unavailable, and only to the
      // already-present injected wallet. Still one explicit operator click.
      if (
        !result.ok &&
        result.notice !== null &&
        APPKIT_UNAVAILABLE_NOTICES.includes(result.notice) &&
        isInjectedWalletAvailable()
      ) {
        result = await connectInjected();
      }
      setNotice(result.notice);
      setWalletLabel(result.state.walletName);
      await refresh();
    } catch {
      setNotice("CONNECTION_REJECTED_OR_FAILED");
    } finally {
      setBusy(null);
    }
  }, [clearInspection, refresh]);

  /**
   * "Choose another wallet" — EXPLICIT TEARDOWN FIRST. The current wallet /
   * session is disconnected and the readout cleared BEFORE the chooser opens,
   * so the previous wallet can never be re-accepted as the new choice. It
   * signs nothing, sends nothing and advances nothing.
   */
  const runChooseAnotherWallet = useCallback(async () => {
    setBusy("disconnect");
    try {
      await disconnect();
      setNotice(null);
      setSwitchNotice(null);
      setChainUnavailable(false);
      setWalletLabel(null);
      clearInspection();
      refreshAvailability();
    } finally {
      setBusy(null);
    }
    await runConnect();
  }, [clearInspection, refreshAvailability, runConnect]);

  /**
   * GATE 2 ONLY, EXPLICIT CLICK. The single switch call site in this panel. On
   * approval the live chain is re-read exactly once; CONNECTED_READY follows
   * only if the provider now really reports 4663. A rejection leaves the wallet
   * connected.
   */
  const runSwitch = useCallback(async () => {
    setBusy("switch");
    setSwitchNotice(null);
    try {
      const result = await requestRobinhoodChainSwitch();
      setSwitchNotice(result.notice);
      setChainUnavailable(isChainUnavailableSwitchNotice(result.notice));
      if (result.ok) await refresh();
    } finally {
      setBusy(null);
    }
  }, [refresh]);

  /**
   * An expected deployer only exists once it is a well-formed address. Without
   * one there is nothing to compare, so the readout says "—" rather than
   * claiming a MISMATCH against an empty expectation.
   */
  const expectedDeployerValid = /^0x[0-9a-fA-F]{40}$/.test((expectedDeployer ?? "").trim());

  const chainIdDecimal = (() => {
    if (!chainId) return null;
    try {
      return BigInt(chainId).toString(10);
    } catch {
      return null;
    }
  })();

  const status = classifyWalletConnection({
    connected: account !== null,
    liveChainId: chainId,
    chainUnavailable,
  });

  return (
    <Section
      variant="surface"
      leading={<Wallet className="h-4 w-4" />}
      title="Connect Deployment Wallet"
      description="Connecting is one step; choosing Robinhood Chain is a separate step you control. Nothing is read from any wallet until you click Connect Wallet, and connecting never switches networks, signs, sends or advances the sequence."
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
          disabled={busy !== null || (!walletConnectReady && !injectedAvailable) || embedded}
          onClick={() => {
            void runConnect();
          }}
        >
          {busy === "connect" ? (
            <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Smartphone className="mr-2 h-3.5 w-3.5" />
          )}
          Connect Wallet
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
              setSwitchNotice(null);
              setChainUnavailable(false);
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

      {status === "CONNECTED_WRONG_CHAIN" ? (
        <div className="mt-3 rounded-md border border-danger/40 bg-danger/5 p-3">
          <p className="text-xs text-danger">
            This wallet is connected, but it is on a different network. Robinhood Chain mainnet
            (chain id {expectedChainId}) is required before anything can be signed or sent. Your
            wallet stays connected either way.
          </p>
          <Button
            className="mt-2"
            size="sm"
            variant="outline"
            disabled={busy !== null}
            onClick={() => {
              void runSwitch();
            }}
          >
            {busy === "switch" ? (
              <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Network className="mr-2 h-3.5 w-3.5" />
            )}
            Switch to Robinhood Chain
          </Button>
          {switchNotice ? (
            <p className="mt-2 text-xs text-danger">{SWITCH_NOTICE_COPY[switchNotice]}</p>
          ) : null}
        </div>
      ) : null}

      {status === "CONNECTED_CHAIN_UNAVAILABLE" ? (
        <div className="mt-3 rounded-md border border-danger/40 bg-danger/5 p-3">
          <p className="text-xs text-danger">
            This wallet is connected, but Robinhood Chain is unavailable in this wallet. Please
            connect another compatible wallet to use Robinhood Chain features.
          </p>
          {switchNotice ? (
            <p className="mt-2 text-xs text-danger">{SWITCH_NOTICE_COPY[switchNotice]}</p>
          ) : null}
          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={busy !== null}
              onClick={async () => {
                setBusy("disconnect");
                try {
                  await disconnect();
                  setNotice(null);
                  setSwitchNotice(null);
                  setChainUnavailable(false);
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
            <Button
              size="sm"
              variant="outline"
              disabled={busy !== null || embedded}
              onClick={() => {
                void runChooseAnotherWallet();
              }}
            >
              Choose another wallet
            </Button>
          </div>
        </div>
      ) : null}

      {status === "DISCONNECTED" ? (
        <p className="mt-3 text-xs text-foreground">Not connected — click Connect Wallet.</p>
      ) : null}
      {!walletConnectReady ? (
        <p className="mt-3 text-xs text-danger">{NOTICE_COPY.WALLETCONNECT_NOT_CONFIGURED}</p>
      ) : null}
      {notice ? <p className="mt-2 text-xs text-danger">{NOTICE_COPY[notice]}</p> : null}
      {notice === "REOWN_ORIGIN_NOT_ALLOWED" && getConnectorOrigin() ? (
        <p className="mt-1 text-xs text-danger">
          Current origin: <span className="font-mono">{getConnectorOrigin()}</span>
        </p>
      ) : null}

      <p className="mt-3 text-[11px] text-muted-foreground">
        Any EVM wallet is supported. Robinhood Wallet is recommended because it supports Robinhood
        Chain natively, but it is not required: MetaMask and other EVM wallets work too, as long as
        Robinhood Chain (chain id {expectedChainId}) is already available and approved in that
        wallet. CARTEL HQ never adds a network for you, only asks the wallet to switch when you
        press the button above, and never asks for a private key, seed phrase or wallet password.
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
        <ReadoutLine label={"Wallet state"} value={status} />
        <ReadoutLine label={"Wallet address"} value={account ?? "—"} />
        {/*
          Visible identity proof. "VERIFIED CURRENT SESSION" appears only when
          the connector proved this exact account for the current explicit
          connection; it is never shown for an inferred or unproven account.
        */}
        <ReadoutLine
          label={"Selected account"}
          value={!account ? "—" : accountVerified ? "VERIFIED CURRENT SESSION" : "UNVERIFIED"}
        />
        <ReadoutLine label={"Expected deployer"} value={expectedDeployer ?? "—"} />
        <ReadoutLine
          label={"Account check"}
          value={!account || !expectedDeployerValid ? "—" : accountMatches ? "MATCH" : "MISMATCH"}
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
        A wrong network or wrong account fails closed: the deployment stages below keep their own
        independent expected-deployer, live chain-id {expectedChainId}, attempt and authorization
        checks, which this panel never replaces.
      </p>
    </Section>
  );
}
