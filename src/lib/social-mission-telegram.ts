import { supabase } from "@/integrations/supabase/client";

/**
 * SE-3 — thin client for the authenticated Edge Function
 * `social-mission-telegram`.
 *
 * The browser never renders mission copy, never sees the bot token and never
 * writes transport state: every send/edit decision, the card text and the
 * SENT / FAILED / AMBIGUOUS classification are server-owned.
 */

export type MissionDeliveryState = "PENDING" | "SENDING" | "SENT" | "FAILED" | "AMBIGUOUS";
export type MissionEditState = "IDLE" | "EDITING" | "EDITED" | "FAILED" | "AMBIGUOUS";

export type SendMissionCardResult = {
  deliveryState: MissionDeliveryState;
  telegramMessageId?: number | null;
  sentAt?: string | null;
  duplicate?: boolean;
  message?: string;
};

export type EditMissionCardResult = {
  editState: MissionEditState;
  editRevision?: number;
  lastEditAt?: string | null;
  duplicate?: boolean;
  message?: string;
};

async function readServerMessage(ctx: unknown): Promise<string | null> {
  const context = (ctx as { context?: { json?: () => Promise<unknown> } })?.context;
  if (!context || typeof context.json !== "function") return null;
  try {
    const body = (await context.json()) as { message?: unknown; error?: unknown } | null;
    const msg = body?.error ?? body?.message;
    return typeof msg === "string" && msg.trim() ? msg.trim() : null;
  } catch {
    return null;
  }
}

async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("social-mission-telegram", { body });
  if (error) {
    const serverMessage = await readServerMessage(error);
    throw new Error(
      serverMessage || error.message || "The mission transport service is unavailable right now.",
    );
  }
  const payload = data as (T & { error?: string }) | null;
  if (!payload) throw new Error("Empty response from the mission transport service.");
  if (payload.error) throw new Error(payload.error);
  return payload as T;
}

/** Sends the server-rendered mission card once into one connected community. */
export function sendMissionCard(params: {
  workspaceId: string;
  missionId: string;
  targetId: string;
  clientRequestId: string;
}): Promise<SendMissionCardResult> {
  return invoke<SendMissionCardResult>({
    action: "send_mission",
    workspaceId: params.workspaceId,
    missionId: params.missionId,
    targetId: params.targetId,
    clientRequestId: params.clientRequestId,
  });
}

/** Edits the already-sent mission card in place. Never sends a replacement. */
export function editMissionCard(params: {
  workspaceId: string;
  missionId: string;
  targetId: string;
  clientRequestId: string;
  revision: number;
}): Promise<EditMissionCardResult> {
  return invoke<EditMissionCardResult>({
    action: "edit_mission",
    workspaceId: params.workspaceId,
    missionId: params.missionId,
    targetId: params.targetId,
    clientRequestId: params.clientRequestId,
    revision: params.revision,
  });
}
