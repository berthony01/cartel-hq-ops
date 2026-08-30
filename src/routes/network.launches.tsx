import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LaunchCard, NetworkEmpty } from "@/components/cartel-network/NetworkPieces";
import {
  NETWORK_PAGE_SIZE,
  fetchNetworkUpcomingLaunches,
  networkKeys,
  type NetworkUpcomingLaunch,
} from "@/lib/cartel-network";

export const Route = createFileRoute("/network/launches")({
  head: () => ({
    meta: [
      { title: "Upcoming Launches — Cartel Network" },
      {
        name: "description",
        content:
          "Upcoming launches announced by published projects on the Cartel Network, with schedules and Launch Watch links.",
      },
      { property: "og:title", content: "Upcoming Launches — Cartel Network" },
      {
        property: "og:description",
        content: "Upcoming launches announced by published projects on the Cartel Network.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: LaunchesDirectory,
});

function LaunchesDirectory() {
  const [searchInput, setSearchInput] = useState("");
  const [chainInput, setChainInput] = useState("");
  const [search, setSearch] = useState("");
  const [chain, setChain] = useState("");
  const [page, setPage] = useState(0);
  const offset = page * NETWORK_PAGE_SIZE;

  const query = useQuery({
    queryKey: networkKeys.upcoming({ search, chain, limit: NETWORK_PAGE_SIZE, offset }),
    queryFn: () =>
      fetchNetworkUpcomingLaunches({ search, chain, limit: NETWORK_PAGE_SIZE, offset }),
    placeholderData: keepPreviousData,
  });

  const rows: NetworkUpcomingLaunch[] = query.data?.rows ?? [];
  const total = query.data?.totalCount ?? 0;
  const rangeStart = rows.length > 0 ? offset + 1 : 0;
  const rangeEnd = offset + rows.length;
  const hasNext = rangeEnd < total;

  function applyFilters(e: React.FormEvent) {
    e.preventDefault();
    setPage(0);
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
          Upcoming Launches
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Announced launches from published projects. Launch Watch opens when the project opens
          it.
        </p>
      </header>

      <form onSubmit={applyFilters} className="grid gap-3 sm:grid-cols-[1fr_200px_auto]">
        <div>
          <Label htmlFor="launch-search" className="text-xs">
            Search
          </Label>
          <Input
            id="launch-search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Launch, project or ticker"
            maxLength={120}
            className="mt-1"
          />
        </div>
        <div>
          <Label htmlFor="launch-chain" className="text-xs">
            Chain
          </Label>
          <Input
            id="launch-chain"
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
        <p className="text-sm text-muted-foreground">Loading launches…</p>
      ) : query.isError ? (
        <div className="space-y-3">
          <NetworkEmpty
            title="Launches could not be loaded"
            description="Something went wrong loading upcoming launches."
          />
          <Button variant="outline" size="sm" onClick={() => query.refetch()}>
            Retry
          </Button>
        </div>
      ) : rows.length === 0 ? (
        <NetworkEmpty
          title="No upcoming launches match"
          description="Try a different search term or clear the chain filter."
        />
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            Showing {rows.length} of {total}
          </p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {rows.map((l) => (
              <LaunchCard key={l.public_slug} launch={l} />
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
