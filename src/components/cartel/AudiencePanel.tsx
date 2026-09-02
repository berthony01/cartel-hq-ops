import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { BellRing, Loader2, Send, Users } from "lucide-react";

import { Section } from "@/components/cartel/Section";
import { StatusBadge } from "@/components/cartel/StatusBadge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useWorkspace } from "@/lib/workspace-context";
import {
  LAUNCH_STATUS_LABELS,
  getLaunchAudienceSummary,
  getLaunchWatchConfirmationSummary,
  listLaunches,
  toLaunchStatus,
} from "@/lib/launch-control";

/**
 * Community Command → Audience (C3).
 *
 * READ-ONLY, aggregate-only. There are no send controls here and no operator-
 * only actions: any workspace member who can read the launch can read these
 * counts, exactly matching the existing summary RPC membership policy.
 *
 * Every number comes from `get_launch_audience_summary` /
 * `get_launch_watch_confirmation_summary`, both SECURITY DEFINER count-only
 * RPCs. Telegram identities, subscription ids, usernames, per-delivery rows and
 * message bodies never reach the browser, and nothing here can be exported.
 */

const PRIVACY_LINE = "Aggregate only. CARTEL HQ never shows watcher identities.";

function MetricList({
  items,
  loading,
  className,
}: {
  items: Array<{ label: string; value: number; hint?: string }>;
  loading: boolean;
  className?: string;
}) {
  return (
    <dl className={className ?? "grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 sm:grid-cols-3"}>
      {items.map((item) => (
        <div
          key={item.label}
          className="min-w-0 rounded-md border border-border/60 bg-background/40 p-3"
        >
          <dt className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground [overflow-wrap:anywhere]">
            {item.label}
          </dt>
          <dd className="mt-1 text-lg font-semibold text-foreground">
            {loading ? (
              <span
                className="inline-block h-5 w-10 animate-pulse rounded bg-surface-raised"
                aria-label="Loading"
              />
            ) : (
              item.value.toLocaleString()
            )}
          </dd>
          {item.hint ? (
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">
              {item.hint}
            </p>
          ) : null}
        </div>
      ))}
    </dl>
  );
}

function InlineError({
  message,
  onRetry,
  retrying,
}: {
  message: string;
  onRetry: () => void;
  retrying: boolean;
}) {
  return (
    <div className="rounded-md border border-signal/40 bg-signal/5 p-3">
      <p className="text-xs leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">
        {message}
      </p>
      <Button
        size="sm"
        variant="outline"
        className="mt-2 min-h-11"
        onClick={onRetry}
        disabled={retrying}
      >
        {retrying ? <Loader2 className="mr-2 size-3.5 animate-spin" aria-hidden="true" /> : null}
        Retry
      </Button>
    </div>
  );
}

export function AudiencePanel({
  selectedLaunchId,
  onLaunchChange,
}: {
  /** Validated `launch` search param. The URL owns the selection. */
  selectedLaunchId?: string | null;
  onLaunchChange: (launchId: string) => void;
}) {
  const { workspaceId } = useWorkspace();

  // Same query key/wrapper as Broadcasts and Launch Control: shared cache.
  const launchesQuery = useQuery({
    queryKey: ["launches", workspaceId],
    enabled: !!workspaceId,
    queryFn: () => listLaunches(workspaceId!),
  });
  const launches = useMemo(() => launchesQuery.data ?? [], [launchesQuery.data]);

  // URL param wins when it names a launch in THIS workspace (the list is
  // RLS-scoped). Otherwise the primary-launch convention: newest non-COMPLETED,
  // else newest.
  const resolvedId = useMemo(() => {
    if (launches.length === 0) return null;
    if (selectedLaunchId && launches.some((l) => l.id === selectedLaunchId)) {
      return selectedLaunchId;
    }
    const primary = launches.find((l) => toLaunchStatus(l.status) !== "COMPLETED");
    return (primary ?? launches[0]!).id;
  }, [launches, selectedLaunchId]);

  // Normalize the URL once, guarded so it cannot loop.
  useEffect(() => {
    if (resolvedId && resolvedId !== selectedLaunchId) onLaunchChange(resolvedId);
  }, [resolvedId, selectedLaunchId, onLaunchChange]);

  const selected = launches.find((l) => l.id === resolvedId) ?? null;
  const status = selected ? toLaunchStatus(selected.status) : null;

  const audienceQuery = useQuery({
    queryKey: ["launch-audience-summary", selected?.id ?? null],
    enabled: !!selected?.id,
    queryFn: () => getLaunchAudienceSummary(selected!.id),
  });
  const confirmationQuery = useQuery({
    queryKey: ["launch-watch-confirmation-summary", selected?.id ?? null],
    enabled: !!selected?.id,
    queryFn: () => getLaunchWatchConfirmationSummary(selected!.id),
  });

  const summary = audienceQuery.data ?? null;
  const audienceLoading = !!selected && audienceQuery.isPending;
  const confirmation = confirmationQuery.data ?? null;
  const confirmationLoading = !!selected && confirmationQuery.isPending;

  const lastDeliveryLabel = useMemo(() => {
    if (!summary?.last_delivery_at) return null;
    const date = new Date(summary.last_delivery_at);
    if (Number.isNaN(date.getTime())) return null;
    return date.toLocaleString();
  }, [summary?.last_delivery_at]);

  const deliveryBuckets = summary
    ? [
        { label: "Last attempt sent", value: summary.last_sent_watchers },
        { label: "Last attempt failed", value: summary.last_failed_watchers },
        { label: "Outcome uncertain", value: summary.last_ambiguous_watchers },
        { label: "In flight", value: summary.last_inflight_watchers },
        { label: "Skipped before send", value: summary.last_skipped_watchers },
        { label: "No attempt yet", value: summary.never_contacted_watchers },
      ]
    : [
        { label: "Last attempt sent", value: 0 },
        { label: "Last attempt failed", value: 0 },
        { label: "Outcome uncertain", value: 0 },
        { label: "In flight", value: 0 },
        { label: "Skipped before send", value: 0 },
        { label: "No attempt yet", value: 0 },
      ];

  const bucketTotal = deliveryBuckets.reduce((sum, b) => sum + b.value, 0);
  const bucketsConsistent = !summary || bucketTotal === summary.active_watchers;

  // ---- Launch list error ------------------------------------------------------
  if (launchesQuery.isError) {
    return (
      <Section
        variant="primary"
        title="Audience"
        description="Aggregate Launch Watch audience information only."
        leading={<Users className="size-4" aria-hidden="true" />}
      >
        <InlineError
          message="Your launches could not be loaded right now."
          onRetry={() => void launchesQuery.refetch()}
          retrying={launchesQuery.isFetching}
        />
      </Section>
    );
  }

  // ---- No launch at all -----------------------------------------------------
  if (!launchesQuery.isPending && launches.length === 0) {
    return (
      <Section
        variant="primary"
        title="Audience"
        description="Aggregate Launch Watch audience information only."
        leading={<Users className="size-4" aria-hidden="true" />}
      >
        <div className="rounded-md border border-dashed border-border/70 bg-background/40 p-4">
          <p className="text-xs leading-relaxed text-muted-foreground">
            You have no launches yet. Create a launch in Launch Control and open Launch Watch before
            an audience can exist.
          </p>
          <Button size="sm" variant="outline" className="mt-3 min-h-11" asChild>
            <Link to="/launch-control">Open Launch Control</Link>
          </Button>
        </div>
      </Section>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-4 sm:gap-6">
      {/* A) Header + launch selector -------------------------------------- */}
      <Section
        variant="primary"
        title="Audience"
        description="Aggregate Launch Watch audience information only. No identities, no per-person records, no exports."
        leading={<Users className="size-4" aria-hidden="true" />}
        actions={
          status ? <StatusBadge tone="muted">{LAUNCH_STATUS_LABELS[status]}</StatusBadge> : null
        }
      >
        <div className="flex min-w-0 flex-col gap-3">
          <div className="min-w-0">
            <Label htmlFor="audience-launch" className="text-xs">
              Launch
            </Label>
            <Select
              value={selected?.id ?? ""}
              onValueChange={(value) => onLaunchChange(value)}
              disabled={launchesQuery.isPending || launches.length === 0}
            >
              <SelectTrigger id="audience-launch" className="mt-1.5 min-h-11 w-full">
                <SelectValue placeholder="Select a launch" />
              </SelectTrigger>
              <SelectContent>
                {launches.map((launch) => (
                  <SelectItem key={launch.id} value={launch.id}>
                    {launch.token_name} · {launch.ticker}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {selected ? (
            <p className="text-xs leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">
              {selected.token_name} · {selected.ticker} · {selected.chain}
              {status ? ` · ${LAUNCH_STATUS_LABELS[status]}` : ""}
            </p>
          ) : null}
        </div>
      </Section>

      {audienceQuery.isError ? (
        <Section variant="surface" title="Audience data unavailable">
          <InlineError
            message="This launch's audience counts could not be loaded right now."
            onRetry={() => void audienceQuery.refetch()}
            retrying={audienceQuery.isFetching}
          />
        </Section>
      ) : summary && summary.total_watchers === 0 && !audienceLoading ? (
        <Section
          variant="surface"
          title="Watchers"
          description="No Launch Watch opt-ins yet for this launch."
        >
          <p className="text-xs leading-relaxed text-muted-foreground">
            Nobody has joined Launch Watch for this launch. Open Launch Watch in Launch Control and
            share the deep link so members can opt in from @PepeCartelHQBot. No delivery health can
            be reported until there is an audience.
          </p>
          <Button size="sm" variant="outline" className="mt-3 min-h-11" asChild>
            <Link to="/launch-control">Open Launch Control</Link>
          </Button>
          <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">{PRIVACY_LINE}</p>
        </Section>
      ) : (
        <>
          {/* B) Watchers ------------------------------------------------- */}
          <Section
            variant="surface"
            title="Watchers"
            description="Everyone who has opted into Launch Watch for this launch."
          >
            <MetricList
              loading={audienceLoading}
              className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2"
              items={[
                { label: "Active watchers", value: summary?.active_watchers ?? 0 },
                { label: "All-time opt-ins", value: summary?.total_watchers ?? 0 },
              ]}
            />
            <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">{PRIVACY_LINE}</p>
          </Section>

          {/* C) What they receive ---------------------------------------- */}
          <Section
            variant="surface"
            title="What they receive"
            description="Project updates and countdown reminders are two independent preferences."
            leading={<BellRing className="size-4" aria-hidden="true" />}
          >
            <div className="flex min-w-0 flex-col gap-4">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  Project updates
                </p>
                <MetricList
                  loading={audienceLoading}
                  className="mt-2 grid grid-cols-1 gap-3 min-[420px]:grid-cols-2"
                  items={[
                    { label: "Allowed", value: summary?.updates_enabled_watchers ?? 0 },
                    { label: "Muted", value: summary?.updates_muted_watchers ?? 0 },
                  ]}
                />
              </div>
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  Countdown reminders
                </p>
                <MetricList
                  loading={audienceLoading}
                  className="mt-2 grid grid-cols-1 gap-3 min-[420px]:grid-cols-2"
                  items={[
                    { label: "Allowed", value: summary?.reminders_enabled_watchers ?? 0 },
                    { label: "Muted", value: summary?.reminders_muted_watchers ?? 0 },
                  ]}
                />
              </div>
            </div>
            <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
              These are separate, watcher-controlled preferences set privately in
              @PepeCartelHQBot. Only the watcher can change them — muting one channel does not
              affect the other, and it is not the same as leaving Launch Watch.
            </p>
          </Section>

          {/* D) Last known delivery outcome ------------------------------ */}
          <Section
            variant="surface"
            title="Last known delivery outcome"
            description="One bucket per active watcher, based on their most recent delivery record."
            leading={<Send className="size-4" aria-hidden="true" />}
          >
            {summary && summary.total_watchers > 0 && summary.active_watchers === 0 && !audienceLoading ? (
              <p className="text-xs leading-relaxed text-muted-foreground">
                There are no active watchers right now, so there is no active delivery-state
                distribution to report.
              </p>
            ) : (
              <>
                <MetricList
                  loading={audienceLoading}
                  items={deliveryBuckets}
                  className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 sm:grid-cols-3"
                />
                <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
                  Based on each active watcher’s most recent delivery record. These counts describe
                  the latest known state, not permanent reachability.
                </p>
                {!audienceLoading && lastDeliveryLabel ? (
                  <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">
                    Latest delivery activity: {lastDeliveryLabel}
                  </p>
                ) : null}
                {!audienceLoading && summary && !bucketsConsistent ? (
                  <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                    These buckets currently total {bucketTotal.toLocaleString()} against{" "}
                    {summary.active_watchers.toLocaleString()} active watchers. Refresh in a moment.
                  </p>
                ) : null}
              </>
            )}
          </Section>
        </>
      )}

      {/* E) Join confirmation --------------------------------------------- */}
      <Section
        variant="surface"
        title="Join confirmation"
        description="Outcome of the private confirmation message sent when a watcher opted in."
      >
        {confirmationQuery.isError ? (
          <InlineError
            message="Join confirmation counts could not be loaded right now."
            onRetry={() => void confirmationQuery.refetch()}
            retrying={confirmationQuery.isFetching}
          />
        ) : (
          <>
            <MetricList
              loading={confirmationLoading}
              items={[
                { label: "Confirmation sent", value: confirmation?.delivered_count ?? 0 },
                { label: "Confirmation failed", value: confirmation?.failed_count ?? 0 },
                { label: "Outcome uncertain", value: confirmation?.ambiguous_count ?? 0 },
                { label: "Legacy / untracked", value: confirmation?.untracked_count ?? 0 },
              ]}
              className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 lg:grid-cols-4"
            />
            <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
              Legacy / untracked opt-ins predate confirmation tracking. Their original outcome
              cannot be reconstructed, so they must never be read as failures.
            </p>
          </>
        )}
      </Section>
    </div>
  );
}
