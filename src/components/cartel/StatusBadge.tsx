import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type Tone = "gold" | "green" | "red" | "muted";

const TONES: Record<Tone, string> = {
  gold: "border-gold/35 bg-gold/8 text-gold",
  green: "border-pepe/35 bg-pepe/8 text-pepe",
  red: "border-signal/40 bg-signal/8 text-signal",
  muted: "border-border-subtle bg-surface-overlay/45 text-muted-foreground",
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
        "inline-flex min-w-0 max-w-full items-center gap-1 overflow-hidden rounded-sm border px-2 py-1 text-[10px] font-bold uppercase leading-tight tracking-[0.12em]",
        "whitespace-nowrap text-ellipsis",
        "sm:gap-1.5 sm:px-2.5 sm:py-1 sm:text-[11px] sm:tracking-[0.14em]",
        "[&>span]:min-w-0 [&>span]:truncate",
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
