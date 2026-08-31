import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

/**
 * Phase 7A — My Watchlist read layer.
 *
 * Both reads go through authenticated-only SECURITY DEFINER RPCs that derive
 * the caller from `auth.uid()` alone. There are NO direct reads of
 * `launch_watch_subscriptions` or `telegram_connections`, and the RPCs never
 * return Telegram user ids, subscription ids, user ids or workspace ids.
 */

type Fns = Database["public"]["Functions"];

export type MyWatchlistState = Fns["get_my_launch_watchlist_state"]["Returns"][number];
export type MyWatchlistItem = Fns["get_my_launch_watchlist"]["Returns"][number];

export const watchlistKeys = {
  state: () => ["my-watchlist", "state"] as const,
  list: () => ["my-watchlist", "list"] as const,
};

export async function fetchMyWatchlistState(): Promise<MyWatchlistState> {
  const { data, error } = await supabase.rpc("get_my_launch_watchlist_state");
  if (error) throw error;
  return data?.[0] ?? { telegram_connected: false, active_watch_count: 0 };
}

export async function fetchMyWatchlist(): Promise<MyWatchlistItem[]> {
  const { data, error } = await supabase.rpc("get_my_launch_watchlist");
  if (error) throw error;
  return data ?? [];
}

export const WATCHLIST_COPY = {
  readOnly:
    "This view is read-only. Countdown and Stop Watching controls stay in your private Launch Watch message in Telegram.",
  privacy:
    "Only your own Launch Watch opt-ins are shown here. CARTEL HQ never shows other watchers or their identities.",
} as const;
