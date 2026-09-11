import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Bell, BellOff, Eye, Loader2, MessageSquare, TriangleAlert } from "lucide-react";
import { PageHeader } from "@/components/cartel/PageHeader";
import { Section } from "@/components/cartel/Section";
import { EmptyState } from "@/components/cartel/EmptyState";
import { Button } from "@/components/ui/button";
import { ProjectLogo, StatusPill } from "@/components/cartel-network/NetworkPieces";
import {
  formatDateTime,
  formatSchedule,
  formatTicker,
  launchStatusLabel,
  launchStatusTone,
} from "@/lib/cartel-network";
import {
  WATCHLIST_COPY,
  fetchMyWatchlist,
  fetchMyWatchlistState,
  watchlistKeys,
  type MyWatchlistItem,
} from "@/lib/watchlist";

export const Route = createFileRoute("/_authenticated/watchlist")({
  head: () => ({
    meta: [
      { title: "My Watchlist — CARTEL HQ" },
      {
        name: "description",
        content:
          "The launches you opted into through Launch Watch in Telegram, with schedules, status and countdown state.",
      },
      { property: "og:title", content: "My Watchlist — CARTEL HQ" },
      {
        property: "og:description",
        content: "Your personal Launch Watch opt-ins, synced from Telegram.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: MyWatchlist,
});

function WatchRow({ item }: { item: MyWatchlistItem }) {
  const ticker = formatTicker(item.ticker);
  const subscribed = formatDateTime(item.subscribed_at);
  return (
    <article className="group min-w-0 rounded-lg border border-border/80 bg-surface-elevated p-4 shadow-inset transition-[border-color,transform,box-shadow] hover:-translate-y-0.5 hover:border-gold/40 hover:shadow-elevated">
      <div className="flex min-w-0 items-start gap-3">
        <ProjectLogo
          slug={item.project_public_slug}
          hasLogo={item.has_logo}
          name={item.project_name}
          size="sm"
        />
        <div className="min-w-0 flex-1 space-y-1.5">
          <h3 className="truncate font-display text-base uppercase leading-tight text-foreground">
            {item.token_name}
          </h3>
          <p className="truncate text-[11px] uppercase tracking-wider text-muted-foreground">
            {item.project_name}
          </p>
          <div className="flex flex-wrap items-center gap-1.5">
            {ticker ? <StatusPill tone="gold">{ticker}</StatusPill> : null}
            {item.chain ? <StatusPill tone="muted">{item.chain}</StatusPill> : null}
            <StatusPill tone={launchStatusTone(item.status)}>
              {launchStatusLabel(item.status)}
            </StatusPill>
          </div>
          <p className="text-xs text-muted-foreground">{formatSchedule(item)}</p>
          <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            {item.reminders_enabled ? (
              <Bell className="size-3.5 text-gold" aria-hidden="true" />
            ) : (
              <BellOff className="size-3.5" aria-hidden="true" />
            )}
            {item.reminders_enabled ? "Countdowns on" : "Countdowns muted"}
            {subscribed ? <span className="text-muted-foreground">· Watching since {subscribed}</span> : null}
          </p>
          {item.official_contract_address ? (
            <p className="rounded-md border border-border bg-surface-raised px-2.5 py-1.5 font-mono text-[11px] leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">
              {item.official_contract_address}
            </p>
          ) : null}
          <div className="pt-1">
            <Button asChild variant="outline" size="sm">
              <Link
                to="/network/launch/$launchSlug"
                params={{ launchSlug: item.launch_public_slug }}
              >
                View Launch
              </Link>
            </Button>
          </div>
        </div>
      </div>
    </article>
  );
}

function MyWatchlist() {
  const stateQuery = useQuery({
    queryKey: watchlistKeys.state(),
    queryFn: fetchMyWatchlistState,
  });

  const connected = stateQuery.data?.telegram_connected === true;

  const listQuery = useQuery({
    queryKey: watchlistKeys.list(),
    queryFn: fetchMyWatchlist,
    enabled: connected,
  });

  const rows: MyWatchlistItem[] = listQuery.data ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Network"
        title="My Watchlist"
        description="Launches you explicitly opted into through Launch Watch in Telegram. Read-only in CARTEL HQ."
      />

      {stateQuery.isLoading ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          Checking your Launch Watch connection…
        </p>
      ) : stateQuery.isError ? (
        <div className="space-y-3">
          <EmptyState
            icon={TriangleAlert}
            title="Your watchlist could not be checked"
            description="Something went wrong loading your Launch Watch state. This does not mean you have no watched launches."
          />
          <Button variant="outline" size="sm" onClick={() => stateQuery.refetch()}>
            Retry
          </Button>
        </div>
      ) : !connected ? (
        <EmptyState
          icon={MessageSquare}
          title="Connect Telegram to sync Launch Watch"
          description="Launch Watch opt-ins happen in Telegram. Connect your Telegram account to see the launches you are watching here."
          action={
            <Button asChild size="sm">
              <Link to="/telegram">Open Community Command</Link>
            </Button>
          }
        />
      ) : listQuery.isLoading ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          Loading your watched launches…
        </p>
      ) : listQuery.isError ? (
        <div className="space-y-3">
          <EmptyState
            icon={TriangleAlert}
            title="Watched launches could not be loaded"
            description="Something went wrong loading your watchlist. This does not mean you have no watched launches."
          />
          <Button variant="outline" size="sm" onClick={() => listQuery.refetch()}>
            Retry
          </Button>
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Eye}
          title="You’re not watching any launches yet"
          description="Open a launch on the Cartel Network and use Watch This Launch to opt in through Telegram."
          action={
            <Button asChild size="sm">
              <Link to="/network/launches">Browse upcoming launches</Link>
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {rows.map((item) => (
            <WatchRow key={item.launch_public_slug} item={item} />
          ))}
        </div>
      )}

      <Section variant="quiet">
        <p className="text-xs leading-relaxed text-muted-foreground">
          {WATCHLIST_COPY.readOnly} {WATCHLIST_COPY.privacy}
        </p>
      </Section>
    </div>
  );
}
