import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Sticker, PackageOpen, Plus, ArrowRight } from "lucide-react";
import { PageHeader } from "@/components/cartel/PageHeader";
import { EmptyState } from "@/components/cartel/EmptyState";
import { StatusBadge } from "@/components/cartel/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FLOW_STEPS } from "@/lib/sticker-lab";
import { useWorkspace } from "@/lib/workspace-context";
import { listWorkspacePacks } from "@/lib/sticker-packs";

export const Route = createFileRoute("/_authenticated/sticker-lab/")({
  head: () => ({
    meta: [
      { title: "Sticker Lab — CARTEL HQ" },
      {
        name: "description",
        content:
          "Sticker Lab is the first CARTEL HQ production module: plan, generate and review PEPECARTEL sticker packs.",
      },
      { property: "og:title", content: "Sticker Lab — CARTEL HQ" },
      {
        property: "og:description",
        content: "Plan and generate PEPECARTEL sticker packs inside the CARTEL HQ operating layer.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: StickerLabHome,
});

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function StickerLabHome() {
  const { workspaceId } = useWorkspace();
  const packsQuery = useQuery({
    queryKey: ["sticker-packs", workspaceId],
    enabled: !!workspaceId,
    queryFn: () => listWorkspacePacks(workspaceId!),
  });
  const packs = packsQuery.data ?? [];

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Module 01"
        title="Sticker Lab"
        description="Plan a PEPECARTEL sticker pack end to end: private character references, pack setup, concepts, server-side AI generation with verified transparency, and review. Telegram delivery arrives in a later phase."
        status="Live · Telegram pending"
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
            <StatusBadge tone={packs.length > 0 ? "gold" : "muted"}>
              {packsQuery.isLoading ? "Loading" : `${packs.length} saved`}
            </StatusBadge>
          </CardHeader>
          <CardContent>
            {packsQuery.isLoading ? (
              <p className="text-sm text-muted-foreground">Loading packs…</p>
            ) : packs.length === 0 ? (
              <EmptyState
                icon={PackageOpen}
                title="No sticker packs yet"
                description="Packs you save in the builder are stored in this workspace and appear here."
                action={
                  <Button asChild variant="outline" size="sm" className="mt-1 min-h-10">
                    <Link to="/sticker-lab/new">Open the builder</Link>
                  </Button>
                }
              />
            ) : (
              <ul className="divide-y divide-border">
                {packs.map((pack) => (
                  <li
                    key={pack.id}
                    className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-foreground">
                        {pack.title}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {pack.pack_size} stickers · {pack.ready}/{pack.total} ready · updated{" "}
                        {relativeTime(pack.updated_at)}
                      </p>
                    </div>
                    {(() => {
                      // A pack is only "generating" while stickers are actually active.
                      const label =
                        pack.status === "generating" && pack.active === 0
                          ? pack.ready > 0
                            ? "review"
                            : "draft"
                          : pack.status;
                      return (
                        <StatusBadge tone={label === "review" ? "green" : "muted"}>
                          {label}
                        </StatusBadge>
                      );
                    })()}
                  </li>
                ))}
              </ul>
            )}
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
                Connected
              </p>
              <ul className="mt-2 space-y-1.5 text-muted-foreground">
                <li>Account sign-in and workspace access</li>
                <li>Private asset storage and Asset Vault records</li>
                <li>Pack and sticker persistence</li>
                <li>AI generation with server-side transparency validation, when configured</li>
              </ul>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Not connected yet
              </p>
              <ul className="mt-2 space-y-1.5 text-muted-foreground">
                <li>Telegram publishing</li>
                <li>Motion and video stickers</li>
              </ul>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
