import type { LucideIcon } from "lucide-react";
import { PageHeader } from "@/components/cartel/PageHeader";
import { Section } from "@/components/cartel/Section";
import { InlineRow } from "@/components/cartel/InlineRow";
import { StatusBadge } from "@/components/cartel/StatusBadge";
import { CircleDashed, Check } from "lucide-react";

type PlaceholderPageProps = {
  eyebrow: string;
  title: string;
  description: string;
  status: string;
  icon: LucideIcon;
  availableNow: string[];
  plannedLater: string[];
  highlight?: string;
};

export function PlaceholderPage({
  eyebrow,
  title,
  description,
  status,
  icon: Icon,
  availableNow,
  plannedLater,
  highlight,
}: PlaceholderPageProps) {
  return (
    <div className="space-y-5 sm:space-y-8">
      <PageHeader eyebrow={eyebrow} title={title} description={description} status={status} />

      {highlight ? (
        <div className="rise-in flex items-start gap-3 rounded-lg border border-gold/35 bg-gold/5 px-3 py-3 sm:px-4">
          <Icon className="mt-0.5 size-4 shrink-0 text-gold" aria-hidden="true" />
          <p className="min-w-0 text-[13px] leading-relaxed text-ivory/90 sm:text-sm">{highlight}</p>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        <Section
          variant="surface"
          className="rise-in"
          leading={<Check className="size-4 text-pepe" aria-hidden="true" />}
          title="In this build"
          contentClassName="space-y-2"
        >
          {availableNow.map((item) => (
            <div key={item} className="flex gap-2 text-[13px] text-muted-foreground sm:text-sm">
              <span className="mt-2 size-1.5 shrink-0 rounded-full bg-pepe" aria-hidden="true" />
              <span className="min-w-0">{item}</span>
            </div>
          ))}
        </Section>

        <Section
          variant="surface"
          className="rise-in"
          leading={<CircleDashed className="size-4 text-gold" aria-hidden="true" />}
          title="Not built yet"
          contentClassName="space-y-2"
        >
          {plannedLater.map((item) => (
            <InlineRow
              key={item}
              title={<span className="whitespace-normal">{item}</span>}
              trailing={<StatusBadge tone="muted">Planned</StatusBadge>}
              className="items-start"
            />
          ))}
        </Section>
      </div>
    </div>
  );
}
