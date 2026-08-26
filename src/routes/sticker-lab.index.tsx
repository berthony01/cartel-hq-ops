import { createFileRoute, Link } from "@tanstack/react-router";
import { Sticker, PackageOpen, Plus, ArrowRight } from "lucide-react";
import { PageHeader } from "@/components/cartel/PageHeader";
import { EmptyState } from "@/components/cartel/EmptyState";
import { StatusBadge } from "@/components/cartel/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FLOW_STEPS } from "@/lib/sticker-lab";

export const Route = createFileRoute("/sticker-lab/")({
  head: () => ({
    meta: [
      { title: "Sticker Lab — CARTEL HQ" },
      {
        name: "description",
        content:
          "Sticker Lab is the first CARTEL HQ production module: plan, design and ship PEPECARTEL sticker packs.",
      },
      { property: "og:title", content: "Sticker Lab — CARTEL HQ" },
      {
        property: "og:description",
        content: "Plan and design PEPECARTEL sticker packs inside the CARTEL HQ operating layer.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: StickerLabHome,
});

function StickerLabHome() {
  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Module 01"
        title="Sticker Lab"
        description="Plan a PEPECARTEL sticker pack end to end: character reference, pack setup, concepts, generation and Telegram delivery. This release is an interactive prototype of that workflow — no generation, upload or publishing is connected."
        status="Beta · Frontend prototype"
        actions={
          <Button asChild className="min-h-11">
            <Link to="/sticker-lab/new">
              <Plus className="size-4" aria-hidden="true" />
              Create Sticker Pack
            </Link>
          </Button>
        }
      />

      <section aria-labelledby="flow-heading" className="rise-in">
        <h2
          id="flow-heading"
          className="text-[11px] font-semibold uppercase tracking-[0.24em] text-muted-foreground"
        >
          Workflow
        </h2>
        <ol className="mt-3 flex flex-wrap items-center gap-2">
          {FLOW_STEPS.map((step, i) => (
            <li key={step} className="flex items-center gap-2">
              <span className="cartel-panel rounded-md px-3 py-2 text-xs font-medium text-foreground">
                <span className="mr-2 text-gold">{String(i + 1).padStart(2, "0")}</span>
                {step}
              </span>
              {i < FLOW_STEPS.length - 1 ? (
                <ArrowRight
                  className="size-3.5 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
              ) : null}
            </li>
          ))}
        </ol>
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="cartel-panel lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
            <CardTitle className="text-base">Recent Packs</CardTitle>
            <StatusBadge tone="muted">No data</StatusBadge>
          </CardHeader>
          <CardContent>
            <EmptyState
              icon={PackageOpen}
              title="No sticker packs yet"
              description="Packs are not persisted in this phase. Start the builder to walk through the planned creation flow."
              action={
                <Button asChild variant="outline" size="sm" className="mt-1 min-h-10">
                  <Link to="/sticker-lab/new">Open the builder</Link>
                </Button>
              }
            />
          </CardContent>
        </Card>

        <Card className="cartel-panel">
          <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
            <CardTitle className="text-base">Module status</CardTitle>
            <StatusBadge tone="gold">
              <Sticker className="size-3" aria-hidden="true" />
              First module
            </StatusBadge>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-pepe">
                Available now
              </p>
              <ul className="mt-2 space-y-1.5 text-muted-foreground">
                <li>Interactive workflow prototype</li>
                <li>Local-only concept editing</li>
                <li>Session-scoped draft state</li>
              </ul>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Not connected yet
              </p>
              <ul className="mt-2 space-y-1.5 text-muted-foreground">
                <li>AI generation and background removal</li>
                <li>Asset storage and pack history</li>
                <li>Telegram publishing</li>
              </ul>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
