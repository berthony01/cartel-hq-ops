import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  ExternalLinks,
  NetworkEmpty,
  ProjectLogo,
  StatusPill,
  WatchButton,
} from "@/components/cartel-network/NetworkPieces";
import {
  NETWORK_TRUST_COPY,
  fetchNetworkProject,
  fetchNetworkProjectLaunches,
  formatSchedule,
  formatTicker,
  launchStatusLabel,
  launchStatusTone,
  networkKeys,
} from "@/lib/cartel-network";

export const Route = createFileRoute("/network/project/$projectSlug")({
  loader: async ({ params, context }) => {
    const project = await context.queryClient.ensureQueryData({
      queryKey: networkKeys.project(params.projectSlug),
      queryFn: () => fetchNetworkProject(params.projectSlug),
    });
    return { project };
  },
  head: ({ loaderData }) => {
    const project = loaderData?.project ?? null;
    if (!project) {
      return {
        meta: [
          { title: "Project unavailable — Cartel Network" },
          { name: "robots", content: "noindex" },
        ],
      };
    }
    const title = `${project.project_name} — Cartel Network`;
    const description =
      (project.description ?? "").trim().slice(0, 155) ||
      `${project.project_name} on the Cartel Network.`;
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
  component: PublicProjectPage,
});

function PublicProjectPage() {
  const { projectSlug } = Route.useParams();

  const projectQuery = useQuery({
    queryKey: networkKeys.project(projectSlug),
    queryFn: () => fetchNetworkProject(projectSlug),
  });

  const launchesQuery = useQuery({
    queryKey: networkKeys.projectLaunches(projectSlug),
    queryFn: () => fetchNetworkProjectLaunches(projectSlug),
    enabled: !!projectQuery.data,
  });

  if (projectQuery.isLoading) {
    return <p className="text-sm text-muted-foreground">Loading project…</p>;
  }

  if (projectQuery.isError) {
    return (
      <div className="space-y-3">
        <NetworkEmpty
          title="This project could not be loaded"
          description="Something went wrong. Try again shortly."
        />
        <Button variant="outline" size="sm" onClick={() => projectQuery.refetch()}>
          Retry
        </Button>
      </div>
    );
  }

  const project = projectQuery.data;
  if (!project) {
    return (
      <div className="space-y-4">
        <NetworkEmpty
          title="Project not available"
          description="This project does not exist on the Cartel Network, or it is not published."
        />
        <div className="flex justify-center">
          <Button asChild variant="outline">
            <Link to="/network/projects">Browse projects</Link>
          </Button>
        </div>
      </div>
    );
  }

  const ticker = formatTicker(project.ticker);
  const launches = launchesQuery.data ?? [];

  return (
    <div className="space-y-8">
      <nav className="text-xs text-muted-foreground">
        <Link to="/network/projects" className="hover:text-foreground">
          Projects
        </Link>{" "}
        / <span className="text-foreground">{project.project_name}</span>
      </nav>

      <header className="flex flex-col gap-4 border-b border-border pb-6 sm:flex-row sm:items-start">
        <ProjectLogo
          slug={project.public_slug}
          hasLogo={project.has_logo}
          name={project.project_name}
          size="lg"
        />
        <div className="min-w-0">
          <h1 className="font-display text-3xl uppercase leading-tight text-foreground sm:text-4xl [overflow-wrap:anywhere]">
            {project.project_name}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {ticker ? <StatusPill tone="gold">{ticker}</StatusPill> : null}
            {project.primary_chain ? (
              <StatusPill tone="muted">{project.primary_chain}</StatusPill>
            ) : null}
          </div>
          <div className="mt-3">
            <ExternalLinks
              website={project.website_url}
              telegram={project.telegram_url}
              x={project.x_url}
            />
          </div>
        </div>
      </header>

      {project.description ? (
        <section className="max-w-3xl whitespace-pre-line text-sm leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">
          {project.description}
        </section>
      ) : null}

      <section className="rounded-lg border border-border bg-surface px-4 py-4">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gold">
          Trust
        </h2>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          {NETWORK_TRUST_COPY.projectSupplied} {NETWORK_TRUST_COPY.notAnAudit}
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="border-b border-border pb-3 font-display text-xl uppercase text-foreground sm:text-2xl">
          Launches
        </h2>
        {launchesQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading launches…</p>
        ) : launches.length === 0 ? (
          <NetworkEmpty
            title="No launches announced yet"
            description="This project has not announced a launch on the Cartel Network."
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {launches.map((l) => (
              <article
                key={l.public_slug}
                className="flex h-full flex-col gap-3 rounded-lg border border-border bg-surface p-4"
              >
                <div className="min-w-0">
                  <h3 className="truncate font-display text-lg uppercase text-foreground">
                    {l.token_name}
                  </h3>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    {formatTicker(l.ticker) ? (
                      <StatusPill tone="gold">{formatTicker(l.ticker)}</StatusPill>
                    ) : null}
                    <StatusPill tone="muted">{l.chain}</StatusPill>
                    <StatusPill tone={launchStatusTone(l.status)}>
                      {launchStatusLabel(l.status)}
                    </StatusPill>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">{formatSchedule(l)}</p>
                <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
                  {l.join_launch_watch_url ? (
                    <WatchButton url={l.join_launch_watch_url} status={l.status} />
                  ) : null}
                  <Button asChild variant="outline" size="sm">
                    <Link
                      to="/network/launch/$launchSlug"
                      params={{ launchSlug: l.public_slug }}
                    >
                      View Launch
                    </Link>
                  </Button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
