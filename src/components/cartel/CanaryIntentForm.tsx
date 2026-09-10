import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CANARY_REQUIRED_LAUNCH_CHAIN } from "@/lib/chain-mainnet-canary-intent";
import {
  getActiveConnectorKind,
  ROBINHOOD_MAINNET_CHAIN_ID_HEX_CANONICAL,
  readWalletConnectorState,
  subscribeWalletConnector,
} from "@/lib/wallet-connector";

/**
 * P3C-F1 — presentation only for the canary's exact production intent.
 *
 * This component holds no authority, calls nothing and decides nothing: the
 * owner-only server wrappers and the authoritative RPCs remain the boundary.
 *
 * SAFE DEPLOYER BINDING (UX only). When a wallet has been EXPLICITLY connected
 * and its chain is actually Robinhood Chain mainnet, the deployer field is
 * bound to that address and shown read-only. This is form state only: it never
 * creates an attempt, never presigns, arms, claims, sends, verifies or writes
 * any backend state, and it never switches or adds a network. When the wallet
 * disconnects or moves to another chain the provisional binding is cleared.
 * An immutable attempt-bound deployer supplied by the backend always wins and
 * is never overwritten.
 */

export type CanaryLaunchOption = {
  id: string;
  token_name: string | null;
  ticker: string | null;
  status: string | null;
  chain: string | null;
};

export type CanaryIntentFormProps = {
  launches: CanaryLaunchOption[];
  launchId: string;
  onSelectLaunch: (launchId: string) => void;
  deployer: string;
  onDeployer: (value: string) => void;
  recipient: string;
  onRecipient: (value: string) => void;
  name: string;
  onName: (value: string) => void;
  symbol: string;
  onSymbol: (value: string) => void;
  supplyWhole: string;
  onSupplyWhole: (value: string) => void;
  selectedChain: string | null;
  chainEligible: boolean;
  /**
   * Authoritative, immutable deployer already bound to an existing attempt
   * row. When present it always wins: no connected-wallet binding is applied
   * and nothing is cleared.
   */
  attemptBoundDeployer?: string | null;
  /** Authoritative recipient already bound to an existing attempt row. */
  attemptBoundRecipient?: string | null;
};


export function CanaryIntentForm(props: CanaryIntentFormProps) {
  const propsRef = useRef(props);
  propsRef.current = props;
  /** Address currently auto-bound from the connected wallet, if any. */
  const [boundWallet, setBoundWallet] = useState<string | null>(null);
  const boundRef = useRef<string | null>(null);

  const unbind = useCallback(() => {
    const previous = boundRef.current;
    boundRef.current = null;
    setBoundWallet(null);
    if (previous === null) return;
    const current = propsRef.current;
    // Only ever clear the values this component provisionally set. A manually
    // typed address, or an attempt-bound one, is never touched.
    if (current.deployer.trim().toLowerCase() === previous) current.onDeployer("");
    if (!current.attemptBoundRecipient?.trim() && current.recipient.trim().toLowerCase() === previous) {
      current.onRecipient("");
    }
  }, []);

  /**
   * Reads the already-active connector only. It never connects, never prompts,
   * never switches a network and never advances the canary sequence.
   */
  const syncBinding = useCallback(async () => {
    const current = propsRef.current;
    const attemptDeployer = current.attemptBoundDeployer?.trim();
    if (attemptDeployer) {
      // Immutable backend state wins outright.
      boundRef.current = null;
      setBoundWallet(null);
      return;
    }
    if (getActiveConnectorKind() === null) {
      unbind();
      return;
    }
    const state = await readWalletConnectorState();
    const matched =
      state.account !== null && state.chainId === ROBINHOOD_MAINNET_CHAIN_ID_HEX_CANONICAL
        ? state.account
        : null;
    if (matched === null) {
      unbind();
      return;
    }
    boundRef.current = matched;
    setBoundWallet(matched);
    const latest = propsRef.current;
    if (latest.deployer.trim().toLowerCase() !== matched) latest.onDeployer(matched);
    // CANARY SAFETY MODE: the deployer wallet is also the sole recipient.
    if (!latest.attemptBoundRecipient?.trim() && latest.recipient.trim().toLowerCase() !== matched) {
      latest.onRecipient(matched);
    }
  }, [unbind]);

  useEffect(() => {
    void syncBinding();
    return subscribeWalletConnector(() => {
      void syncBinding();
    });
  }, [syncBinding]);

  const attemptDeployer = props.attemptBoundDeployer?.trim() || null;
  const attemptRecipient = props.attemptBoundRecipient?.trim() || null;
  const deployerValue = attemptDeployer ?? props.deployer;
  const deployerLocked = attemptDeployer !== null || boundWallet !== null;
  const recipientValue = attemptRecipient ?? props.recipient;
  const recipientLocked = attemptRecipient !== null || boundWallet !== null;


  return (

    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="canary-launch">Launch</Label>
          <select
            id="canary-launch"
            className="h-9 w-full rounded-md border border-border bg-surface-raised px-2 text-sm"
            value={props.launchId}
            onChange={(event) => props.onSelectLaunch(event.target.value)}
          >
            <option value="">Select a launch…</option>
            {props.launches.map((row) => (
              <option key={row.id} value={row.id}>
                {row.token_name} · {row.ticker} · {row.status}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="canary-deployer">Deployer wallet</Label>
          <Input
            id="canary-deployer"
            value={deployerValue}
            readOnly={deployerLocked}
            onChange={(event) => {
              if (deployerLocked) return;
              props.onDeployer(event.target.value);
            }}
            placeholder="0x…"
          />
          <p className="text-[11px] text-muted-foreground">
            {attemptDeployer
              ? "Source: existing attempt — immutable and never overwritten."
              : boundWallet
                ? "Source: Connected wallet on Robinhood Chain. Read-only while that wallet stays connected and matched. Disconnecting or changing network clears it."
                : "Source: typed by you. Connect a wallet on Robinhood Chain to bind it automatically."}
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="canary-recipient">Initial recipient</Label>
          <Input
            id="canary-recipient"
            value={recipientValue}
            readOnly={recipientLocked}
            onChange={(event) => {
              if (recipientLocked) return;
              props.onRecipient(event.target.value);
            }}
            placeholder="0x…"
          />
          <p className="text-[11px] text-muted-foreground">
            {attemptRecipient
              ? "Source: existing attempt — immutable and never overwritten."
              : boundWallet && props.recipient.trim().toLowerCase() === boundWallet
                ? "Default only: the connected wallet. Editable — choose another recipient before creating the attempt."
                : "Always editable. Defaults to the connected wallet only while empty."}
          </p>
        </div>


        <div className="space-y-1.5">
          <Label htmlFor="canary-name">Token name</Label>
          <Input
            id="canary-name"
            value={props.name}
            onChange={(event) => props.onName(event.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="canary-symbol">Onchain symbol</Label>
          <Input
            id="canary-symbol"
            value={props.symbol}
            onChange={(event) => props.onSymbol(event.target.value)}
            placeholder="PCART"
          />
          <p className="text-[11px] text-muted-foreground">
            2–11 uppercase letters or digits. The launch display ticker is never changed by this
            console.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="canary-supply">Total supply (whole tokens)</Label>
          <Input
            id="canary-supply"
            value={props.supplyWhole}
            onChange={(event) => props.onSupplyWhole(event.target.value)}
            placeholder="1000000"
          />
          <p className="text-[11px] text-muted-foreground">
            Whole tokens. The exact base-unit value (×10¹⁸) is what reaches the production record.
          </p>
        </div>
      </div>

      {props.launchId && !props.chainEligible ? (
        <div className="flex items-start gap-2 rounded-md border border-danger/40 bg-danger/10 p-3 text-xs text-danger">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Blocked: this launch records its chain as{" "}
            <strong>{props.selectedChain?.trim() || "—"}</strong>, not{" "}
            <strong>{CANARY_REQUIRED_LAUNCH_CHAIN}</strong>. Reconcile the launch metadata in Launch
            Control before any production attempt. This console will not change the launch record.
          </span>
        </div>
      ) : null}
    </div>
  );
}
