import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, Loader2, ShieldQuestion } from "lucide-react";

import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/cartel/StatusBadge";
import { verifyTreasurySafe } from "@/lib/treasury-safe-verify.functions";
import {
  normalizeTreasuryAddress,
  type TreasurySafeVerification,
} from "@/lib/treasury-safe-verify";

/**
 * PCART-L1B — compact, read-only treasury check for the recipient address the
 * owner already entered above. It reads the chain and nothing else: it never
 * creates a Safe, never signs, never sends a transaction, never moves ETH or
 * tokens, never records a request and never changes any launch state.
 *
 * Success now requires the FULL canonical Safe v1.4.1 profile, not just an
 * ABI-compatible 2-of-3 answer. It still does not gate request submission.
 */

export type TreasurySafeVerificationPanelProps = {
  /** The SAME recipient value shown in the production request form. */
  address: string;
  addressValid: boolean;
  disabled?: boolean | undefined;
};

function shorten(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function failureLabel(result: TreasurySafeVerification): string {
  switch (result.failureCode) {
    case "NOT_A_CONTRACT":
      return "Not a contract";
    case "PROXY_BYTECODE_MISMATCH":
    case "SINGLETON_MISMATCH":
    case "MASTERCOPY_UNREADABLE":
      return "Not official Safe code";
    case "VERSION_MISMATCH":
    case "VERSION_UNREADABLE":
      return "Wrong Safe version";
    case "MODULES_PRESENT":
    case "MODULES_UNREADABLE":
      return "Extra modules";
    case "GUARD_PRESENT":
    case "GUARD_UNREADABLE":
      return "Guard installed";
    case "NONCE_UNREADABLE":
      return "Unreadable wallet";
    case "OWNER_COUNT_NOT_THREE":
    case "THRESHOLD_NOT_TWO":
    case "OWNER_SET_INVALID":
      return "Wrong configuration";
    default:
      return "Not verified";
  }
}

export function TreasurySafeVerificationPanel({
  address,
  addressValid,
  disabled,
}: TreasurySafeVerificationPanelProps) {
  const runVerify = useServerFn(verifyTreasurySafe);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<TreasurySafeVerification | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showOwners, setShowOwners] = useState(false);

  const normalized = normalizeTreasuryAddress(address);

  // Any change to the recipient address immediately discards a previous
  // verification. A stale result must never be shown against a new address.
  useEffect(() => {
    setResult(null);
    setError(null);
    setShowOwners(false);
  }, [normalized]);

  const verify = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const outcome = await runVerify({ data: { address: normalized } });
      setResult(outcome);
    } catch {
      setResult(null);
      setError("The treasury check could not be completed. Nothing was changed.");
    } finally {
      setBusy(false);
    }
  }, [normalized, runVerify]);

  const verified = result?.isCanonicalSafeV141 === true;

  return (
    <div className="min-w-0 space-y-2.5 rounded-lg border border-border-subtle bg-surface-raised/40 p-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold leading-snug text-foreground">
          Treasury Safe verification
        </p>
        {busy ? (
          <StatusBadge tone="gold">
            <span>Checking</span>
          </StatusBadge>
        ) : verified ? (
          <StatusBadge tone="green">
            <span>Canonical Safe v1.4.1</span>
          </StatusBadge>
        ) : result ? (
          <StatusBadge tone="red">
            <span>{failureLabel(result)}</span>
          </StatusBadge>
        ) : null}
      </div>

      <p className="text-xs leading-relaxed text-muted-foreground">
        Optional check. This reads Robinhood Chain to confirm the receiving address above is a
        genuine, unmodified Safe wallet of the official 1.4.1 version, with no add-ons, needing 2 of
        3 owners to approve anything. It only looks — it does not create a wallet, sign anything or
        move any funds.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="min-h-11"
          disabled={disabled || busy || !addressValid}
          onClick={() => {
            void verify();
          }}
        >
          {busy ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <ShieldQuestion className="size-4" aria-hidden="true" />
          )}
          Check this address
        </Button>
        {addressValid ? (
          <span className="font-mono text-xs text-muted-foreground">{shorten(normalized)}</span>
        ) : (
          <span className="text-xs text-muted-foreground">
            Enter a valid receiving address above first.
          </span>
        )}
      </div>

      {error ? <p className="text-xs leading-relaxed text-signal">{error}</p> : null}

      {result && verified ? (
        <div className="min-w-0 space-y-1.5 rounded-md border border-pepe/35 bg-pepe/5 px-3 py-2.5">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
            <CheckCircle2 className="size-4" aria-hidden="true" />
            Canonical Safe v1.4.1 profile verified
          </p>
          <ul className="space-y-0.5 text-xs leading-relaxed text-muted-foreground">
            <li>Robinhood Chain {result.chainId} verified</li>
            <li>Official Safe wallet code matched exactly</li>
            <li>Official Safe 1.4.1 implementation matched</li>
            <li>Reported version: {result.version}</li>
            <li>Owners: {result.ownerCount}</li>
            <li>Required signatures: {result.threshold}</li>
            <li>Add-on modules: none</li>
            <li>Transaction guard: none</li>
            <li>Transaction counter readable</li>
          </ul>
          <button
            type="button"
            className="text-xs underline underline-offset-2 text-muted-foreground"
            onClick={() => setShowOwners((v) => !v)}
          >
            {showOwners ? "Hide owner addresses" : "Show owner addresses"}
          </button>
          {showOwners ? (
            <ul className="min-w-0 space-y-0.5 font-mono text-xs text-foreground [overflow-wrap:anywhere]">
              {result.owners.map((owner) => (
                <li key={owner}>{owner}</li>
              ))}
            </ul>
          ) : null}
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            This confirms the wallet shape only. The exact PEPECARTEL signer addresses have not been
            chosen or pinned yet, so this is not a PEPECARTEL treasury approval. This check did not
            create the wallet, did not approve it and did not move anything.
          </p>
        </div>
      ) : null}

      {result && !verified ? (
        <p className="text-xs leading-relaxed text-signal">{result.message}</p>
      ) : null}
    </div>
  );
}
