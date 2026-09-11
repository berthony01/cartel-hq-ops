import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

type EmptyStateProps = {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: ReactNode;
  compact?: boolean;
};

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  compact = false,
}: EmptyStateProps) {
  return (
    <div
      className={`surface-quiet flex flex-col items-center justify-center rounded-lg border-dashed text-center ${
        compact ? "gap-2 px-4 py-6" : "gap-3 px-5 py-9 sm:px-6 sm:py-10"
      }`}
    >
      <span className="flex size-10 items-center justify-center rounded-md border border-gold/25 bg-gold/5 text-gold shadow-[0_8px_24px_-18px_var(--gold)]">
        <Icon className="size-5" aria-hidden="true" />
      </span>
      <p className="text-sm font-semibold text-foreground">{title}</p>
      <p className="max-w-sm text-xs leading-relaxed text-muted-foreground">{description}</p>
      {action}
    </div>
  );
}
