import { supabase } from "@/integrations/supabase/client";
import type { MissionMilestoneType, MissionPreset } from "@/lib/social-mission-settings";

/**
 * SP-B6 V1 — Service Partner missions: read-only history + FUTURE defaults.
 *
 * Both calls go through scope-checked partner_* RPCs. No Telegram ids, message
 * ids, provider payloads or secrets reach here. Mission start, close, end,
 * resurface and Mission Control are NOT available to partners.
 */

export const partnerMissionKeys = {
  state: (workspaceId: string | null) => ["partner-missions", "state", workspaceId] as const,
};

export type PartnerMissionSettings = {
  default_preset: MissionPreset;
  live_metrics_enabled: boolean;
  link_finder_enabled: boolean;
  delete_command_after_send: boolean;
  auto_pin_mission: boolean;
  milestone_type: MissionMilestoneType;
  milestone_target: number | null;
  saved?: boolean;
};

export type PartnerMission = {
  id: string;
  status: string;
  canonical_url: string | null;
  author_handle: string | null;
  created_at: string;
  started_at: string | null;
  ends_at: string | null;
  completed_at: string | null;
  accomplished_at: string | null;
  goal: { preset: string | null; duration_minutes: number | null; milestone_type: string; milestone_target: number | null };
  latest_metrics: {
    views: number | null; likes: number | null; replies: number | null;
    reposts: number | null; bookmarks: number | null; observed_at: string;
  } | null;
  targets: Array<{ group_connection_id: string | null; group_title: string | null; delivery_state: string | null; sent_at: string | null }>;
  timeline: Array<{ event_type: string; sequence_no: number; state: string; due_at: string; finished_at: string | null }>;
};

export type PartnerMissionState = { settings: PartnerMissionSettings; missions: PartnerMission[] };

type LooseRpc = (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { message?: string } | null }>;
const rpc: LooseRpc = (fn, args) => (supabase.rpc.bind(supabase) as unknown as LooseRpc)(fn, args);

export async function getPartnerMissionState(workspaceId: string): Promise<PartnerMissionState> {
  const { data, error } = await rpc("partner_list_mission_state", { _workspace_id: workspaceId });
  if (error) throw new Error(error.message ?? "error");
  const d = (data ?? {}) as Partial<PartnerMissionState>;
  return { settings: d.settings as PartnerMissionSettings, missions: d.missions ?? [] };
}

export async function savePartnerMissionSettings(workspaceId: string, settings: PartnerMissionSettings) {
  const { data, error } = await rpc("partner_save_mission_settings", {
    _workspace_id: workspaceId,
    _settings: {
      default_preset: settings.default_preset,
      live_metrics_enabled: settings.live_metrics_enabled,
      link_finder_enabled: settings.link_finder_enabled,
      delete_command_after_send: settings.delete_command_after_send,
      auto_pin_mission: settings.auto_pin_mission,
      milestone_type: settings.milestone_type,
      milestone_target: settings.milestone_type === "NONE" ? null : settings.milestone_target,
    },
  });
  if (error) throw new Error(error.message ?? "error");
  return data as { saved: boolean; settings: PartnerMissionSettings };
}

const ERRORS: Record<string, string> = {
  "Not authorized": "Your access to this project does not include missions.",
  PROJECT_IDENTITY_REQUIRED: "The project owner needs to finish the Project Profile first.",
  INVALID_PRESET: "Choose a valid mission preset.",
  INVALID_MILESTONE_TYPE: "Choose a valid Primary Goal.",
  INVALID_MILESTONE_TARGET: "A Primary Goal needs a whole target number above zero.",
  INVALID_TOGGLE: "Mission settings are incomplete. Reload and try again.",
  INVALID_SETTINGS: "Mission settings are incomplete. Reload and try again.",
};

export function partnerMissionErrorMessage(e: unknown): string {
  const msg = (e as { message?: string })?.message ?? "";
  for (const [k, v] of Object.entries(ERRORS)) if (msg.includes(k)) return v;
  return "Something went wrong. Try again.";
}
