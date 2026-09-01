import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Archive, ExternalLink, ImageOff, Pencil, Send } from "lucide-react";
import { PageHeader } from "@/components/cartel/PageHeader";
import { Section } from "@/components/cartel/Section";
import { StatusBadge } from "@/components/cartel/StatusBadge";
import { EmptyState } from "@/components/cartel/EmptyState";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "@/lib/workspace-context";
import { loadAssets, loadPack, loadPackStickers } from "@/lib/sticker-packs";
import { PackLifecycleMenu } from "@/routes/_authenticated/sticker-lab.index";
import { loadPackTelegramState } from "@/lib/telegram-stickers";
import { signedUrlMap } from "@/lib/media";
import { countStickerVersions } from "@/lib/sticker-versions";
import { fetchPackGroupDistribution } from "@/lib/telegram-group";
import { fetchDropStatus, scheduleState, SCHEDULE_STATE_LABEL } from "@/lib/sticker-drops";


export const Route = createFileRoute("/_authenticated/sticker-lab/$packId")({
  head: () => ({
    meta: [
      { title: "Sticker Pack — CARTEL HQ" },
      {
        name: "description",
        content:
          "Review a saved CARTEL HQ sticker pack: stickers, publish state, Telegram sticker set and community delivery.",
      },
      { property: "og:title", content: "Sticker Pack — CARTEL HQ" },
      {
        property: "og:description",
        content: "Manage a saved PEPECARTEL sticker pack, its Telegram set and community delivery.",
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
  const navigate = useNavigate();
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


  const stickerIds = useMemo(() => stickers.map((s) => s.id), [stickers]);
  const sameWorkspace = !!pack && !!workspaceId && pack.workspace_id === workspaceId;

  const versionsQuery = useQuery({
    queryKey: ["pack-summary-versions", packId, stickerIds],
    queryFn: () => countStickerVersions(stickerIds),
    enabled: sameWorkspace && stickerIds.length > 0,
    retry: false,
  });

  const distributionQuery = useQuery({
    queryKey: ["pack-summary-distribution", workspaceId, packId],
    queryFn: () => fetchPackGroupDistribution({ workspaceId: workspaceId!, packId }),
    enabled: sameWorkspace && !!workspaceId,
    retry: false,
  });

  const dropsQuery = useQuery({
    queryKey: ["pack-summary-drops", workspaceId],
    queryFn: () => fetchDropStatus(workspaceId!),
    enabled: sameWorkspace && !!workspaceId,
    retry: false,
  });

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
          description="It may have been removed, or it belongs to a different project."
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
  const allReady = stickers.length > 0 && readyCount === stickers.length;
  const isArchived = !!pack.archived_at;
  const statusLabel = isArchived
    ? "Archived"
    : published
      ? "Published"
      : allReady
        ? "Ready to publish"
        : readyCount > 0
          ? "Review in progress"
          : "In progress";

  /* ---- read-only summary derivations (no mutations, degrade to Unavailable) ---- */
  const versionCount = versionsQuery.isError
    ? null
    : stickerIds.length === 0
      ? 0
      : versionsQuery.isPending
        ? undefined
        : (versionsQuery.data ?? 0);

  const targets = distributionQuery.data?.targets ?? [];
  const deliveredTargets = targets.filter(
    (t) => t.status === "assigned" || t.status === "announced",
  ).length;
  const communityLabel = distributionQuery.isError
    ? "Unavailable"
    : distributionQuery.isPending
      ? "Loading…"
      : deliveredTargets > 0
        ? `${deliveredTargets} community${deliveredTargets === 1 ? "" : "s"}`
        : targets.length > 0
          ? "Needs attention"
          : "None yet";
  const communityHint = distributionQuery.isError
    ? "Community delivery state could not be loaded right now."
    : deliveredTargets > 0
      ? "These groups received the official sticker set."
      : targets.length > 0
        ? "Delivery was attempted but no group is confirmed yet."
        : "Send the published set to a community from Quality & Release.";

  const killSwitch = !!dropsQuery.data?.control?.kill_switch;
  const packSchedules = (dropsQuery.data?.schedules ?? []).filter((s) => s.pack_id === pack.id);
  const activeSchedule = packSchedules.find((s) => s.enabled);
  const dropState = scheduleState(activeSchedule ?? packSchedules[0], killSwitch);
  const dropLabel = dropsQuery.isError
    ? "Unavailable"
    : dropsQuery.isPending
      ? "Loading…"
      : SCHEDULE_STATE_LABEL[dropState];
  const dropHint = dropsQuery.isError
    ? "Sticker Drop state could not be loaded right now."
    : killSwitch && packSchedules.length > 0
      ? "The workspace emergency pause is on, so nothing is sending."
      : dropState === "active"
        ? "Stickers post automatically on your schedule."
        : packSchedules.length > 0
          ? "A schedule exists for this pack but is not sending."
          : "Automated drops keep your set in front of the community.";

  const hasActiveDrop = !dropsQuery.isError && !killSwitch && !!activeSchedule;

  type NextStep = { title: string; body: string; action: React.ReactNode };
  let nextStep: NextStep;
  if (isArchived) {
    nextStep = {
      title: "Restore this pack",
      body: "This pack is archived. Use the pack options menu at the top of this page to restore it — Sticker Drops stay paused until you re-enable them.",
      action: null,
    };
  } else if (!allReady) {
    nextStep = {
      title: "Continue in the Studio",
      body: `${readyCount} of ${stickers.length} stickers are ready. Continue editing reopens the five-step flow so you can generate and review in Sticker Studio.`,
      action: (
        <Button asChild className="min-h-11">
          <Link to="/sticker-lab/new" search={{ pack: pack.id }}>
            Continue editing
          </Link>
        </Button>
      ),
    };
  } else if (!published) {
    nextStep = {
      title: "Open Quality & Release",
      body: "Every sticker is ready. Create the Telegram sticker set from Quality & Release.",
      action: (
        <Button asChild className="min-h-11">
          <Link to="/sticker-lab/new" search={{ pack: pack.id, step: 5 }}>
            Open Quality &amp; Release
          </Link>
        </Button>
      ),
    };
  } else if (distributionQuery.isPending) {
    nextStep = {
      title: "Checking community delivery…",
      body: "Waiting for community delivery state before recommending the next step.",
      action: null,
    };
  } else if (distributionQuery.isError) {
    nextStep = {
      title: "Community delivery status unavailable",
      body: "Community delivery state could not be loaded right now. Open Quality & Release to inspect or retry by normal page behavior.",
      action: (
        <Button asChild className="min-h-11">
          <Link to="/sticker-lab/new" search={{ pack: pack.id, step: 5 }}>
            Open Quality &amp; Release
          </Link>
        </Button>
      ),
    };
  } else if (deliveredTargets === 0) {
    nextStep = {
      title: "Send to communities",
      body:
        targets.length > 0
          ? "Delivery was attempted but no group is confirmed. Retry from Quality & Release."
          : "The set is live on Telegram. Deliver it to your connected communities from Quality & Release.",
      action: (
        <Button asChild className="min-h-11">
          <Link to="/sticker-lab/new" search={{ pack: pack.id, step: 5 }}>
            Open Quality &amp; Release
          </Link>
        </Button>
      ),
    };
  } else if (dropsQuery.isPending) {
    nextStep = {
      title: "Checking Sticker Drops state…",
      body: "Waiting for Sticker Drops state before recommending the next step.",
      action: null,
    };
  } else if (dropsQuery.isError) {
    nextStep = {
      title: "Sticker Drops status unavailable",
      body: "Sticker Drop state could not be loaded right now. Manage Sticker Drops to inspect safely.",
      action: (
        <Button asChild className="min-h-11">
          <Link to="/distribution" search={{ pack: pack.id }}>
            Manage Sticker Drops
          </Link>
        </Button>
      ),
    };
  } else if (packSchedules.length === 0) {
    nextStep = {
      title: "Set up Sticker Drops",
      body: "Your set is live and delivered. Schedule automatic drops so the community keeps seeing it.",
      action: (
        <Button asChild className="min-h-11">
          <Link to="/distribution" search={{ pack: pack.id }}>
            Set up Sticker Drops
          </Link>
        </Button>
      ),
    };
  } else if (!hasActiveDrop) {
    nextStep = {
      title: "Review Sticker Drops",
      body: killSwitch
        ? "The workspace emergency pause is on, so scheduled drops are not sending."
        : "A schedule exists for this pack but is not currently sending.",
      action: (
        <Button asChild className="min-h-11">
          <Link to="/distribution" search={{ pack: pack.id }}>
            Review Sticker Drops
          </Link>
        </Button>
      ),
    };
  } else {
    nextStep = {
      title: "Pack is operational",
      body:
        targets.length > deliveredTargets
          ? "Drops are running. Some community deliveries did not succeed — review them when you can."
          : "Drops are running on schedule. Adjust cadence or groups any time.",
      action: (
        <Button asChild variant="outline" className="min-h-11">
          <Link to="/distribution" search={{ pack: pack.id }}>
            Manage Sticker Drops
          </Link>
        </Button>
      ),
    };
  }

  const summaryItems: { label: string; value: string; hint: string }[] = [
    {
      label: "Stickers",

      value: `${readyCount}/${stickers.length} ready`,
      hint: "Ready stickers are the ones Quality & Release can publish.",
    },
    {
      label: "Version history",
      value:
        versionCount === null
          ? "Unavailable"
          : versionCount === undefined
            ? "Loading…"
            : versionCount === 0
              ? "None yet"
              : `${versionCount} preserved`,
      hint: "Successful generations stay recoverable. Open Sticker Studio to view or restore versions.",
    },
    {
      label: "Telegram pack",
      value: published ? "Live" : "Not published",
      hint: published
        ? "One official sticker set exists for this pack."
        : "Publishing happens in Quality & Release.",
    },
    { label: "Communities", value: communityLabel, hint: communityHint },
    { label: "Sticker Drops", value: dropLabel, hint: dropHint },
  ];


  return (
    <div className="flex min-w-0 flex-col gap-6 sm:gap-8">
      <PageHeader
        eyebrow="Sticker Pack"
        title={pack.title}
        status={statusLabel}
        description={`${pack.theme} · ${pack.pack_size} stickers · ${readyCount}/${stickers.length} ready`}
        actions={
          <PackLifecycleMenu
            packId={pack.id}
            packTitle={pack.title}
            workspaceId={workspaceId}
            onDeleted={() => void navigate({ to: "/sticker-lab" })}
          />
        }
      />

      {isArchived ? (
        <Section
          variant="quiet"
          title="This pack is archived"
          description="Archived packs stay out of your active packs and their Sticker Drops are paused. Publishing, delivery and generation history are preserved, and the existing Telegram sticker set is not deleted from Telegram. Restore it from the pack options menu to make it active again — Sticker Drops stay paused until you re-enable them."
          actions={<StatusBadge tone="muted">archived</StatusBadge>}
        >
          <p className="flex items-start gap-2 text-sm text-muted-foreground">
            <Archive className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>Editing, publishing and community delivery actions are hidden while archived.</span>
          </p>
        </Section>
      ) : null}

      <Section
        variant="primary"
        title="Pack command summary"
        description="Where this pack stands right now, and what to do next."
      >
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 [&>*]:min-w-0">
          {summaryItems.map((item) => (
            <li
              key={item.label}
              className="min-w-0 rounded-lg border border-border/70 bg-surface-raised/50 p-3"
            >
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {item.label}
              </p>
              <p className="mt-1 break-words text-sm font-semibold text-foreground">{item.value}</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{item.hint}</p>
            </li>
          ))}
        </ul>
        <div className="mt-4 rounded-lg border border-primary/40 bg-primary/5 p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Recommended next step
          </p>
          <p className="mt-1 text-sm font-semibold text-foreground">{nextStep.title}</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{nextStep.body}</p>
          {nextStep.action ? (
            <div className="mt-3 flex flex-wrap gap-2 [&>*]:min-w-0">{nextStep.action}</div>
          ) : null}
        </div>
      </Section>


      {isArchived ? null : (
      <Section
        variant="hero"
        title={
          published
            ? "Published to Telegram"
            : allReady
              ? "Ready to publish"
              : readyCount > 0
                ? "Review in progress"
                : "In progress"
        }
        description={
          published
            ? "One Telegram sticker set exists for this pack. Publishing again only adds missing reviewed stickers; adding a community sends the same set."
            : allReady
              ? `${readyCount} of ${stickers.length} stickers are ready. Open Quality & Release to create the Telegram sticker set.`
              : readyCount > 0
                ? `${readyCount} of ${stickers.length} stickers are ready. Open Quality & Release to review what can be published and what still needs work.`
                : "Keep generating and reviewing stickers in the builder before publishing."
        }
        actions={
          <StatusBadge tone={published ? "green" : allReady ? "gold" : "muted"}>
            {statusLabel}
          </StatusBadge>
        }
      >
        <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
          <strong className="text-foreground">Continue editing</strong> returns you to the same
          five-step Studio flow (Blueprint → Concept Studio → Sticker Studio → Quality &amp;
          Release). <strong className="text-foreground">Review &amp; release</strong> jumps straight
          to Quality &amp; Release.
        </p>
        <div className="flex flex-wrap gap-2 [&>*]:min-w-0">
          {readyCount > 0 ? (
            <Button asChild className="min-h-11 flex-1 sm:flex-none">
              <Link to="/sticker-lab/new" search={{ pack: pack.id, step: 5 }}>
                <Send className="size-4" aria-hidden="true" />
                Review &amp; release
              </Link>
            </Button>
          ) : null}
          <Button
            asChild
            variant={readyCount > 0 ? "outline" : "default"}
            className="min-h-11 flex-1 sm:flex-none"
          >
            <Link to="/sticker-lab/new" search={{ pack: pack.id }}>
              <Pencil className="size-4" aria-hidden="true" />
              Continue editing
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
          {setUrl ? (
            <Button asChild variant="ghost" size="sm" className="min-h-11">
              <Link to="/distribution" search={{ pack: pack.id }}>
                Manage Sticker Drops
              </Link>
            </Button>
          ) : null}
        </div>
      </Section>
      )}


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
