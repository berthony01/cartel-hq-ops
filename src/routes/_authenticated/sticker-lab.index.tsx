import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, ArchiveRestore, MoreVertical, PackageOpen, Plus, Trash2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/cartel/PageHeader";
import { EmptyState } from "@/components/cartel/EmptyState";
import { StatusBadge } from "@/components/cartel/StatusBadge";
import { Section } from "@/components/cartel/Section";
import { InlineRow } from "@/components/cartel/InlineRow";
import { RelatedLinks, relatedLinkClass } from "@/components/cartel/RelatedLinks";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  CapabilityStrip,
  JourneyAfterRelease,
  JourneyOverview,
} from "@/components/sticker-lab/StickerLabJourney";
import { useWorkspace } from "@/lib/workspace-context";
import {
  archivePack,
  deletePackPermanently,
  describeBlockingReasons,
  inspectPackLifecycle,
  listArchivedPacks,
  listWorkspacePacks,
  restorePack,
  type PackLifecycleState,
} from "@/lib/sticker-packs";
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

/**
 * Compact lifecycle control for one pack. Every action and its availability is
 * decided by the server (`sticker_pack_lifecycle_state`); this menu only
 * renders what the database says the signed-in operator may actually do.
 */
export function PackLifecycleMenu({
  packId,
  packTitle,
  workspaceId,
  onDeleted,
  align = "end",
}: {
  packId: string;
  packTitle: string;
  workspaceId: string | null | undefined;
  onDeleted?: () => void;
  align?: "start" | "end";
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState<null | "delete" | "archive" | "restore">(null);
  const [confirmTitle, setConfirmTitle] = useState("");
  const [busy, setBusy] = useState(false);

  const stateQuery = useQuery<PackLifecycleState>({
    queryKey: ["pack-lifecycle", packId],
    queryFn: () => inspectPackLifecycle(packId),
    enabled: open || dialog !== null,
    staleTime: 15_000,
  });
  const state = stateQuery.data;

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ["sticker-packs", workspaceId] });
    void queryClient.invalidateQueries({ queryKey: ["sticker-packs-archived", workspaceId] });
    void queryClient.invalidateQueries({ queryKey: ["pack-lifecycle", packId] });
    void queryClient.invalidateQueries({ queryKey: ["pack-manager", packId] });
  }

  function close() {
    setDialog(null);
    setConfirmTitle("");
  }

  async function run(kind: "delete" | "archive" | "restore") {
    setBusy(true);
    try {
      if (kind === "archive") {
        await archivePack(packId);
        toast.success("Pack archived", {
          description: "Any Sticker Drops for this pack were paused. The Telegram sticker set is untouched.",
        });
      } else if (kind === "restore") {
        await restorePack(packId);
        toast.success("Pack restored", {
          description: "Sticker Drops stay paused until you re-enable them in Sticker Drops.",
        });
      } else {
        const result = await deletePackPermanently(packId);
        if (!result.deleted) {
          toast.error("This pack cannot be deleted", {
            description: `${describeBlockingReasons(result.blockingReasons).join(", ") || "It has durable history"}. Archive it instead.`,
          });
          refresh();
          close();
          return;
        }
        toast.success("Pack deleted permanently", {
          description: result.storageCleanupPending
            ? "The pack is gone. Some stored images will be cleaned up later."
            : `Removed the pack, its stickers and ${result.removedImages} generated image${result.removedImages === 1 ? "" : "s"}.`,
        });
        onDeleted?.();
      }
      refresh();
      close();
    } catch (err) {
      toast.error("That action could not be completed", {
        description: err instanceof Error ? err.message : "Please try again.",
      });
    } finally {
      setBusy(false);
    }
  }

  const blocking = describeBlockingReasons(state?.blocking_reasons ?? []);

  return (
    <>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="size-9 shrink-0" aria-label={`Pack options for ${packTitle}`}>
            <MoreVertical className="size-4" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align={align} className="w-60">
          {stateQuery.isLoading ? (
            <DropdownMenuItem disabled>Checking pack…</DropdownMenuItem>
          ) : stateQuery.isError ? (
            <DropdownMenuItem disabled>Options unavailable</DropdownMenuItem>
          ) : !state?.can_manage ? (
            <DropdownMenuItem disabled>Owners and admins only</DropdownMenuItem>
          ) : state.can_restore ? (
            <DropdownMenuItem onSelect={() => setDialog("restore")}>
              <ArchiveRestore className="size-4" aria-hidden="true" />
              Restore pack
            </DropdownMenuItem>
          ) : state.can_delete ? (
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onSelect={() => setDialog("delete")}
            >
              <Trash2 className="size-4" aria-hidden="true" />
              Delete pack permanently
            </DropdownMenuItem>
          ) : state.can_archive ? (
            <DropdownMenuItem onSelect={() => setDialog("archive")}>
              <Archive className="size-4" aria-hidden="true" />
              Archive pack
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem disabled>Busy — try again shortly</DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={dialog !== null} onOpenChange={(v) => (v ? null : close())}>
        <DialogContent className="max-h-[90dvh] max-w-md overflow-y-auto">
          {dialog === "delete" ? (
            <>
              <DialogHeader>
                <DialogTitle>Delete “{packTitle}” permanently?</DialogTitle>
                <DialogDescription asChild>
                  <div className="space-y-2 text-sm text-muted-foreground">
                    <p>
                      This removes the CARTEL HQ pack, its sticker rows and the generated sticker
                      images that belong only to this pack. It cannot be undone.
                    </p>
                    <p>
                      Shared project assets and Brand Kit logos, mascots and references are{" "}
                      <strong className="text-foreground">not</strong> removed.
                    </p>
                    <p>
                      Type <strong className="text-foreground">{packTitle}</strong> to confirm.
                    </p>
                  </div>
                </DialogDescription>
              </DialogHeader>
              <Input
                value={confirmTitle}
                onChange={(e) => setConfirmTitle(e.target.value)}
                aria-label="Type the pack title to confirm"
                placeholder={packTitle}
                className="min-h-11"
              />
              <DialogFooter className="gap-2">
                <Button variant="outline" className="min-h-11" onClick={close} disabled={busy}>
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  className="min-h-11"
                  disabled={busy || confirmTitle.trim() !== packTitle}
                  onClick={() => void run("delete")}
                >
                  {busy ? "Deleting…" : "Delete permanently"}
                </Button>
              </DialogFooter>
            </>
          ) : dialog === "archive" ? (
            <>
              <DialogHeader>
                <DialogTitle>Archive “{packTitle}”?</DialogTitle>
                <DialogDescription asChild>
                  <div className="space-y-2 text-sm text-muted-foreground">
                    <p>The pack leaves your active packs and moves to Archived packs.</p>
                    <p>Any Sticker Drops using this pack are paused so nothing keeps posting.</p>
                    <p>
                      Publishing, delivery and generation history are preserved, and the existing
                      Telegram sticker set is{" "}
                      <strong className="text-foreground">not deleted from Telegram</strong>.
                    </p>
                    {blocking.length > 0 ? (
                      <p className="text-xs">Why archive instead of delete: {blocking.join(", ")}.</p>
                    ) : null}
                  </div>
                </DialogDescription>
              </DialogHeader>
              <DialogFooter className="gap-2">
                <Button variant="outline" className="min-h-11" onClick={close} disabled={busy}>
                  Cancel
                </Button>
                <Button className="min-h-11" disabled={busy} onClick={() => void run("archive")}>
                  {busy ? "Archiving…" : "Archive pack"}
                </Button>
              </DialogFooter>
            </>
          ) : dialog === "restore" ? (
            <>
              <DialogHeader>
                <DialogTitle>Restore “{packTitle}”?</DialogTitle>
                <DialogDescription asChild>
                  <div className="space-y-2 text-sm text-muted-foreground">
                    <p>The pack returns to your active packs.</p>
                    <p>
                      Sticker Drops stay paused on purpose. Re-enable them yourself in Sticker Drops
                      when you want recurring posts again.
                    </p>
                  </div>
                </DialogDescription>
              </DialogHeader>
              <DialogFooter className="gap-2">
                <Button variant="outline" className="min-h-11" onClick={close} disabled={busy}>
                  Cancel
                </Button>
                <Button className="min-h-11" disabled={busy} onClick={() => void run("restore")}>
                  {busy ? "Restoring…" : "Restore pack"}
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
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

  const archivedQuery = useQuery({
    queryKey: ["sticker-packs-archived", workspaceId],
    enabled: !!workspaceId,
    queryFn: () => listArchivedPacks(workspaceId!),
  });
  const archived = archivedQuery.data ?? [];


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

      <RelatedLinks label="Go to">
        <Link to="/brand-kit" className={relatedLinkClass}>
          Brand Kit
        </Link>
        <Link to="/assets" className={relatedLinkClass}>
          Asset Vault
        </Link>
        <Link to="/distribution" className={relatedLinkClass}>
          Sticker Drops · recurring
        </Link>
      </RelatedLinks>

      <section className="surface-command rise-in overflow-hidden rounded-lg border border-gold/35 p-4 shadow-[var(--shadow-cartel),var(--glow-gold)] sm:p-6" aria-labelledby="studio-context-title">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <div className="min-w-0">
            <p className="type-eyebrow text-gold">Creative operations</p>
            <h2 id="studio-context-title" className="mt-2 font-display text-2xl uppercase leading-none text-foreground sm:text-3xl">
              {projectName} Sticker Studio
            </h2>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">
              Brand Kit defines the identity. Asset Vault holds the source material. Sticker Lab turns both into reviewed packs for Telegram and community distribution.
            </p>
          </div>
          <div className="grid gap-3 lg:min-w-80">
            <dl className="grid grid-cols-2 gap-2">
            <div className="surface-quiet min-w-0 rounded-md p-3">
              <dt className="type-eyebrow text-muted-foreground">Active packs</dt>
              <dd className="mt-1.5 font-display text-xl leading-none text-gold">{packsQuery.isLoading ? "—" : packs.length}</dd>
            </div>
            <div className="surface-quiet min-w-0 rounded-md p-3">
              <dt className="type-eyebrow text-muted-foreground">Archived</dt>
              <dd className="mt-1.5 font-display text-xl leading-none text-foreground">{archivedQuery.isLoading ? "—" : archived.length}</dd>
            </div>
            </dl>
          </div>
        </div>
      </section>

      <Section
        variant="plain"
        title="How Sticker Lab works"
        description="A connected path from project identity to community-ready creative. Blueprint covers builder steps 1 and 2."
      >
        <JourneyOverview />
        <JourneyAfterRelease />
      </Section>

      <Section
        variant="plain"
        title="What you get"
        description="Capabilities available in Sticker Lab today."
      >
        <CapabilityStrip />
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
            title={
              archivedQuery.isSuccess && archived.length === 0
                ? "No sticker packs yet"
                : "No active sticker packs"
            }
            description={
              archivedQuery.isLoading
                ? "There are no active packs. Checking archived packs…"
                : archivedQuery.isError
                  ? "There are no active packs. Archived packs could not be checked right now."
                  : archived.length > 0
                    ? "Every pack in this project is archived. Archived packs are preserved below and can be restored at any time."
                    : "Packs you save in the builder are stored in this project and appear here."
            }
            action={
              <Button asChild variant="outline" size="sm" className="mt-1 min-h-10">
                <Link to="/sticker-lab/new" search={{}} onClick={() => clearDraft()}>
                  Open the builder
                </Link>
              </Button>
            }
          />

        ) : (
          <ul className="grid gap-3 lg:grid-cols-2">
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
                    leading={<PackageOpen className="size-4" aria-hidden="true" />}
                    className={label === "review" ? "border-pepe/35 bg-pepe/5" : "hover:border-gold/35"}
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
                        <PackLifecycleMenu
                          packId={pack.id}
                          packTitle={pack.title}
                          workspaceId={workspaceId}
                        />
                      </div>
                    }
                  />
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      {archivedQuery.isError ? (
        <p className="flex items-start gap-2 rounded-md border border-gold/40 bg-gold/5 p-3 text-xs text-muted-foreground">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-gold" aria-hidden="true" />
          <span>
            Archived packs could not be loaded, so this page may not show every pack in the project.{" "}
            <button
              type="button"
              className="underline underline-offset-2"
              onClick={() => void archivedQuery.refetch()}
            >
              Retry
            </button>
          </span>
        </p>
      ) : null}

      {archived.length > 0 ? (

        <Section
          variant="quiet"
          title="Archived packs"
          description="Archived packs keep their Telegram sticker set, delivery history and Sticker Drop history. Their Sticker Drops are paused."
          actions={<StatusBadge tone="muted">{`${archived.length} archived`}</StatusBadge>}
        >
          <ul className="space-y-2">
            {archived.map((pack) => (
              <li key={pack.id}>
                <InlineRow
                  leading={<Archive className="size-4" aria-hidden="true" />}
                  className="opacity-85"
                  title={pack.title}
                  subtitle={`${pack.pack_size} stickers · archived ${pack.archived_at ? relativeTime(pack.archived_at) : "recently"}`}
                  trailing={
                    <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
                      <StatusBadge tone="muted">archived</StatusBadge>
                      <Button asChild size="sm" variant="outline" className="min-h-9">
                        <Link to="/sticker-lab/$packId" params={{ packId: pack.id }}>
                          View pack
                        </Link>
                      </Button>
                      <PackLifecycleMenu
                        packId={pack.id}
                        packTitle={pack.title}
                        workspaceId={workspaceId}
                      />
                    </div>
                  }
                />
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

    </div>
  );
}
