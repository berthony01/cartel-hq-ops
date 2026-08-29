import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { PackageOpen, Plus } from "lucide-react";
import { PageHeader } from "@/components/cartel/PageHeader";
import { EmptyState } from "@/components/cartel/EmptyState";
import { StatusBadge } from "@/components/cartel/StatusBadge";
import { Section } from "@/components/cartel/Section";
import { InlineRow } from "@/components/cartel/InlineRow";
import { ScrollRail } from "@/components/cartel/ScrollRail";
import { Button } from "@/components/ui/button";
import { FLOW_STEPS } from "@/lib/sticker-lab";
import { useWorkspace } from "@/lib/workspace-context";
import { listWorkspacePacks } from "@/lib/sticker-packs";
import { clearDraft } from "@/lib/sticker-lab";

export const Route = createFileRoute("/_authenticated/sticker-lab/")({
  head: () => ({
    meta: [
      { title: "Sticker Lab — CARTEL HQ" },
      {
        name: "description",
        content:
          "Sticker Lab is the first CARTEL HQ production module: plan, generate, review and publish PEPECARTEL sticker packs to Telegram.",
      },
      { property: "og:title", content: "Sticker Lab — CARTEL HQ" },
      {
        property: "og:description",
        content:
          "Plan, generate and publish PEPECARTEL sticker packs inside the CARTEL HQ operating layer.",
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

const LIVE_CAPABILITIES = [
  "Private, workspace-scoped asset storage",
  "Pack and sticker persistence",
  "Server-side AI generation with transparency validation",
  "Review, export and Telegram pack publishing",
  "Scheduled Sticker Drops per pack in Review & Telegram, managed workspace wide in the Distribution Center",
];

const FUTURE_CAPABILITIES = ["Motion and video stickers"];

function StickerLabHome() {
  const { workspaceId } = useWorkspace();
  const packsQuery = useQuery({
    queryKey: ["sticker-packs", workspaceId],
    enabled: !!workspaceId,
    queryFn: () => listWorkspacePacks(workspaceId!),
  });
  const packs = packsQuery.data ?? [];

  const newPackLink = (
    <Button asChild className="min-h-11 w-full sm:w-auto">
      <Link to="/sticker-lab/new" search={{}} onClick={() => clearDraft()}>
        <Plus className="size-4" aria-hidden="true" />
        Create Sticker Pack
      </Link>
    </Button>
  );

  return (
    <div className="flex flex-col gap-6 sm:gap-8">
      <PageHeader
        eyebrow="Module 01"
        title="Sticker Lab"
        description="Plan a PEPECARTEL sticker pack end to end: private character references, pack setup, concepts, server-side AI generation with verified transparency, review, and Telegram publishing."
        status="Live Beta"
        actions={<div className="hidden sm:block">{newPackLink}</div>}
      />

      <div className="sm:hidden">{newPackLink}</div>

      <Section
        variant="plain"
        title="Workflow"
        description="Six guided steps from reference to published Telegram pack."
      >
        <ScrollRail
          aria-label="Sticker Lab workflow steps"
          desktopClassName="lg:grid lg:grid-cols-6 lg:overflow-visible lg:mx-0 lg:px-0"
        >
          {FLOW_STEPS.map((step, i) => (
            <div
              key={step}
              className="min-w-[8.5rem] rounded-lg border border-border/70 bg-surface-raised/60 px-3 py-2.5"
            >
              <p className="text-[11px] font-semibold tracking-[0.16em] text-gold">
                {String(i + 1).padStart(2, "0")}
              </p>
              <p className="mt-1 text-sm font-medium leading-snug text-foreground">{step}</p>
            </div>
          ))}
        </ScrollRail>
      </Section>

      <div className="grid gap-4 sm:gap-6 lg:grid-cols-3 [&>*]:min-w-0">
        <Section
          variant="primary"
          className="lg:col-span-2"
          title="Recent Packs"
          actions={
            <StatusBadge tone={packs.length > 0 ? "gold" : "muted"}>
              {packsQuery.isLoading ? "Loading" : `${packs.length} saved`}
            </StatusBadge>
          }
        >
          {packsQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading packs…</p>
          ) : packs.length === 0 ? (
            <EmptyState
              compact
              icon={PackageOpen}
              title="No sticker packs yet"
              description="Packs you save in the builder are stored in this workspace and appear here."
              action={
                <Button asChild variant="outline" size="sm" className="mt-1 min-h-10">
                  <Link to="/sticker-lab/new" search={{}} onClick={() => clearDraft()}>
                    Open the builder
                  </Link>
                </Button>
              }
            />
          ) : (
            <ul className="space-y-2">
              {packs.map((pack) => {
                // A pack is only "generating" while stickers are actually active.
                const label =
                  pack.status === "generating" && pack.active === 0
                    ? pack.ready > 0
                      ? "review"
                      : "draft"
                    : pack.status;
                return (
                  <li key={pack.id}>
                    <InlineRow
                      title={pack.title}
                      subtitle={`${pack.pack_size} stickers · ${pack.ready}/${pack.total} ready · updated ${relativeTime(pack.updated_at)}`}
                      trailing={
                        <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
                          <StatusBadge tone={label === "review" ? "green" : "muted"}>
                            {label}
                          </StatusBadge>
                          <Button asChild variant="outline" size="sm" className="min-h-9">
                            <Link to="/sticker-lab/$packId" params={{ packId: pack.id }}>
                              Manage
                            </Link>
                          </Button>
                          <Button asChild variant="outline" size="sm" className="min-h-9">
                            <Link to="/sticker-lab/new" search={{ pack: pack.id }}>
                              Resume
                            </Link>
                          </Button>
                        </div>
                      }
                    />
                  </li>
                );
              })}
            </ul>
          )}
        </Section>

        <Section
          variant="primary"
          title="Module status"
          actions={<StatusBadge tone="green">Live Beta</StatusBadge>}
          contentClassName="space-y-4 text-sm"
        >
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-pepe">Live</p>
            <ul className="mt-2 space-y-1.5 text-muted-foreground">
              {LIVE_CAPABILITIES.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Coming later
            </p>
            <ul className="mt-2 space-y-1.5 text-muted-foreground">
              {FUTURE_CAPABILITIES.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        </Section>
      </div>
    </div>
  );
}
