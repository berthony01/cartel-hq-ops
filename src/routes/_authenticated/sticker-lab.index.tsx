import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { PackageOpen, Plus, TriangleAlert } from "lucide-react";
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
          "Create, generate, review and publish PEPECARTEL sticker packs to Telegram, then send them to your communities.",
      },
      { property: "og:title", content: "Sticker Lab — CARTEL HQ" },
      {
        property: "og:description",
        content:
          "Create, generate, review and publish PEPECARTEL sticker packs from the CARTEL HQ operating layer.",
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
  const { workspaceId, workspace } = useWorkspace();
  const projectName = workspace?.name ?? "this project";
  const packsQuery = useQuery({
    queryKey: ["sticker-packs", workspaceId],
    enabled: !!workspaceId,
    queryFn: () => listWorkspacePacks(workspaceId!),
  });
  const packs = packsQuery.data ?? [];
  const failed = packsQuery.isError;
  const staleWhileFailed = failed && packs.length > 0;

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
        description="Design a branded sticker pack, generate it with verified transparency, review it, then publish one Telegram sticker set and send it to your communities."
        status="Live Beta"
        actions={<div className="hidden sm:block">{newPackLink}</div>}
      />

      <div className="sm:hidden">{newPackLink}</div>

      <Section
        variant="plain"
        title="Workflow"
        description="Five guided steps from reference to published Telegram pack."
      >
        <ScrollRail
          aria-label="Sticker Lab workflow steps"
          desktopClassName="lg:grid lg:grid-cols-5 lg:overflow-visible lg:mx-0 lg:px-0"
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

      <Section
        variant="primary"
        title="Your packs"
        actions={
          <StatusBadge tone={failed ? "red" : packs.length > 0 ? "gold" : "muted"}>
            {packsQuery.isLoading
              ? "Loading"
              : failed && packs.length === 0
                ? "Unavailable"
                : `${packs.length} saved`}
          </StatusBadge>
        }
      >
        {staleWhileFailed ? (
          <p className="mb-3 flex items-start gap-2 rounded-md border border-gold/40 bg-gold/5 p-3 text-xs text-muted-foreground">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-gold" aria-hidden="true" />
            <span>
              Showing the last loaded packs; refreshing the list failed.{" "}
              <button
                type="button"
                className="underline underline-offset-2"
                onClick={() => void packsQuery.refetch()}
              >
                Retry
              </button>
            </span>
          </p>
        ) : null}

        {packsQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading packs…</p>
        ) : failed && packs.length === 0 ? (
          <EmptyState
            compact
            icon={TriangleAlert}
            title="Pack list unavailable"
            description="We could not load your sticker packs. Nothing has been lost — try again."
            action={
              <Button
                variant="outline"
                size="sm"
                className="mt-1 min-h-10"
                disabled={packsQuery.isFetching}
                onClick={() => void packsQuery.refetch()}
              >
                {packsQuery.isFetching ? "Retrying…" : "Retry"}
              </Button>
            }
          />
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
                        <Button asChild size="sm" className="min-h-9">
                          <Link to="/sticker-lab/$packId" params={{ packId: pack.id }}>
                            Open pack
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
    </div>
  );
}
