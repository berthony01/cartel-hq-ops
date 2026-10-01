import { Lock } from "lucide-react";

/**
 * PCART-L3 — read-only checkpoint shown INSTEAD of the generic production
 * request form for the canonical PEPECARTEL launch. No inputs, no actions, no
 * bypass. The database independently rejects this launch on the generic path.
 */
export const PCART_PRODUCTION_BLOCKERS = [
  "Exact-artifact testnet rehearsal of pepecartel-token-v1",
  "The real 2-of-3 signer configuration and Safe address",
  "Canonical Safe verification",
  "A separately reviewed production-allowlist migration",
] as const;

const PLAIN_BLOCKERS = [
  "Run one test launch of PCART on testnet",
  "Set up the 2-of-3 treasury Safe",
  "Check the treasury Safe",
  "Final launch approval",
] as const;

export function PcartProductionBlockedCheckpoint() {
  return (
    <section
      aria-label="PCART launch locked"
      className="rounded-lg border border-gold/40 bg-gold/10 p-4 text-xs leading-relaxed"
    >
      <p className="flex items-center gap-2 font-semibold uppercase tracking-wide text-gold">
        <Lock className="size-4" aria-hidden="true" />
        PEPECARTEL launch is locked for safety
      </p>
      <p className="mt-1 text-muted-foreground">
        The real launch stays locked until these are done:
      </p>
      <ol className="mt-2 list-decimal space-y-1 pl-5 text-foreground">
        {PLAIN_BLOCKERS.map((b) => (
          <li key={b}>{b}</li>
        ))}
      </ol>
      <p className="mt-2 text-muted-foreground">
        Nothing on this page can start the real launch, record an official contract or add
        liquidity.
      </p>
      <details className="mt-2">
        <summary className="cursor-pointer text-muted-foreground">Technical details</summary>
        <p className="mt-1 text-muted-foreground">
          The PEPECARTEL launch never uses the generic production deployment request. Its protected
          PCART path remains blocked until all of these are complete:
        </p>
        <ol className="mt-1 list-decimal space-y-1 pl-5 text-foreground">
          {PCART_PRODUCTION_BLOCKERS.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ol>
      </details>
    </section>
  );
}
