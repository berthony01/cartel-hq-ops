import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  ArrowRight,
  Clock3,
  Megaphone,
  Radio,
  Users,
} from "lucide-react";

import { PageHeader } from "@/components/cartel/PageHeader";
import { Section } from "@/components/cartel/Section";
import { StatusBadge } from "@/components/cartel/StatusBadge";
import { LaunchReadinessCallout } from "@/components/cartel/LaunchReadiness";
import { BroadcastsPanel } from "@/components/cartel/BroadcastsPanel";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useWorkspace } from "@/lib/workspace-context";

import { useTelegramSetup } from "@/components/cartel/TelegramConnectionCard";
import {
  TelegramGroupCard,
  useTelegramGroupSetup,
} from "@/components/cartel/TelegramGroupCard";

const TAB_KEYS = ["overview", "broadcasts", "audience", "communities", "history"] as const;
type TabKey = (typeof TAB_KEYS)[number];

type TelegramSearch = { tab: TabKey; launch?: string };

/** Invalid or missing values fail safe to the Overview tab and no launch. */
function validateTelegramSearch(search: Record<string, unknown>): TelegramSearch {
  const rawTab = search["tab"];
  const tab = (TAB_KEYS as readonly string[]).includes(String(rawTab))
    ? (String(rawTab) as TabKey)
    : "overview";
  const rawLaunch = search["launch"];
  const launch =
    typeof rawLaunch === "string" && rawLaunch.trim().length > 0 && rawLaunch.length <= 100
      ? rawLaunch.trim()
      : undefined;
  return launch ? { tab, launch } : { tab };
}


export const Route = createFileRoute("/_authenticated/telegram")({
  validateSearch: validateTelegramSearch,
  head: () => ({
    meta: [
      { title: "Community Command — CARTEL HQ" },
      {
        name: "description",
        content:
          "Operator control center for connected Telegram communities. Manage onboarding, Sticker Drops, sticker sends, and connection health from one place.",
      },
      { property: "og:title", content: "Community Command — CARTEL HQ" },
      {
        property: "og:description",
        content:
          "Operator control center for Telegram communities, onboarding, Sticker Drops, sticker sends, and connection health.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: TelegramPage,
});



const TABS: Array<{ value: TabKey; label: string; shortLabel: string }> = [
  { value: "overview", label: "Overview", shortLabel: "Overview" },
  { value: "broadcasts", label: "Broadcasts", shortLabel: "Broadcasts" },
  { value: "audience", label: "Audience", shortLabel: "Audience" },
  { value: "communities", label: "Communities", shortLabel: "Communities" },
  { value: "history", label: "History", shortLabel: "History" },
];

/**
 * Shell placeholder for a Community Command capability that is not built yet.
 * Deliberately renders no counts, no records and no send controls so nothing
 * can read as live functionality.
 */
function ComingSoonPanel({
  icon: Icon,
  title,
  summary,
  points,
  footnote,
}: {
  icon: typeof Megaphone;
  title: string;
  summary: string;
  points: string[];
  footnote: string;
}) {
  return (
    <Section
      variant="primary"
      title={title}
      description={summary}
      leading={<Icon className="size-4" aria-hidden="true" />}
      actions={<StatusBadge tone="muted">Planned</StatusBadge>}
    >
      <div className="rounded-lg border border-dashed border-border/70 bg-background/40 p-4">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          What will live here
        </p>
        <ul className="mt-2 list-disc space-y-1.5 pl-4 text-xs leading-relaxed text-muted-foreground">
          {points.map((point) => (
            <li key={point}>{point}</li>
          ))}
        </ul>
        <p className="mt-3 border-t border-border/60 pt-3 text-xs leading-relaxed text-muted-foreground">
          {footnote}
        </p>
      </div>
    </Section>
  );
}

function TelegramPage() {
  const setup = useTelegramSetup();
  const groupSetup = useTelegramGroupSetup();
  const { workspaceId } = useWorkspace();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const tab = search.tab;
  const setTab = (next: TabKey) =>
    void navigate({
      search: (prev: TelegramSearch) => ({ ...prev, tab: next }),
      replace: true,
    });


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
        title="Community Command"
        description="Connection health, onboarding and per-community controls for every Telegram community you have connected."
        status={groupCount > 0 ? "Connected · Live Beta" : "Live Beta"}
      />

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

          <Section
            variant="hero"
            title="Community state"
            description={primaryLine}
            actions={<StatusBadge tone={overallTone}>{overallLabel}</StatusBadge>}
          >
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="min-w-0">
                <dt className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                  Telegram service
                </dt>
                <dd className="mt-1 text-sm font-semibold text-foreground">{serviceLabel}</dd>
              </div>
              <div className="min-w-0">
                <dt className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                  Connected
                </dt>
                <dd className="mt-1 text-sm font-semibold text-foreground">
                  {metricValue(groupCount)}
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                  Ready
                </dt>
                <dd className="mt-1 text-sm font-semibold text-foreground">
                  {metricValue(readyCount)}
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                  Needs attention
                </dt>
                <dd className="mt-1 text-sm font-semibold text-foreground">
                  {metricValue(attentionCount)}
                </dd>
              </div>
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
          <BroadcastsPanel initialLaunchId={search.launch ?? null} />
        </TabsContent>


        {/* ---------------------------------------------------------------- */}
        <TabsContent value="audience" className="mt-0 min-w-0">
          <ComingSoonPanel
            icon={Users}
            title="Audience"
            summary="Privacy-safe aggregates about who you can reach. Not available yet."
            points={[
              "Counts of active watchers, and how many allow project updates or countdown reminders.",
              "Aggregate reachability derived from past delivery outcomes only.",
              "Guidance for watchers who have muted a channel, since only they can re-enable it.",
            ]}
            footnote="CARTEL HQ will never show Telegram identities, usernames or per-person records here — counts only."
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
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="min-w-0">
                <dt className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                  Telegram service
                </dt>
                <dd className="mt-1 text-sm font-semibold text-foreground">{serviceLabel}</dd>
              </div>
              <div className="min-w-0">
                <dt className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                  Connected
                </dt>
                <dd className="mt-1 text-sm font-semibold text-foreground">
                  {metricValue(groupCount)}
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                  Ready
                </dt>
                <dd className="mt-1 text-sm font-semibold text-foreground">
                  {metricValue(readyCount)}
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                  Needs attention
                </dt>
                <dd className="mt-1 text-sm font-semibold text-foreground">
                  {metricValue(attentionCount)}
                </dd>
              </div>
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
              "Messages: watcher updates, launch notifications and community announcements, with aggregate delivery outcomes.",
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
          Broadcasts, Audience and History are being added in later controlled phases. They are
          placeholders today and cannot send or expose anything.
        </span>
      </p>
    </div>
  );
}
