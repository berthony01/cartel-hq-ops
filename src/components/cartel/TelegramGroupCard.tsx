import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Copy, ExternalLink, Loader2, Users } from "lucide-react";

import { useWorkspace } from "@/lib/workspace-context";
import { useTelegramLauncher } from "@/hooks/useTelegramLauncher";
import { telegramErrorMessage } from "@/lib/telegram-stickers";
import {
  createTelegramGroupLink,
  fetchTelegramGroupLinkStatus,
  type TelegramLinkLastGroupCheck,
  type TelegramLinkStatus,
} from "@/lib/telegram-link";

import {
  fetchTelegramGroupStatus,
  type TelegramGroupConnection,
  type TelegramGroupStatusResult,
} from "@/lib/telegram-group";
import { StatusBadge } from "@/components/cartel/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Single source of truth for the workspace's target Telegram supergroup.
 * Shared by Step 5 of the builder and /telegram. Read-only: the webhook is the
 * authoritative writer for `telegram_group_connections`.
 */
export function useTelegramGroupSetup(enabled = true) {
  const { workspaceId } = useWorkspace();
  const queryClient = useQueryClient();
  const groupQuery = useQuery({
    queryKey: ["telegram-group-link", workspaceId],
    enabled: enabled && !!workspaceId,
    queryFn: () => fetchTelegramGroupLinkStatus(workspaceId!),
  });

  const [live, setLive] = useState<TelegramGroupStatusResult | null>(null);
  const [checking, setChecking] = useState(false);

  const group: TelegramGroupConnection | null = groupQuery.data?.group ?? null;
  const groupId = group?.id ?? null;

  const recheck = useCallback(
    async (silent = false) => {
      if (!workspaceId || !groupId) return;
      setChecking(true);
      try {
        const result = await fetchTelegramGroupStatus({
          workspaceId,
          groupConnectionId: groupId,
        });
        setLive(result);
        void queryClient.invalidateQueries({ queryKey: ["telegram-group-link", workspaceId] });
        if (!silent) toast.success("Group status re-checked.");
      } catch (err) {
        if (!silent) toast.error(telegramErrorMessage(err));
      } finally {
        setChecking(false);
      }
    },
    [groupId, queryClient, workspaceId],
  );

  // Live verification when a connected group appears and on window refocus.
  useEffect(() => {
    if (!enabled || !groupId) return;
    void recheck(true);
    const onFocus = () => void recheck(true);
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [enabled, groupId, recheck]);

  const isSupergroup = (live?.chatType ?? group?.chat_type) === "supergroup";
  const botAdmin = live?.botIsAdmin ?? group?.bot_is_admin ?? false;
  const botCanChangeInfo = live?.botCanChangeInfo;
  const canSetStickerSet = live?.canSetStickerSet ?? group?.can_set_sticker_set ?? false;

  // Operational readiness never depends on official group-sticker eligibility.
  const ready =
    live?.ready ?? (!!group && isSupergroup && botAdmin && botCanChangeInfo !== false);

  return {
    workspaceId,
    groupQuery,
    group,
    groupId,
    groupTitle: group?.title ?? null,
    groupConnected: !!group,
    groupReady: !!group && ready,
    live,
    checking,
    recheck,
    isSupergroup,
    botAdmin,
    botCanChangeInfo,
    canSetStickerSet,
    memberCount: live?.memberCount ?? null,
    minMembers: live?.minMembers ?? null,
    officialStickerEligible: live?.officialStickerEligible ?? false,
    officialStickerReason: live?.officialStickerReason ?? null,
  };
}

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

export function TelegramGroupCard({
  setup,
  personalConnected,
  botConfigured,
}: {
  setup: ReturnType<typeof useTelegramGroupSetup>;
  personalConnected: boolean;
  botConfigured: boolean;
}) {
  const queryClient = useQueryClient();
  const { launchTelegram, isMobileDevice } = useTelegramLauncher();
  const {
    workspaceId,
    group,
    groupQuery,
    live,
    checking,
    recheck,
    isSupergroup,
    botAdmin,
    botCanChangeInfo,
    canSetStickerSet: canSet,
    memberCount,
    minMembers,
    officialStickerEligible,
    officialStickerReason,
  } = setup;
  const ready = setup.groupReady;


  const [starting, setStarting] = useState(false);
  const [linkState, setLinkState] = useState<TelegramLinkStatus | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [remaining, setRemaining] = useState(0);
  const [launchUrls, setLaunchUrls] = useState<{ app?: string | undefined; web?: string | undefined }>({});
  const [launchBlocked, setLaunchBlocked] = useState(false);
  const [live, setLive] = useState<TelegramGroupStatusResult | null>(null);
  const [checking, setChecking] = useState(false);
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

  const startPolling = useCallback(
    (requestId: string) => {
      if (!workspaceId) return;
      stopPolling();
      pollRef.current = window.setInterval(async () => {
        try {
          const result = await fetchTelegramGroupLinkStatus(workspaceId, requestId);
          queryClient.setQueryData(["telegram-group-link", workspaceId], result);
          if (result.connected && result.group) {
            stopPolling();
            setLinkState("connected");
            void queryClient.invalidateQueries({ queryKey: ["telegram-group-link", workspaceId] });
            toast.success(`Group connected: ${result.group.title}`);
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

  const connect = async () => {
    if (!workspaceId || starting) return;
    setStarting(true);
    setLaunchBlocked(false);
    try {
      const result = await createTelegramGroupLink(workspaceId);
      const web = result.groupStartUrl;
      const app = result.groupAppUrl;
      if (!web && !app) throw new Error("The Telegram group link is unavailable right now.");
      setExpiresAt(result.expiresAt ?? null);
      setLaunchUrls({ app, web });
      setLinkState("pending");
      setRemaining(secondsLeft(result.expiresAt));
      startPolling(result.requestId);
      const launched = launchTelegram(app, web);
      setLaunchBlocked(!launched);
    } catch (err) {
      setLinkState(null);
      toast.error(telegramErrorMessage(err));
    } finally {
      setStarting(false);
    }
  };

  const recheck = useCallback(
    async (silent = false) => {
      if (!workspaceId || !group) return;
      setChecking(true);
      try {
        const result = await fetchTelegramGroupStatus({
          workspaceId,
          groupConnectionId: group.id,
        });
        setLive(result);
        void queryClient.invalidateQueries({ queryKey: ["telegram-group-link", workspaceId] });
        if (!silent) toast.success("Group status re-checked.");
      } catch (err) {
        if (!silent) toast.error(telegramErrorMessage(err));
      } finally {
        setChecking(false);
      }
    },
    [group, queryClient, workspaceId],
  );

  // Live verification when the card mounts with a connected group and on refocus.
  const groupId = group?.id ?? null;
  useEffect(() => {
    if (!groupId) return;
    void recheck(true);
    const onFocus = () => void recheck(true);
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [groupId, recheck]);

  const pending = linkState === "pending";
  const manualUrl = isMobileDevice()
    ? (launchUrls.app ?? launchUrls.web)
    : (launchUrls.web ?? launchUrls.app);
  const liveBotAdmin = live?.botIsAdmin;
  const liveCanSet = live?.canSetStickerSet;
  const botAdmin = liveBotAdmin ?? group?.bot_is_admin ?? false;
  const canSet = liveCanSet ?? group?.can_set_sticker_set ?? false;
  const isSupergroup = (live?.chatType ?? group?.chat_type) === "supergroup";
  const ready = !!group && isSupergroup && botAdmin && canSet;
  const lastCheck = groupQuery.data?.request?.metadata?.last_group_check;


  return (
    <Card className="cartel-panel">
      <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
        <CardTitle className="text-base">Target Telegram group</CardTitle>
        {groupQuery.isLoading ? (
          <StatusBadge tone="muted">Checking group…</StatusBadge>
        ) : ready ? (
          <StatusBadge tone="green">Group verified</StatusBadge>
        ) : group ? (
          <StatusBadge tone="red">Needs attention</StatusBadge>
        ) : (
          <StatusBadge tone="muted">No group connected</StatusBadge>
        )}
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <p className="text-xs leading-relaxed text-muted-foreground">
          Connect the supergroup where this sticker pack should become the group sticker set.
          If @PepeCartelHQBot is already installed there, open the group and send{" "}
          <code className="rounded bg-surface-raised px-1 py-0.5 font-mono text-[11px]">/cartelhq</code>{" "}
          once while a one-time link is active. Otherwise, choose the group and approve admin rights
          when Telegram opens. Members can then use the set inside that group — installing it globally
          to a personal Telegram account stays a separate, individual action.
        </p>

        {group ? (
          <div className="rounded-md border border-border/60 bg-background/40 p-3">
            <p className="text-sm font-semibold text-foreground">
              {group.title}
              {group.username ? (
                <span className="ml-2 font-normal text-muted-foreground">@{group.username}</span>
              ) : null}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <StatusBadge tone={isSupergroup ? "green" : "red"}>
                {isSupergroup ? "Supergroup" : `Unsupported chat type (${group.chat_type})`}
              </StatusBadge>
              <StatusBadge tone={botAdmin ? "green" : "red"}>
                {botAdmin ? "Bot admin verified" : "Bot is not an admin"}
              </StatusBadge>
              <StatusBadge tone={canSet ? "green" : "red"}>
                {canSet ? "Group sticker permission verified" : "Group sticker permission missing"}
              </StatusBadge>
            </div>
            {!ready ? (
              <p className="mt-3 rounded-md border border-signal/40 bg-signal/5 p-3 text-xs text-signal">
                This group is not ready. In Telegram, open the group and either make @PepeCartelHQBot
                an administrator with the right to change group info / set the group sticker set, or,
                if the bot is already installed, send{" "}
                <code className="rounded bg-surface-raised px-1 py-0.5 font-mono text-[11px]">/cartelhq</code>{" "}
                once. Then press Re-check group status.
              </p>
            ) : null}
            <details className="mt-3 rounded-md border border-border bg-surface-raised p-3 text-xs">
              <summary className="cursor-pointer font-semibold">Technical detail</summary>
              <p className="mt-2 font-mono text-[11px] text-muted-foreground">
                chat_id {group.telegram_chat_id}
                {live?.currentStickerSetName
                  ? ` · current group sticker set ${live.currentStickerSetName}`
                  : ""}
              </p>
              {live?.technical ? (
                <p className="mt-1 font-mono text-[11px] text-muted-foreground/80">
                  {live.technical}
                </p>
              ) : null}
            </details>
          </div>
        ) : null}

        {pending ? (
          <div className="rounded-md border border-gold/40 bg-gold/5 p-3 text-xs text-muted-foreground">
            <p className="flex items-center gap-2 font-semibold text-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              Waiting for Telegram…
            </p>
            <p className="mt-1">
              Telegram opened. Choose the target supergroup and approve the requested admin right,
              then return here. If @PepeCartelHQBot is already installed in the group, open that
              group and send{" "}
              <span className="inline-flex items-center gap-1 align-middle">
                <code className="rounded bg-surface-raised px-1 py-0.5 font-mono text-[11px]">/cartelhq</code>
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
              once while this link is active, then return here. CARTEL HQ will verify the group
              automatically.{" "}
              {launchBlocked ? "If Telegram did not open, use Open Telegram below." : null}{" "}
              {remaining > 0
                ? `This one-time link expires in ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}.`
                : "This one-time link is about to expire."}
            </p>

            {pending && lastCheck ? (
              <div className="mt-3 rounded-md border border-border/60 bg-background/40 p-3 space-y-2">
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

                  <span className="text-muted-foreground">Group sticker-set permission</span>
                  <StatusBadge
                    tone={
                      lastCheck.can_set_sticker_set === true
                        ? "green"
                        : lastCheck.can_set_sticker_set === false
                          ? "red"
                          : "muted"
                    }
                  >
                    {lastCheck.can_set_sticker_set === true
                      ? "Verified"
                      : lastCheck.can_set_sticker_set === false
                        ? "Telegram has not granted it yet"
                        : "Not reported by Telegram yet"}
                  </StatusBadge>
                </div>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Fix the item shown above, save the admin rights in Telegram, then send{" "}
                  <code className="rounded bg-surface-raised px-1 py-0.5 font-mono text-[11px]">/cartelhq</code>{" "}
                  in the group again while this link is active.
                </p>
              </div>
            ) : null}

            {manualUrl ? (

              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-3 min-h-9"
                onClick={() => launchTelegram(launchUrls.app, launchUrls.web)}
              >
                <ExternalLink className="size-4" aria-hidden="true" />
                Open Telegram
              </Button>
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
            Connect your personal Telegram account first — the group is linked by the same account.
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
            {group ? "Reconnect / choose another group" : "Connect Telegram group"}
          </Button>
          {group ? (
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              disabled={checking}
              onClick={() => void recheck(false)}
            >
              {checking ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
              Re-check group status
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
