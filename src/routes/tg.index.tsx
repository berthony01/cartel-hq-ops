/**
 * SE-16.1H — Mission Control picker (read-only).
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
import { ChevronRight } from "lucide-react";
import {
  miniAppListMissionWorkspaces,
  miniAppListMissions,
} from "@/lib/telegram-miniapp-bridge.functions";
import {
  MiniAppFrame,
  MiniAppIdentity,
  MiniAppMessage,
  MiniAppPanel,
  MiniAppRetryButton,
  MiniAppSkeleton,
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

  return (
    <MiniAppFrame>
      <MiniAppIdentity subtitle={activeWorkspace?.workspaceName} />

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
          note={workspaceId ? undefined : "Choose a project to see its live missions."}
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

      {workspaceId ? (
        <MiniAppPanel heading="Live missions" note="Select a mission to view its latest results.">
          {missionsQuery.isPending ? (
            <MiniAppSkeleton label="Loading missions…" />
          ) : missionsQuery.isError || missionsFailure ? (
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
    </MiniAppFrame>
  );
}
