import type { ReactNode } from "react";
import { StatusBadge } from "@/components/cartel/StatusBadge";
import { cn } from "@/lib/utils";

type PageHeaderProps = {
  eyebrow?: string;
  title: string;
  description?: string;
  status?: string;
  actions?: ReactNode;
  className?: string;
};

export function PageHeader({
  eyebrow,
  title,
  description,
  status,
  actions,
  className,
}: PageHeaderProps) {
  return (
    <header
      className={cn(
        "rise-in grid min-w-0 gap-4 border-b border-border-subtle pb-5 sm:pb-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end",
        className,
      )}
    >
      <div className="min-w-0">
        {eyebrow ? (
          <p className="type-eyebrow text-gold">
            {eyebrow}
          </p>
        ) : null}
        <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
          <h1 className="min-w-0 font-display text-[2rem] uppercase leading-[0.95] text-foreground [overflow-wrap:anywhere] sm:text-[2.5rem] lg:text-5xl">
            {title}
          </h1>
          {status ? (
            <StatusBadge tone="gold" className="shrink-0">
              {status}
            </StatusBadge>
          ) : null}
        </div>
        {description ? (
          <p className="mt-3 max-w-2xl text-[13px] leading-6 text-muted-foreground sm:text-sm">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? <div className="flex min-w-0 flex-wrap gap-2 lg:justify-end">{actions}</div> : null}
    </header>
  );
}
