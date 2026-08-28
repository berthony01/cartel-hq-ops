import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type Tone = "gold" | "green" | "red" | "muted";

const TONES: Record<Tone, string> = {
  gold: "border-gold/40 bg-gold/10 text-gold",
  green: "border-pepe/40 bg-pepe/10 text-pepe",
  red: "border-signal/40 bg-signal/10 text-signal",
  muted: "border-border bg-surface-raised text-muted-foreground",
};

export function StatusBadge({
  tone = "muted",
  className,
  children,
}: {
  tone?: Tone;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase leading-tight tracking-[0.12em]",
        "sm:gap-1.5 sm:px-2.5 sm:py-1 sm:text-[11px] sm:tracking-[0.14em]",
        "[&>span]:truncate",
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
