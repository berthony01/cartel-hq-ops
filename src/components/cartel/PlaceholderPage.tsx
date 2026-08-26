import type { LucideIcon } from "lucide-react";
import { PageHeader } from "@/components/cartel/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
    <div className="space-y-8">
      <PageHeader eyebrow={eyebrow} title={title} description={description} status={status} />

      {highlight ? (
        <div className="rise-in flex items-start gap-3 rounded-lg border border-gold/35 bg-gold/5 px-4 py-3">
          <Icon className="mt-0.5 size-4 shrink-0 text-gold" aria-hidden="true" />
          <p className="text-sm text-ivory/90">{highlight}</p>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="cartel-panel rise-in">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm uppercase tracking-widest">
              <Check className="size-4 text-pepe" aria-hidden="true" />
              In this build
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm text-muted-foreground">
              {availableNow.map((item) => (
                <li key={item} className="flex gap-2">
                  <span className="mt-2 size-1.5 shrink-0 rounded-full bg-pepe" aria-hidden="true" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card className="cartel-panel rise-in">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm uppercase tracking-widest">
              <CircleDashed className="size-4 text-gold" aria-hidden="true" />
              Not built yet
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm text-muted-foreground">
              {plannedLater.map((item) => (
                <li key={item} className="flex items-start justify-between gap-3">
                  <span>{item}</span>
                  <Badge variant="outline" className="shrink-0 border-border text-[10px] uppercase">
                    Planned
                  </Badge>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
