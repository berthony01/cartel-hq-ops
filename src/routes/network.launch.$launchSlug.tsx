import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  ExternalLinks,
  NetworkEmpty,
  ProjectLogo,
  StatusPill,
  VerificationSignals,
  WatchButton,
} from "@/components/cartel-network/NetworkPieces";
import {
  NETWORK_TRUST_COPY,
  fetchNetworkLaunch,
  formatDateTime,
  formatSchedule,
  formatTicker,
  launchStatusLabel,
  launchStatusTone,
  networkKeys,
} from "@/lib/cartel-network";

export const Route = createFileRoute("/network/launch/$launchSlug")({
  loader: async ({ params, context }) => {
    const launch = await context.queryClient.ensureQueryData({
      queryKey: networkKeys.launch(params.launchSlug),
      queryFn: () => fetchNetworkLaunch(params.launchSlug),
    });
    return { launch };
  },
  head: ({ loaderData }) => {
    const launch = loaderData?.launch ?? null;
    if (!launch) {
      return {
        meta: [
          { title: "Launch unavailable — Cartel Network" },
          { name: "robots", content: "noindex" },
        ],
      };
    }
    const title = `${launch.token_name} launch — ${launch.project_name} — Cartel Network`;
    const description = `${launch.token_name} on ${launch.chain}: ${launchStatusLabel(
      launch.status,
    )}. Official launch details supplied by ${launch.project_name} in CARTEL HQ.`.slice(0, 155);
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:type", content: "website" },
        { name: "twitter:card", content: "summary_large_image" },
      ],
    };
  },
  component: PublicLaunchPage,
});

function TimelineRow({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border/60 py-1.5 last:border-b-0">
      <dt className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</dt>
      <dd className="text-xs text-foreground">{value}</dd>
    </div>
  );
}

function PublicLaunchPage() {
  const { launchSlug } = Route.useParams();
  const [copied, setCopied] = useState(false);

  const query = useQuery({
    queryKey: networkKeys.launch(launchSlug),
    queryFn: () => fetchNetworkLaunch(launchSlug),
  });

  if (query.isLoading) {
    return <p className="text-sm text-muted-foreground">Loading launch…</p>;
  }

  if (query.isError) {
    return (
      <div className="space-y-3">
        <NetworkEmpty
          title="This launch could not be loaded"
          description="Something went wrong. Try again shortly."
        />
        <Button variant="outline" size="sm" onClick={() => query.refetch()}>
          Retry
        </Button>
      </div>
    );
  }

  const launch = query.data;
  if (!launch) {
    return (
      <div className="space-y-4">
        <NetworkEmpty
          title="Launch not available"
          description="This launch does not exist on the Cartel Network, or it is not published yet."
        />
        <div className="flex justify-center">
          <Button asChild variant="outline">
            <Link to="/network/launches">Browse upcoming launches</Link>
          </Button>
        </div>
      </div>
    );
  }

  const tz = launch.timezone;

  async function copyContract(address: string) {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="space-y-8">
      <nav className="text-xs text-muted-foreground">
        <Link to="/network/launches" className="hover:text-foreground">
          Upcoming Launches
        </Link>{" "}
        /{" "}
        <Link
          to="/network/project/$projectSlug"
          params={{ projectSlug: launch.project_public_slug }}
          className="hover:text-foreground"
        >
          {launch.project_name}
        </Link>{" "}
        / <span className="text-foreground">{launch.token_name}</span>
      </nav>

      <header className="flex flex-col gap-4 border-b border-border pb-6 sm:flex-row sm:items-start">
        <ProjectLogo
          slug={launch.project_public_slug}
          hasLogo={launch.has_logo}
          name={launch.project_name}
          size="lg"
        />
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
            {launch.project_name}
          </p>
          <h1 className="mt-1 font-display text-3xl uppercase leading-tight text-foreground sm:text-4xl [overflow-wrap:anywhere]">
            {launch.token_name}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {formatTicker(launch.ticker) ? (
              <StatusPill tone="gold">{formatTicker(launch.ticker)}</StatusPill>
            ) : null}
            <StatusPill tone="muted">{launch.chain}</StatusPill>
            <StatusPill tone={launchStatusTone(launch.status)}>
              {launchStatusLabel(launch.status)}
            </StatusPill>
          </div>
          <p className="mt-3 text-sm text-muted-foreground">{formatSchedule(launch)}</p>
          <div className="mt-4">
            <WatchButton url={launch.join_launch_watch_url} status={launch.status} />
          </div>
        </div>
      </header>

      {launch.official_contract_address ? (
        <section className="rounded-lg border border-pepe/40 bg-pepe/5 px-4 py-4">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-pepe">
            Official contract
          </h2>
          <p className="mt-2 text-xs text-muted-foreground">
            {NETWORK_TRUST_COPY.contractRegistered}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 break-all rounded-md border border-border bg-surface px-3 py-2 text-xs text-foreground">
              {launch.official_contract_address}
            </code>
            <Button
              variant="outline"
              size="sm"
              onClick={() => copyContract(launch.official_contract_address!)}
            >
              {copied ? (
                <>
                  <Check className="size-4" aria-hidden="true" /> Copied
                </>
              ) : (
                <>
                  <Copy className="size-4" aria-hidden="true" /> Copy
                </>
              )}
            </Button>
          </div>
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
            {NETWORK_TRUST_COPY.notAnAudit}
          </p>
        </section>
      ) : null}

      <section className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-border bg-surface px-4 py-4">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gold">
            Launch timeline
          </h2>
          <dl className="mt-2">
            <TimelineRow label="Announced" value={formatDateTime(launch.announced_at, tz)} />
            <TimelineRow
              label="Watchlist opened"
              value={formatDateTime(launch.watchlist_opened_at, tz)}
            />
            <TimelineRow
              label="Launch approaching"
              value={formatDateTime(launch.launch_approaching_at, tz)}
            />
            <TimelineRow
              label="Contract pending"
              value={formatDateTime(launch.contract_pending_at, tz)}
            />
            <TimelineRow
              label="Contract registered"
              value={formatDateTime(launch.contract_registered_at, tz)}
            />
            <TimelineRow label="Live" value={formatDateTime(launch.live_at, tz)} />
            <TimelineRow label="Completed" value={formatDateTime(launch.completed_at, tz)} />
          </dl>
        </div>

        <div className="rounded-lg border border-border bg-surface px-4 py-4">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gold">
            Official project links
          </h2>
          <div className="mt-3">
            <ExternalLinks
              website={launch.website_url}
              telegram={launch.telegram_url}
              x={launch.x_url}
            />
          </div>
          <Button asChild variant="outline" size="sm" className="mt-4">
            <Link
              to="/network/project/$projectSlug"
              params={{ projectSlug: launch.project_public_slug }}
            >
              View Project
            </Link>
          </Button>
        </div>
      </section>

      <VerificationSignals
        verificationStatus={launch.verification_status}
        verifiedAt={launch.verified_at}
      />
    </div>
  );
}
