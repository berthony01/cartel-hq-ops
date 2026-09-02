import { supabase } from "@/integrations/supabase/client";

/**
 * C7.3C — Project Inbox browser API.
 *
 * SINGLE wrapper for every Inbox read/write the UI performs. All access goes
 * through privacy-safe authenticated SECURITY DEFINER RPCs — the browser
 * NEVER queries the Inbox tables directly (`project_inbox_*`,
 * `project_conversations`, `project_conversation_messages`,
 * `telegram_inbound_updates`, `telegram_team_sessions` have zero browser
 * policies by design).
 *
 * Privacy contract: the team sees only the opaque `member_ref`. No Telegram
 * user id / chat id / message id / username and no `contact_id` ever reach
 * this layer — the RPC return shapes do not contain them.
 */

// ---------------------------------------------------------------------------
// Domain constants
// ---------------------------------------------------------------------------

export const CONVERSATION_STATUSES = [
  "OPEN",
  "WAITING_ON_TEAM",
  "WAITING_ON_MEMBER",
  "RESOLVED",
] as const;

export type ConversationStatus = (typeof CONVERSATION_STATUSES)[number];

export const CONVERSATION_STATUS_LABELS: Record<ConversationStatus, string> = {
  OPEN: "Open",
  WAITING_ON_TEAM: "Needs reply",
  WAITING_ON_MEMBER: "Waiting on member",
  RESOLVED: "Resolved",
};

export function isConversationStatus(value: string): value is ConversationStatus {
  return (CONVERSATION_STATUSES as readonly string[]).includes(value);
}

export function conversationStatusLabel(value: string): string {
  return isConversationStatus(value) ? CONVERSATION_STATUS_LABELS[value] : value;
}

const CATEGORY_LABELS: Record<string, string> = {
  SECURITY: "Security",
  LAUNCH: "Launch",
  VERIFY: "Verification",
  TECHNICAL: "Technical",
  GENERAL: "General",
  PARTNERSHIP: "Partnership",
};

export function conversationCategoryLabel(value: string): string {
  return CATEGORY_LABELS[value] ?? value;
}

const ORIGIN_TYPE_LABELS: Record<string, string> = {
  LAUNCH_DELIVERY: "Reply to a launch notification",
  LAUNCH_CONFIRMATION: "Reply to a Launch Watch confirmation",
  MEMBER_INITIATED: "Member initiated",
  COMMUNITY_BROADCAST: "Community broadcast",
};

export function conversationOriginLabel(value: string): string {
  return ORIGIN_TYPE_LABELS[value] ?? value;
}

// ---------------------------------------------------------------------------
// Result types (nullable-honest; NO Telegram identifiers, NO contact_id)
// ---------------------------------------------------------------------------

export type ProjectInboxSettings = {
  workspace_id: string;
  replies_enabled: boolean;
  new_conversations_enabled: boolean;
  security_warning_version: string;
  updated_at: string | null;
};

export type ProjectInboxSummary = {
  open_count: number;
  waiting_on_team_count: number;
  waiting_on_member_count: number;
  resolved_count: number;
  blocked_contact_count: number;
};

export type ProjectInboxConversationListItem = {
  conversation_id: string;
  member_ref: string;
  contact_status: string;
  category: string;
  status: string;
  priority: string;
  origin_type: string;
  origin_title_snapshot: string | null;
  latest_message_preview: string | null;
  last_message_at: string;
  opened_at: string;
  assigned_to: string | null;
  assigned_display_name: string | null;
};

export type ProjectInboxConversationDetail = {
  conversation_id: string;
  member_ref: string;
  contact_status: string;
  category: string;
  status: string;
  priority: string;
  origin_type: string;
  origin_title_snapshot: string | null;
  origin_text_snapshot: string | null;
  last_message_at: string;
  opened_at: string;
  resolved_at: string | null;
  assigned_to: string | null;
  assigned_display_name: string | null;
};

export type ProjectConversationMessage = {
  message_id: string;
  author_type: string; // MEMBER | TEAM | SYSTEM
  channel: string; // TELEGRAM | WEB | SYSTEM
  body: string;
  team_display_name: string | null;
  created_at: string;
  reply_to_message_id: string | null;
};

export type ProjectConversationStatusResult = {
  conversation_id: string;
  status: string;
  resolved_at: string | null;
  updated_at: string;
};

export type ProjectInboxConversationBlockResult = {
  conversation_id: string;
  member_ref: string;
  contact_status: string;
  blocked_at: string | null;
};

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------

export const projectInboxKeys = {
  all: ["project-inbox"] as const,
  settings: (workspaceId: string | null) => ["project-inbox", "settings", workspaceId] as const,
  summary: (workspaceId: string | null) => ["project-inbox", "summary", workspaceId] as const,
  /** Root key covering every status filter for one workspace. */
  conversationsRoot: (workspaceId: string | null) =>
    ["project-inbox", "conversations", workspaceId] as const,
  conversations: (workspaceId: string | null, status: ConversationStatus | null) =>
    ["project-inbox", "conversations", workspaceId, status ?? "ALL"] as const,
  conversation: (workspaceId: string | null, conversationId: string | null) =>
    ["project-inbox", "conversation", workspaceId, conversationId] as const,
  messages: (workspaceId: string | null, conversationId: string | null) =>
    ["project-inbox", "messages", workspaceId, conversationId] as const,
};

// ---------------------------------------------------------------------------
// Normalization helpers
// ---------------------------------------------------------------------------

function oneRow<T>(data: unknown, what: string): T {
  const row = Array.isArray(data) ? data[0] : data;
  if (row == null) {
    throw new Error(`${what}: the server returned no row.`);
  }
  return row as T;
}

function manyRows<T>(data: unknown): T[] {
  if (data == null) return [];
  return (Array.isArray(data) ? data : [data]) as T[];
}

// ---------------------------------------------------------------------------
// RPC wrappers
// ---------------------------------------------------------------------------

export async function getProjectInboxSettings(
  workspaceId: string,
): Promise<ProjectInboxSettings> {
  const { data, error } = await supabase.rpc("get_project_inbox_settings", {
    _workspace_id: workspaceId,
  });
  if (error) throw error;
  return oneRow<ProjectInboxSettings>(data, "Inbox settings");
}

/**
 * Enables/disables reply capture ONLY. `new_conversations_enabled` is passed
 * through UNCHANGED from the caller-supplied current value so this UI can
 * never enable or reset it accidentally. Callers must pass the value from the
 * most recent server-returned settings row.
 */
export async function setProjectInboxRepliesEnabled(
  workspaceId: string,
  repliesEnabled: boolean,
  currentNewConversationsEnabled: boolean,
): Promise<ProjectInboxSettings> {
  const { data, error } = await supabase.rpc("set_project_inbox_settings", {
    _workspace_id: workspaceId,
    _replies_enabled: repliesEnabled,
    _new_conversations_enabled: currentNewConversationsEnabled,
  });
  if (error) throw error;
  return oneRow<ProjectInboxSettings>(data, "Inbox settings update");
}

export async function getProjectInboxSummary(
  workspaceId: string,
): Promise<ProjectInboxSummary> {
  const { data, error } = await supabase.rpc("get_project_inbox_summary", {
    _workspace_id: workspaceId,
  });
  if (error) throw error;
  return oneRow<ProjectInboxSummary>(data, "Inbox summary");
}

export async function listProjectInboxConversations(
  workspaceId: string,
  status: ConversationStatus | null,
  limit = 100,
): Promise<ProjectInboxConversationListItem[]> {
  // Omitting `_status` entirely lets the SQL default (NULL = all statuses)
  // apply; explicit `undefined` is rejected under exactOptionalPropertyTypes.
  const args: { _workspace_id: string; _limit: number; _status?: string } = {
    _workspace_id: workspaceId,
    _limit: Math.min(Math.max(limit, 1), 100),
  };
  if (status) {
    args._status = status;
  }
  const { data, error } = await supabase.rpc("list_project_inbox_conversations", args);
  if (error) throw error;
  return manyRows<ProjectInboxConversationListItem>(data);
}

/**
 * Workspace-bound detail: the server authorizes the caller against the
 * supplied ACTIVE workspace FIRST, then resolves the conversation only with
 * `id AND workspace_id`. A stale selection from another workspace fails
 * closed with a generic error instead of rendering.
 */
export async function getProjectInboxConversation(
  workspaceId: string,
  conversationId: string,
): Promise<ProjectInboxConversationDetail> {
  const { data, error } = await supabase.rpc("get_project_inbox_conversation", {
    _workspace_id: workspaceId,
    _conversation_id: conversationId,
  });
  if (error) throw error;
  return oneRow<ProjectInboxConversationDetail>(data, "Conversation");
}

export async function listProjectConversationMessages(
  conversationId: string,
  limit = 200,
): Promise<ProjectConversationMessage[]> {
  const { data, error } = await supabase.rpc("list_project_conversation_messages", {
    _conversation_id: conversationId,
    _limit: Math.min(Math.max(limit, 1), 200),
  });
  if (error) throw error;
  return manyRows<ProjectConversationMessage>(data);
}

export async function updateProjectConversationStatus(
  conversationId: string,
  status: ConversationStatus,
): Promise<ProjectConversationStatusResult> {
  const { data, error } = await supabase.rpc("update_project_conversation_status", {
    _conversation_id: conversationId,
    _status: status,
  });
  if (error) throw error;
  return oneRow<ProjectConversationStatusResult>(data, "Conversation status update");
}

/**
 * Workspace-bound block/unblock: the server authorizes the caller against the
 * supplied ACTIVE workspace FIRST and resolves the contact only from a
 * conversation matching `id AND workspace_id`. Wrong workspace fails closed.
 */
export async function setProjectInboxConversationBlocked(
  workspaceId: string,
  conversationId: string,
  blocked: boolean,
): Promise<ProjectInboxConversationBlockResult> {
  const { data, error } = await supabase.rpc(
    "set_project_inbox_conversation_contact_blocked",
    {
      _workspace_id: workspaceId,
      _conversation_id: conversationId,
      _blocked: blocked,
    },
  );
  if (error) throw error;
  return oneRow<ProjectInboxConversationBlockResult>(data, "Member block update");
}
