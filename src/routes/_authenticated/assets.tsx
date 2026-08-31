import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, FolderLock, Trash2 } from "lucide-react";
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
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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

  const assetsQuery = useQuery({
    queryKey: ["assets", workspaceId],
    enabled: !!workspaceId,
    queryFn: () => listWorkspaceAssets(workspaceId!),
  });

  const assets = useMemo(() => {
    const list = assetsQuery.data ?? [];
    return filter === "all" ? list : list.filter((a) => a.asset_type === filter);
  }, [assetsQuery.data, filter]);

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
    try {
      await deleteWorkspaceAsset(asset);
      toast.success("Asset deleted");
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not delete the asset.");
    }
  };

  return (
    <div className="space-y-6 sm:space-y-8">
      <PageHeader
        eyebrow="Module"
        title="Asset Vault"
        description="Private storage for this project’s artwork, references, and generated stickers. Previews and downloads use short-lived signed links."
        status={workspace ? workspace.name : "No project"}
      />

      {!workspaceLoading && !workspaceId ? (
        <EmptyState
          icon={FolderLock}
          title="No project yet"
          description="Add a project from the switcher in the header to start storing assets."
        />
      ) : (
        <>
          <Section variant="surface" title="Upload" contentClassName="space-y-3">
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
          </Section>

          <Section
            variant="plain"
            title="Library"
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
            ) : assets.length === 0 ? (
              <EmptyState
                compact
                icon={FolderLock}
                title="No assets yet"
                description="Uploads appear here. Files are private to this project and never publicly accessible."
              />
            ) : (
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-5 [&>*]:min-w-0">
                {assets.map((asset) => (
                  <li key={asset.id} className="cartel-panel rise-in rounded-lg p-2.5 sm:p-3">
                    <div className="flex aspect-square items-center justify-center overflow-hidden rounded-md border border-border bg-background/40">
                      {urls[asset.storage_path] ? (
                        <img
                          src={urls[asset.storage_path]}
                          alt={`${ASSET_TYPE_LABELS[asset.asset_type as AssetType] ?? asset.asset_type} asset`}
                          className="max-h-full max-w-full object-contain"
                          loading="lazy"
                        />
                      ) : (
                        <span className="text-[10px] text-muted-foreground">Loading preview…</span>
                      )}
                    </div>
                    <p className="mt-2 truncate text-[11px] uppercase tracking-wider text-gold">
                      {ASSET_TYPE_LABELS[asset.asset_type as AssetType] ?? asset.asset_type}
                    </p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {asset.width && asset.height ? `${asset.width}×${asset.height} · ` : ""}
                      {formatBytes(asset.file_size_bytes)}
                    </p>
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
                      <Button
                        size="sm"
                        variant="ghost"
                        className="min-h-10 min-w-10 text-signal hover:text-signal"
                        aria-label="Delete asset"
                        onClick={() => void remove(asset)}
                      >
                        <Trash2 className="size-4" aria-hidden="true" />
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </>
      )}
    </div>
  );
}
