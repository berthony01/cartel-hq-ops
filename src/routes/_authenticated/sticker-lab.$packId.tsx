import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, ImageOff, Pencil, Send } from "lucide-react";
import { PageHeader } from "@/components/cartel/PageHeader";
import { Section } from "@/components/cartel/Section";
import { StatusBadge } from "@/components/cartel/StatusBadge";
import { EmptyState } from "@/components/cartel/EmptyState";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "@/lib/workspace-context";
import { loadAssets, loadPack, loadPackStickers } from "@/lib/sticker-packs";
import { loadPackTelegramState } from "@/lib/telegram-stickers";
import { signedUrlMap } from "@/lib/media";

export const Route = createFileRoute("/_authenticated/sticker-lab/$packId")({
  head: () => ({
    meta: [
      { title: "Sticker Pack — CARTEL HQ" },
      {
        name: "description",
        content:
          "Review a saved CARTEL HQ sticker pack: stickers, publish state, Telegram set link and distribution.",
      },
      { property: "og:title", content: "Sticker Pack — CARTEL HQ" },
      {
        property: "og:description",
        content: "Manage a saved PEPECARTEL sticker pack and its Telegram distribution.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: PackManagerPage,
});

function PackManagerPage() {
  const { packId } = Route.useParams();
  const { workspaceId } = useWorkspace();
  const [urls, setUrls] = useState<Record<string, string>>({});

  const packQuery = useQuery({
    queryKey: ["pack-manager", packId],
    queryFn: async () => {
      const [pack, stickers, telegram] = await Promise.all([
        loadPack(packId),
        loadPackStickers(packId),
        loadPackTelegramState(packId),
      ]);
      const assets = await loadAssets(
        stickers.map((s) => s.image_asset_id).filter((v): v is string => !!v),
      );
      return { pack, stickers, telegram, assets };
    },
  });

  const data = packQuery.data;
  const pack = data?.pack ?? null;
  const stickers = useMemo(() => data?.stickers ?? [], [data]);
  const assets = useMemo(() => data?.assets ?? {}, [data]);

  useEffect(() => {
    let cancelled = false;
    const paths = Object.values(assets)
      .map((a) => a.storage_path)
      .filter(Boolean);
    if (paths.length === 0) {
      setUrls({});
      return;
    }
    void signedUrlMap(paths, 300).then((map) => {
      if (!cancelled) setUrls(map);
    });
    return () => {
      cancelled = true;
    };
  }, [assets]);

  const setUrl = data?.telegram.pack?.telegram_set_url ?? null;
  const published = !!setUrl;
  const wrongWorkspace = !!pack && !!workspaceId && pack.workspace_id !== workspaceId;

  if (packQuery.isLoading) {
    return <p className="text-sm text-muted-foreground">Loading pack…</p>;
  }

  if (!pack || wrongWorkspace) {
    return (
      <div className="flex min-w-0 flex-col gap-6">
        <PageHeader eyebrow="Sticker Lab" title="Pack not found" />
        <EmptyState
          icon={ImageOff}
          title="This pack is not available"
          description="It may have been removed, or it belongs to a different workspace."
          action={
            <Button asChild variant="outline" size="sm" className="mt-1 min-h-10">
              <Link to="/sticker-lab">Back to Sticker Lab</Link>
            </Button>
          }
        />
      </div>
    );
  }

  const readyCount = stickers.filter(
    (s) => s.status === "ready" || s.status === "published",
  ).length;
  const statusLabel = published ? "Published" : readyCount > 0 ? "Ready" : "Draft";

  return (
    <div className="flex min-w-0 flex-col gap-6 sm:gap-8">
      <PageHeader
        eyebrow="Sticker Pack"
        title={pack.title}
        status={statusLabel}
        description={`${pack.theme} · ${pack.pack_size} stickers · ${readyCount}/${stickers.length} ready`}
      />

      <div className="flex flex-wrap gap-2 [&>*]:min-w-0">
        <Button asChild className="min-h-11 flex-1 sm:flex-none">
          <Link to="/sticker-lab/new" search={{ pack: pack.id }}>
            <Pencil className="size-4" aria-hidden="true" />
            Edit in builder
          </Link>
        </Button>
        {setUrl ? (
          <Button asChild variant="outline" className="min-h-11 flex-1 sm:flex-none">
            <a href={setUrl} target="_blank" rel="noreferrer noopener">
              <ExternalLink className="size-4" aria-hidden="true" />
              Open Telegram pack
            </a>
          </Button>
        ) : null}
        <Button asChild variant="outline" className="min-h-11 flex-1 sm:flex-none">
          <Link to="/sticker-lab/new" search={{ pack: pack.id, step: 5 }}>
            <Send className="size-4" aria-hidden="true" />
            Manage Telegram &amp; Distribution
          </Link>
        </Button>
        <Button asChild variant="ghost" size="sm" className="min-h-11">
          <Link to="/distribution" search={{ pack: pack.id }}>
            Distribution Center
          </Link>
        </Button>

      </div>

      <Section
        variant="primary"
        title="Stickers"
        actions={<StatusBadge tone={readyCount > 0 ? "green" : "muted"}>{`${stickers.length} total`}</StatusBadge>}
      >
        {stickers.length === 0 ? (
          <EmptyState
            compact
            icon={ImageOff}
            title="No stickers yet"
            description="Generate stickers for this pack in the builder to see them here."
          />
        ) : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 [&>*]:min-w-0">
            {stickers.map((sticker) => {
              const asset = sticker.image_asset_id ? assets[sticker.image_asset_id] : undefined;
              const url = asset ? urls[asset.storage_path] : undefined;
              const telegramState = data?.telegram.stickers[sticker.id];
              const isPublished = !!telegramState?.telegram_file_id;
              return (
                <li
                  key={sticker.id}
                  className="min-w-0 rounded-lg border border-border/70 bg-surface-raised/50 p-2"
                >
                  <div className="flex aspect-square items-center justify-center overflow-hidden rounded-md border border-border/60 bg-background/60">
                    {url ? (
                      <img
                        src={url}
                        alt={sticker.label}
                        loading="lazy"
                        className="size-full object-contain"
                      />
                    ) : (
                      <ImageOff className="size-5 text-muted-foreground" aria-hidden="true" />
                    )}
                  </div>
                  <p className="mt-2 truncate text-xs font-medium text-foreground">
                    {sticker.label}
                  </p>
                  <div className="mt-1 flex min-w-0">
                    <StatusBadge tone={isPublished ? "green" : url ? "gold" : "muted"}>
                      {isPublished ? "on telegram" : (sticker.status ?? "draft")}
                    </StatusBadge>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Section>
    </div>
  );
}
