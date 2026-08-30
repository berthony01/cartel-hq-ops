import { Link } from "@tanstack/react-router";
import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  NETWORK_TRUST_COPY,
  excerpt,
  formatSchedule,
  formatTicker,
  launchStatusLabel,
  launchStatusTone,
  publicProjectLogoUrl,
  watchStateMessage,
  type LaunchTone,
  type NetworkProjectCard,
  type NetworkUpcomingLaunch,
} from "@/lib/cartel-network";

const TONES: Record<LaunchTone, string> = {
  gold: "border-gold/40 bg-gold/10 text-gold",
  green: "border-pepe/40 bg-pepe/10 text-pepe",
  red: "border-signal/40 bg-signal/10 text-signal",
  muted: "border-border bg-surface-raised text-muted-foreground",
};

export function StatusPill({
  tone = "muted",
  children,
  className,
}: {
  tone?: LaunchTone;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase leading-tight tracking-[0.12em]",
        TONES[tone],
        className,
      )}
    >
      <span className="truncate">{children}</span>
    </span>
  );
}

export function ProjectLogo({
  slug,
  hasLogo,
  name,
  size = "md",
}: {
  slug: string;
  hasLogo: boolean;
  name: string;
  size?: "sm" | "md" | "lg";
}) {
  const box =
    size === "lg" ? "size-16" : size === "sm" ? "size-9" : "size-12";
  const initials = name.trim().slice(0, 2).toUpperCase() || "PC";
  if (!hasLogo) {
    return (
      <span
        aria-hidden="true"
        className={cn(
          box,
          "flex shrink-0 items-center justify-center rounded-md border border-border bg-surface-raised font-display text-sm text-muted-foreground",
        )}
      >
        {initials}
      </span>
    );
  }
  return (
    <img
      src={publicProjectLogoUrl(slug)}
      alt={`${name} logo`}
      loading="lazy"
      className={cn(box, "shrink-0 rounded-md border border-border bg-surface object-contain")}
    />
  );
}

export function ExternalLinks({
  website,
  telegram,
  x,
}: {
  website?: string | null;
  telegram?: string | null;
  x?: string | null;
}) {
  const items = [
    { label: "Website", href: website },
    { label: "Telegram", href: telegram },
    { label: "X", href: x },
  ].filter((i) => !!i.href);
  if (items.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item) => (
        <a
          key={item.label}
          href={item.href!}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 rounded-md border border-border bg-surface-raised px-2.5 py-1 text-[11px] uppercase tracking-wider text-muted-foreground transition-colors hover:border-gold/40 hover:text-foreground"
        >
          {item.label}
          <ExternalLink className="size-3" aria-hidden="true" />
        </a>
      ))}
    </div>
  );
}

export function TrustNote({ className }: { className?: string }) {
  return (
    <p className={cn("text-xs leading-relaxed text-muted-foreground", className)}>
      {NETWORK_TRUST_COPY.projectSupplied} {NETWORK_TRUST_COPY.notAnAudit}
    </p>
  );
}

export function NetworkEmpty({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-surface/40 px-6 py-10 text-center">
      <p className="text-sm font-semibold text-foreground">{title}</p>
      <p className="mx-auto mt-2 max-w-md text-xs leading-relaxed text-muted-foreground">
        {description}
      </p>
    </div>
  );
}

export function WatchButton({
  url,
  status,
  className,
}: {
  url: string | null;
  status: string | null;
  className?: string;
}) {
  if (!url) {
    return (
      <p className={cn("text-xs text-muted-foreground", className)}>
        {watchStateMessage(status)}
      </p>
    );
  }
  return (
    <Button asChild size="sm" className={className}>
      <a href={url} target="_blank" rel="noopener noreferrer">
        Watch This Launch
      </a>
    </Button>
  );
}

export function ProjectCard({ project }: { project: NetworkProjectCard }) {
  const ticker = formatTicker(project.ticker);
  const summary = excerpt(project.description);
  return (
    <article className="flex h-full flex-col gap-3 rounded-lg border border-border bg-surface p-4">
      <div className="flex min-w-0 items-start gap-3">
        <ProjectLogo
          slug={project.public_slug}
          hasLogo={project.has_logo}
          name={project.project_name}
        />
        <div className="min-w-0">
          <h3 className="truncate font-display text-lg uppercase leading-tight text-foreground">
            {project.project_name}
          </h3>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {ticker ? <StatusPill tone="gold">{ticker}</StatusPill> : null}
            {project.primary_chain ? (
              <StatusPill tone="muted">{project.primary_chain}</StatusPill>
            ) : null}
          </div>
        </div>
      </div>

      {summary ? (
        <p className="text-xs leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">
          {summary}
        </p>
      ) : null}

      {project.current_launch_status ? (
        <div className="rounded-md border border-border bg-surface-raised px-3 py-2">
          <StatusPill tone={launchStatusTone(project.current_launch_status)}>
            {launchStatusLabel(project.current_launch_status)}
          </StatusPill>
          <p className="mt-1.5 truncate text-[11px] text-muted-foreground">
            {project.current_launch_token_name ?? "Launch"} ·{" "}
            {formatSchedule({
              launch_at: project.current_launch_at,
              launch_window_start: project.current_launch_window_start,
              launch_window_end: project.current_launch_window_end,
              timezone: project.current_launch_timezone,
            })}
          </p>
        </div>
      ) : null}

      <ExternalLinks
        website={project.website_url}
        telegram={project.telegram_url}
        x={project.x_url}
      />

      <div className="mt-auto pt-1">
        <Button asChild variant="outline" size="sm">
          <Link to="/network/project/$projectSlug" params={{ projectSlug: project.public_slug }}>
            View Project
          </Link>
        </Button>
      </div>
    </article>
  );
}

export function LaunchCard({ launch }: { launch: NetworkUpcomingLaunch }) {
  const ticker = formatTicker(launch.ticker);
  return (
    <article className="flex h-full flex-col gap-3 rounded-lg border border-border bg-surface p-4">
      <div className="flex min-w-0 items-start gap-3">
        <ProjectLogo
          slug={launch.project_public_slug}
          hasLogo={launch.has_logo}
          name={launch.project_name}
        />
        <div className="min-w-0">
          <h3 className="truncate font-display text-lg uppercase leading-tight text-foreground">
            {launch.token_name}
          </h3>
          <p className="truncate text-[11px] uppercase tracking-wider text-muted-foreground">
            {launch.project_name}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {ticker ? <StatusPill tone="gold">{ticker}</StatusPill> : null}
            <StatusPill tone="muted">{launch.chain}</StatusPill>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <StatusPill tone={launchStatusTone(launch.status)}>
          {launchStatusLabel(launch.status)}
        </StatusPill>
      </div>

      <p className="text-xs text-muted-foreground">{formatSchedule(launch)}</p>

      <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
        <WatchButton url={launch.join_launch_watch_url} status={launch.status} />
        <Button asChild variant="outline" size="sm">
          <Link to="/network/launch/$launchSlug" params={{ launchSlug: launch.public_slug }}>
            View Launch
          </Link>
        </Button>
      </div>
    </article>
  );
}
