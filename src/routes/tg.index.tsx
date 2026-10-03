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
import { AlertTriangle, ChevronRight, Lock, Radio, Send, ShieldCheck, Target } from "lucide-react";
import {
  miniAppListMissionWorkspaces,
  miniAppListMissions,
  miniAppOperatorHome,
  miniAppInboxSummary,
  miniAppCommercialStatus,
  miniAppResolveCommunityLaunch,
} from "@/lib/telegram-miniapp-bridge.functions";
import { MiniAppInbox } from "@/components/telegram-miniapp/MiniAppInbox";
import { MiniAppCustomMedia } from "@/components/telegram-miniapp/MiniAppCustomMedia";
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

const MINI_APP_TABS: readonly MiniAppTab[] = ["home", "missions", "inbox", "brand", "more"];
const CONVERSATION_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * MINI-HQ-1B — bounded deep-link state. Only a known tab and a syntactically
 * valid UUID survive; anything else is dropped. Existence and workspace
 * ownership are decided server-side and fail closed without disclosure.
 */
export type MiniAppHomeSearch = { tab?: MiniAppTab; conversation?: string; workspace?: string };

export function parseMiniAppHomeSearch(search: Record<string, unknown>): MiniAppHomeSearch {
  const out: MiniAppHomeSearch = {};
  const tab = search["tab"];
  if (typeof tab === "string" && (MINI_APP_TABS as readonly string[]).includes(tab)) {
    out.tab = tab as MiniAppTab;
  }
  const workspace = search["workspace"];
  if (typeof workspace === "string" && workspace.length === 36 && CONVERSATION_UUID.test(workspace)) {
    out.workspace = workspace.toLowerCase();
  }
  const conversation = search["conversation"];
  if (typeof conversation === "string" && conversation.length === 36 && CONVERSATION_UUID.test(conversation)) {
    out.conversation = conversation.toLowerCase();
    out.tab = "inbox";
  }
  return out;
}

/** Returns the requested workspace id only if it is in the authorized list. */
export function resolveAuthorizedWorkspace(
  requested: string | null | undefined,
  authorized: ReadonlyArray<{ workspaceId: string }>,
): string | null {
  if (!requested) return null;
  const match = authorized.find((w) => w.workspaceId.toLowerCase() === requested);
  return match ? match.workspaceId : null;
}

type FullAppPath =
  | "/project-profile"
  | "/brand-kit"
  | "/launch-control"
  | "/telegram"
  | "/distribution"
  | "/dashboard"
  | "/settings";

/** Existing full-app destination; opens outside the Mini App (signed-in browser). */
function FullAppLink({ to, label }: { to: FullAppPath; label: string }) {
  return (
    <Link
      to={to}
      target="_blank"
      rel="noopener noreferrer"
      className="flex min-h-11 w-full min-w-0 items-center gap-3 rounded-md border border-border/60 bg-surface-raised/40 px-3 text-sm font-medium text-foreground transition-colors hover:border-gold/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/60"
    >
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="shrink-0 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
        Opens CARTEL HQ
      </span>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
    </Link>
  );
}

/** C3 — honest plan label; no plan evaluation happens client-side. */
export function miniAppPlanLabel(status: { unrestricted: boolean; plan: { code: string; name: string } }): string {
  if (status.unrestricted) return "Platform Owner / Unrestricted";
  if (status.plan.code === "cartel_49") return "Cartel HQ Pro ($49/month)";
  if (status.plan.code === "cartel_free") return "Free";
  return status.plan.name;
}

/** Pro-locked panel: the area stays discoverable, content is not fetched. */
function MiniAppProLocked({ area }: { area: string }) {
  return (
    <MiniAppPanel heading={`${area} · Pro`} note="Included with Cartel HQ Pro ($49/month).">
      <div className="flex min-w-0 flex-col gap-3">
        <div className="flex min-w-0 items-start gap-3 text-sm">
          <Lock className="mt-0.5 size-4 shrink-0 text-gold" aria-hidden="true" />
          <p className="min-w-0 text-xs leading-5 text-muted-foreground">
            {area} is not included in this project's current plan. Upgrade from Settings &amp; billing in the full CARTEL HQ app.
          </p>
        </div>
        <FullAppLink to="/settings" label="Upgrade in Settings & billing" />
      </div>
    </MiniAppPanel>
  );
}

/** Commercial status failed/unknown: no premium content, no lock claim. */
function MiniAppPlanUnavailable({ onRetry, pending }: { onRetry: () => void; pending: boolean }) {
  return (
    <MiniAppMessage
      title="Plan status unavailable"
      description="We couldn't confirm this project's plan, so this area stays closed. Try again in a moment."
      action={<MiniAppRetryButton onRetry={onRetry} pending={pending} />}
    />
  );
}

function PlanUnknownTag() {
  return (
    <span className="ml-auto shrink-0 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
      Plan…
    </span>
  );
}

function ProTag() {
  return (
    <span className="ml-auto inline-flex shrink-0 items-center gap-1 rounded border border-gold/40 px-1.5 py-0.5 text-[10px] uppercase tracking-[0.12em] text-gold">
      <Lock className="size-3" aria-hidden="true" />
      Pro
    </span>
  );
}

export const Route = createFileRoute("/tg/")({
  ssr: false,
  validateSearch: parseMiniAppHomeSearch,
  head: () => ({
    meta: [
      { title: "Operator Home — CARTEL HQ" },
      {
        name: "description",
        content: "CARTEL HQ Telegram owner console for project status and mission operations.",
      },
      { property: "og:title", content: "Operator Home — CARTEL HQ" },
      {
        property: "og:description",
        content: "CARTEL HQ Telegram owner console for project status and mission operations.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: MiniAppHome,
});

function MiniAppHome() {
  const [initData, setInitData] = useState<string | null>(null);
  const [booting, setBooting] = useState(true);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const search = Route.useSearch();
  const [activeTab, setActiveTab] = useState<MiniAppTab>(search.tab ?? "home");
  const [conversationId, setConversationId] = useState<string | null>(search.conversation ?? null);

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
  const loadInboxSummary = useServerFn(miniAppInboxSummary);
  const loadCommercialStatus = useServerFn(miniAppCommercialStatus);

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
  const requestedWorkspace = search.workspace ?? null;
  useEffect(() => {
    setWorkspaceId((current) => {
      if (current && workspaces.some((workspace) => workspace.workspaceId === current)) {
        return current;
      }
      // Deep-link preselection: only honoured when the requested workspace is
      // in the server-authorized list. Anything else is silently ignored.
      const authorizedRequested = resolveAuthorizedWorkspace(requestedWorkspace, workspaces);
      if (authorizedRequested) {
        return authorizedRequested;
      }
      if (workspaces.length === 1) {
        const only = workspaces[0];
        return only ? only.workspaceId : null;
      }
      return null;
    });
  }, [workspaces, requestedWorkspace]);

  // C3 — read-only commercial status. Server authorization remains the gate;
  // this only drives honest UI and skips premium reads once denied.
  const commercialQuery = useQuery({
    queryKey: ["tg", "commercial", workspaceId],
    enabled: Boolean(initData && workspaceId),
    retry: false,
    queryFn: () =>
      loadCommercialStatus({ data: { initData: initData as string, workspaceId: workspaceId as string } }),
  });
  // C3A fail-closed: premium reads run ONLY on explicit ok=true + feature true.
  const commercial = commercialQuery.data?.ok ? commercialQuery.data : null;
  const commercialUnavailable =
    Boolean(workspaceId) && !commercialQuery.isPending && commercial === null;
  const missionsAllowed = commercial ? commercial.features.x_missions : null;
  const inboxAllowed = commercial ? commercial.features.project_inbox : null;
  const stickerDropsAllowed = commercial ? commercial.features.sticker_drops : null;
  const missionsLocked = missionsAllowed === false;
  const inboxLocked = inboxAllowed === false;
  const missionsEnabled = missionsAllowed === true;
  const inboxEnabled = inboxAllowed === true;

  const missionsQuery = useQuery({
    queryKey: ["tg", "missions", workspaceId],
    enabled: Boolean(initData && workspaceId && missionsEnabled),
    queryFn: () =>
      listMissions({ data: { initData: initData as string, workspaceId: workspaceId as string } }),
  });

  const homeQuery = useQuery({
    queryKey: ["tg", "operator-home", workspaceId],
    enabled: Boolean(initData && workspaceId),
    queryFn: () =>
      loadOperatorHome({ data: { initData: initData as string, workspaceId: workspaceId as string } }),
  });

  const inboxSummaryQuery = useQuery({
    queryKey: ["tg", "inbox", "summary", workspaceId],
    enabled: Boolean(initData && workspaceId && inboxEnabled),
    retry: false,
    queryFn: () =>
      loadInboxSummary({ data: { initData: initData as string, workspaceId: workspaceId as string } }),
  });

  if (booting) {
    return (
      <MiniAppFrame>
        <MiniAppIdentity title="Operator Console" />
        <MiniAppSkeleton label="Connecting to Telegram…" />
      </MiniAppFrame>
    );
  }

  if (!initData) {
    return (
      <MiniAppFrame>
        <MiniAppIdentity title="Operator Console" />
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
  // Null when unavailable: Home then shows no inbox claim at all.
  const inboxSummary = inboxSummaryQuery.data?.ok ? inboxSummaryQuery.data.summary : null;
  const navigation = <MiniAppTabBar active={activeTab} onSelect={setActiveTab} />;

  return (
    <MiniAppFrame navigation={navigation}>
      <MiniAppIdentity title="Operator Console" subtitle={activeWorkspace?.workspaceName} />

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

      {workspaceId && (homeQuery.isPending || commercialQuery.isPending || (missionsEnabled && missionsQuery.isPending)) ? (
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
          {commercial ? (
            <MiniAppPanel heading="Plan">
              <div className="flex min-w-0 items-center gap-3">
                <p className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
                  {miniAppPlanLabel(commercial)}
                </p>
              </div>
              {!commercial.unrestricted && commercial.plan.code === "cartel_free" ? (
                <div className="mt-3 border-t border-border/40 pt-3">
                  <FullAppLink to="/settings" label="Upgrade to Pro — Settings & billing" />
                </div>
              ) : null}
            </MiniAppPanel>
          ) : null}
          <MiniAppPanel heading="Needs attention">
            {inboxSummary && inboxSummary.waitingOnTeam > 0 ? (
              <button
                type="button"
                onClick={() => {
                  setConversationId(null);
                  setActiveTab("inbox");
                }}
                className="mb-3 flex w-full min-w-0 items-start gap-3 border-b border-border/40 pb-3 text-left text-sm"
              >
                <Send className="mt-0.5 size-4 shrink-0 text-gold" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold text-foreground">
                    {inboxSummary.waitingOnTeam === 1
                      ? "1 conversation needs a reply"
                      : `${inboxSummary.waitingOnTeam} conversations need a reply`}
                  </span>
                  <span className="mt-1 block text-xs text-muted-foreground">Open Project Inbox</span>
                </span>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              </button>
            ) : null}
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

          {!missionsEnabled ? null : (
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
          )}

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
                {missionsLocked ? <ProTag /> : missionsEnabled ? null : <PlanUnknownTag />}
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("inbox")}
                className="flex min-h-14 min-w-0 items-center gap-2 rounded-md border border-border/60 bg-surface-raised/40 px-3 text-left text-xs font-semibold text-foreground"
              >
                <Send className="size-4 shrink-0 text-gold" aria-hidden="true" />
                <span className="truncate">Project Inbox</span>
                {inboxLocked ? <ProTag /> : inboxEnabled ? null : <PlanUnknownTag />}
              </button>
            </div>
          </MiniAppPanel>
        </>
      ) : null}

      {workspaceId && activeTab === "missions" && missionsLocked ? <MiniAppProLocked area="Mission Control" /> : null}

      {workspaceId && activeTab === "missions" && commercialUnavailable ? (
        <MiniAppPlanUnavailable onRetry={() => void commercialQuery.refetch()} pending={commercialQuery.isFetching} />
      ) : null}

      {workspaceId && activeTab === "missions" && missionsEnabled ? (
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

      {workspaceId && activeTab === "inbox" && inboxLocked ? <MiniAppProLocked area="Project Inbox" /> : null}

      {workspaceId && activeTab === "inbox" && commercialUnavailable ? (
        <MiniAppPlanUnavailable onRetry={() => void commercialQuery.refetch()} pending={commercialQuery.isFetching} />
      ) : null}

      {workspaceId && activeTab === "inbox" && inboxEnabled ? (
        <MiniAppInbox
          initData={initData}
          workspaceId={workspaceId}
          conversationId={conversationId}
          onOpenConversation={setConversationId}
        />
      ) : null}

      {workspaceId && activeTab === "brand" ? (
        <>
          <MiniAppPanel
            heading="Saved project identity"
            note="Read-only here. This is exactly what Telegram cards and public pages use."
          >
            {homeData ? (
              <dl className="flex min-w-0 flex-col divide-y divide-border/40">
                <div className="flex min-w-0 items-center justify-between gap-3 py-2">
                  <dt className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">Name</dt>
                  <dd className="min-w-0 truncate text-sm font-medium text-foreground">
                    {homeData.identity.projectName}
                  </dd>
                </div>
                <div className="flex min-w-0 items-center justify-between gap-3 py-2">
                  <dt className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">Ticker</dt>
                  <dd className="min-w-0 truncate text-sm text-foreground">
                    {homeData.identity.ticker ? `$${homeData.identity.ticker}` : "Not set"}
                  </dd>
                </div>
                <div className="flex min-w-0 items-center justify-between gap-3 py-2">
                  <dt className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">Logo</dt>
                  <dd className="text-sm text-foreground">
                    {homeData.identity.logoDataUrl ? "Saved" : "Not set"}
                  </dd>
                </div>
                <div className="flex min-w-0 items-center justify-between gap-3 py-2">
                  <dt className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">Source</dt>
                  <dd className="text-sm text-foreground">
                    {homeData.identity.source === "profile" ? "Project Profile" : "Workspace name"}
                  </dd>
                </div>
              </dl>
            ) : (
              <MiniAppSkeleton label="Loading project identity…" />
            )}
          </MiniAppPanel>
          {initData ? <MiniAppCustomMedia key={workspaceId} initData={initData} workspaceId={workspaceId} /> : null}
          <MiniAppPanel heading="Edit in CARTEL HQ" note="Opens the full CARTEL HQ app in your browser.">
            <div className="flex min-w-0 flex-col gap-2">
              <FullAppLink to="/project-profile" label="Project Profile" />
              <FullAppLink to="/brand-kit" label="Brand Kit" />
            </div>
          </MiniAppPanel>
        </>
      ) : null}

      {workspaceId && activeTab === "more" ? (
        <>
          <MiniAppPanel heading="Launch & community" note="Opens CARTEL HQ in your browser.">
            <div className="flex min-w-0 flex-col gap-2">
              <FullAppLink to="/launch-control" label="Launch Control" />
              <FullAppLink to="/telegram" label="Community Command" />
              {stickerDropsAllowed === true ? (
                <FullAppLink to="/distribution" label="Sticker Drops" />
              ) : stickerDropsAllowed === false ? (
                <FullAppLink to="/settings" label="Sticker Drops · Pro locked — upgrade" />
              ) : (
                <FullAppLink to="/settings" label="Sticker Drops · plan status unavailable" />
              )}
            </div>
          </MiniAppPanel>
          <MiniAppPanel heading="Account" note="Opens CARTEL HQ in your browser.">
            <div className="flex min-w-0 flex-col gap-2">
              <FullAppLink to="/dashboard" label="Dashboard" />
              <FullAppLink to="/settings" label="Settings & billing" />
            </div>
          </MiniAppPanel>
        </>
      ) : null}
    </MiniAppFrame>
  );
}
