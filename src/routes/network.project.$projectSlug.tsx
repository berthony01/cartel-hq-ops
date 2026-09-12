import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { NetworkEmpty } from "@/components/cartel-network/NetworkPieces";
import {
  PublicProjectHub,
  type PublicProjectHubTab,
} from "@/components/cartel-network/PublicProjectHub";
import {
  fetchNetworkProject,
  fetchNetworkProjectLaunches,
  fetchNetworkProjectVideos,
  networkKeys,
} from "@/lib/cartel-network";

type ProjectHubSearch = { tab?: PublicProjectHubTab };

function validateProjectHubSearch(search: Record<string, unknown>): ProjectHubSearch {
  const tab = search["tab"];
  return tab === "launch" || tab === "media" || tab === "trust" ? { tab } : {};
}

export const Route = createFileRoute("/network/project/$projectSlug")({
  validateSearch: validateProjectHubSearch,
  loader: async ({ params, context }) => {
    const project = await context.queryClient.ensureQueryData({
      queryKey: networkKeys.project(params.projectSlug),
      queryFn: () => fetchNetworkProject(params.projectSlug),
    });
    const launches = project
      ? await context.queryClient.ensureQueryData({
          queryKey: networkKeys.projectLaunches(params.projectSlug),
          queryFn: () => fetchNetworkProjectLaunches(params.projectSlug),
        })
      : [];
    // Media must never take the whole project page down.
    const videos = project
      ? await context.queryClient
          .ensureQueryData({
            queryKey: networkKeys.projectVideos(params.projectSlug),
            queryFn: () => fetchNetworkProjectVideos(params.projectSlug),
          })
          .catch(() => [])
      : [];
    return { project, launches, videos };
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
  const { tab } = Route.useSearch();
  const {
    project: initialProject,
    launches: initialLaunches,
    videos: initialVideos,
  } = Route.useLoaderData();

  const projectQuery = useQuery({
    queryKey: networkKeys.project(projectSlug),
    queryFn: () => fetchNetworkProject(projectSlug),
    initialData: initialProject,
  });

  const launchesQuery = useQuery({
    queryKey: networkKeys.projectLaunches(projectSlug),
    queryFn: () => fetchNetworkProjectLaunches(projectSlug),
    enabled: !!projectQuery.data,
    initialData: initialLaunches,
  });

  const videosQuery = useQuery({
    queryKey: networkKeys.projectVideos(projectSlug),
    queryFn: () => fetchNetworkProjectVideos(projectSlug),
    enabled: !!projectQuery.data,
    initialData: initialVideos,
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

  const launches = launchesQuery.data ?? [];
  const videos = videosQuery.data ?? [];
  const requestedTab =
    tab === "launch" || tab === "media" || tab === "trust" ? tab : "overview";
  const activeTab =
    (requestedTab === "launch" && launches.length === 0) ||
    (requestedTab === "media" && videos.length === 0)
      ? "overview"
      : requestedTab;

  return (
    <div className="space-y-6">
      <nav className="text-xs text-muted-foreground">
        <Link to="/network/projects" className="hover:text-foreground">
          Projects
        </Link>{" "}
        / <span className="text-foreground">{project.project_name}</span>
      </nav>
      {launchesQuery.isError ? (
        <div className="space-y-3">
          <NetworkEmpty
            title="Launch details unavailable"
            description="The project is available, but its launch details could not be loaded. Try again shortly."
          />
          <Button variant="outline" size="sm" onClick={() => launchesQuery.refetch()}>
            Retry launch details
          </Button>
        </div>
      ) : (
        <>
          {videosQuery.isError ? (
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border/80 bg-surface-elevated px-4 py-3">
              <p className="min-w-0 text-xs text-muted-foreground">
                Project videos could not be loaded right now.
              </p>
              <Button variant="outline" size="sm" onClick={() => videosQuery.refetch()}>
                Retry videos
              </Button>
            </div>
          ) : null}
          <PublicProjectHub
            project={project}
            launches={launches}
            videos={videos}
            activeTab={activeTab}
          />
        </>
      )}

    </div>
  );
}
