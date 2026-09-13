import { useCallback } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  CalendarClock,
  Radio,
} from "lucide-react";


import { PageHeader } from "@/components/cartel/PageHeader";
import { Section } from "@/components/cartel/Section";
import { StatusBadge } from "@/components/cartel/StatusBadge";
import { LaunchReadinessCallout } from "@/components/cartel/LaunchReadiness";
import { BroadcastsPanel } from "@/components/cartel/BroadcastsPanel";
import { AudiencePanel } from "@/components/cartel/AudiencePanel";
import { ProjectInboxPanel } from "@/components/cartel/ProjectInboxPanel";
import {
  SocialMissionsPanel,
  SocialMissionsSummary,
} from "@/components/cartel/SocialMissionsPanel";
import { CommunityAnalyticsPanel } from "@/components/cartel/CommunityAnalyticsPanel";
import { RelatedLinks, relatedLinkClass } from "@/components/cartel/RelatedLinks";

import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useWorkspace } from "@/lib/workspace-context";
import {
  listPendingScheduleCommunications,
  workspaceScheduleCommunicationsQueryKey,
} from "@/lib/launch-control";


import { useTelegramSetup } from "@/components/cartel/TelegramConnectionCard";
import {
  TelegramGroupCard,
  useTelegramGroupSetup,
} from "@/components/cartel/TelegramGroupCard";

/**
 * Canonical tab keys. `communities` and `audience` keep their original key so
 * every existing `?tab=` URL keeps resolving; only their presentation labels
 * changed (Telegram / Launch Watch). `history` is retired from navigation and
 * is remapped below instead of silently 404-ing.
 */
const TAB_KEYS = [
  "overview",
  "communities",
  "missions",
  "broadcasts",
  "inbox",
  "audience",
  "analytics",
] as const;
type TabKey = (typeof TAB_KEYS)[number];

/** Retired tab keys mapped to their current home. */
const LEGACY_TAB_ALIASES: Record<string, TabKey> = {
  history: "overview",
};


/** Strict UUID shape for the Inbox `conversation` param; anything else is dropped. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * All params are optional so every existing `to="/telegram"` link keeps
 * working. Anything invalid or missing resolves to the Overview tab and no
 * preselected launch or conversation.
 */
type TelegramSearch = { tab?: TabKey; launch?: string; conversation?: string };

function validateTelegramSearch(search: Record<string, unknown>): TelegramSearch {
  const rawTab = String(search["tab"] ?? "");
  const aliased = LEGACY_TAB_ALIASES[rawTab];
  const tab = aliased
    ? aliased
    : (TAB_KEYS as readonly string[]).includes(rawTab)
      ? (rawTab as TabKey)
      : undefined;

  const rawLaunch = search["launch"];
  const launch =
    typeof rawLaunch === "string" && rawLaunch.trim().length > 0 && rawLaunch.length <= 100
      ? rawLaunch.trim()
      : undefined;
  const rawConversation = search["conversation"];
  const conversation =
    typeof rawConversation === "string" && UUID_PATTERN.test(rawConversation.trim())
      ? rawConversation.trim()
      : undefined;
  const next: TelegramSearch = {};
  if (tab && tab !== "overview") next.tab = tab;
  if (launch) next.launch = launch;
  if (conversation) next.conversation = conversation;
  return next;
}



export const Route = createFileRoute("/_authenticated/telegram")({
  validateSearch: validateTelegramSearch,
  head: () => ({
    meta: [
      { title: "Community Command Center — CARTEL HQ" },
      {
        name: "description",
        content:
          "Workspace-scoped community operations hub: Telegram communities, Social Missions, broadcasts, the member Inbox and Launch Watch in one place.",
      },
      { property: "og:title", content: "Community Command Center — CARTEL HQ" },
      {
        property: "og:description",
        content:
          "One hub for Telegram community health, Social Missions, broadcasts, member Inbox and Launch Watch.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: TelegramPage,
});



const TABS: Array<{ value: TabKey; label: string; shortLabel: string }> = [
  { value: "overview", label: "Overview", shortLabel: "Overview" },
  { value: "communities", label: "Telegram", shortLabel: "Telegram" },
  { value: "missions", label: "Missions", shortLabel: "Missions" },
  { value: "broadcasts", label: "Broadcasts", shortLabel: "Broadcast" },
  { value: "inbox", label: "Inbox", shortLabel: "Inbox" },
  { value: "audience", label: "Launch Watch", shortLabel: "Watch" },
  { value: "analytics", label: "Analytics", shortLabel: "Stats" },
];



/** Presentation-only metric tile for the community-state summaries. */
function StateMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="surface-quiet min-w-0 rounded-lg p-3">
      <dt className="type-eyebrow text-muted-foreground">{label}</dt>
      <dd className="mt-1.5 min-w-0 truncate font-display text-xl leading-none text-foreground">
        {value}
      </dd>
    </div>
  );
}

function TelegramPage() {
  const setup = useTelegramSetup();
  const groupSetup = useTelegramGroupSetup();
  const { workspaceId } = useWorkspace();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const tab = search.tab ?? "overview";
  const setTab = (next: TabKey) =>
    void navigate({
      search: (prev: TelegramSearch) => ({ ...prev, tab: next }),
      replace: true,
    });
  // The URL owns the Broadcasts launch selection (M3). Replace, not push, so
  // back/forward stay meaningful and normalization cannot loop.
  const setLaunch = useCallback(
    (launchId: string) =>
      void navigate({
        search: (prev: TelegramSearch) => ({ ...prev, tab: "broadcasts", launch: launchId }),
        replace: true,
      }),
    [navigate],
  );
  // Audience owns the same `launch` param, so switching Broadcasts → Audience
  // preserves the selection. Replace-only, same as Broadcasts.
  const setAudienceLaunch = useCallback(
    (launchId: string) =>
      void navigate({
        search: (prev: TelegramSearch) => ({ ...prev, tab: "audience", launch: launchId }),
        replace: true,
      }),
    [navigate],
  );
  // Inbox conversation selection is URL-owned like the Broadcasts launch.
  // Replace-only so selection changes never pollute back/forward history.
  const setInboxConversation = useCallback(
    (conversationId: string) =>
      void navigate({
        search: (prev: TelegramSearch) => ({ ...prev, tab: "inbox", conversation: conversationId }),
        replace: true,
      }),
    [navigate],
  );
  const clearInboxConversation = useCallback(
    () =>
      void navigate({
        search: (prev: TelegramSearch) => {
          const { conversation: _dropped, ...rest } = prev;
          return { ...rest, tab: "inbox" as const };
        },
        replace: true,
      }),
    [navigate],
  );

  // C6 — workspace-wide unnotified schedule changes (RLS-scoped, metadata only).
  const pendingScheduleQuery = useQuery({
    queryKey: workspaceScheduleCommunicationsQueryKey(workspaceId ?? null),
    enabled: !!workspaceId,
    queryFn: () => listPendingScheduleCommunications(workspaceId!),
  });
  const pendingSchedule = pendingScheduleQuery.data ?? [];




  const groupCount = groupSetup.connectedGroupCount;
  const readyCount = groupSetup.readiness.filter((r) => r.ready).length;
  const attentionCount = Math.max(groupCount - readyCount, 0);

  const serviceChecking = setup.configQuery.isPending;
  const serviceError = setup.configQuery.isError;
  const serviceAvailable = !serviceChecking && !serviceError && setup.botConfigured;
  const serviceLabel = serviceChecking
    ? "Checking"
    : serviceError
      ? "Status unavailable"
      : setup.botConfigured
        ? "Available"
        : "Unavailable";

  const groupsPending = groupSetup.groupQuery.isPending;
  const groupsError = groupSetup.groupQuery.isError;
  const checking = serviceChecking || groupsPending;
  const hasProblem = !checking && (!serviceAvailable || groupsError || attentionCount > 0);

  const overallTone = checking
    ? "muted"
    : hasProblem
      ? "red"
      : groupCount === 0
        ? "gold"
        : "green";
  const overallLabel = checking
    ? "Checking"
    : hasProblem
      ? "Needs attention"
      : groupCount === 0
        ? "No communities connected"
        : "Operational";

  const primaryLine = checking
    ? "Checking Telegram service and connected communities…"
    : groupsError && groupCount === 0
      ? "Connected community state could not be loaded right now."
      : groupsError
        ? "The last loaded communities are shown below, but refreshing the list failed."
        : groupCount === 0
          ? "Connect your first Telegram community to start onboarding members."
          : hasProblem
            ? "Review the community rows under Communities and follow the listed fix for each one."
            : `All ${groupCount} connected communit${groupCount === 1 ? "y is" : "ies are"} operational.`;

  const metricValue = (value: number) =>
    groupsPending && groupCount === 0
      ? "—"
      : groupsError && groupCount === 0
        ? "Unavailable"
        : String(value);

  const nextStepLine = checking
    ? "Waiting for current community state."
    : !serviceAvailable
      ? "The Telegram service is not reporting as available. Recheck before running community actions."
      : groupCount === 0
        ? "Connect your first Telegram community under Communities."
        : attentionCount > 0
          ? `Open Communities and resolve ${attentionCount} communit${attentionCount === 1 ? "y" : "ies"} that need attention.`
          : "Nothing needs attention. Review onboarding and Launch Watch settings per community when you are ready.";

  return (
    <div className="flex max-w-5xl min-w-0 flex-col gap-4 sm:gap-6">
      <PageHeader
        eyebrow="Community Operations"
        title="Community Command Center"
        description="Your workspace's community operations hub: connected Telegram communities, Social Missions, broadcasts, the member Inbox and Launch Watch in one place."
        status={groupCount > 0 ? "Connected · Live Beta" : "Live Beta"}
      />


      <RelatedLinks label="Go to">
        <Link to="/distribution" className={relatedLinkClass}>
          Sticker Drops
        </Link>
        <Link to="/sticker-lab" className={relatedLinkClass}>
          Sticker Lab
        </Link>
        <Link to="/launch-control" className={relatedLinkClass}>
          Launch Control
        </Link>
      </RelatedLinks>

      <Tabs
        value={tab}
        onValueChange={(value) => setTab(value as TabKey)}
        className="flex min-w-0 flex-col gap-4 sm:gap-6"
      >
        <TabsList
          aria-label="Community Command sections"
          className="no-scrollbar -mx-4 h-auto w-[calc(100%+2rem)] max-w-none justify-start gap-1 overflow-x-auto rounded-none border-y border-border/60 bg-surface-raised/40 px-4 py-1.5 sm:mx-0 sm:w-full sm:rounded-lg sm:border sm:px-1.5"
        >
          {TABS.map((item) => (
            <TabsTrigger
              key={item.value}
              value={item.value}
              className="min-h-11 shrink-0 px-3 text-xs uppercase tracking-[0.12em] data-[state=active]:bg-background data-[state=active]:text-gold sm:text-[13px]"
            >
              <span className="sm:hidden">{item.shortLabel}</span>
              <span className="hidden sm:inline">{item.label}</span>
            </TabsTrigger>
          ))}
        </TabsList>

        {/* ---------------------------------------------------------------- */}
        <TabsContent value="overview" className="mt-0 flex min-w-0 flex-col gap-4 sm:gap-6">
          <LaunchReadinessCallout workspaceId={workspaceId} />

          {/* C6 — unnotified schedule changes need an explicit operator decision. */}
          {pendingScheduleQuery.isError ? (
            <Section variant="surface" title="Schedule changes">
              <p className="text-xs leading-relaxed text-muted-foreground">
                Pending schedule-change decisions could not be loaded. This is not a confirmation
                that there are none.
              </p>
              <Button
                variant="outline"
                size="sm"
                className="mt-2 min-h-11"
                onClick={() => void pendingScheduleQuery.refetch()}
              >
                Retry
              </Button>
            </Section>
          ) : pendingSchedule.length > 0 ? (
            <Section
              variant="surface"
              title="Schedule changed"
              leading={<CalendarClock className="size-4" aria-hidden="true" />}
              description={
                pendingSchedule.length === 1
                  ? "One launch schedule changed and its watchers have not been notified."
                  : `${pendingSchedule.length} launch schedules changed and their watchers have not been notified.`
              }
              actions={<StatusBadge tone="gold">Decision needed</StatusBadge>}
            >
              <Button
                size="sm"
                className="min-h-11"
                onClick={() =>
                  pendingSchedule.length === 1
                    ? setLaunch(pendingSchedule[0]!.launch_id)
                    : setTab("broadcasts")
                }
              >
                {pendingSchedule.length === 1
                  ? "Review in Broadcasts"
                  : "Open Broadcasts to decide"}
              </Button>
              {pendingSchedule.length > 1 ? (
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                  Select each affected launch in Broadcasts to notify watchers or dismiss the
                  change.
                </p>
              ) : null}
            </Section>
          ) : null}


          <Section
            variant="hero"
            title="Community state"
            description={primaryLine}
            actions={<StatusBadge tone={overallTone}>{overallLabel}</StatusBadge>}
          >
            <dl className="grid min-w-0 grid-cols-2 gap-2.5 sm:grid-cols-4">
              <StateMetric label="Telegram service" value={serviceLabel} />
              <StateMetric label="Connected" value={metricValue(groupCount)} />
              <StateMetric label="Ready" value={metricValue(readyCount)} />
              <StateMetric label="Needs attention" value={metricValue(attentionCount)} />
            </dl>
          </Section>

          {hasProblem ? (
            <Section variant="surface" title="Attention required">
              <ul className="list-disc space-y-1.5 pl-4 text-xs leading-relaxed text-muted-foreground">
                {serviceError ? (
                  <li>Telegram service status could not be loaded right now.</li>
                ) : !setup.botConfigured ? (
                  <li>The Telegram service is unavailable, so community actions may not work.</li>
                ) : null}
                {groupsError && groupCount === 0 ? (
                  <li>Connected communities could not be loaded right now.</li>
                ) : groupsError ? (
                  <li>Showing the last loaded communities; refreshing the list failed.</li>
                ) : null}
                {attentionCount > 0 ? (
                  <li>
                    {attentionCount} connected communit{attentionCount === 1 ? "y" : "ies"} not
                    ready. Open Communities for the exact fix on each one.
                  </li>
                ) : null}
              </ul>
            </Section>
          ) : null}

          <Section
            variant="surface"
            title="Next step"
            description={nextStepLine}
            leading={<ArrowRight className="size-4" aria-hidden="true" />}
          >
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => setTab("communities")}>
                Open Communities
              </Button>
              <Button size="sm" variant="outline" asChild>
                <Link to="/launch-control">Launch Control</Link>
              </Button>
              <Button size="sm" variant="outline" asChild>
                <Link to="/distribution">Sticker Drops</Link>
              </Button>
            </div>
          </Section>
        </TabsContent>

        {/* ---------------------------------------------------------------- */}
        <TabsContent value="broadcasts" className="mt-0 min-w-0">
          <BroadcastsPanel
            selectedLaunchId={search.launch ?? null}
            onLaunchChange={setLaunch}
            groupSetup={groupSetup}
          />

        </TabsContent>


        {/* ---------------------------------------------------------------- */}
        <TabsContent value="audience" className="mt-0 min-w-0">
          <AudiencePanel selectedLaunchId={search.launch ?? null} onLaunchChange={setAudienceLaunch} />
        </TabsContent>

        {/* ---------------------------------------------------------------- */}
        <TabsContent value="inbox" className="mt-0 min-w-0">
          <ProjectInboxPanel
            selectedConversationId={search.conversation ?? null}
            onConversationChange={setInboxConversation}
            onConversationClear={clearInboxConversation}
          />
        </TabsContent>



        {/* ---------------------------------------------------------------- */}
        {/*
          Communities stays mounted across tab changes: the group card owns
          in-flight connect/link flows with live countdowns that must not be
          destroyed by switching tabs. Data fetching is unchanged — both
          hooks already run once at page level.
        */}
        <TabsContent
          value="communities"
          forceMount
          className="mt-0 flex min-w-0 flex-col gap-4 data-[state=inactive]:hidden sm:gap-6"
        >
          <Section
            variant="hero"
            title="Connected communities"
            description={primaryLine}
            actions={<StatusBadge tone={overallTone}>{overallLabel}</StatusBadge>}
          >
            <dl className="grid min-w-0 grid-cols-2 gap-2.5 sm:grid-cols-4">
              <StateMetric label="Telegram service" value={serviceLabel} />
              <StateMetric label="Connected" value={metricValue(groupCount)} />
              <StateMetric label="Ready" value={metricValue(readyCount)} />
              <StateMetric label="Needs attention" value={metricValue(attentionCount)} />
            </dl>
          </Section>

          <TelegramGroupCard
            setup={groupSetup}
            personalConnected={setup.ownerConnected}
            botConfigured={setup.botConfigured}
            selectable={false}
          />

          <details className="rounded-md border border-border/60 bg-background/40 p-3">
            <summary className="flex min-h-11 cursor-pointer list-none items-center text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Scope &amp; limitations
            </summary>
            <div className="mt-2 space-y-2 text-xs leading-relaxed text-muted-foreground">
              <p>
                Community Command owns connection health and onboarding. Recurring posting lives in{" "}
                <strong>Sticker Drops</strong>, and pack publishing and one-time sends live in{" "}
                <strong>Sticker Lab</strong>.
              </p>
              <p>
                Assigning a pack as a community’s <strong>official</strong> Telegram sticker set is
                an optional Telegram capability that exists only for <strong>supergroups</strong>,
                and Telegram decides when it is available for a given group. Otherwise CARTEL HQ
                posts the pack link in the community instead — publishing and native sticker sending
                are unaffected.
              </p>
              <p>Telegram allows one community per add-bot flow, so connect them one at a time.</p>
            </div>
          </details>
        </TabsContent>

        {/* ---------------------------------------------------------------- */}
        <TabsContent value="history" className="mt-0 min-w-0">
          <ComingSoonPanel
            icon={Clock3}
            title="History"
            summary="What was communicated, where it landed, and what the automations did. Not available yet."
            points={[
              "Messages: watcher updates, launch notifications and community broadcasts, with aggregate delivery outcomes.",
              "Activity: onboarding welcomes, Launch Watch cards and Sticker Drops, kept separate so the log stays readable.",
              "Outcomes reported honestly — an uncertain Telegram result will never be shown as delivered.",
            ]}
            footnote="Recent watcher update outcomes remain visible in Launch Control until this view ships."
          />
        </TabsContent>
      </Tabs>

      <p className="flex items-center gap-2 text-[11px] leading-relaxed text-muted-foreground">
        <Radio className="size-3.5 shrink-0" aria-hidden="true" />
        <span>
          History is being added in a later controlled phase. It is a placeholder today and cannot
          send or expose anything. Broadcasts sends private watcher updates, and can post one
          official project message into a connected community you select. Inbox shows explicit
          private replies to official Launch Watch bot messages — sending team replies from it is
          not available yet.
        </span>
      </p>
    </div>
  );

}
