import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  NetworkEmpty,
  ProjectLogo,
  StatusPill,
} from "@/components/cartel-network/NetworkPieces";
import {
  NETWORK_PAGE_SIZE,
  NETWORK_TRUST_COPY,
  fetchNetworkSignals,
  formatDateTime,
  formatTicker,
  launchStatusLabel,
  launchStatusTone,
  networkKeys,
  signalLabel,
  signalTone,
  type NetworkSignal,
} from "@/lib/cartel-network";

export const Route = createFileRoute("/network/signals")({
  head: () => ({
    meta: [
      { title: "Cartel Signals — Official Launch Events" },
      {
        name: "description",
        content:
          "A chronological feed of official project and launch lifecycle events from published projects on the Cartel Network.",
      },
      { property: "og:title", content: "Cartel Signals — Official Launch Events" },
      {
        property: "og:description",
        content:
          "Official project and launch lifecycle events from published Cartel Network projects. Not trading signals.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: SignalsFeed,
});

function SignalRow({ signal }: { signal: NetworkSignal }) {
  const ticker = formatTicker(signal.ticker);
  const occurred = formatDateTime(signal.occurred_at);
  return (
    <li className="rounded-lg border border-border/80 bg-surface-elevated p-4 shadow-inset transition-colors hover:border-gold/30">
      <div className="flex min-w-0 items-start gap-3">
        <ProjectLogo
          slug={signal.project_public_slug}
          hasLogo={signal.has_logo}
          name={signal.project_name}
          size="sm"
        />
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <StatusPill tone={signalTone(signal.signal_type)}>
              {signalLabel(signal.signal_type)}
            </StatusPill>
            <span className="text-[11px] text-muted-foreground">
              {occurred ?? "Time unavailable"}
            </span>
          </div>

          <p className="truncate font-display text-base uppercase leading-tight text-foreground">
            {signal.token_name}
          </p>
          <p className="truncate text-[11px] uppercase tracking-wider text-muted-foreground">
            {signal.project_name}
          </p>

          <div className="flex flex-wrap items-center gap-1.5">
            {ticker ? <StatusPill tone="gold">{ticker}</StatusPill> : null}
            {signal.chain ? <StatusPill tone="muted">{signal.chain}</StatusPill> : null}
            <StatusPill tone={launchStatusTone(signal.status)}>
              {launchStatusLabel(signal.status)}
            </StatusPill>
          </div>

          {signal.signal_type === "OFFICIAL_CONTRACT_REGISTERED" &&
          signal.official_contract_address ? (
            <p className="rounded-md border border-border bg-surface-raised px-2.5 py-1.5 font-mono text-[11px] leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">
              {signal.official_contract_address}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-3 pt-1">
            <Link
              to="/network/launch/$launchSlug"
              params={{ launchSlug: signal.launch_public_slug }}
              className="text-xs font-semibold uppercase tracking-[0.12em] text-gold hover:underline"
            >
              View Launch
            </Link>
            <Link
              to="/network/project/$projectSlug"
              params={{ projectSlug: signal.project_public_slug }}
              className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground hover:text-foreground hover:underline"
            >
              View Project
            </Link>
          </div>
        </div>
      </div>
    </li>
  );
}

function SignalsFeed() {
  const [chainInput, setChainInput] = useState("");
  const [chain, setChain] = useState("");
  const [page, setPage] = useState(0);
  const offset = page * NETWORK_PAGE_SIZE;

  const query = useQuery({
    queryKey: networkKeys.signals({ chain, limit: NETWORK_PAGE_SIZE, offset }),
    queryFn: () => fetchNetworkSignals({ chain, limit: NETWORK_PAGE_SIZE, offset }),
    placeholderData: keepPreviousData,
  });

  const rows: NetworkSignal[] = query.data?.rows ?? [];
  const total = query.data?.totalCount ?? 0;
  const rangeStart = rows.length > 0 ? offset + 1 : 0;
  const rangeEnd = offset + rows.length;
  const hasNext = rangeEnd < total;
  const isFiltered = chain.trim().length > 0;

  function applyFilters(e: React.FormEvent) {
    e.preventDefault();
    setPage(0);
    setChain(chainInput);
  }

  return (
    <div className="space-y-6">
      <header className="rounded-lg border border-gold/20 bg-surface-elevated px-4 py-5 shadow-inset sm:px-6">
        <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-gold">
          Cartel Network
        </p>
        <h1 className="mt-1.5 font-display text-3xl uppercase leading-tight text-foreground sm:text-4xl">
          Cartel Signals
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          A chronological record of official project and launch lifecycle events from published
          projects — announcements, Launch Watch openings, official contract registrations, and
          launch status changes.
        </p>
        <p className="mt-2 max-w-2xl text-xs leading-relaxed text-muted-foreground">
          {NETWORK_TRUST_COPY.signals}
        </p>
      </header>

      <form onSubmit={applyFilters} className="grid gap-3 rounded-lg border border-border/80 bg-surface-raised/40 p-4 shadow-inset sm:grid-cols-[200px_auto]">
        <div>
          <Label htmlFor="signal-chain" className="text-xs">
            Chain
          </Label>
          <Input
            id="signal-chain"
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
        <p className="text-sm text-muted-foreground">Loading signals…</p>
      ) : query.isError ? (
        <div className="space-y-3">
          <NetworkEmpty
            title="Signals could not be loaded"
            description="Something went wrong loading the signal feed. This does not mean there are no signals."
          />
          <Button variant="outline" size="sm" onClick={() => query.refetch()}>
            Retry
          </Button>
        </div>
      ) : rows.length === 0 ? (
        <NetworkEmpty
          title={isFiltered ? "No signals match this chain" : "No signals yet"}
          description={
            isFiltered
              ? "Try a different chain or clear the filter to see all official launch events."
              : "Published projects have not recorded any official launch lifecycle events yet."
          }
        />
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            Showing {rangeStart}–{rangeEnd} of {total}
          </p>
          <ul className="space-y-3">
            {rows.map((s) => (
              <SignalRow
                key={`${s.launch_public_slug}-${s.signal_type}-${s.occurred_at}`}
                signal={s}
              />
            ))}
          </ul>
          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            <Button
              variant="outline"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0 || query.isFetching}
            >
              Previous
            </Button>
            <span className="text-xs text-muted-foreground">
              Page {page + 1} of {Math.max(1, Math.ceil(total / NETWORK_PAGE_SIZE))}
            </span>
            <Button
              variant="outline"
              onClick={() => setPage((p) => p + 1)}
              disabled={!hasNext || query.isFetching}
            >
              Next
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
