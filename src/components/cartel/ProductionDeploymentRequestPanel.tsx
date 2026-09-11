import { useCallback, useMemo, useState } from "react";
import { Loader2, Rocket, ShieldCheck, Wallet } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Section } from "@/components/cartel/Section";
import { StatusBadge } from "@/components/cartel/StatusBadge";
import {
  canWithdrawProductionRequest,
  evaluateProductionRequestEligibility,
  groupDigits,
  isValidRecipientAddress,
  normalizeRecipientAddress,
  parseWholeSupply,
  productionRequestCopy,
  sameAddress,
  type ProductionDeploymentRequest,
  type ProductionRequestEligibilityHints,
} from "@/lib/launch-production-request";
import {
  connectInjected,
  connectWalletConnect,
  isInjectedWalletAvailable,
  isWalletConnectConfigured,
  readWalletConnectorState,
} from "@/lib/wallet-connector";

/**
 * Launcher-B2 — customer-facing Production Deployment handoff.
 *
 * WHAT THIS IS: a guided way for a project owner to RECORD a request that the
 * platform deploy their fixed-supply token contract, and to see an honest
 * status afterwards.
 *
 * WHAT THIS IS NOT: it never deploys, signs, broadcasts, arms, claims, issues a
 * send window, registers a contract, changes lifecycle, messages Telegram or
 * creates liquidity. It holds no authority — every rule below is re-derived and
 * enforced by the database, which may still refuse.
 *
 * WALLET USE: the shared connector is used ONLY to capture a recipient address
 * from an explicitly connected wallet, and only when the connector proves that
 * exact account for the current session. It never requests a network change,
 * never signs and never sends. A private key or seed phrase is never requested.
 */

export type ProductionDeploymentRequestPanelProps = {
  launchId: string;
  /** Immutable intent preview, read from the launch the owner already sees. */
  launchTokenName: string;
  launchTicker: string;
  request: ProductionDeploymentRequest | null;
  requestLoading: boolean;
  requestError: string | null;
  hints: ProductionRequestEligibilityHints;
  /** Presentation hint only. The database enforces owner-only submission. */
  isWorkspaceOwner: boolean;
  disabled?: boolean;
  submitting?: boolean;
  withdrawing?: boolean;
  submitError?: string | null;
  withdrawError?: string | null;
  onSubmit: (input: { tokenSupplyWhole: string; tokenRecipient: string }) => void;
  onWithdraw: (requestId: string) => void;
};

const NETWORK_LABEL = "Robinhood Chain mainnet";

/** Mirrors the server's ticker → on-chain symbol derivation, for preview only. */
export function previewOnChainSymbol(ticker: string): string | null {
  const raw = (ticker ?? "").trim();
  if (/^[A-Z0-9]{2,11}$/.test(raw)) return raw;
  if (raw.startsWith("$") && /^[A-Z0-9]{2,11}$/.test(raw.slice(1))) return raw.slice(1);
  return null;
}

function Note({ children }: { children: React.ReactNode }) {
  return <p className="text-xs leading-relaxed text-muted-foreground">{children}</p>;
}

function IntentRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="surface-quiet min-w-0 rounded-lg p-3">
      <dt className="type-eyebrow text-muted-foreground">{label}</dt>
      <dd className="mt-1.5 min-w-0 text-sm font-semibold leading-snug text-foreground [overflow-wrap:anywhere]">
        {value}
      </dd>
    </div>
  );
}

export function ProductionDeploymentRequestPanel({
  launchId,
  launchTokenName,
  launchTicker,
  request,
  requestLoading,
  requestError,
  hints,
  isWorkspaceOwner,
  disabled,
  submitting,
  withdrawing,
  submitError,
  withdrawError,
  onSubmit,
  onWithdraw,
}: ProductionDeploymentRequestPanelProps) {
  const [supplyText, setSupplyText] = useState("");
  const [recipientSource, setRecipientSource] = useState<"wallet" | "manual">("manual");
  const [recipient, setRecipient] = useState("");
  const [recipientConfirm, setRecipientConfirm] = useState("");
  const [walletBusy, setWalletBusy] = useState(false);
  const [walletNotice, setWalletNotice] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);

  const eligibility = useMemo(() => evaluateProductionRequestEligibility(hints), [hints]);
  const symbol = previewOnChainSymbol(launchTicker);
  const supply = parseWholeSupply(supplyText);

  const setManualRecipient = (value: string) => {
    setRecipientSource("manual");
    setRecipient(value);
    setWalletNotice(null);
  };

  /**
   * EXPLICIT connection only, for address capture only. The captured value is
   * accepted solely when the connector reports a verified account for this
   * session. No network switch, no signature, no transaction.
   */
  const captureFromWallet = useCallback(async () => {
    setWalletBusy(true);
    setWalletNotice(null);
    try {
      let result = await connectWalletConnect();
      if (!result.ok && isInjectedWalletAvailable()) {
        result = await connectInjected();
      }
      const state = result.ok ? await readWalletConnectorState() : result.state;
      if (!state.account || !state.accountVerified) {
        setWalletNotice(
          "No confirmed wallet address was captured. Connect again and leave a single account connected, or type the address manually below.",
        );
        return;
      }
      setRecipientSource("wallet");
      setRecipient(normalizeRecipientAddress(state.account));
      setRecipientConfirm("");
    } catch {
      setWalletNotice("The wallet connection was cancelled or failed. Nothing changed.");
    } finally {
      setWalletBusy(false);
    }
  }, []);

  const recipientValid = isValidRecipientAddress(recipient);
  const manualConfirmed =
    recipientSource === "wallet" || sameAddress(recipient, recipientConfirm);
  const canSubmit =
    !disabled &&
    !submitting &&
    isWorkspaceOwner &&
    eligibility.eligible &&
    supply.ok &&
    recipientValid &&
    manualConfirmed;

  // -------------------------------------------------------------- request view
  if (requestLoading) {
    return (
      <Section
        variant="surface"
        className="min-w-0 border-gold/25"
        title="Production deployment"
        leading={<Rocket className="size-4" aria-hidden="true" />}
      >
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          Checking your deployment request…
        </p>
      </Section>
    );
  }

  if (requestError) {
    return (
      <Section
        variant="surface"
        className="min-w-0"
        title="Production deployment"
        leading={<Rocket className="size-4" aria-hidden="true" />}
      >
        <Note>Your deployment request could not be read right now. {requestError}</Note>
      </Section>
    );
  }

  const showStatus =
    request !== null &&
    (request.effectiveStatus === "COMPLETED" ||
      ["REQUESTED", "IN_REVIEW", "APPROVED", "EXECUTING"].includes(request.status));

  if (request && showStatus) {
    const copy = productionRequestCopy(request.effectiveStatus);
    const badgeTone =
      copy.tone === "green" ? "green" : copy.tone === "danger" ? "red" : copy.tone;
    const withdrawable = canWithdrawProductionRequest(request);
    return (
      <Section
        variant="surface"
        className={
          copy.tone === "green" ? "min-w-0 border-pepe/35" : "min-w-0 border-gold/40"
        }
        title="Production deployment"
        description="Your recorded request to have the platform deploy this token contract."
        leading={<Rocket className="size-4" aria-hidden="true" />}
        actions={
          <StatusBadge tone={badgeTone}>
            <span>{copy.label}</span>
          </StatusBadge>
        }
        contentClassName="space-y-4"
      >
        <div className="min-w-0 rounded-lg border border-border-subtle bg-surface-raised/40 p-3.5">
          <p className="min-w-0 text-base font-semibold leading-snug text-foreground [overflow-wrap:anywhere]">
            {copy.headline}
          </p>
          <p className="mt-1.5 max-w-prose text-xs leading-relaxed text-muted-foreground sm:text-sm">
            {copy.detail}
          </p>
        </div>

        <dl className="grid min-w-0 gap-2.5 sm:grid-cols-2">
          <IntentRow label="Token" value={request.tokenName} />
          <IntentRow label="On-chain symbol" value={request.tokenSymbol} />
          <IntentRow label="Network" value={NETWORK_LABEL} />
          <IntentRow label="Decimals" value={String(request.tokenDecimals)} />
          <IntentRow
            label="Total supply"
            value={`${groupDigits(request.tokenSupplyWhole)} ${request.tokenSymbol}`}
          />
          <IntentRow
            label="Receiving wallet"
            value={<span className="font-mono text-xs">{request.tokenRecipient}</span>}
          />
        </dl>

        <Note>
          These details were locked in when the request was made and cannot be edited. Withdraw and
          make a new request if anything needs to change.
        </Note>

        {withdrawable ? (
          <div className="space-y-2">
            <Button
              variant="outline"
              className="min-h-11 w-full sm:w-auto"
              disabled={disabled || withdrawing}
              onClick={() => setWithdrawOpen(true)}
            >
              {withdrawing ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : null}
              Withdraw request
            </Button>
            {withdrawError ? (
              <p className="text-xs leading-relaxed text-signal">{withdrawError}</p>
            ) : null}
          </div>
        ) : null}

        <AlertDialog open={withdrawOpen} onOpenChange={setWithdrawOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Withdraw this deployment request?</AlertDialogTitle>
              <AlertDialogDescription>
                The request is marked withdrawn and the platform will not act on it. Nothing has
                been deployed. You can make a new request afterwards.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep request</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  setWithdrawOpen(false);
                  onWithdraw(request.id);
                }}
              >
                Withdraw request
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </Section>
    );
  }

  // ------------------------------------------------------------- request form
  const closedCopy = request ? productionRequestCopy(request.effectiveStatus) : null;

  return (
    <Section
      variant="surface"
      className="min-w-0 border-gold/30"
      title="Production deployment"
      description="Ask the CARTEL platform to deploy your token contract on Robinhood Chain mainnet. Submitting records a request only."
      leading={<Rocket className="size-4" aria-hidden="true" />}
      contentClassName="space-y-4"
    >
      {closedCopy ? (
        <div className="min-w-0 rounded-lg border border-border-subtle bg-surface-raised/40 p-3.5">
          <p className="text-sm font-semibold leading-snug text-foreground">
            {closedCopy.headline}
          </p>
          <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
            {closedCopy.detail}
          </p>
          {request?.decisionNote ? (
            <p className="mt-2 min-w-0 rounded-md border border-border bg-background/40 px-3 py-2 text-xs leading-relaxed text-foreground [overflow-wrap:anywhere]">
              {request.decisionNote}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="space-y-2">
        <p className="text-sm leading-relaxed text-foreground">
          When the platform deploys your contract, these details are permanent and cannot be
          changed afterwards. Check them carefully.
        </p>
        <dl className="grid min-w-0 gap-2.5 sm:grid-cols-2">
          <IntentRow label="Token name" value={launchTokenName || "—"} />
          <IntentRow
            label="On-chain symbol"
            value={symbol ?? "Ticker cannot be used as an on-chain symbol"}
          />
          <IntentRow label="Network" value={NETWORK_LABEL} />
          <IntentRow label="Decimals" value="18" />
        </dl>
      </div>

      {!eligibility.eligible ? (
        <div className="min-w-0 rounded-md border border-border-strong bg-background/40 px-3 py-2.5">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Not available yet
          </p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{eligibility.reason}</p>
        </div>
      ) : null}

      {!isWorkspaceOwner ? (
        <Note>
          Only the project owner can request a production deployment. Admin access is not
          sufficient.
        </Note>
      ) : null}

      <div className="min-w-0 space-y-2">
        <Label htmlFor="production-supply">Total token supply (whole tokens)</Label>
        <Input
          id="production-supply"
          className="min-h-11"
          inputMode="numeric"
          autoComplete="off"
          maxLength={13}
          placeholder="e.g. 1000000000"
          disabled={disabled || submitting}
          value={supplyText}
          onChange={(e) => setSupplyText(e.target.value)}
        />
        {supplyText.trim() === "" ? (
          <Note>Between 1 and 1,000,000,000,000 whole tokens. Whole numbers only.</Note>
        ) : supply.ok ? (
          <Note>
            {groupDigits(supply.whole.toString())} {symbol ?? "tokens"} · exact on-chain amount{" "}
            <span className="font-mono [overflow-wrap:anywhere]">
              {supply.baseUnits.toString()}
            </span>{" "}
            base units
          </Note>
        ) : (
          <p className="text-xs leading-relaxed text-signal">{supply.error}</p>
        )}
      </div>

      <div className="min-w-0 space-y-2">
        <Label htmlFor="production-recipient">Receiving wallet address</Label>
        <p className="text-xs leading-relaxed text-muted-foreground">
          This is the wallet that will receive the full fixed supply when the contract is deployed.
          Connecting a wallet here only reads its address — it never asks you to switch networks,
          sign anything or send a transaction, and never asks for a private key or seed phrase.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="min-h-11"
            disabled={
              disabled ||
              submitting ||
              walletBusy ||
              (!isWalletConnectConfigured() && !isInjectedWalletAvailable())
            }
            onClick={() => {
              void captureFromWallet();
            }}
          >
            {walletBusy ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Wallet className="size-4" aria-hidden="true" />
            )}
            Use my connected wallet
          </Button>
        </div>
        {walletNotice ? (
          <p className="text-xs leading-relaxed text-signal">{walletNotice}</p>
        ) : null}
        {recipientSource === "wallet" && recipient ? (
          <p className="min-w-0 rounded-md border border-pepe/35 bg-pepe/5 px-3 py-2 font-mono text-xs text-foreground [overflow-wrap:anywhere]">
            {recipient}
          </p>
        ) : null}
        <Input
          id="production-recipient"
          className="min-h-11 font-mono"
          autoComplete="off"
          spellCheck={false}
          maxLength={42}
          placeholder="0x…"
          disabled={disabled || submitting}
          value={recipientSource === "wallet" ? recipient : recipient}
          onChange={(e) => setManualRecipient(e.target.value)}
        />
        {recipient.trim() !== "" && !recipientValid ? (
          <p className="text-xs leading-relaxed text-signal">
            Enter a valid wallet address starting with 0x. The zero address cannot be used.
          </p>
        ) : null}
        {recipientSource === "manual" && recipientValid ? (
          <div className="min-w-0 space-y-2">
            <Label htmlFor="production-recipient-confirm">Re-type the wallet address</Label>
            <Input
              id="production-recipient-confirm"
              className="min-h-11 font-mono"
              autoComplete="off"
              spellCheck={false}
              maxLength={42}
              placeholder="Type the same address again"
              disabled={disabled || submitting}
              value={recipientConfirm}
              onChange={(e) => setRecipientConfirm(e.target.value)}
            />
            {recipientConfirm.trim() !== "" && !manualConfirmed ? (
              <p className="text-xs leading-relaxed text-signal">
                The two addresses do not match.
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="space-y-2 border-t border-border-subtle pt-3.5">
        <Button
          className="min-h-11 w-full sm:w-auto"
          disabled={!canSubmit}
          onClick={() => setConfirmOpen(true)}
        >
          {submitting ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <ShieldCheck className="size-4" aria-hidden="true" />
          )}
          Request production deployment
        </Button>
        {submitError ? (
          <p className="text-xs leading-relaxed text-signal">{submitError}</p>
        ) : null}
        <Note>
          Submitting records a request for the platform team. It does not deploy anything by itself.
        </Note>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm your deployment request</AlertDialogTitle>
            <AlertDialogDescription>
              Check these details. They are locked in when the request is recorded.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <dl className="grid min-w-0 gap-2 text-sm">
            <div className="min-w-0">
              <dt className="type-eyebrow text-muted-foreground">Token</dt>
              <dd className="[overflow-wrap:anywhere]">{launchTokenName}</dd>
            </div>
            <div className="min-w-0">
              <dt className="type-eyebrow text-muted-foreground">Symbol</dt>
              <dd>{symbol ?? "—"}</dd>
            </div>
            <div className="min-w-0">
              <dt className="type-eyebrow text-muted-foreground">Network</dt>
              <dd>{NETWORK_LABEL}</dd>
            </div>
            <div className="min-w-0">
              <dt className="type-eyebrow text-muted-foreground">Supply</dt>
              <dd>{supply.ok ? groupDigits(supply.whole.toString()) : "—"}</dd>
            </div>
            <div className="min-w-0">
              <dt className="type-eyebrow text-muted-foreground">Receiving wallet</dt>
              <dd className="font-mono text-xs [overflow-wrap:anywhere]">
                {normalizeRecipientAddress(recipient)}
              </dd>
            </div>
          </dl>
          <p className="text-xs leading-relaxed text-muted-foreground">
            This records a deployment request only. It does NOT deploy a contract, sign or broadcast
            a transaction, register the official contract, change your launch status, notify
            Telegram, or create liquidity.
          </p>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={!canSubmit}
              onClick={() => {
                setConfirmOpen(false);
                if (!supply.ok) return;
                onSubmit({
                  tokenSupplyWhole: supply.whole.toString(),
                  tokenRecipient: normalizeRecipientAddress(recipient),
                });
              }}
            >
              Confirm request
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <p className="type-helper text-muted-foreground">
        Launch: <span className="font-mono [overflow-wrap:anywhere]">{launchId}</span>
      </p>
    </Section>
  );
}
