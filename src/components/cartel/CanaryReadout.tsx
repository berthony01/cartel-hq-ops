import { useEffect, useState } from "react";

/**
 * Presentation-only helpers for the owner-only Mainnet Canary console.
 * No authority, no data access, no side effects.
 */

export const ARM_PHRASE = "ARM MAINNET CANARY";
export const SEND_PHRASE = "SEND ONE MAINNET DEPLOYMENT";

/**
 * The ARM RPC refuses an authorization with 30 seconds or less remaining, so
 * the usable ARM click window ends 30 seconds before the presign expiry.
 */
export const ARM_WINDOW_LEAD_SECONDS = 30;

/**
 * PRESENTATION ONLY live countdown. It updates a local clock value and nothing
 * else: no server function, no wallet, no RPC, no mutation, no network call.
 * The server remains the only authority on authorization freshness.
 */
export function useArmWindow(expiresAt: string | null | undefined) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!expiresAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [expiresAt]);

  const expiryMs = expiresAt ? Date.parse(expiresAt) : Number.NaN;
  if (!Number.isFinite(expiryMs)) {
    return { known: false, secondsRemaining: 0, expired: true } as const;
  }
  const deadline = expiryMs - ARM_WINDOW_LEAD_SECONDS * 1000;
  const secondsRemaining = Math.max(0, Math.ceil((deadline - now) / 1000));
  return { known: true, secondsRemaining, expired: secondsRemaining <= 0 } as const;
}

/** Presentation-only readiness row. Never authoritative for security. */
export function ChecklistRow({
  label,
  state,
}: {
  label: string;
  state: "ready" | "needed" | "expired";
}) {
  const tone =
    state === "ready"
      ? "text-success"
      : state === "expired"
        ? "text-danger"
        : "text-muted-foreground";
  const text = state === "ready" ? "Ready" : state === "expired" ? "Expired" : "Needed";
  return (
    <div className="flex items-baseline justify-between gap-2 border-b border-border/40 py-1 last:border-0">
      <span className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className={`font-mono text-xs ${tone}`}>{text}</span>
    </div>
  );
}


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
