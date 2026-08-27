import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ExternalLink, Loader2, Send } from "lucide-react";

import { useSession } from "@/hooks/useSession";
import {
  fetchTelegramConfig,
  loadTelegramConnection,
  telegramErrorMessage,
  type TelegramConfig,
} from "@/lib/telegram-stickers";
import {
  createTelegramLink,
  fetchTelegramLinkStatus,
  type TelegramLinkStatus,
} from "@/lib/telegram-link";
import { StatusBadge } from "@/components/cartel/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Single source of truth for Telegram bot config + the signed-in user's own
 * `telegram_connections` row. Shared by Step 5 of the builder and /telegram so
 * neither page duplicates the business logic.
 */
export function useTelegramSetup(enabled = true) {
  const { user } = useSession();
  const configQuery = useQuery({
    queryKey: ["telegram-config"],
    enabled,
    staleTime: 60_000,
    retry: 1,
    refetchOnWindowFocus: false,
    queryFn: fetchTelegramConfig,
  });
  const connectionQuery = useQuery({
    queryKey: ["telegram-connection", user?.id],
    enabled: enabled && !!user?.id,
    queryFn: () => loadTelegramConnection(user!.id),
  });

  const config: TelegramConfig | undefined = configQuery.data;
  return {
    userId: user?.id ?? null,
    configQuery,
    connectionQuery,
    config,
    botConfigured: config?.configured === true,
    botUsername: config?.bot?.username,
    botStartUrl: config?.botStartUrl,
    connection: connectionQuery.data ?? null,
    ownerConnected: !!connectionQuery.data?.telegram_user_id,
  };
}

function secondsLeft(expiresAt?: string | null): number {
  if (!expiresAt) return 0;
  const ms = new Date(expiresAt).getTime() - Date.now();
  return ms > 0 ? Math.ceil(ms / 1000) : 0;
}



export function TelegramConnectionCard({
  setup,
  compact = false,
}: {
  setup: ReturnType<typeof useTelegramSetup>;
  compact?: boolean;
}) {
  const queryClient = useQueryClient();
  const { userId, configQuery, connection, botConfigured, botUsername, botStartUrl, config } = setup;

  const [starting, setStarting] = useState(false);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [linkState, setLinkState] = useState<TelegramLinkStatus | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [remaining, setRemaining] = useState(0);
  const [launchUrls, setLaunchUrls] = useState<{ app?: string | undefined; web?: string | undefined }>({});
  const [launchBlocked, setLaunchBlocked] = useState(false);
  const pollRef = useRef<number | null>(null);
  const fallbackRef = useRef<number | null>(null);
  const handoffRef = useRef(false);
  const listenerCleanupRef = useRef<(() => void) | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current !== null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => stopPolling, [stopPolling]);

  const clearListeners = useCallback(() => {
    if (listenerCleanupRef.current) {
      listenerCleanupRef.current();
      listenerCleanupRef.current = null;
    }
  }, []);

  useEffect(() => clearListeners, [clearListeners]);


  // Countdown ticker while a link request is pending.
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
    (id: string) => {
      stopPolling();
      pollRef.current = window.setInterval(async () => {
        try {
          const result = await fetchTelegramLinkStatus(id);
          if (result.connected) {
            stopPolling();
            setLinkState("connected");
            if (userId) {
              if (result.connection) {
                queryClient.setQueryData(["telegram-connection", userId], result.connection);
              }
              void queryClient.invalidateQueries({ queryKey: ["telegram-connection", userId] });
            }
            toast.success("Telegram account connected.");
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
    [queryClient, stopPolling, userId],
  );

  const clearFallback = useCallback(() => {
    if (fallbackRef.current !== null) {
      window.clearTimeout(fallbackRef.current);
      fallbackRef.current = null;
    }
  }, []);

  useEffect(() => clearFallback, [clearFallback]);

  /** Launches Telegram: app deep link first on mobile, https t.me otherwise. */
  const launchTelegram = useCallback(
    (appUrl?: string, webUrl?: string): boolean => {
      const mobile = isMobileDevice();
      clearListeners();
      clearFallback();

      if (mobile && appUrl) {
        handoffRef.current = false;

        const onVisibility = () => {
          if (document.hidden) {
            handoffRef.current = true;
            clearFallback();
            clearListeners();
          }
        };
        const onPageHide = () => {
          handoffRef.current = true;
          clearFallback();
          clearListeners();
        };

        document.addEventListener("visibilitychange", onVisibility);
        window.addEventListener("pagehide", onPageHide);
        listenerCleanupRef.current = () => {
          document.removeEventListener("visibilitychange", onVisibility);
          window.removeEventListener("pagehide", onPageHide);
        };

        window.location.href = appUrl;
        fallbackRef.current = window.setTimeout(() => {
          fallbackRef.current = null;
          clearListeners();
          if (!handoffRef.current && document.visibilityState === "visible" && webUrl) {
            window.location.href = webUrl;
          }
        }, 1300);
        return true;
      }

      const url = webUrl ?? appUrl;
      if (!url) return false;
      if (mobile) {
        window.location.href = url;
        return true;
      }

      const opened = window.open(url, "_blank");
      if (opened) {
        try {
          opened.opener = null;
        } catch {
          /* noop — some browsers restrict cross-origin opener mutation */
        }
        return true;
      }
      window.location.href = url;
      return true;
    },
    [clearFallback, clearListeners],
  );


  const connect = async () => {
    if (!userId || starting) return;
    setStarting(true);
    setLaunchBlocked(false);
    try {
      const result = await createTelegramLink();
      const web = result.botStartUrl ?? botStartUrl;
      const app = result.botAppUrl;
      if (!web && !app) throw new Error("The Telegram bot link is unavailable right now.");
      setRequestId(result.requestId);
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

  const connectedName = connection
    ? connection.telegram_username
      ? `@${connection.telegram_username}`
      : connection.first_name || `Telegram user ${connection.telegram_user_id}`
    : null;

  const pending = linkState === "pending";
  const manualUrl = isMobileDevice()
    ? (launchUrls.app ?? launchUrls.web)
    : (launchUrls.web ?? launchUrls.app);


  return (
    <Card className="cartel-panel">
      <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
        <CardTitle className="text-base">Telegram connection</CardTitle>
        {configQuery.isLoading ? (
          <StatusBadge tone="muted">Checking bot…</StatusBadge>
        ) : botConfigured ? (
          <StatusBadge tone="green">Bot configured</StatusBadge>
        ) : (
          <StatusBadge tone="red">Bot not configured</StatusBadge>
        )}
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {configQuery.isError ? (
          <p className="rounded-md border border-signal/40 bg-signal/5 p-3 text-xs text-signal">
            The Telegram service could not be reached. Nothing was changed — retry in a moment.
          </p>
        ) : null}

        {!configQuery.isLoading && !botConfigured ? (
          <div className="rounded-md border border-signal/40 bg-signal/5 p-3 text-xs leading-relaxed text-signal">
            <p className="font-semibold">Telegram bot not configured</p>
            <p className="mt-1 text-muted-foreground">
              {config?.reason ?? "The CARTEL HQ bot token is not present on the server."}{" "}
              Add <code className="font-mono">TELEGRAM_BOT_TOKEN</code> to the Supabase Edge
              Function secrets for this project, then re-check. The token is only ever read
              server-side and is never entered or stored in this browser.
            </p>
          </div>
        ) : null}

        {botConfigured ? (
          <p className="text-xs text-muted-foreground">
            Bot: <span className="font-mono text-foreground">@{botUsername ?? "PepeCartelHQBot"}</span>
          </p>
        ) : null}

        {connection ? (
          <div className="rounded-md border border-border/60 bg-background/40 p-3">
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-sm font-semibold text-foreground">Connected as {connectedName}</p>
              <StatusBadge tone="green">Telegram linked</StatusBadge>
            </div>
            <p className="mt-1 font-mono text-xs text-muted-foreground">
              ID {connection.telegram_user_id}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              This Telegram account will own the published sticker set.
            </p>
          </div>
        ) : (
          <p className="text-xs leading-relaxed text-muted-foreground">
            We’ll open @{botUsername ?? "PepeCartelHQBot"}. Tap <strong>Start</strong> in Telegram,
            then return here. CARTEL HQ links your account automatically.
          </p>
        )}

        {pending ? (
          <div className="rounded-md border border-gold/40 bg-gold/5 p-3 text-xs text-muted-foreground">
            <p className="flex items-center gap-2 font-semibold text-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              Waiting for Telegram…
            </p>
            <p className="mt-1">
              Telegram opened. Tap <strong>Start</strong> in @{botUsername ?? "PepeCartelHQBot"},
              then return here. CARTEL HQ will connect automatically.{" "}
              {launchBlocked ? "If Telegram did not open, use Open Telegram below." : null}{" "}
              {remaining > 0
                ? `This one-time link expires in ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}.`
                : "This one-time link is about to expire."}
            </p>
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
            Connection link expired. Try Connect Telegram again.
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            className="min-h-11"
            disabled={!userId || starting || pending || !botConfigured}
            onClick={() => void connect()}
          >
            {starting || pending ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : connection ? (
              <ExternalLink className="size-4" aria-hidden="true" />
            ) : (
              <Send className="size-4" aria-hidden="true" />
            )}
            {connection ? "Reconnect Telegram" : "Connect Telegram"}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            disabled={configQuery.isFetching}
            onClick={() => void configQuery.refetch()}
          >
            Re-check bot status
          </Button>
          {connection ? null : <StatusBadge tone="muted">Not connected</StatusBadge>}
        </div>

        {!compact ? (
          <p className="text-xs text-muted-foreground">
            Publishing uses the official CARTEL HQ bot server-side. The bot token never reaches this
            browser and CARTEL HQ never calls the Telegram API from your device.
          </p>
        ) : null}
        {requestId ? <span className="sr-only">Link request {requestId}</span> : null}
      </CardContent>
    </Card>
  );
}
