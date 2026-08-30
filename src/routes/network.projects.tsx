import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NetworkEmpty, ProjectCard } from "@/components/cartel-network/NetworkPieces";
import {
  NETWORK_PAGE_SIZE,
  fetchNetworkProjects,
  networkKeys,
  type NetworkProjectCard,
} from "@/lib/cartel-network";

const DESCRIPTION =
  "Browse published projects on the Cartel Network, with their official links and current launch status.";

export const Route = createFileRoute("/network/projects")({
  head: () => ({
    meta: [
      { title: "Projects — Cartel Network" },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: "Projects — Cartel Network" },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: NetworkProjectsPage,
});

function NetworkProjectsPage() {
  const [searchInput, setSearchInput] = useState("");
  const [chainInput, setChainInput] = useState("");
  const [search, setSearch] = useState("");
  const [chain, setChain] = useState("");
  const [pages, setPages] = useState(1);
  const limit = Math.min(NETWORK_PAGE_SIZE * pages, NETWORK_MAX_PAGE_LIMIT);

  const query = useQuery({
    queryKey: networkKeys.projects({ search, chain, limit, offset: 0 }),
    queryFn: () => fetchNetworkProjects({ search, chain, limit, offset: 0 }),
    placeholderData: keepPreviousData,
  });

  const rows: NetworkProjectCard[] = query.data?.rows ?? [];
  const total = query.data?.totalCount ?? 0;

  function applyFilters(e: React.FormEvent) {
    e.preventDefault();
    setPages(1);
    setSearch(searchInput);
    setChain(chainInput);
  }

  return (
    <div className="space-y-6">
      <header className="border-b border-border pb-4">
        <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-gold">
          Cartel Network
        </p>
        <h1 className="mt-1.5 font-display text-3xl uppercase leading-tight text-foreground sm:text-4xl">
          Projects
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Published projects and their current launch status, as supplied by each project
          account in CARTEL HQ.
        </p>
      </header>

      <form onSubmit={applyFilters} className="grid gap-3 sm:grid-cols-[1fr_200px_auto]">
        <div>
          <Label htmlFor="project-search" className="text-xs">
            Search
          </Label>
          <Input
            id="project-search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Project, ticker or description"
            maxLength={120}
            className="mt-1"
          />
        </div>
        <div>
          <Label htmlFor="project-chain" className="text-xs">
            Chain
          </Label>
          <Input
            id="project-chain"
            value={chainInput}
            onChange={(e) => setChainInput(e.target.value)}
            placeholder="e.g. Solana"
            maxLength={64}
            className="mt-1"
          />
        </div>
        <div className="flex items-end">
          <Button type="submit" className="w-full sm:w-auto">
            Apply
          </Button>
        </div>
      </form>

      {query.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading projects…</p>
      ) : query.isError ? (
        <div className="space-y-3">
          <NetworkEmpty
            title="Projects could not be loaded"
            description="Something went wrong loading published projects."
          />
          <Button variant="outline" size="sm" onClick={() => query.refetch()}>
            Retry
          </Button>
        </div>
      ) : rows.length === 0 ? (
        <NetworkEmpty
          title="No projects match"
          description="Try a different search term or clear the chain filter."
        />
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            Showing {rows.length} of {total}
          </p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {rows.map((p) => (
              <ProjectCard key={p.public_slug} project={p} />
            ))}
          </div>
          {rows.length < total && limit < NETWORK_MAX_PAGE_LIMIT ? (
            <div className="flex justify-center pt-2">
              <Button
                variant="outline"
                onClick={() => setPages((p) => p + 1)}
                disabled={query.isFetching}
              >
                {query.isFetching ? "Loading…" : "Load more"}
              </Button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
