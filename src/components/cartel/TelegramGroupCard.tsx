import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Copy, Loader2, Users } from "lucide-react";

import { useWorkspace } from "@/lib/workspace-context";
import { useTelegramLauncher } from "@/hooks/useTelegramLauncher";
import { telegramErrorMessage } from "@/lib/telegram-stickers";
import {
  createTelegramGroupLink,
  fetchTelegramGroupLinkStatus,
  type TelegramLinkStatus,
} from "@/lib/telegram-link";

import {
  fetchTelegramGroupStatus,
  MAX_DISTRIBUTION_TARGETS,
  type TelegramGroupConnection,
  type TelegramGroupStatusResult,
} from "@/lib/telegram-group";
import { StatusBadge } from "@/components/cartel/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";

/**
 * Connected Telegram groups manager for the active workspace.
 * A workspace may keep many groups connected at once — Telegram itself only
 * allows one group per add-bot flow, so the user repeats the connect action.
 * Read-only against `telegram_group_connections`: the webhook is the
 * authoritative writer. Selection of distribution targets is browser-local.
 */

export type GroupReadiness = {
  group: TelegramGroupConnection;
  live: TelegramGroupStatusResult | null;
  chatType: string | null;
  isSupergroup: boolean;
  isBasicGroup: boolean;
  supportedChatType: boolean;
  botAdmin: boolean;
  botCanChangeInfo: boolean | undefined;
  canSetStickerSet: boolean;
  memberCount: number | null;
  officialStickerEligible: boolean;
  officialStickerReason: string | null;
  ready: boolean;

};

function selectionKey(workspaceId: string) {
  return `cartelhq.telegram.groupTargets.${workspaceId}`;
}

function readStoredSelection(workspaceId: string | null | undefined): string[] {
  if (!workspaceId || typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(selectionKey(workspaceId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

function writeStoredSelection(workspaceId: string | null | undefined, ids: string[]) {
  if (!workspaceId || typeof window === "undefined") return;
  try {
    window.localStorage.setItem(selectionKey(workspaceId), JSON.stringify(ids));
  } catch {
    /* storage unavailable — selection stays in memory only */
  }
}

function readinessFor(
  group: TelegramGroupConnection,
  live: TelegramGroupStatusResult | null,
): GroupReadiness {
  const meta = group.metadata ?? null;
  const chatType = live?.chatType ?? group.chat_type ?? null;
  const isSupergroup = chatType === "supergroup";
  const isBasicGroup = chatType === "group";
  const supportedChatType = isSupergroup || isBasicGroup;
  const botAdmin = live?.botIsAdmin ?? group.bot_is_admin ?? false;
  const botCanChangeInfo =
    live?.botCanChangeInfo ??
    (typeof meta?.bot_can_change_info === "boolean" ? meta.bot_can_change_info : undefined);
  const canSetStickerSet = live?.canSetStickerSet ?? group.can_set_sticker_set ?? false;
  const memberCount =
    live?.memberCount ?? (typeof meta?.member_count === "number" ? meta.member_count : null);
  // Telegram's live `can_set_sticker_set` capability is authoritative. No
  // member threshold is documented as stable, so none is derived or displayed.
  const officialStickerEligible =
    canSetStickerSet ||
    (live?.officialStickerEligible ?? meta?.official_group_sticker_eligible === true);
  const rawReason = live?.officialStickerReason ?? meta?.official_group_sticker_reason ?? null;
  // Stale rows may still carry a fixed-threshold reason — normalize it away.
  const officialStickerReason = rawReason === "minimum_members" ? "not_reported" : rawReason;


  const ready = live?.ready ?? (supportedChatType && botAdmin && botCanChangeInfo !== false);

  return {
    group,
    live,
    chatType,
    isSupergroup,
    isBasicGroup,
    supportedChatType,
    botAdmin,
    botCanChangeInfo,
    canSetStickerSet,
    memberCount,
    officialStickerEligible,
    officialStickerReason,

    ready: !!ready,
  };
}

export function useTelegramGroupSetup(enabled = true) {
  const { workspaceId } = useWorkspace();
  const queryClient = useQueryClient();
  const groupQuery = useQuery({
    queryKey: ["telegram-group-link", workspaceId],
    enabled: enabled && !!workspaceId,
    queryFn: () => fetchTelegramGroupLinkStatus(workspaceId!),
  });

  const [liveById, setLiveById] = useState<Record<string, TelegramGroupStatusResult>>({});
  const [checkingId, setCheckingId] = useState<string | null>(null);

  const data = groupQuery.data;
  const groups: TelegramGroupConnection[] = useMemo(() => {
    const list = data?.groups ?? (data?.group ? [data.group] : []);
    return list.filter((g): g is TelegramGroupConnection => !!g);
  }, [data]);
  const groupIdsKey = groups.map((g) => g.id).join(",");

  const recheckGroup = useCallback(
    async (id: string, silent = false) => {
      if (!workspaceId || !id) return;
      if (!silent) setCheckingId(id);
      try {
        const result = await fetchTelegramGroupStatus({
          workspaceId,
          groupConnectionId: id,
        });
        setLiveById((prev) => ({ ...prev, [id]: result }));
        if (!silent) {
          void queryClient.invalidateQueries({ queryKey: ["telegram-group-link", workspaceId] });
          toast.success("Group status re-checked.");
        }
      } catch (err) {
        if (!silent) toast.error(telegramErrorMessage(err));
      } finally {
        if (!silent) setCheckingId(null);
      }
    },
    [queryClient, workspaceId],
  );

  const recheckAll = useCallback(
    async (silent = true) => {
      for (const g of groups.slice(0, MAX_DISTRIBUTION_TARGETS)) {
        await recheckGroup(g.id, silent);
      }
    },
    [groups, recheckGroup],
  );

  /** Legacy single-group re-check used by the newest connected group. */
  const recheck = useCallback(
    async (silent = false) => {
      const id = groups[0]?.id;
      if (!id) return;
      await recheckGroup(id, silent);
    },
    [groups, recheckGroup],
  );

  // Stored connection metadata is enough to render. We do ONE lightweight live
  // check of the newest group per workspace mount — never N calls, never on focus.
  const autoCheckedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!enabled || !workspaceId || groups.length === 0) return;
    if (autoCheckedRef.current === workspaceId) return;
    autoCheckedRef.current = workspaceId;
    void recheckGroup(groups[0]!.id, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, workspaceId, groupIdsKey]);


  const readiness: GroupReadiness[] = useMemo(
    () => groups.map((g) => readinessFor(g, liveById[g.id] ?? null)),
    [groups, liveById],
  );
  const readinessById = useMemo(() => {
    const map: Record<string, GroupReadiness> = {};
    for (const r of readiness) map[r.group.id] = r;
    return map;
  }, [readiness]);

  /* ---------------- distribution target selection ---------------- */

  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
  const hydratedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!workspaceId || groups.length === 0) return;
    const valid = new Set(groups.map((g) => g.id));
    const firstHydration = hydratedRef.current !== workspaceId;
    hydratedRef.current = workspaceId;
    setSelectedGroupIds((prev) => {
      const base = firstHydration ? readStoredSelection(workspaceId) : prev;
      const kept = base.filter((id) => valid.has(id)).slice(0, MAX_DISTRIBUTION_TARGETS);
      const same = kept.length === prev.length && kept.every((id, i) => id === prev[i]);
      // Defaults only apply on first hydration: a deliberate Clear selection sticks.
      if (kept.length === 0 && firstHydration) return [groups[0]!.id];
      return same ? prev : kept;
    });

  }, [workspaceId, groups]);

  useEffect(() => {
    if (!workspaceId || hydratedRef.current !== workspaceId) return;
    writeStoredSelection(workspaceId, selectedGroupIds);
  }, [workspaceId, selectedGroupIds]);

  const toggleGroup = useCallback((id: string) => {
    setSelectedGroupIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= MAX_DISTRIBUTION_TARGETS) {
        toast.error(
          `You can distribute to up to ${MAX_DISTRIBUTION_TARGETS} groups in one run.`,
        );
        return prev;
      }
      return [...prev, id];
    });
  }, []);
  const selectAllGroups = useCallback(() => {
    setSelectedGroupIds(groups.slice(0, MAX_DISTRIBUTION_TARGETS).map((g) => g.id));
    if (groups.length > MAX_DISTRIBUTION_TARGETS) {
      toast.message(
        `Selected the first ${MAX_DISTRIBUTION_TARGETS} groups — one distribution run is capped at ${MAX_DISTRIBUTION_TARGETS}.`,
      );
    }
  }, [groups]);
  const clearGroupSelection = useCallback(() => setSelectedGroupIds([]), []);


  const selectedGroups = useMemo(
    () => groups.filter((g) => selectedGroupIds.includes(g.id)),
    [groups, selectedGroupIds],
  );
  const selectedReadiness = useMemo(
    () => selectedGroups.map((g) => readinessById[g.id]!).filter(Boolean),
    [selectedGroups, readinessById],
  );

  // Legacy single-group surface kept for backward compatibility.
  const primary = readiness[0] ?? null;

  return {
    workspaceId,
    groupQuery,
    groups,
    readiness,
    readinessById,
    connectedGroupCount: groups.length,
    recheckGroup,
    recheckAll,
    recheck,
    checkingId,
    checking: checkingId !== null,

    selectedGroupIds,
    selectedGroups,
    selectedReadiness,
    selectedReadyCount: selectedReadiness.filter((r) => r.ready).length,
    allSelectedReady:
      selectedReadiness.length > 0 && selectedReadiness.every((r) => r.ready),
    toggleGroup,
    selectAllGroups,
    clearGroupSelection,

    group: primary?.group ?? null,
    groupId: primary?.group.id ?? null,
    groupTitle: primary?.group.title ?? null,
    groupConnected: groups.length > 0,
    groupReady: !!primary?.ready,
    live: primary?.live ?? null,
    chatType: primary?.chatType ?? null,
    isSupergroup: !!primary?.isSupergroup,
    isBasicGroup: !!primary?.isBasicGroup,
    supportedChatType: !!primary?.supportedChatType,
    botAdmin: !!primary?.botAdmin,
    botCanChangeInfo: primary?.botCanChangeInfo,
    canSetStickerSet: !!primary?.canSetStickerSet,
    memberCount: primary?.memberCount ?? null,
    minMembers: primary?.minMembers ?? null,
    officialStickerEligible: !!primary?.officialStickerEligible,
    officialStickerReason: primary?.officialStickerReason ?? null,
  };
}

export type TelegramGroupSetup = ReturnType<typeof useTelegramGroupSetup>;

function secondsLeft(expiresAt?: string | null): number {
  if (!expiresAt) return 0;
  const ms = new Date(expiresAt).getTime() - Date.now();
  return ms > 0 ? Math.ceil(ms / 1000) : 0;
}

const CARTELHQ_COMMAND = "/cartelhq";

async function copyCommandToClipboard() {
  try {
    await navigator.clipboard.writeText(CARTELHQ_COMMAND);
    toast.success("Copied /cartelhq");
  } catch {
    toast.error("Could not copy command");
  }
}

async function copyTelegramUrlToClipboard(url: string) {
  try {
    await navigator.clipboard.writeText(url);
    toast.success("Telegram link copied");
  } catch {
    toast.error("Could not copy Telegram link");
  }
}

function officialSetLabel(r: GroupReadiness): string {
  if (r.officialStickerEligible || r.canSetStickerSet) return "Official group sticker set available";
  if (r.isBasicGroup) return "Official group sticker set requires supergroup";
  if (r.belowMinMembers)
    return `Official group sticker set at ${r.minMembers}+ members (${r.memberCount})`;
  return "Official group sticker set not available yet";
}

function GroupRow({
  readiness: r,
  selected,
  onToggle,
  onRecheck,
  checking,
  selectable,
}: {
  readiness: GroupReadiness;
  selected: boolean;
  onToggle: () => void;
  onRecheck: () => void;
  checking: boolean;
  selectable: boolean;
}) {
  const g = r.group;
  const inputId = `tg-group-${g.id}`;
  return (
    <li className="rounded-md border border-border/60 bg-background/40 p-3">
      <div className="flex items-start gap-3">
        {selectable ? (
          <Checkbox
            id={inputId}
            checked={selected}
            onCheckedChange={onToggle}
            className="mt-1"
            aria-label={`Select ${g.title} as a distribution target`}
          />
        ) : null}
        <div className="min-w-0 flex-1">
          <label
            htmlFor={selectable ? inputId : undefined}
            className="block cursor-pointer text-sm font-semibold text-foreground"
          >
            {g.title}
            {g.username ? (
              <span className="ml-2 font-normal text-muted-foreground">@{g.username}</span>
            ) : null}
          </label>
          <div className="mt-2 flex flex-wrap gap-2">
            <StatusBadge tone={r.supportedChatType ? "green" : "red"}>
              {r.isSupergroup
                ? "Supergroup"
                : r.isBasicGroup
                  ? "Basic group"
                  : `Unsupported chat type (${g.chat_type})`}
            </StatusBadge>
            <StatusBadge tone={r.botAdmin ? "green" : "red"}>
              {r.botAdmin ? "Bot admin verified" : "Bot is not an admin"}
            </StatusBadge>
            {r.botCanChangeInfo !== undefined ? (
              <StatusBadge tone={r.botCanChangeInfo ? "green" : "red"}>
                {r.botCanChangeInfo ? "Change Group Info enabled" : "Change Group Info missing"}
              </StatusBadge>
            ) : null}
            <StatusBadge
              tone={r.officialStickerEligible || r.canSetStickerSet ? "green" : "gold"}
            >
              {officialSetLabel(r)}
            </StatusBadge>
            {typeof r.memberCount === "number" ? (
              <StatusBadge tone="muted">{r.memberCount} members</StatusBadge>
            ) : null}
          </div>

          {!r.ready ? (
            <p className="mt-3 rounded-md border border-signal/40 bg-signal/5 p-3 text-xs text-signal">
              This group is not ready. In Telegram, open the group and make @PepeCartelHQBot an
              administrator with the <strong>Change Group Info</strong> right, or, if the bot is
              already installed, send{" "}
              <code className="rounded bg-surface-raised px-1 py-0.5 font-mono text-[11px]">
                /cartelhq
              </code>{" "}
              once. Then re-check this group.
            </p>
          ) : !r.officialStickerEligible ? (
            <p className="mt-3 rounded-md border border-gold/40 bg-gold/5 p-3 text-xs text-muted-foreground">
              {r.isBasicGroup
                ? "This basic group is fully set up for CARTEL HQ: the published pack can be shared here and native stickers can be sent through the bot. Telegram’s official group sticker set only exists for supergroups — converting is optional."
                : r.belowMinMembers
                  ? `Official group sticker set unlocks at ${r.minMembers} members. This group currently has ${r.memberCount}. The pack link and native stickers still work.`
                  : "Telegram has not reported official group sticker-set eligibility for this group yet. Sharing the pack and sending native stickers still work normally."}
            </p>
          ) : null}

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="min-h-9"
              disabled={checking}
              onClick={onRecheck}
            >
              {checking ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
              Re-check group status
            </Button>
          </div>

          <details className="mt-3 rounded-md border border-border bg-surface-raised p-3 text-xs">
            <summary className="cursor-pointer font-semibold">Technical detail</summary>
            <p className="mt-2 font-mono text-[11px] text-muted-foreground">
              chat_id {g.telegram_chat_id}
              {r.live?.currentStickerSetName
                ? ` · current group sticker set ${r.live.currentStickerSetName}`
                : ""}
            </p>
            {r.live?.technical ? (
              <p className="mt-1 font-mono text-[11px] text-muted-foreground/80">
                {r.live.technical}
              </p>
            ) : null}
          </details>
        </div>
      </div>
    </li>
  );
}

export function TelegramGroupCard({
  setup,
  personalConnected,
  botConfigured,
  selectable = true,
}: {
  setup: TelegramGroupSetup;
  personalConnected: boolean;
  botConfigured: boolean;
  /** Renders distribution-target checkboxes. */
  selectable?: boolean;
}) {
  const queryClient = useQueryClient();
  const { isMobileDevice, launchTelegram } = useTelegramLauncher();
  const {
    workspaceId,
    groups,
    readiness,
    groupQuery,
    checkingId,
    recheckGroup,
    selectedGroupIds,
    toggleGroup,
    selectAllGroups,
    clearGroupSelection,
  } = setup;

  
  const [starting, setStarting] = useState(false);
  const [linkState, setLinkState] = useState<TelegramLinkStatus | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [remaining, setRemaining] = useState(0);
  /** Server-provided official admin deep links for the active request. */
  const [launchUrls, setLaunchUrls] = useState<{ app?: string | undefined; web?: string | undefined }>({});
  /** Only true when the launch attempt itself failed (sandbox / popup block). */
  const [launchBlocked, setLaunchBlocked] = useState(false);

  const pollRef = useRef<number | null>(null);


  const stopPolling = useCallback(() => {
    if (pollRef.current !== null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);
  useEffect(() => stopPolling, [stopPolling]);

  useEffect(() => {
    if (linkState !== "pending" || !expiresAt) return;
    setRemaining(secondsLeft(expiresAt));
    const id = window.setInterval(() => {
      const left = secondsLeft(expiresAt);
      setRemaining(left);
      if (left <= 0) {
        setLinkState("expired");
        stopPolling();
      }
    }, 1000);
    return () => window.clearInterval(id);
  }, [linkState, expiresAt, stopPolling]);

  const knownIdsRef = useRef<string[]>([]);
  useEffect(() => {
    knownIdsRef.current = groups.map((g) => g.id);
  }, [groups]);

  const startPolling = useCallback(
    (requestId: string) => {
      if (!workspaceId) return;
      stopPolling();
      const before = new Set(knownIdsRef.current);
      pollRef.current = window.setInterval(async () => {
        try {
          const result = await fetchTelegramGroupLinkStatus(workspaceId, requestId);
          // The server list stays authoritative — existing groups are never dropped.
          queryClient.setQueryData(["telegram-group-link", workspaceId], result);
          const list = result.groups ?? (result.group ? [result.group] : []);
          const fresh = list.find((g) => g && !before.has(g.id));
          // Success only when THIS request reports connected, or a genuinely new
          // group id appeared. Legacy `result.group` alone proves nothing.
          const requestConnected = result.request?.status === "connected";
          if (fresh || requestConnected) {
            stopPolling();
            setLinkState("connected");
            void queryClient.invalidateQueries({ queryKey: ["telegram-group-link", workspaceId] });
            toast.success(
              fresh ? `Group connected: ${fresh.title}` : "Telegram group connection confirmed.",
            );
            return;
          }

          const status = result.request?.status;
          if (status === "expired" || status === "cancelled") {
            stopPolling();
            setLinkState(status);
          }
        } catch {
          /* transient poll failure — keep waiting until expiry */
        }
      }, 2000);
    },
    [queryClient, stopPolling, workspaceId],
  );

  /**
   * Opens a same-origin "Opening Telegram…" tab synchronously (inside the click
   * gesture) so the desktop handoff survives the async link request. Never a
   * blank tab: the placeholder paints immediately and is replaced by Telegram.
   */
  const openHandoffWindow = (): Window | null => {
    try {
      const w = window.open("", "_blank");
      if (!w) return null;
      w.document.write(
        '<!doctype html><meta charset="utf-8"><title>Opening Telegram…</title>' +
          '<body style="margin:0;display:flex;align-items:center;justify-content:center;' +
          'height:100vh;background:#070707;color:#E9E0C9;font:600 16px system-ui,sans-serif">' +
          "Opening Telegram…</body>",
      );
      w.document.close();
      return w;
    } catch {
      return null;
    }
  };

  const connect = async () => {
    if (!workspaceId || starting) return;
    setStarting(true);
    setLaunchBlocked(false);

    const mobile = isMobileDevice();
    // Desktop: reserve the tab now, while the user gesture is still live.
    const handoff = mobile ? null : openHandoffWindow();

    try {
      const result = await createTelegramGroupLink(workspaceId);
      // Server URLs are authoritative: they carry the secure startgroup payload
      // and the minimal `admin=change_info` suggestion.
      const web = result.groupStartUrl;
      const app = result.groupAppUrl;

      if (!web && !app) throw new Error("The Telegram group link is unavailable right now.");
      setExpiresAt(result.expiresAt ?? null);
      setLaunchUrls({ app, web });
      setLinkState("pending");
      setRemaining(secondsLeft(result.expiresAt));
      startPolling(result.requestId);

      let launched = false;
      if (handoff && !handoff.closed && web) {
        try {
          handoff.location.replace(web);
          launched = true;
        } catch {
          launched = false;
        }
      } else if (mobile) {
        launched = launchTelegram(app, web);
      } else {
        launched = launchTelegram(undefined, web ?? app);
      }
      if (!launched) {
        try {
          handoff?.close();
        } catch {
          /* noop */
        }
        setLaunchBlocked(true);
      }
    } catch (err) {
      try {
        handoff?.close();
      } catch {
        /* noop */
      }
      setLinkState(null);
      toast.error(telegramErrorMessage(err));
    } finally {
      setStarting(false);
    }
  };

  const pending = linkState === "pending";
  const manualUrl = isMobileDevice()
    ? (launchUrls.app ?? launchUrls.web)
    : (launchUrls.web ?? launchUrls.app);
  const lastCheck = groupQuery.data?.request?.metadata?.last_group_check;
  const readyCount = readiness.filter((r) => r.ready).length;

  return (
    <Card className="cartel-panel">
      <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
        <CardTitle className="text-base">Connected Telegram groups</CardTitle>
        {groupQuery.isLoading ? (
          <StatusBadge tone="muted">Checking groups…</StatusBadge>
        ) : groups.length === 0 ? (
          <StatusBadge tone="muted">No groups connected</StatusBadge>
        ) : readyCount === groups.length ? (
          <StatusBadge tone="green">
            {groups.length} group{groups.length === 1 ? "" : "s"} verified
          </StatusBadge>
        ) : (
          <StatusBadge tone="red">
            {readyCount} of {groups.length} verified
          </StatusBadge>
        )}
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <p className="text-xs leading-relaxed text-muted-foreground">
          Connect every Telegram group or supergroup CARTEL HQ should work with. Telegram only lets
          you pick <strong>one group per add-bot flow</strong>, so use{" "}
          <strong>Connect another group</strong> once for each community — connecting a new group
          never removes the ones already connected. Once connected, CARTEL HQ can distribute one
          published pack to many groups together. If @PepeCartelHQBot is already installed in a
          group, open it and send{" "}
          <code className="rounded bg-surface-raised px-1 py-0.5 font-mono text-[11px]">/cartelhq</code>{" "}
          once while a one-time link is active. A verified group — basic group or supergroup — can
          receive the published pack link and native stickers. Telegram’s <em>official</em> group
          sticker set is a separate, optional feature for supergroups that also meet Telegram’s
          member minimum.
        </p>

        {groups.length > 0 && selectable ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/60 bg-surface-raised p-3">
            <div className="min-w-0">
              <p className="text-xs font-semibold text-foreground">
                {selectedGroupIds.length} of {groups.length} group
                {groups.length === 1 ? "" : "s"} selected for distribution
              </p>
              {groups.length > MAX_DISTRIBUTION_TARGETS ? (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  One distribution run covers up to {MAX_DISTRIBUTION_TARGETS} groups. Run it again
                  for the rest — the sticker set is never recreated.
                </p>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="min-h-9"
                onClick={selectAllGroups}
                disabled={
                  selectedGroupIds.length ===
                  Math.min(groups.length, MAX_DISTRIBUTION_TARGETS)
                }
              >
                {groups.length > MAX_DISTRIBUTION_TARGETS
                  ? `Select first ${MAX_DISTRIBUTION_TARGETS}`
                  : "Select all"}
              </Button>

              <Button
                type="button"
                variant="outline"
                size="sm"
                className="min-h-9"
                onClick={clearGroupSelection}
                disabled={selectedGroupIds.length === 0}
              >
                Clear selection
              </Button>
            </div>
          </div>
        ) : null}

        {groups.length > 0 ? (
          <ul className="space-y-3">
            {readiness.map((r) => (
              <GroupRow
                key={r.group.id}
                readiness={r}
                selectable={selectable}
                selected={selectedGroupIds.includes(r.group.id)}
                onToggle={() => toggleGroup(r.group.id)}
                onRecheck={() => void recheckGroup(r.group.id, false)}
                checking={checkingId === r.group.id}
              />
            ))}
          </ul>
        ) : null}

        {pending ? (
          <div className="rounded-md border border-gold/40 bg-gold/5 p-3 text-xs text-muted-foreground">
            <p className="flex items-center gap-2 font-semibold text-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              Waiting for Telegram… Choose a group and confirm admin permissions.
            </p>
            <p className="mt-2">
              {remaining > 0
                ? `This one-time link expires in ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}.`
                : "This one-time link is about to expire."}
            </p>

            {launchBlocked && manualUrl ? (
              <div className="mt-3 rounded-md border border-border/60 bg-background/40 p-3">
                <p className="leading-relaxed text-foreground">
                  Your browser blocked the Telegram window. Open this link yourself while the
                  one-time link is active:
                </p>
                <div className="mt-2 flex min-w-0 items-center gap-2">
                  <code className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap rounded bg-surface-raised px-2 py-1.5 font-mono text-[11px] text-muted-foreground">
                    {manualUrl}
                  </code>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="size-9 shrink-0"
                    onClick={() => void copyTelegramUrlToClipboard(manualUrl)}
                    aria-label="Copy Telegram group link"
                    title="Copy Telegram group link"
                  >
                    <Copy className="size-4" aria-hidden="true" />
                  </Button>
                </div>
                <div className="mt-2">
                  <Button asChild size="sm" className="min-h-9">
                    <a href={manualUrl} target="_blank" rel="noopener noreferrer">
                      Open Telegram
                    </a>
                  </Button>
                </div>
                <p className="mt-2 leading-relaxed">
                  If @PepeCartelHQBot is already in the group, open that group instead, give it the{" "}
                  <strong>Change Group Info</strong> admin right and send{" "}
                  <span className="inline-flex items-center gap-1 align-middle">
                    <code className="rounded bg-surface-raised px-1 py-0.5 font-mono text-[11px]">
                      /cartelhq
                    </code>
                    <button
                      type="button"
                      onClick={() => void copyCommandToClipboard()}
                      className="inline-flex items-center rounded p-0.5 text-muted-foreground hover:bg-surface-raised hover:text-foreground"
                      aria-label="Copy /cartelhq"
                      title="Copy /cartelhq"
                    >
                      <Copy className="size-3" aria-hidden="true" />
                    </button>
                  </span>{" "}
                  once.
                </p>
              </div>
            ) : null}





            {lastCheck ? (
              <div className="mt-3 space-y-2 rounded-md border border-border/60 bg-background/40 p-3">
                {lastCheck.group_title ? (
                  <p className="text-sm font-semibold text-foreground">{lastCheck.group_title}</p>
                ) : null}
                <div className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 text-xs">
                  <span className="text-muted-foreground">Your admin status</span>
                  <StatusBadge tone={lastCheck.user_is_admin === true ? "green" : "red"}>
                    {lastCheck.user_is_admin === true ? "Verified" : "Needs admin access"}
                  </StatusBadge>

                  <span className="text-muted-foreground">Bot admin status</span>
                  <StatusBadge tone={lastCheck.bot_is_admin === true ? "green" : "red"}>
                    {lastCheck.bot_is_admin === true ? "Verified" : "Bot must be admin"}
                  </StatusBadge>

                  <span className="text-muted-foreground">Change Group Info</span>
                  <StatusBadge tone={lastCheck.bot_can_change_info === true ? "green" : "red"}>
                    {lastCheck.bot_can_change_info === true ? "Enabled" : "Needs to be enabled"}
                  </StatusBadge>

                  <span className="text-muted-foreground">Official group sticker set</span>
                  <StatusBadge
                    tone={lastCheck.official_group_sticker_eligible === true ? "green" : "gold"}
                  >
                    {lastCheck.official_group_sticker_eligible === true
                      ? "Eligible"
                      : lastCheck.official_group_sticker_reason === "requires_supergroup"
                        ? "Requires supergroup"
                        : lastCheck.official_group_sticker_reason === "minimum_members"
                          ? `Unlocks at ${lastCheck.official_group_sticker_min_members ?? 100} members (${lastCheck.member_count ?? "?"})`
                          : "Not reported by Telegram yet"}
                  </StatusBadge>
                </div>
                {lastCheck.user_is_admin === true &&
                lastCheck.bot_is_admin === true &&
                lastCheck.bot_can_change_info === true ? (
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    Admin rights look correct.{" "}
                    {lastCheck.official_group_sticker_reason === "requires_supergroup"
                      ? "This is a basic Telegram group, which is fully valid for CARTEL HQ publishing and native stickers. Telegram’s official group sticker set only exists for supergroups — upgrading is optional."
                      : lastCheck.official_group_sticker_reason === "minimum_members"
                        ? `Telegram only allows an official group sticker set from ${lastCheck.official_group_sticker_min_members ?? 100} members (this group has ${lastCheck.member_count ?? "fewer"}). No further permission changes are needed.`
                        : "No further permission changes are needed."}
                  </p>
                ) : (
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    Fix the item shown above, save the admin rights in Telegram, then send{" "}
                    <code className="rounded bg-surface-raised px-1 py-0.5 font-mono text-[11px]">/cartelhq</code>{" "}
                    in the group again while this link is active.
                  </p>
                )}
              </div>
            ) : null}
          </div>
        ) : null}

        {linkState === "expired" || linkState === "cancelled" ? (
          <p className="rounded-md border border-signal/40 bg-signal/5 p-3 text-xs text-signal">
            Group link expired. Try again.
          </p>
        ) : null}

        {!personalConnected ? (
          <p className="text-xs text-muted-foreground">
            Connect your personal Telegram account first — groups are linked by the same account.
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            className="min-h-11"
            disabled={!workspaceId || starting || pending || !botConfigured || !personalConnected}
            onClick={() => void connect()}
          >
            {starting || pending ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Users className="size-4" aria-hidden="true" />
            )}
            {groups.length > 0 ? "Connect another group" : "Connect Telegram group"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
