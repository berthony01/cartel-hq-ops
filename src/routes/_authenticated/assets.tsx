import { useEffect, useMemo, useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, FolderLock, ImageIcon, Palette, ShieldCheck, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useSession } from "@/hooks/useSession";
import { useWorkspace } from "@/lib/workspace-context";
import {
  ASSET_TYPES,
  ASSET_TYPE_LABELS,
  deleteWorkspaceAsset,
  formatBytes,
  listWorkspaceAssets,
  signedUrl,
  signedUrlMap,
  type AssetType,
  type MediaAsset,
} from "@/lib/media";
import { PageHeader } from "@/components/cartel/PageHeader";
import { EmptyState } from "@/components/cartel/EmptyState";
import { AssetUploader } from "@/components/cartel/AssetUploader";
import { Section } from "@/components/cartel/Section";
import { StatusBadge } from "@/components/cartel/StatusBadge";
import { RelatedLinks, relatedLinkClass } from "@/components/cartel/RelatedLinks";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";


/**
 * Display-only labels for system-generated Sticker Lab artifacts. These types
 * are NOT user-uploadable and are deliberately absent from `ASSET_TYPES`.
 */
const MANAGED_ASSET_TYPES = ["generated_motion", "telegram_motion"] as const;

const isManagedAsset = (assetType: string) =>
  (MANAGED_ASSET_TYPES as readonly string[]).includes(assetType);

const assetTypeLabel = (assetType: string): string => {
  if (assetType === "generated_motion") return "Motion source";
  if (assetType === "telegram_motion") return "Telegram motion";
  return ASSET_TYPE_LABELS[assetType as AssetType] ?? assetType;
};


export const Route = createFileRoute("/_authenticated/assets")({
  head: () => ({
    meta: [
      { title: "Asset Vault — CARTEL HQ" },
      {
        name: "description",
        content: "Asset Vault stores PEPECARTEL artwork, references, and generated stickers.",
      },
      { property: "og:title", content: "Asset Vault — CARTEL HQ" },
      { property: "og:description", content: "Private storage for PEPECARTEL creative assets." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AssetsPage,
});

function AssetsPage() {
  const { workspaceId, workspace, loading: workspaceLoading } = useWorkspace();
  const { user } = useSession();
  const queryClient = useQueryClient();
  const [uploadType, setUploadType] = useState<AssetType>("reference_image");
  const [filter, setFilter] = useState<AssetType | "all">("all");
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [pendingDelete, setPendingDelete] = useState<MediaAsset | null>(null);
  const [deleting, setDeleting] = useState(false);


  const assetsQuery = useQuery({
    queryKey: ["assets", workspaceId],
    enabled: !!workspaceId,
    queryFn: () => listWorkspaceAssets(workspaceId!),
  });

  const assets = useMemo(() => {
    const list = assetsQuery.data ?? [];
    return filter === "all" ? list : list.filter((a) => a.asset_type === filter);
  }, [assetsQuery.data, filter]);

  const allAssets = assetsQuery.data ?? [];
  const sourceCount = allAssets.filter((asset) => !isManagedAsset(asset.asset_type)).length;
  const studioCount = allAssets.filter((asset) => isManagedAsset(asset.asset_type)).length;

  useEffect(() => {
    let active = true;
    if (assets.length === 0) {
      setUrls({});
      return;
    }
    signedUrlMap(assets.map((a) => a.storage_path)).then((map) => {
      if (active) setUrls(map);
    });
    return () => {
      active = false;
    };
  }, [assets]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["assets", workspaceId] });

  const download = async (asset: MediaAsset) => {
    const url = await signedUrl(asset.storage_path, 60);
    if (!url) {
      toast.error("Could not create a download link.");
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const remove = async (asset: MediaAsset) => {
    setDeleting(true);
    try {
      await deleteWorkspaceAsset(asset);
      toast.success("Asset deleted");
      setPendingDelete(null);
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not delete the asset.");
    } finally {
      setDeleting(false);
    }
  };


  return (
    <div className="space-y-6 sm:space-y-8">
      <PageHeader
        eyebrow="Module"
        title="Asset Vault"
        description="Asset Vault is this project’s source of truth for actual image files. Brand Kit stores creative rules, not separate copies, and Sticker Lab reuses applicable files from here. Files stay private; previews and downloads use short-lived signed links."
        status={workspace ? workspace.name : "No project"}
      />

      <RelatedLinks label="Go to">
        <Link to="/brand-kit" className={relatedLinkClass}>
          Brand Kit
        </Link>
        <Link to="/sticker-lab" className={relatedLinkClass}>
          Sticker Lab
        </Link>
      </RelatedLinks>

      {workspaceId ? (
        <section className="surface-command overflow-hidden rounded-lg p-4 sm:p-6" aria-labelledby="vault-status-title">
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
            <div className="min-w-0">
              <p className="type-eyebrow text-gold">Private creative library</p>
              <h2 id="vault-status-title" className="mt-2 font-display text-2xl uppercase leading-none text-foreground sm:text-3xl">
                {workspace?.name ?? "Project"} Asset Vault
              </h2>
              <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                Source artwork and Sticker Lab outputs stay together here, protected by project access and opened through short-lived links.
              </p>
            </div>
            <dl className="grid grid-cols-3 gap-2 lg:min-w-[22rem]">
              <div className="surface-quiet min-w-0 rounded-md p-3">
                <dt className="type-eyebrow text-muted-foreground">All files</dt>
                <dd className="mt-1.5 font-display text-xl leading-none text-foreground">{assetsQuery.isLoading ? "—" : allAssets.length}</dd>
              </div>
              <div className="surface-quiet min-w-0 rounded-md p-3">
                <dt className="type-eyebrow text-muted-foreground">Source</dt>
                <dd className="mt-1.5 font-display text-xl leading-none text-gold">{assetsQuery.isLoading ? "—" : sourceCount}</dd>
              </div>
              <div className="surface-quiet min-w-0 rounded-md p-3">
                <dt className="type-eyebrow text-muted-foreground">Studio</dt>
                <dd className="mt-1.5 font-display text-xl leading-none text-pepe">{assetsQuery.isLoading ? "—" : studioCount}</dd>
              </div>
            </dl>
          </div>
        </section>
      ) : null}

      {!workspaceLoading && !workspaceId ? (
        <EmptyState
          icon={FolderLock}
          title="No project yet"
          description="Add a project from the switcher in the header to start storing assets."
        />
      ) : (
        <>
          <Section
            variant="primary"
            leading={<ImageIcon className="size-4" aria-hidden="true" />}
            title="Add source material"
            description="Choose what this file represents, then place it in the project vault."
            actions={
              <Button asChild variant="outline" size="sm" className="min-h-10">
                <Link to="/brand-kit">
                  <Palette className="size-4" aria-hidden="true" />
                  Edit Brand Kit
                </Link>
              </Button>
            }
            contentClassName="space-y-3"
          >
            <div className="grid gap-3 md:grid-cols-[220px_1fr] md:items-start [&>*]:min-w-0">
              <div>
                <label
                  htmlFor="asset-type"
                  className="mb-2 block text-sm font-medium text-foreground"
                >
                  Asset type
                </label>
                <Select value={uploadType} onValueChange={(v) => setUploadType(v as AssetType)}>
                  <SelectTrigger id="asset-type" className="min-h-11 w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ASSET_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>
                        {ASSET_TYPE_LABELS[t]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <AssetUploader
                workspaceId={workspaceId}
                userId={user?.id ?? null}
                assetType={uploadType}
                label={`Upload ${ASSET_TYPE_LABELS[uploadType].toLowerCase()}`}
                onUploaded={refresh}
              />
            </div>
            <details className="surface-quiet rounded-md p-3">
              <summary className="cursor-pointer text-xs font-medium text-foreground">
                What each asset type means
              </summary>
              <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                <li>
                  <span className="text-foreground">Logo</span> — project mark / profile identity
                  candidate.
                </li>
                <li>
                  <span className="text-foreground">Mascot</span> — recurring project character or
                  subject.
                </li>
                <li>
                  <span className="text-foreground">Reference image</span> — visual reference for
                  Sticker Lab generation.
                </li>
                <li>
                  <span className="text-foreground">Generated sticker</span> — sticker output or
                  sticker file associated with Sticker Lab.
                </li>
                <li>
                  <span className="text-foreground">Other</span> — uncategorised project imagery.
                </li>
              </ul>
            </details>
          </Section>

          <Section
            variant="plain"
            title="Creative library"
            description="These are the project's files. Project Profile and Sticker Lab can reuse applicable project files. Brand Kit stores creative rules and only shows related references for context — there are no separate Brand Kit file copies."
            actions={
              <div className="flex items-center gap-2">
                <StatusBadge tone={assets.length > 0 ? "gold" : "muted"}>
                  {assetsQuery.isLoading ? "Loading" : `${assets.length}`}
                </StatusBadge>
                <Select value={filter} onValueChange={(v) => setFilter(v as AssetType | "all")}>
                  <SelectTrigger
                    className="min-h-10 w-[9.5rem] sm:w-48"
                    aria-label="Filter by asset type"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All types</SelectItem>
                    {ASSET_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>
                        {ASSET_TYPE_LABELS[t]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            }
          >
            {assetsQuery.isLoading ? (
              <p className="text-sm text-muted-foreground">Loading assets…</p>
            ) : assetsQuery.isError ? (
              <div className="flex flex-wrap items-center gap-3 rounded-md border border-border/70 p-3">
                <p role="alert" className="text-sm text-signal">
                  Assets could not be loaded, so the library is unavailable right now.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="min-h-10"
                  onClick={() => void assetsQuery.refetch()}
                >
                  Retry
                </Button>
              </div>
            ) : assets.length === 0 ? (
              (assetsQuery.data ?? []).length > 0 ? (
                <EmptyState
                  compact
                  icon={FolderLock}
                  title="No matching assets"
                  description={`This project has files, but none of type "${filter === "all" ? "All types" : ASSET_TYPE_LABELS[filter]}". Change the filter to see other assets.`}
                />
              ) : (
                <EmptyState
                  compact
                  icon={FolderLock}
                  title="No assets yet"
                  description="Uploads appear here. Files are private to this project and never publicly accessible."
                />
              )
            ) : (
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-5 [&>*]:min-w-0">
                {assets.map((asset) => {
                  const label = assetTypeLabel(asset.asset_type);
                  const managed = isManagedAsset(asset.asset_type);
                  const isVideo = (asset.mime_type ?? "").startsWith("video/");
                  return (
                    <li key={asset.id} className="surface-elevated hover-lift rise-in group rounded-lg p-2.5 sm:p-3">
                      <div className="relative flex aspect-square items-center justify-center overflow-hidden rounded-md border border-border-subtle bg-background/40">
                        {urls[asset.storage_path] ? (
                          isVideo ? (
                            <video
                              src={urls[asset.storage_path]}
                              controls
                              muted
                              loop
                              playsInline
                              preload="metadata"
                              className="max-h-full max-w-full object-contain"
                            />
                          ) : (
                            <img
                              src={urls[asset.storage_path]}
                              alt={`${label} asset`}
                              className="max-h-full max-w-full object-contain"
                              loading="lazy"
                            />
                          )
                        ) : (
                          <span className="text-[10px] text-muted-foreground">
                            Loading preview…
                          </span>
                        )}
                      </div>
                      <div className="mt-2 flex min-w-0 items-center justify-between gap-2">
                        <p className="type-eyebrow min-w-0 truncate text-gold">{label}</p>
                        {managed ? (
                          <span title="Managed by Sticker Lab"><Sparkles className="size-3.5 shrink-0 text-pepe" aria-hidden="true" /></span>
                        ) : (
                          <span title="Project source"><ShieldCheck className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" /></span>
                        )}
                      </div>
                      <p className="truncate text-[11px] text-muted-foreground">
                        {asset.width && asset.height ? `${asset.width}×${asset.height} · ` : ""}
                        {formatBytes(asset.file_size_bytes)}
                      </p>
                      {managed ? (
                        <p className="mt-1 text-[10px] text-muted-foreground">
                          Managed by Sticker Lab
                        </p>
                      ) : null}
                      <div className="mt-2 flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          className="min-h-10 flex-1 text-xs"
                          onClick={() => void download(asset)}
                        >
                          <Download className="size-3.5" aria-hidden="true" />
                          Open
                        </Button>
                        {managed ? null : (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="min-h-10 min-w-10 text-signal hover:text-signal"
                            aria-label="Delete asset"
                            onClick={() => setPendingDelete(asset)}
                          >
                            <Trash2 className="size-4" aria-hidden="true" />
                          </Button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>
        </>
      )}

      <AlertDialog
        open={!!pendingDelete}
        onOpenChange={(open) => {
          if (!open && !deleting) setPendingDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete this{" "}
              {pendingDelete
                ? (
                    ASSET_TYPE_LABELS[pendingDelete.asset_type as AssetType] ??
                    pendingDelete.asset_type
                  ).toLowerCase()
                : "asset"}
              ?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>
                  This removes the file from this project&apos;s Asset Vault. It cannot be undone.
                </p>
                <p>
                  Anywhere still using this file — Brand Kit, Sticker Lab references or earlier
                  work — may no longer show it.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              onClick={(e) => {
                e.preventDefault();
                if (pendingDelete) void remove(pendingDelete);
              }}
            >
              {deleting ? "Deleting…" : "Delete asset"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );

}
