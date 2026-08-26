import type { ReactNode } from "react";

type Tone = "gold" | "green" | "red" | "muted";

const TONES: Record<Tone, string> = {
  gold: "border-gold/40 bg-gold/10 text-gold",
  green: "border-pepe/40 bg-pepe/10 text-pepe",
  red: "border-signal/40 bg-signal/10 text-signal",
  muted: "border-border bg-surface-raised text-muted-foreground",
};

export function StatusBadge({
  tone = "muted",
  children,
}: {
  tone?: Tone;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] ${TONES[tone]}`}
    >
      {children}
    </span>
  );
}
