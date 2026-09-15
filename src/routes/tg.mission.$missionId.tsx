/**
 * SE-16.1 — Mission detail (read-only).
 *
 * The route `missionId` is an untrusted routing hint only: the SE-16.0 bridge
 * re-resolves the mission through operator-scoped RPCs and re-verifies live
 * Telegram group admin status before returning anything. No chat id is sent or
 * displayed, and no target/duration/end/cancel control exists in this phase.
 */

import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronLeft } from "lucide-react";
import { miniAppMissionPanel } from "@/lib/telegram-miniapp-bridge.functions";
import {
  MiniAppFrame,
  MiniAppIdentity,
  MiniAppMessage,
  MiniAppPanel,
  MiniAppSkeleton,
  MiniAppStatLine,
} from "@/components/telegram-miniapp/MiniAppPieces";
import { StatusBadge } from "@/components/cartel/StatusBadge";
import {
  MINI_APP_METRIC_LABELS,
  formatMetricValue,
  formatTargetValue,
  formatTimeRemaining,
  miniAppFailureMessage,
  readRawInitData,
  telegramBoot,
} from "@/lib/telegram-miniapp-client";

const METRIC_ORDER = ["views", "likes", "replies", "reposts", "bookmarks"] as const;

export const Route = createFileRoute("/tg/mission/$missionId")({
  ssr: false,
  component: MiniAppMission,
});

function BackLink() {
  return (
    <Link
      to="/tg"
      className="inline-flex min-h-9 items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-gold"
    >
      <ChevronLeft className="size-4" aria-hidden="true" />
      All missions
    </Link>
  );
}

function MiniAppMission() {
  const { missionId } = Route.useParams();
  const [initData, setInitData] = useState<string | null>(null);
  const [booting, setBooting] = useState(true);

  useEffect(() => {
    telegramBoot();
    setInitData(readRawInitData());
    setBooting(false);
  }, []);

  const loadPanel = useServerFn(miniAppMissionPanel);
  const panelQuery = useQuery({
    queryKey: ["tg", "panel", missionId],
    enabled: Boolean(initData),
    queryFn: () => loadPanel({ data: { initData: initData as string, missionId } }),
  });

  if (booting) {
    return (
      <MiniAppFrame>
        <MiniAppIdentity />
        <MiniAppSkeleton label="Connecting to Telegram…" />
      </MiniAppFrame>
    );
  }

  if (!initData) {
    return (
      <MiniAppFrame>
        <MiniAppIdentity />
        <MiniAppMessage
          title="Open Mission Control from Telegram"
          description="This screen only works inside the CARTEL HQ Telegram bot. Open Mission Control from the bot to continue."
        />
      </MiniAppFrame>
    );
  }

  if (panelQuery.isPending) {
    return (
      <MiniAppFrame>
        <MiniAppIdentity />
        <BackLink />
        <MiniAppSkeleton label="Loading mission…" />
      </MiniAppFrame>
    );
  }

  const panel = panelQuery.data;
  if (panelQuery.isError || !panel || !panel.ok) {
    const reason = panel && !panel.ok ? panel.reason : "unavailable";
    return (
      <MiniAppFrame>
        <MiniAppIdentity />
        <BackLink />
        <MiniAppMessage title="Mission unavailable" description={miniAppFailureMessage(reason)} />
      </MiniAppFrame>
    );
  }

  return (
    <MiniAppFrame>
      <MiniAppIdentity subtitle={panel.workspaceName} />
      <BackLink />

      <section className="min-w-0 rounded-lg border border-gold/25 bg-gold/5 px-3.5 py-3.5">
        <div className="flex min-w-0 items-center gap-2">
          <h1 className="min-w-0 flex-1 truncate font-display text-xl uppercase leading-none text-foreground">
            {panel.authorHandle ? `@${panel.authorHandle}` : "Mission"}
          </h1>
          <StatusBadge tone="green">{panel.status}</StatusBadge>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">{formatTimeRemaining(panel.endsAt)}</p>
      </section>

      <MiniAppPanel heading="Live X results" note="Latest stored mission snapshot.">
        {METRIC_ORDER.map((metric) => (
          <MiniAppStatLine
            key={metric}
            label={MINI_APP_METRIC_LABELS[metric] ?? metric}
            value={formatMetricValue(panel.results[metric])}
          />
        ))}
      </MiniAppPanel>

      <MiniAppPanel heading={`Targets · ${panel.controlMode}`}>
        <MiniAppStatLine
          label={`Primary goal · ${panel.primaryType}`}
          value={formatTargetValue(panel.primaryTarget)}
          emphasis
        />
        {METRIC_ORDER.map((metric) => (
          <MiniAppStatLine
            key={metric}
            label={`${MINI_APP_METRIC_LABELS[metric] ?? metric} target`}
            value={formatTargetValue(panel.targets[metric])}
          />
        ))}
      </MiniAppPanel>

      <p className="px-1 text-[11px] leading-4 text-muted-foreground">
        This view is read-only. Editing targets, changing the end time, ending a mission and
        cancelling a mission are handled in the CARTEL HQ Telegram bot.
      </p>
    </MiniAppFrame>
  );
}
