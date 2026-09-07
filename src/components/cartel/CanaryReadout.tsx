import { useState } from "react";

/**
 * Presentation-only helpers for the owner-only Mainnet Canary console.
 * No authority, no data access, no side effects.
 */

export const ARM_PHRASE = "ARM MAINNET CANARY";
export const SEND_PHRASE = "SEND ONE MAINNET DEPLOYMENT";

export function ReadoutLine({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border/40 py-1 last:border-0">
      <span className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className="break-all font-mono text-xs text-foreground">
        {value === null || value === undefined || value === "" ? "—" : String(value)}
      </span>
    </div>
  );
}

export function Readout({ value }: { value: unknown }) {
  if (!value) return null;
  return (
    <pre className="mt-3 max-h-56 overflow-auto rounded-md bg-surface-raised/40 p-2 text-[11px]">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

/** Serializes owner actions so two stages can never run at once. */
export function useBusy() {
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (key: string, fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(key);
    try {
      await fn();
    } finally {
      setBusy(null);
    }
  };
  return { busy, run };
}
