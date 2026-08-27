import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ExternalLink, Loader2, Send } from "lucide-react";

import { useSession } from "@/hooks/useSession";
import {
  fetchTelegramConfig,
  loadTelegramConnection,
  saveTelegramConnection,
  telegramErrorMessage,
  type TelegramConfig,
  type TelegramConnection,
} from "@/lib/telegram-stickers";
import { StatusBadge } from "@/components/cartel/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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

export function TelegramConnectionCard({
  setup,
  compact = false,
}: {
  setup: ReturnType<typeof useTelegramSetup>;
  compact?: boolean;
}) {
  const queryClient = useQueryClient();
  const { userId, configQuery, connection, botConfigured, botUsername, botStartUrl, config } = setup;
  const [ownerId, setOwnerId] = useState("");
  const [username, setUsername] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (connection) {
      setOwnerId(String(connection.telegram_user_id));
      setUsername(connection.telegram_username ?? "");
    }
  }, [connection]);

  const save = async () => {
    if (!userId) return;
    const numeric = Number(ownerId.trim());
    if (!Number.isInteger(numeric) || numeric <= 0) {
      toast.error("Enter your numeric Telegram user ID (digits only, e.g. 123456789).");
      return;
    }
    setSaving(true);
    try {
      const saved: TelegramConnection = await saveTelegramConnection({
        userId,
        telegramUserId: numeric,
        telegramUsername: username,
      });
      queryClient.setQueryData(["telegram-connection", userId], saved);
      toast.success("Telegram owner connection saved to your account.");
    } catch (err) {
      toast.error(telegramErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

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
              {config?.reason ??
                "The CARTEL HQ bot token is not present on the server."}{" "}
              Add <code className="font-mono">TELEGRAM_BOT_TOKEN</code> to the Supabase Edge
              Function secrets for this project, then re-check. The token is only ever read
              server-side and is never entered or stored in this browser.
            </p>
          </div>
        ) : null}

        {botConfigured ? (
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-xs text-muted-foreground">
              Bot:{" "}
              <span className="font-mono text-foreground">@{botUsername ?? "cartel-hq-bot"}</span>
            </p>
            {botStartUrl ? (
              <Button asChild size="sm" variant="outline" className="min-h-10">
                <a href={botStartUrl} target="_blank" rel="noreferrer noopener">
                  <ExternalLink className="size-4" aria-hidden="true" />
                  Open bot in Telegram
                </a>
              </Button>
            ) : null}
            <p className="text-xs text-muted-foreground">
              Tap <strong>Start</strong> in the bot chat before sending a test sticker.
            </p>
          </div>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="tg-owner-id" className="text-xs">
              Telegram numeric user ID (required)
            </Label>
            <Input
              id="tg-owner-id"
              inputMode="numeric"
              className="mt-1.5 min-h-10"
              placeholder="123456789"
              value={ownerId}
              onChange={(e) => setOwnerId(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="tg-username" className="text-xs">
              Telegram username (optional)
            </Label>
            <Input
              id="tg-username"
              className="mt-1.5 min-h-10"
              placeholder="pepecartel"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          This numeric Telegram user ID will <strong>own</strong> the published sticker set. Use
          your own account ID — sets cannot be transferred later. A username alone is not enough.
        </p>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" className="min-h-11" disabled={saving || !userId} onClick={() => void save()}>
            {saving ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Send className="size-4" aria-hidden="true" />}
            Save Telegram connection
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
          {connection ? (
            <StatusBadge tone="green">Owner ID connected</StatusBadge>
          ) : (
            <StatusBadge tone="muted">No owner ID saved</StatusBadge>
          )}
        </div>

        {!compact ? (
          <p className="text-xs text-muted-foreground">
            Publishing uses the official CARTEL HQ bot server-side. The bot token never reaches this
            browser and CARTEL HQ never calls the Telegram API from your device.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
