/**
 * MINI-HQ-1A — owner/operator Home and Missions shell.
 *
 * Reads only the raw `Telegram.WebApp.initData` credential and hands it to the
 * SE-16.0 bridge. No chat id is ever sent or rendered, and no mutation server
 * function is referenced from this screen. The credential is obtained through
 * a bounded readiness wait, never a one-shot read of a possibly-unloaded
 * bridge, and `initDataUnsafe` is never consulted.
 */

import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, ChevronRight, Radio, Send, ShieldCheck, Target } from "lucide-react";
import {
  miniAppListMissionWorkspaces,
  miniAppListMissions,
  miniAppOperatorHome,
} from "@/lib/telegram-miniapp-bridge.functions";
import {
  MiniAppFrame,
  MiniAppIdentity,
  MiniAppMessage,
  MiniAppPanel,
  MiniAppProjectIdentity,
  MiniAppRetryButton,
  MiniAppSkeleton,
  MiniAppTabBar,
  type MiniAppTab,
} from "@/components/telegram-miniapp/MiniAppPieces";
import { StatusBadge } from "@/components/cartel/StatusBadge";
import {
  formatTimeRemaining,
  miniAppFailureMessage,
  missionStatusTone,
  resolveTelegramSession,
} from "@/lib/telegram-miniapp-client";

export const Route = createFileRoute("/tg/")({
  ssr: false,
  component: MiniAppHome,
});

function MiniAppHome() {
  const [initData, setInitData] = useState<string | null>(null);
  const [booting, setBooting] = useState(true);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<MiniAppTab>("home");

  useEffect(() => {
    let cancelled = false;
    void resolveTelegramSession().then((credential) => {
      if (cancelled) return;
      setInitData(credential);
      setBooting(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const listWorkspaces = useServerFn(miniAppListMissionWorkspaces);
  const listMissions = useServerFn(miniAppListMissions);
  const loadOperatorHome = useServerFn(miniAppOperatorHome);

  const workspacesQuery = useQuery({
    queryKey: ["tg", "workspaces"],
    enabled: Boolean(initData),
    queryFn: () => listWorkspaces({ data: { initData: initData as string } }),
  });

  const workspaces = useMemo(
    () => (workspacesQuery.data?.ok ? workspacesQuery.data.workspaces : []),
    [workspacesQuery.data],
  );

  /**
   * Deterministic selection contract: none authorized -> nothing selected;
   * exactly one -> auto-selected; two or more -> nothing selected until the
   * operator chooses. An existing valid selection survives a refetch.
   */
  useEffect(() => {
    setWorkspaceId((current) => {
      if (current && workspaces.some((workspace) => workspace.workspaceId === current)) {
        return current;
      }
      if (workspaces.length === 1) {
        const only = workspaces[0];
        return only ? only.workspaceId : null;
      }
      return null;
    });
  }, [workspaces]);

  const missionsQuery = useQuery({
    queryKey: ["tg", "missions", workspaceId],
    enabled: Boolean(initData && workspaceId),
    queryFn: () =>
      listMissions({ data: { initData: initData as string, workspaceId: workspaceId as string } }),
  });

  const homeQuery = useQuery({
    queryKey: ["tg", "operator-home", workspaceId],
    enabled: Boolean(initData && workspaceId),
    queryFn: () =>
      loadOperatorHome({ data: { initData: initData as string, workspaceId: workspaceId as string } }),
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

  const workspaceFailure =
    workspacesQuery.data && !workspacesQuery.data.ok ? workspacesQuery.data.reason : null;
  const activeWorkspace = workspaces.find((w) => w.workspaceId === workspaceId);
  const missionsFailure =
    missionsQuery.data && !missionsQuery.data.ok ? missionsQuery.data.reason : null;
  const homeFailure = homeQuery.data && !homeQuery.data.ok ? homeQuery.data.reason : null;
  const homeData = homeQuery.data?.ok ? homeQuery.data : null;
  const liveMissionCount = missionsQuery.data?.ok ? missionsQuery.data.missions.length : null;
  const navigation = <MiniAppTabBar active={activeTab} onSelect={setActiveTab} />;

  return (
    <MiniAppFrame navigation={navigation}>
      <MiniAppIdentity />

      {workspacesQuery.isPending ? <MiniAppSkeleton label="Loading projects…" /> : null}

      {workspaceFailure || workspacesQuery.isError ? (
        <MiniAppMessage
          title="Could not load your projects"
          description={miniAppFailureMessage(workspaceFailure ?? "unavailable")}
          action={
            <MiniAppRetryButton
              onRetry={() => void workspacesQuery.refetch()}
              pending={workspacesQuery.isFetching}
            />
          }
        />
      ) : null}

      {workspacesQuery.data?.ok && workspaces.length === 0 ? (
        <MiniAppMessage
          title="No authorized projects"
          description="Your Telegram account is not an operator on any CARTEL HQ project with missions."
        />
      ) : null}

      {workspaces.length > 1 ? (
        <MiniAppPanel
          heading="Project"
          note={workspaceId ? undefined : "Choose a project to control."}
        >
          <div className="flex flex-wrap gap-2">
            {workspaces.map((workspace) => {
              const active = workspace.workspaceId === workspaceId;
              return (
                <button
                  key={workspace.workspaceId}
                  type="button"
                  onClick={() => setWorkspaceId(workspace.workspaceId)}
                  aria-current={active ? "true" : undefined}
                  className={`min-h-9 max-w-full truncate rounded-md border px-3 py-2 text-xs font-medium transition-colors ${
                    active
                      ? "border-gold/50 bg-gold/10 text-gold"
                      : "border-border/70 bg-surface-raised/40 text-muted-foreground"
                  }`}
                >
                  {workspace.workspaceName}
                </button>
              );
            })}
          </div>
        </MiniAppPanel>
      ) : null}

      {workspaceId && (homeQuery.isPending || missionsQuery.isPending) ? (
        <MiniAppSkeleton label="Loading operator console…" />
      ) : null}

      {workspaceId && (homeQuery.isError || homeFailure) ? (
        <MiniAppMessage
          title="Could not load project status"
          description={miniAppFailureMessage(homeFailure ?? "unavailable")}
          action={
            <MiniAppRetryButton
              onRetry={() => void homeQuery.refetch()}
              pending={homeQuery.isFetching}
            />
          }
        />
      ) : null}

      {workspaceId && homeData ? (
        <MiniAppProjectIdentity
          projectName={homeData.identity.projectName}
          ticker={homeData.identity.ticker}
          logoDataUrl={homeData.identity.logoDataUrl}
        />
      ) : activeWorkspace ? (
        <MiniAppProjectIdentity
          projectName={activeWorkspace.workspaceName}
          ticker={null}
          logoDataUrl={null}
        />
      ) : null}

      {workspaceId && activeTab === "home" ? (
        <>
          <MiniAppPanel heading="Needs attention">
            {homeData && homeData.community.connectedGroups === 0 ? (
              <div className="flex min-w-0 items-start gap-3 text-sm">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-gold" aria-hidden="true" />
                <div className="min-w-0">
                  <p className="font-semibold text-foreground">No community connected</p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    Connect a Telegram community from the full CARTEL HQ app before running missions.
                  </p>
                </div>
              </div>
            ) : homeData && homeData.community.adminReadyGroups === 0 ? (
              <div className="flex min-w-0 items-start gap-3 text-sm">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-gold" aria-hidden="true" />
                <div className="min-w-0">
                  <p className="font-semibold text-foreground">Bot admin access needs attention</p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    Review the connected community in the full CARTEL HQ app.
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex min-w-0 items-center gap-3">
                <ShieldCheck className="size-5 shrink-0 text-pepe" aria-hidden="true" />
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground">No immediate blockers</p>
                  <p className="mt-1 text-xs text-muted-foreground">Current connected-community status is ready.</p>
                </div>
              </div>
            )}
          </MiniAppPanel>

          <MiniAppPanel heading="Missions" note="Live mission activity for this project.">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-md border border-gold/25 bg-gold/8 text-gold">
                <Target className="size-5" aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-lg font-semibold tabular-nums text-foreground">
                  {liveMissionCount === null ? "—" : liveMissionCount}
                </p>
                <p className="text-xs text-muted-foreground">
                  {liveMissionCount === 1 ? "Live mission" : "Live missions"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setActiveTab("missions")}
                className="inline-flex min-h-10 shrink-0 items-center gap-1 rounded-md border border-gold/35 bg-gold/8 px-3 text-xs font-semibold text-gold"
              >
                Open
                <ChevronRight className="size-4" aria-hidden="true" />
              </button>
            </div>
            {liveMissionCount === 0 ? (
              <p className="mt-3 border-t border-border/40 pt-3 text-xs leading-5 text-muted-foreground">
                No mission is live. Post an X link as an admin in the connected community to begin setup.
              </p>
            ) : null}
          </MiniAppPanel>

          <MiniAppPanel heading="Community status">
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-md border border-border/50 bg-background/30 p-3">
                <p className="text-lg font-semibold tabular-nums text-foreground">
                  {homeData?.community.connectedGroups ?? "—"}
                </p>
                <p className="mt-1 text-[10px] uppercase text-muted-foreground">Connected</p>
              </div>
              <div className="rounded-md border border-border/50 bg-background/30 p-3">
                <p className="text-lg font-semibold tabular-nums text-foreground">
                  {homeData?.community.adminReadyGroups ?? "—"}
                </p>
                <p className="mt-1 text-[10px] uppercase text-muted-foreground">Admin ready</p>
              </div>
            </div>
          </MiniAppPanel>

          <MiniAppPanel heading="Quick actions" note="Available owner actions only.">
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setActiveTab("missions")}
                className="flex min-h-14 min-w-0 items-center gap-2 rounded-md border border-border/60 bg-surface-raised/40 px-3 text-left text-xs font-semibold text-foreground"
              >
                <Radio className="size-4 shrink-0 text-gold" aria-hidden="true" />
                <span className="truncate">Mission Control</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("inbox")}
                className="flex min-h-14 min-w-0 items-center gap-2 rounded-md border border-border/60 bg-surface-raised/40 px-3 text-left text-xs font-semibold text-foreground"
              >
                <Send className="size-4 shrink-0 text-gold" aria-hidden="true" />
                <span className="truncate">Inbox status</span>
              </button>
            </div>
          </MiniAppPanel>
        </>
      ) : null}

      {workspaceId && activeTab === "missions" ? (
        <MiniAppPanel heading="Live missions" note="Select a mission to view its latest results.">
          {missionsQuery.isError || missionsFailure ? (
            <MiniAppMessage
              title="Could not load missions"
              description={miniAppFailureMessage(missionsFailure ?? "unavailable")}
              action={
                <MiniAppRetryButton
                  onRetry={() => void missionsQuery.refetch()}
                  pending={missionsQuery.isFetching}
                />
              }
            />
          ) : missionsQuery.data?.ok && missionsQuery.data.missions.length === 0 ? (
            <MiniAppMessage
              title="No live missions"
              description="This project has no live mission right now. Start one from the CARTEL HQ bot."
            />
          ) : (
            <ul className="flex flex-col gap-2">
              {(missionsQuery.data?.ok ? missionsQuery.data.missions : []).map((mission) => (
                <li key={mission.missionId} className="min-w-0">
                  <Link
                    to="/tg/mission/$missionId"
                    params={{ missionId: mission.missionId }}
                    className="flex min-h-12 w-full min-w-0 items-center gap-3 rounded-lg border border-border/60 bg-surface-raised/50 px-3 py-2.5 transition-colors hover:border-gold/40"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-foreground">
                        {mission.authorHandle ? `@${mission.authorHandle}` : "Mission"}
                      </span>
                      <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                        {formatTimeRemaining(mission.endsAt)}
                      </span>
                    </span>
                    <StatusBadge tone={missionStatusTone(mission.status)}>
                      {mission.status}
                    </StatusBadge>
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </MiniAppPanel>
      ) : null}

      {workspaceId && activeTab === "inbox" ? (
        <MiniAppMessage
          title="Inbox is coming next"
          description="Project Inbox remains available in the full CARTEL HQ app while the owner Mini App inbox is being connected."
        />
      ) : null}

      {workspaceId && activeTab === "brand" ? (
        <MiniAppMessage
          title="Brand controls are coming next"
          description="Your saved project identity is shown here now. Editing remains in the full CARTEL HQ app for this release."
        />
      ) : null}

      {workspaceId && activeTab === "more" ? (
        <MiniAppMessage
          title="More tools stay in CARTEL HQ"
          description="Launch, billing, treasury, settings, and advanced operations remain in the full CARTEL HQ app."
        />
      ) : null}
    </MiniAppFrame>
  );
}
