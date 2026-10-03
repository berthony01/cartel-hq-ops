/**
 * MC-GL — `/missioncontrol` group launcher flow (runtime-neutral, no Deno/npm
 * imports) so the exact production flow is testable with controlled doubles.
 *
 * Groups cannot carry `web_app` buttons, so the launcher is a normal URL button
 * to the configured direct link (Main Mini App `https://t.me/<bot>` or named app
 * `https://t.me/<bot>/<short_name>`) with `startapp=mc_<connection UUID>`. The
 * link is never guessed: missing/invalid config withholds the button. The
 * payload is a routing hint only — the Mini App re-proves operator scope and a
 * live admin check in this exact chat, so a copied link grants nothing.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CLOSE_TOKEN_RE = /^[A-Za-z0-9_-]{22,64}$/;

export const MISSION_CONTROL_GROUP_TEXT =
  "🛠 <b>MISSION CONTROL</b>\n\nOpen this community's missions in the CARTEL HQ Mini App. Only this group's current admins who operate the project can manage it — the button grants no access by itself.";
export const MISSION_CONTROL_NOT_CONNECTED_TEXT =
  "🛠 <b>MISSION CONTROL</b>\n\nThis group is not connected to a CARTEL HQ project yet, or the bot has lost its admin rights here.";
export const MISSION_CONTROL_UNAVAILABLE_TEXT =
  "🛠 <b>MISSION CONTROL</b>\n\nThe Mission Control app link is not available right now. Use /mission manage to open Mission Control in a private chat with the bot.";
export const MISSION_CONTROL_ADMIN_ONLY_TEXT =
  "Mission Control is available to this group's administrators only.";

/** Once setup commits a mission, legacy Ignore must not resolve the candidate. */
export function candidateIgnoreAllowed(setupMissionId: unknown): boolean {
  return setupMissionId === null || setupMissionId === undefined || setupMissionId === "";
}

/** `/missioncontrol` or `/missioncontrol@<this bot>`; a foreign suffix is ignored. */
export function isMissionControlCommand(text: string, botUsername: string): boolean {
  const match = String(text ?? "").match(/^\/missioncontrol(?:@(\w+))?\s*$/i);
  return !!match && (!match[1] || match[1].toLowerCase() === botUsername.toLowerCase());
}

export function buildMissionControlDirectLink(
  configured: string,
  connectionId: string,
  botUsername: string,
  closeToken?: string | null,
): string | null {
  if (!UUID_RE.test(connectionId)) return null;
  if (closeToken != null && !CLOSE_TOKEN_RE.test(closeToken)) return null;
  const raw = String(configured ?? "").trim().replace(/\/+$/, "");
  const match = raw.match(/^https:\/\/t\.me\/([A-Za-z0-9_]{5,32})(?:\/([A-Za-z0-9_]{3,30}))?$/);
  if (!match || match[1]!.toLowerCase() !== botUsername.toLowerCase()) return null;
  const url = new URL(raw);
  const payload = closeToken
    ? `mc_${connectionId.toLowerCase()}_${closeToken}`
    : `mc_${connectionId.toLowerCase()}`;
  url.search = new URLSearchParams({ startapp: payload }).toString();
  return url.toString();
}

/** Candidate-scoped setup route. Candidate and connection are routing hints only. */
export function buildMissionSetupDirectLink(
  configured: string,
  candidateId: string,
  connectionId: string,
  botUsername: string,
  closeToken?: string | null,
): string | null {
  if (!UUID_RE.test(candidateId) || !UUID_RE.test(connectionId)) return null;
  if (closeToken != null && !CLOSE_TOKEN_RE.test(closeToken)) return null;
  const raw = String(configured ?? "").trim().replace(/\/+$/, "");
  const match = raw.match(/^https:\/\/t\.me\/([A-Za-z0-9_]{5,32})(?:\/([A-Za-z0-9_]{3,30}))?$/);
  if (!match || match[1]!.toLowerCase() !== botUsername.toLowerCase()) return null;
  const url = new URL(raw);
  const payload = `ms_${candidateId.toLowerCase()}_${connectionId.toLowerCase()}${closeToken ? `_${closeToken}` : ""}`;
  url.search = new URLSearchParams({ startapp: payload }).toString();
  return url.toString();
}

/**
 * Bot present and admin. `bot_can_change_info` (chat title/photo permission) is
 * a community-branding readiness signal, not a Mission Control requirement.
 */
export function missionControlConnectionOperational(row: unknown): boolean {
  const r = (row ?? {}) as { bot_is_admin?: unknown; metadata?: unknown };
  if (r.bot_is_admin !== true) return false;
  const meta = (r.metadata ?? {}) as Record<string, unknown>;
  return !meta["bot_removed_at"];
}

export type LauncherDeps = {
  botUsername: string;
  configuredLink: string;
  /** Anonymous admin proven by same-group sender_chat. */
  anonymousAdmin: boolean;
  /** Live getChatMember status for the sender; may throw. */
  getSenderStatus: () => Promise<string>;
  /** telegram_group_connections rows for this exact chat (caller limits to 2). */
  findConnections: () => Promise<{ rows: unknown[]; error: unknown }>;
  /** Plain bot reply. */
  sendText: (text: string) => Promise<unknown>;
  /** Launcher post with a single URL button; truthy only when Telegram confirmed it. */
  sendLauncher: (text: string, url: string) => Promise<unknown>;
  /** Optional durable close binding. Null safely preserves the legacy link. */
  prepareCloseBinding?: (connectionId: string) => Promise<{ token: string; bindingId: string } | null>;
  /** Attaches the exact confirmed launcher message to the prepared binding. */
  confirmCloseBinding?: (bindingId: string, messageId: number) => Promise<boolean>;
  /** Invalidates an unconfirmed prepared binding. */
  abandonCloseBinding?: (bindingId: string) => Promise<void>;
  /** Deletes exactly the original command message. */
  deleteCommand: (messageId: number) => Promise<unknown>;
  sourceMessageId: unknown;
  log?: (line: string) => void;
};

export type LauncherOutcome =
  | "refused_not_admin"
  | "not_connected"
  | "link_unavailable"
  | "launcher_failed"
  | "launcher_sent";

export async function runMissionControlGroupLauncher(deps: LauncherDeps): Promise<LauncherOutcome> {
  let isAdmin = deps.anonymousAdmin;
  if (!isAdmin) {
    try {
      const status = await deps.getSenderStatus();
      isAdmin = status === "administrator" || status === "creator";
    } catch {
      isAdmin = false;
    }
  }
  if (!isAdmin) {
    await deps.sendText(MISSION_CONTROL_ADMIN_ONLY_TEXT);
    return "refused_not_admin";
  }

  // Exact, still-operational connection for THIS chat; ambiguity fails closed.
  let connectionId: string | null = null;
  try {
    const { rows, error } = await deps.findConnections();
    const list = !error && Array.isArray(rows) ? rows : [];
    if (list.length === 1 && missionControlConnectionOperational(list[0])) {
      connectionId = String((list[0] as { id?: unknown }).id ?? "");
    }
  } catch {
    connectionId = null;
  }
  if (!connectionId) {
    await deps.sendText(MISSION_CONTROL_NOT_CONNECTED_TEXT);
    return "not_connected";
  }

  let closeBinding: { token: string; bindingId: string } | null = null;
  try {
    closeBinding = (await deps.prepareCloseBinding?.(connectionId)) ?? null;
  } catch {
    closeBinding = null;
  }
  const link = buildMissionControlDirectLink(
    deps.configuredLink,
    connectionId,
    deps.botUsername,
    closeBinding?.token,
  );
  if (!link) {
    if (closeBinding) await deps.abandonCloseBinding?.(closeBinding.bindingId).catch(() => undefined);
    deps.log?.("[MC-GL] MISSION_CONTROL_MINIAPP_LINK missing or invalid; launcher withheld");
    await deps.sendText(MISSION_CONTROL_UNAVAILABLE_TEXT);
    return "link_unavailable";
  }

  let sent: unknown = null;
  try {
    sent = await deps.sendLauncher(MISSION_CONTROL_GROUP_TEXT, link);
  } catch {
    if (closeBinding) await deps.abandonCloseBinding?.(closeBinding.bindingId).catch(() => undefined);
    return "launcher_failed";
  }
  const launcherMessageId = Number((sent as { message_id?: unknown } | null)?.message_id);
  if (!sent) {
    if (closeBinding) await deps.abandonCloseBinding?.(closeBinding.bindingId).catch(() => undefined);
    return "launcher_failed";
  }
  if (closeBinding) {
    const confirmed = Number.isFinite(launcherMessageId) && launcherMessageId > 0
      ? await deps.confirmCloseBinding?.(closeBinding.bindingId, launcherMessageId).catch(() => false)
      : false;
    if (!confirmed) await deps.abandonCloseBinding?.(closeBinding.bindingId).catch(() => undefined);
  }
  // Only the exact original command, and only after the launcher was confirmed.
  const messageId = Number(deps.sourceMessageId);
  if (Number.isFinite(messageId) && messageId > 0) {
    try {
      await deps.deleteCommand(messageId);
    } catch (error) {
      deps.log?.(`[MC-GL] missioncontrol command cleanup failed: ${String((error as Error)?.message ?? "unknown").slice(0, 200)}`);
    }
  }
  return "launcher_sent";
}
