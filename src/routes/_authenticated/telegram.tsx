import { createFileRoute } from "@tanstack/react-router";

import { PageHeader } from "@/components/cartel/PageHeader";
import { Section } from "@/components/cartel/Section";
import { StatusBadge } from "@/components/cartel/StatusBadge";
import { LaunchReadinessCallout } from "@/components/cartel/LaunchReadiness";
import { useWorkspace } from "@/lib/workspace-context";


import { useTelegramSetup } from "@/components/cartel/TelegramConnectionCard";
import {
  TelegramGroupCard,
  useTelegramGroupSetup,
} from "@/components/cartel/TelegramGroupCard";


export const Route = createFileRoute("/_authenticated/telegram")({
  head: () => ({
    meta: [
      { title: "Community Command — CARTEL HQ" },
      {
        name: "description",
        content:
          "Operator control center for connected Telegram communities. Manage onboarding, Sticker Drops, sticker distribution, and connection health from one place.",
      },
      { property: "og:title", content: "Community Command — CARTEL HQ" },
      {
        property: "og:description",
        content: "Operator control center for Telegram communities, onboarding, Sticker Drops, sticker distribution, and connection health.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: TelegramPage,
});

function TelegramPage() {
  const setup = useTelegramSetup();
  const groupSetup = useTelegramGroupSetup();
  const { workspaceId } = useWorkspace();

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
          ? "Connect your first Telegram community below to start onboarding members."
          : hasProblem
            ? "Review the community rows below and follow the listed fix for each one."
            : `All ${groupCount} connected communit${groupCount === 1 ? "y is" : "ies are"} operational.`;

  return (
    <div className="flex max-w-5xl flex-col gap-4 sm:gap-6">
      <PageHeader
        eyebrow="Community Operations"
        title="Community Command"
        description="Connection health and per-community controls for every Telegram community you have connected."
        status={groupCount > 0 ? "Connected · Live Beta" : "Live Beta"}
      />

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
              {groupsPending && groupCount === 0
                ? "—"
                : groupsError && groupCount === 0
                  ? "Unavailable"
                  : groupCount}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
              Ready
            </dt>
            <dd className="mt-1 text-sm font-semibold text-foreground">
              {groupsPending && groupCount === 0
                ? "—"
                : groupsError && groupCount === 0
                  ? "Unavailable"
                  : readyCount}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
              Needs attention
            </dt>
            <dd className="mt-1 text-sm font-semibold text-foreground">
              {groupsPending && groupCount === 0
                ? "—"
                : groupsError && groupCount === 0
                  ? "Unavailable"
                  : attentionCount}
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
                {attentionCount} connected communit{attentionCount === 1 ? "y" : "ies"} not ready.
                Open the matching community below for the exact fix.
              </li>
            ) : null}
          </ul>
        </Section>
      ) : null}

      <TelegramGroupCard
        setup={groupSetup}
        personalConnected={setup.ownerConnected}
        botConfigured={setup.botConfigured}
        selectable={false}
      />

      <details className="mt-4 rounded-md border border-border/60 bg-background/40 p-3">
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
            Assigning a pack as a community’s <strong>official</strong> Telegram sticker set is an
            optional Telegram capability that exists only for <strong>supergroups</strong>, and
            Telegram decides when it is available for a given group. Otherwise CARTEL HQ posts the
            pack link in the community instead — publishing and native sticker sending are
            unaffected.
          </p>
          <p>Telegram allows one community per add-bot flow, so connect them one at a time.</p>
        </div>
      </details>
    </div>
  );
}

