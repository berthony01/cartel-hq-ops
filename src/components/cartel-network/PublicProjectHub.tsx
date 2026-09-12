import { Link } from "@tanstack/react-router";
import { CalendarDays, ExternalLink, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  ExternalLinks,
  PlatformReviewedPill,
  ProjectLogo,
  StatusPill,
  VerificationSignals,
  WatchButton,
} from "@/components/cartel-network/NetworkPieces";
import {
  NETWORK_TRUST_COPY,
  formatSchedule,
  formatTicker,
  launchStatusLabel,
  launchStatusTone,
  type NetworkProject,
  type NetworkProjectLaunch,
} from "@/lib/cartel-network";
import { cn } from "@/lib/utils";

export type PublicProjectHubTab = "overview" | "launch" | "trust";

type PublicProjectHubProps = {
  project: NetworkProject;
  launches: NetworkProjectLaunch[];
  activeTab: PublicProjectHubTab;
};

const TAB_LABELS: Record<PublicProjectHubTab, string> = {
  overview: "Overview",
  launch: "Launch",
  trust: "Trust",
};

function LaunchActions({ launch }: { launch: NetworkProjectLaunch }) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
      {launch.join_launch_watch_url ? (
        <WatchButton
          url={launch.join_launch_watch_url}
          status={launch.status}
          className="min-h-11 w-full px-5 sm:w-auto"
        />
      ) : null}
      <Button asChild variant="outline" className="min-h-11 w-full sm:w-auto">
        <Link to="/network/launch/$launchSlug" params={{ launchSlug: launch.public_slug }}>
          View Launch
          <ExternalLink aria-hidden="true" />
        </Link>
      </Button>
    </div>
  );
}

function FactRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-border/60 py-3 last:border-b-0">
      <dt className="min-w-0 text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 max-w-44 text-right text-sm font-medium text-foreground [overflow-wrap:anywhere]">
        {value}
      </dd>
    </div>
  );
}

function OverviewPanel({
  project,
  currentLaunch,
}: {
  project: NetworkProject;
  currentLaunch: NetworkProjectLaunch | null;
}) {
  const ticker = formatTicker(project.ticker);
  return (
    <div role="tabpanel" id="project-tabpanel-overview" aria-labelledby="project-tab-overview">
      <section className="rounded-lg border border-border/80 bg-surface-elevated p-5 shadow-inset sm:p-7">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-gold">About</p>
        <h2 className="mt-2 font-display text-2xl uppercase leading-tight text-foreground sm:text-3xl">
          About {project.project_name}
        </h2>
        {project.description ? (
          <p className="mt-5 max-w-3xl whitespace-pre-line text-sm leading-7 text-muted-foreground [overflow-wrap:anywhere] sm:text-base sm:leading-8">
            {project.description}
          </p>
        ) : (
          <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
            This project has not published a description yet.
          </p>
        )}
      </section>

      <section className="mt-5 rounded-lg border border-border/80 bg-surface-raised/45 p-5 shadow-inset">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gold">
          Key facts
        </h2>
        <dl className="mt-3 grid gap-x-6 sm:grid-cols-2">
          {ticker ? <FactRow label="Ticker" value={ticker} /> : null}
          {project.primary_chain ? <FactRow label="Primary chain" value={project.primary_chain} /> : null}
          <FactRow label="Network status" value="Published" />
          {currentLaunch ? (
            <FactRow label="Current launch" value={launchStatusLabel(currentLaunch.status)} />
          ) : null}
        </dl>
      </section>
    </div>
  );
}

function LaunchSpotlight({ launch }: { launch: NetworkProjectLaunch }) {
  const ticker = formatTicker(launch.ticker);
  return (
    <article className="overflow-hidden rounded-lg border border-gold/25 bg-surface-elevated shadow-elevated">
      <div className="border-b border-border/70 p-5 sm:p-7">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-gold">
          Current launch
        </p>
        <div className="mt-3 grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
          <div className="min-w-0">
            <h2 className="font-display text-2xl uppercase leading-tight text-foreground sm:text-3xl [overflow-wrap:anywhere]">
              {launch.token_name}
            </h2>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {ticker ? <StatusPill tone="gold">{ticker}</StatusPill> : null}
              <StatusPill tone="muted">{launch.chain}</StatusPill>
            </div>
          </div>
          <StatusPill tone={launchStatusTone(launch.status)}>
            {launchStatusLabel(launch.status)}
          </StatusPill>
        </div>
        <div className="mt-5 flex min-w-0 items-start gap-3 rounded-md border border-border bg-surface-raised px-4 py-3">
          <CalendarDays className="mt-0.5 size-4 shrink-0 text-gold" aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Schedule
            </p>
            <p className="mt-1 text-sm leading-relaxed text-foreground [overflow-wrap:anywhere]">
              {formatSchedule(launch)}
            </p>
          </div>
        </div>
        <div className="mt-5">
          <LaunchActions launch={launch} />
        </div>
      </div>

      {launch.official_contract_address ? (
        <div className="bg-pepe/5 p-5 sm:px-7">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-pepe">
            Official contract
          </p>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            {NETWORK_TRUST_COPY.contractRegistered}
          </p>
          <code className="mt-3 block max-w-full break-all rounded-md border border-pepe/30 bg-surface px-3 py-2.5 text-xs text-foreground">
            {launch.official_contract_address}
          </code>
        </div>
      ) : null}
    </article>
  );
}

function LaunchPanel({ launches }: { launches: NetworkProjectLaunch[] }) {
  const currentLaunch = launches.find((launch) => launch.status !== "COMPLETED") ?? launches[0];
  if (!currentLaunch) return null;
  const history = launches.filter((launch) => launch.public_slug !== currentLaunch.public_slug);

  return (
    <div role="tabpanel" id="project-tabpanel-launch" aria-labelledby="project-tab-launch">
      <LaunchSpotlight launch={currentLaunch} />
      {history.length > 0 ? (
        <section className="mt-7">
          <div className="border-b border-border pb-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gold">
              Launch history
            </p>
            <h2 className="mt-1 font-display text-xl uppercase text-foreground">Other launches</h2>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {history.map((launch) => (
              <article
                key={launch.public_slug}
                className="flex min-w-0 flex-col rounded-lg border border-border/80 bg-surface-elevated p-4 shadow-inset"
              >
                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
                  <div className="min-w-0">
                    <h3 className="truncate font-display text-lg uppercase text-foreground">
                      {launch.token_name}
                    </h3>
                    <p className="mt-1 text-xs text-muted-foreground">{formatSchedule(launch)}</p>
                  </div>
                  <StatusPill tone={launchStatusTone(launch.status)}>
                    {launchStatusLabel(launch.status)}
                  </StatusPill>
                </div>
                <Button asChild variant="outline" size="sm" className="mt-4 w-full sm:w-auto sm:self-start">
                  <Link to="/network/launch/$launchSlug" params={{ launchSlug: launch.public_slug }}>
                    View Launch
                  </Link>
                </Button>
              </article>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function FactsRail({
  project,
  currentLaunch,
}: {
  project: NetworkProject;
  currentLaunch: NetworkProjectLaunch | null;
}) {
  const ticker = formatTicker(project.ticker);
  const hasLinks = Boolean(project.website_url || project.telegram_url || project.x_url);
  const platformReviewed = project.verification_status === "verified";

  return (
    <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start" aria-label="Project facts">
      {hasLinks ? (
        <section className="rounded-lg border border-border/80 bg-surface-elevated p-4 shadow-inset">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gold">
            Official links
          </h2>
          <div className="mt-3">
            <ExternalLinks
              website={project.website_url}
              telegram={project.telegram_url}
              x={project.x_url}
            />
          </div>
        </section>
      ) : null}

      <section className="rounded-lg border border-border/80 bg-surface-elevated p-4 shadow-inset">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gold">
          Project facts
        </h2>
        <dl className="mt-2">
          {ticker ? <FactRow label="Ticker" value={ticker} /> : null}
          {project.primary_chain ? <FactRow label="Primary chain" value={project.primary_chain} /> : null}
          <FactRow label="Cartel Network" value="Published" />
          {currentLaunch ? (
            <FactRow label="Current launch" value={launchStatusLabel(currentLaunch.status)} />
          ) : null}
        </dl>
      </section>

      <section className="rounded-lg border border-gold/20 bg-surface-elevated p-4 shadow-inset">
        <div className="flex items-center gap-2 text-gold">
          <ShieldCheck className="size-4 shrink-0" aria-hidden="true" />
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em]">Trust summary</h2>
        </div>
        <div className="mt-3 flex flex-col items-start gap-2">
          <StatusPill tone="gold">Project Authenticated</StatusPill>
          {platformReviewed ? <PlatformReviewedPill /> : null}
        </div>
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
          Trust signals are distinct and do not verify token safety or investment quality.
        </p>
      </section>
    </aside>
  );
}

export function PublicProjectHub({ project, launches, activeTab }: PublicProjectHubProps) {
  const ticker = formatTicker(project.ticker);
  const currentLaunch = launches.find((launch) => launch.status !== "COMPLETED") ?? null;
  const tabs: PublicProjectHubTab[] = launches.length > 0
    ? ["overview", "launch", "trust"]
    : ["overview", "trust"];

  return (
    <div className="space-y-6 sm:space-y-8">
      <header className="relative overflow-hidden rounded-lg border border-gold/25 bg-surface-elevated shadow-elevated">
        <div className="h-1 bg-gold/70" aria-hidden="true" />
        <div className="grid gap-6 p-5 sm:p-7 lg:grid-cols-[auto_minmax(0,1fr)] lg:items-center lg:gap-8 lg:p-9">
          <div className="flex items-center justify-center rounded-lg border border-border/80 bg-surface-raised/70 p-3 shadow-inset sm:w-fit">
            <ProjectLogo
              slug={project.public_slug}
              hasLogo={project.has_logo}
              name={project.project_name}
              size="xl"
            />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-gold">
              Cartel Network Project
            </p>
            <h1 className="mt-2 font-display text-4xl uppercase leading-none text-foreground [overflow-wrap:anywhere] sm:text-5xl lg:text-6xl">
              {project.project_name}
            </h1>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              {ticker ? <StatusPill tone="gold">{ticker}</StatusPill> : null}
              {project.primary_chain ? <StatusPill tone="muted">{project.primary_chain}</StatusPill> : null}
              {currentLaunch ? (
                <StatusPill tone={launchStatusTone(currentLaunch.status)}>
                  {launchStatusLabel(currentLaunch.status)}
                </StatusPill>
              ) : null}
            </div>
            {currentLaunch ? (
              <div className="mt-6 border-l-2 border-gold/50 pl-4">
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  Current launch · {currentLaunch.token_name}
                </p>
                <p className="mt-1 text-sm text-foreground [overflow-wrap:anywhere]">
                  {formatSchedule(currentLaunch)}
                </p>
                <div className="mt-4">
                  <LaunchActions launch={currentLaunch} />
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </header>

      <nav
        aria-label="Project hub sections"
        className="overflow-x-auto border-b border-border [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <div className="flex min-w-max" role="tablist" aria-label="Project hub sections">
          {tabs.map((tab) => {
            const selected = activeTab === tab;
            return (
              <Link
                key={tab}
                id={`project-tab-${tab}`}
                to="/network/project/$projectSlug"
                params={{ projectSlug: project.public_slug }}
                search={tab === "overview" ? {} : { tab }}
                role="tab"
                aria-selected={selected}
                aria-controls={`project-tabpanel-${tab}`}
                tabIndex={selected ? 0 : -1}
                className={cn(
                  "relative min-h-12 px-5 py-3 text-xs font-semibold uppercase tracking-[0.16em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gold/60",
                  selected ? "text-gold" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {TAB_LABELS[tab]}
                {selected ? <span className="absolute inset-x-4 bottom-0 h-0.5 bg-gold" aria-hidden="true" /> : null}
              </Link>
            );
          })}
        </div>
      </nav>

      <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_19rem] lg:items-start">
        <main className="min-w-0">
          {activeTab === "launch" && launches.length > 0 ? (
            <LaunchPanel launches={launches} />
          ) : activeTab === "trust" ? (
            <div role="tabpanel" id="project-tabpanel-trust" aria-labelledby="project-tab-trust">
              <VerificationSignals
                verificationStatus={project.verification_status}
                verifiedAt={project.verified_at}
                className="px-5 py-5 sm:px-7 sm:py-7"
              />
            </div>
          ) : (
            <OverviewPanel project={project} currentLaunch={currentLaunch} />
          )}
        </main>
        <FactsRail project={project} currentLaunch={currentLaunch} />
      </div>
    </div>
  );
}