import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
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
        "rise-in flex flex-col gap-3 border-b border-border pb-4 sm:gap-4 sm:pb-6 lg:flex-row lg:items-end lg:justify-between",
        className,
      )}
    >
      <div className="min-w-0">
        {eyebrow ? (
          <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-gold sm:text-[11px]">
            {eyebrow}
          </p>
        ) : null}
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-2 sm:mt-2">
          <h1 className="min-w-0 font-display text-2xl uppercase leading-tight text-foreground sm:text-3xl lg:text-4xl lg:leading-none">
            {title}
          </h1>
          {status ? (
            <Badge
              variant="outline"
              className="shrink-0 border-gold/40 text-[10px] uppercase tracking-[0.14em] text-gold sm:text-xs"
            >
              {status}
            </Badge>
          ) : null}
        </div>
        {description ? (
          <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-muted-foreground sm:mt-3 sm:text-sm">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </header>
  );
}
