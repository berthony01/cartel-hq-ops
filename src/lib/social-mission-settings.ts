import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

/**
 * SE-5 — workspace-scoped Social Mission settings (read for members, write for
 * owner/admin only).
 *
 * Scope guarantees:
 * - This module touches EXACTLY ONE table, `social_mission_settings`, always
 *   filtered to the caller's active workspace. Authorization is enforced by the
 *   installed RLS policies (member SELECT, operator INSERT/UPDATE); the UI gate
 *   below is convenience only and is never the security boundary.
 * - It performs NO provider call, NO Telegram call, NO polling and NO service
 *   role access, and it never reads or writes mission rows. Mission creation and
 *   closing remain Telegram-only.
 * - The settings row is a DEFAULT for FUTURE missions. A running mission keeps
 *   the effective configuration snapshotted on it at launch; changing settings
 *   never rewrites a mission already in flight.
 *
 * The table is newer than the committed generated Supabase types, so reads and
 * writes go through an untyped client handle rather than editing generated types.
 */

const untyped = supabase as unknown as SupabaseClient;
const TABLE = "social_mission_settings";

export const MISSION_PRESETS = ["STANDARD", "QUICK", "MAJOR_ANNOUNCEMENT", "LAUNCH"] as const;
export type MissionPreset = (typeof MISSION_PRESETS)[number];

export const MILESTONE_TYPES = [
  "NONE",
  "VIEWS",
  "LIKES",
  "REPLIES",
  "REPOSTS",
  "TOTAL_INTERACTIONS",
] as const;
export type MissionMilestoneType = (typeof MILESTONE_TYPES)[number];

/** Display-only mirror of `public.social_mission_preset_config`. */
export const MISSION_PRESET_SHAPE: Record<
  MissionPreset,
  { label: string; durationMinutes: number; pulseOffsets: number[] }
> = {
  STANDARD: { label: "Standard", durationMinutes: 45, pulseOffsets: [3, 8, 15, 25, 35] },
  QUICK: { label: "Quick", durationMinutes: 20, pulseOffsets: [2, 5, 10, 15] },
  MAJOR_ANNOUNCEMENT: {
    label: "Major announcement",
    durationMinutes: 120,
    pulseOffsets: [5, 15, 30, 60, 90],
  },
  LAUNCH: { label: "Launch", durationMinutes: 60, pulseOffsets: [3, 8, 15, 30, 45] },
};

/** SE-13 — user-facing Primary Goal labels. The stored keys are unchanged. */
export const MILESTONE_LABELS: Record<MissionMilestoneType, string> = {
  NONE: "No goal",
  VIEWS: "Views",
  LIKES: "Likes",
  REPLIES: "Replies",
  REPOSTS: "Reposts",
  TOTAL_INTERACTIONS: "Total interactions",
};

export type MissionSettings = {
  workspace_id: string;
  default_preset: MissionPreset;
  live_metrics_enabled: boolean;
  link_finder_enabled: boolean;
  delete_command_after_send: boolean;
  auto_pin_mission: boolean;
  milestone_type: MissionMilestoneType;
  milestone_target: number | null;
};

/** The stored defaults, used when a workspace has never saved a row. */
export function defaultMissionSettings(workspaceId: string): MissionSettings {
  return {
    workspace_id: workspaceId,
    default_preset: "STANDARD",
    live_metrics_enabled: true,
    link_finder_enabled: true,
    delete_command_after_send: true,
    auto_pin_mission: true,
    milestone_type: "NONE",
    milestone_target: null,
  };
}

function normalize(workspaceId: string, row: Record<string, unknown> | null): MissionSettings {
  const base = defaultMissionSettings(workspaceId);
  if (!row) return base;
  const preset = String(row["default_preset"] ?? "");
  const milestone = String(row["milestone_type"] ?? "");
  const target = row["milestone_target"];
  return {
    workspace_id: workspaceId,
    default_preset: (MISSION_PRESETS as readonly string[]).includes(preset)
      ? (preset as MissionPreset)
      : base.default_preset,
    live_metrics_enabled: row["live_metrics_enabled"] !== false,
    link_finder_enabled: row["link_finder_enabled"] !== false,
    delete_command_after_send: row["delete_command_after_send"] !== false,
    auto_pin_mission: row["auto_pin_mission"] !== false,
    milestone_type: (MILESTONE_TYPES as readonly string[]).includes(milestone)
      ? (milestone as MissionMilestoneType)
      : base.milestone_type,
    milestone_target: typeof target === "number" && Number.isFinite(target) ? target : null,
  };
}

/** The exact constraint the database enforces, mirrored for the form. */
export function validateMissionSettings(settings: MissionSettings): string | null {
  if (!(MISSION_PRESETS as readonly string[]).includes(settings.default_preset)) {
    return "Choose a valid mission preset.";
  }
  if (settings.milestone_type === "NONE") {
    return settings.milestone_target === null ? null : "Turn the Primary Goal on to set a target.";
  }
  if (
    settings.milestone_target === null ||
    !Number.isInteger(settings.milestone_target) ||
    settings.milestone_target <= 0
  ) {
    return "A Primary Goal needs a whole target number above zero.";
  }
  return null;
}

export const missionSettingsKeys = {
  workspace: (workspaceId: string | null) =>
    ["social-mission-settings", workspaceId ?? "none"] as const,
  operator: (workspaceId: string | null) =>
    ["social-mission-settings", "operator", workspaceId ?? "none"] as const,
};

export async function fetchMissionSettings(workspaceId: string): Promise<MissionSettings> {
  const { data, error } = await untyped
    .from(TABLE)
    .select("*")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) throw error;
  return normalize(workspaceId, (data as Record<string, unknown> | null) ?? null);
}

export function useMissionSettings(workspaceId: string | null) {
  return useQuery({
    queryKey: missionSettingsKeys.workspace(workspaceId),
    enabled: !!workspaceId,
    queryFn: () => fetchMissionSettings(workspaceId!),
    staleTime: 30_000,
  });
}

/** UI affordance only. The database still refuses a non-operator write. */
export function useIsWorkspaceOperator(workspaceId: string | null) {
  return useQuery({
    queryKey: missionSettingsKeys.operator(workspaceId),
    enabled: !!workspaceId,
    staleTime: 60_000,
    queryFn: async () => {
      const { data: session } = await supabase.auth.getUser();
      const userId = session.user?.id;
      if (!userId) return false;
      const { data, error } = await supabase.rpc("is_workspace_operator", {
        _workspace_id: workspaceId!,
        _user_id: userId,
      });
      if (error) throw error;
      return data === true;
    },
  });
}

export function useSaveMissionSettings(workspaceId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (settings: MissionSettings) => {
      if (!workspaceId) throw new Error("No active workspace is selected.");
      const invalid = validateMissionSettings(settings);
      if (invalid) throw new Error(invalid);
      const { error } = await untyped.from(TABLE).upsert(
        {
          workspace_id: workspaceId,
          default_preset: settings.default_preset,
          live_metrics_enabled: settings.live_metrics_enabled,
          link_finder_enabled: settings.link_finder_enabled,
          delete_command_after_send: settings.delete_command_after_send,
          auto_pin_mission: settings.auto_pin_mission,
          milestone_type: settings.milestone_type,
          milestone_target: settings.milestone_type === "NONE" ? null : settings.milestone_target,
        },
        { onConflict: "workspace_id" },
      );
      if (error) throw error;
      return settings;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: missionSettingsKeys.workspace(workspaceId),
      });
    },
  });
}
