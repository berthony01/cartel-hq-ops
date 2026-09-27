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

export function PcartProductionBlockedCheckpoint() {
  return (
    <section
      aria-label="PCART production path blocked"
      className="rounded-lg border border-gold/40 bg-gold/10 p-4 text-xs leading-relaxed"
    >
      <p className="flex items-center gap-2 font-semibold uppercase tracking-wide text-gold">
        <Lock className="size-4" aria-hidden="true" />
        Protected PCART path — blocked
      </p>
      <p className="mt-1 text-muted-foreground">
        The PEPECARTEL launch never uses the generic production deployment request. Its protected
        PCART path is prepared but remains blocked until all of these are complete:
      </p>
      <ol className="mt-2 list-decimal space-y-1 pl-5 text-foreground">
        {PCART_PRODUCTION_BLOCKERS.map((b) => (
          <li key={b}>{b}</li>
        ))}
      </ol>
      <p className="mt-2 text-muted-foreground">
        No mainnet request, deployment, official contract record or liquidity action can be made
        from here.
      </p>
    </section>
  );
}
