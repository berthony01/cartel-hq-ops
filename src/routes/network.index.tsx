import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  LaunchCard,
  NetworkEmpty,
  ProjectCard,
  TrustNote,
} from "@/components/cartel-network/NetworkPieces";
import {
  fetchNetworkProjects,
  fetchNetworkSummary,
  fetchNetworkUpcomingLaunches,
  networkKeys,
} from "@/lib/cartel-network";

export const Route = createFileRoute("/network/")({
  head: () => ({
    meta: [
      { title: "Cartel Network — Authenticated project launch discovery" },
      {
        name: "description",
        content:
          "Discover published projects and upcoming launches published by authenticated project accounts in CARTEL HQ.",
      },
      { property: "og:title", content: "Cartel Network" },
      {
        property: "og:description",
        content: "Authenticated project launch discovery from CARTEL HQ.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: NetworkOverview,
});

function SummaryCard({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="rounded-lg border border-border bg-surface px-4 py-4">
      <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      <p className="mt-1 font-display text-3xl leading-none text-gold">
        {value == null ? "—" : value}
      </p>
    </div>
  );
}

function NetworkOverview() {
  const summary = useQuery({
    queryKey: networkKeys.summary(),
    queryFn: fetchNetworkSummary,
  });

  const projects = useQuery({
    queryKey: networkKeys.projects({ limit: 6 }),
    queryFn: () => fetchNetworkProjects({ limit: 6 }),
  });

  const launches = useQuery({
    queryKey: networkKeys.upcoming({ limit: 6 }),
    queryFn: () => fetchNetworkUpcomingLaunches({ limit: 6 }),
  });

  return (
    <div className="space-y-10">
      <section className="rounded-lg border border-border bg-surface/70 px-5 py-8 sm:px-8 sm:py-12">
        <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-gold">
          Cartel Network
        </p>
        <h1 className="mt-2 max-w-3xl font-display text-3xl uppercase leading-tight text-foreground sm:text-5xl">
          Authenticated project launch discovery
        </h1>
        <p className="mt-4 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Every project and launch listed here is published by a project account inside CARTEL
          HQ. Follow launches, read the official details the project supplied, and opt in for
          launch alerts when a project opens Launch Watch.
        </p>
        <div className="mt-6 flex flex-wrap gap-2">
          <Button asChild>
            <Link to="/network/projects">View Projects</Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/network/launches">View Upcoming Launches</Link>
          </Button>
        </div>
        <TrustNote className="mt-6 max-w-2xl" />
      </section>

      <section className="grid gap-3 sm:grid-cols-3">
        <SummaryCard
          label="Published projects"
          value={summary.data ? Number(summary.data.published_projects) : null}
        />
        <SummaryCard
          label="Upcoming launches"
          value={summary.data ? Number(summary.data.upcoming_launches) : null}
        />
        <SummaryCard
          label="Live now"
          value={summary.data ? Number(summary.data.live_launches) : null}
        />
      </section>

      <section className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border pb-3">
          <h2 className="font-display text-xl uppercase text-foreground sm:text-2xl">
            Latest projects
          </h2>
          <Link to="/network/projects" className="text-xs uppercase tracking-wider text-gold">
            View all →
          </Link>
        </div>
        {projects.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading projects…</p>
        ) : projects.isError ? (
          <NetworkEmpty
            title="Projects could not be loaded"
            description="Something went wrong loading published projects. Try again shortly."
          />
        ) : projects.data && projects.data.rows.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {projects.data.rows.map((p) => (
              <ProjectCard key={p.public_slug} project={p} />
            ))}
          </div>
        ) : (
          <NetworkEmpty
            title="No published projects yet"
            description="Projects appear here once a project account publishes its profile in CARTEL HQ."
          />
        )}
      </section>

      <section className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border pb-3">
          <h2 className="font-display text-xl uppercase text-foreground sm:text-2xl">
            Upcoming launches
          </h2>
          <Link to="/network/launches" className="text-xs uppercase tracking-wider text-gold">
            View all →
          </Link>
        </div>
        {launches.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading launches…</p>
        ) : launches.isError ? (
          <NetworkEmpty
            title="Launches could not be loaded"
            description="Something went wrong loading upcoming launches. Try again shortly."
          />
        ) : launches.data && launches.data.rows.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {launches.data.rows.map((l) => (
              <LaunchCard key={l.public_slug} launch={l} />
            ))}
          </div>
        ) : (
          <NetworkEmpty
            title="No upcoming launches yet"
            description="Announced launches from published projects appear here."
          />
        )}
      </section>
    </div>
  );
}
