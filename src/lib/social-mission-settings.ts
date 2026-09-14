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

export const MILESTONE_LABELS: Record<MissionMilestoneType, string> = {
  NONE: "No milestone",
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
  /** SE-6: the saved tier preset applied to the next mission, if any. */
  active_preset_id: string | null;
};

/** The stored defaults, used when a workspace has never saved a row. */
export function defaultMissionSettings(workspaceId: string): MissionSettings {
  return {
    workspace_id: workspaceId,
    default_preset: "STANDARD",
    live_metrics_enabled: true,
    link_finder_enabled: true,
    delete_command_after_send: true,
    // SE-6: pinning is opt-in.
    auto_pin_mission: false,
    milestone_type: "NONE",
    milestone_target: null,
    active_preset_id: null,
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
    auto_pin_mission: row["auto_pin_mission"] === true,
    milestone_type: (MILESTONE_TYPES as readonly string[]).includes(milestone)
      ? (milestone as MissionMilestoneType)
      : base.milestone_type,
    milestone_target: typeof target === "number" && Number.isFinite(target) ? target : null,
    active_preset_id:
      typeof row["active_preset_id"] === "string" ? (row["active_preset_id"] as string) : null,
  };

}

/** The exact constraint the database enforces, mirrored for the form. */
export function validateMissionSettings(settings: MissionSettings): string | null {
  if (!(MISSION_PRESETS as readonly string[]).includes(settings.default_preset)) {
    return "Choose a valid mission preset.";
  }
  if (settings.milestone_type === "NONE") {
    return settings.milestone_target === null ? null : "Turn the milestone on to set a target.";
  }
  if (
    settings.milestone_target === null ||
    !Number.isInteger(settings.milestone_target) ||
    settings.milestone_target <= 0
  ) {
    return "A milestone needs a whole target number above zero.";
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
          active_preset_id: settings.active_preset_id,
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

/* -------------------------------------------------------------------------
 * SE-6 — saved tier presets (requirement 6).
 *
 * A preset is a reusable, workspace-scoped bundle of Tier 1..Tier 10 targets
 * plus the pulse step sizes and an optional mission code. It never starts,
 * closes or mutates a mission: it only describes the defaults the NEXT mission
 * snapshots at launch. RLS (member SELECT, operator write) remains the
 * security boundary; the flags below are UI affordances only.
 * ------------------------------------------------------------------------- */

const PRESET_TABLE = "social_mission_presets";

export const TIER_COUNT = 10;

export type MissionTierTarget = {
  tier: number;
  views: number | null;
  likes: number | null;
  shares: number | null;
  comments: number | null;
};

export type MissionPulseDeltas = {
  views: number;
  likes: number;
  shares: number;
  comments: number;
};

/** Frozen SE-6 pulse defaults: +100 views, +10 likes, +5 reposts, +5 replies. */
export const DEFAULT_PULSE_DELTAS: MissionPulseDeltas = {
  views: 100,
  likes: 10,
  shares: 5,
  comments: 5,
};

export const DEFAULT_TIER_TARGETS: readonly MissionTierTarget[] = [
  { tier: 1, views: 250, likes: 10, shares: 3, comments: 3 },
  { tier: 2, views: 1_000, likes: 30, shares: 10, comments: 8 },
  { tier: 3, views: 2_500, likes: 75, shares: 25, comments: 15 },
  { tier: 4, views: 5_000, likes: 150, shares: 50, comments: 25 },
  { tier: 5, views: 10_000, likes: 300, shares: 100, comments: 40 },
  { tier: 6, views: 25_000, likes: 700, shares: 200, comments: 75 },
  { tier: 7, views: 50_000, likes: 1_500, shares: 400, comments: 120 },
  { tier: 8, views: 100_000, likes: 3_000, shares: 800, comments: 200 },
  { tier: 9, views: 250_000, likes: 6_000, shares: 2_000, comments: 500 },
  { tier: 10, views: 500_000, likes: 12_000, shares: 4_000, comments: 1_000 },
];

export type MissionTierPreset = {
  id: string;
  workspace_id: string;
  name: string;
  base_preset: MissionPreset;
  mission_code: string | null;
  tier_targets: MissionTierTarget[];
  pulse_deltas: MissionPulseDeltas;
  is_default: boolean;
};

function positiveOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

function positiveOr(value: unknown, fallback: number): number {
  return positiveOrNull(value) ?? fallback;
}

/** A missing or malformed tier stays "not part of the bundle", never zero. */
export function normalizeTierTargets(raw: unknown): MissionTierTarget[] {
  const rows = Array.isArray(raw) ? (raw as Record<string, unknown>[]) : [];
  const byTier = new Map<number, Record<string, unknown>>();
  for (const row of rows) {
    const tier = Number(row?.["tier"]);
    if (Number.isInteger(tier) && tier >= 1 && tier <= TIER_COUNT) byTier.set(tier, row);
  }
  const normalized: MissionTierTarget[] = [];
  for (let tier = 1; tier <= TIER_COUNT; tier += 1) {
    const row = byTier.get(tier);
    normalized.push({
      tier,
      views: positiveOrNull(row?.["views"]),
      likes: positiveOrNull(row?.["likes"]),
      shares: positiveOrNull(row?.["shares"]),
      comments: positiveOrNull(row?.["comments"]),
    });
  }
  return normalized;
}


export function normalizePulseDeltas(raw: unknown): MissionPulseDeltas {
  const row = (raw ?? {}) as Record<string, unknown>;
  return {
    views: positiveOr(row["views"], DEFAULT_PULSE_DELTAS.views),
    likes: positiveOr(row["likes"], DEFAULT_PULSE_DELTAS.likes),
    shares: positiveOr(row["shares"], DEFAULT_PULSE_DELTAS.shares),
    comments: positiveOr(row["comments"], DEFAULT_PULSE_DELTAS.comments),
  };
}

function normalizePreset(row: Record<string, unknown>): MissionTierPreset {
  const base = String(row["base_preset"] ?? "");
  const code = row["mission_code"];
  return {
    id: String(row["id"] ?? ""),
    workspace_id: String(row["workspace_id"] ?? ""),
    name: String(row["name"] ?? "Untitled preset"),
    base_preset: (MISSION_PRESETS as readonly string[]).includes(base)
      ? (base as MissionPreset)
      : "STANDARD",
    mission_code: typeof code === "string" && code.trim() ? code.trim() : null,
    tier_targets: normalizeTierTargets(row["tier_targets"]),
    pulse_deltas: normalizePulseDeltas(row["pulse_deltas"]),
    is_default: row["is_default"] === true,
  };
}

/** A brand-new, unsaved bundle seeded from the SE-6 defaults. */
export function blankTierPreset(workspaceId: string): MissionTierPreset {
  return {
    id: "",
    workspace_id: workspaceId,
    name: "",
    base_preset: "STANDARD",
    mission_code: null,
    tier_targets: DEFAULT_TIER_TARGETS.map((target) => ({ ...target })),
    pulse_deltas: { ...DEFAULT_PULSE_DELTAS },
    is_default: false,
  };
}

/** Compact chips, e.g. "T1 250 views" — skips tiers with nothing set. */
export function tierSummaryChips(preset: MissionTierPreset): string[] {
  return preset.tier_targets
    .filter((t) => t.views !== null || t.likes !== null || t.shares !== null || t.comments !== null)
    .map((t) => {
      const parts: string[] = [];
      if (t.views !== null) parts.push(`${t.views.toLocaleString()} views`);
      if (t.likes !== null) parts.push(`${t.likes.toLocaleString()} likes`);
      if (t.shares !== null) parts.push(`${t.shares.toLocaleString()} reposts`);
      if (t.comments !== null) parts.push(`${t.comments.toLocaleString()} replies`);
      return `T${t.tier} · ${parts.join(" · ")}`;
    });
}

export function validateTierPreset(preset: MissionTierPreset): string | null {
  if (!preset.name.trim()) return "Give the preset a name.";
  if (preset.name.trim().length > 60) return "Keep the preset name under 60 characters.";
  if (preset.mission_code && preset.mission_code.trim().length > 32) {
    return "Keep the mission code under 32 characters.";
  }
  const used = preset.tier_targets.filter(
    (t) => t.views !== null || t.likes !== null || t.shares !== null || t.comments !== null,
  );
  if (used.length === 0) return "Set a target on at least one tier.";
  return null;
}

export const missionPresetKeys = {
  list: (workspaceId: string | null) =>
    ["social-mission-presets", workspaceId ?? "none"] as const,
};

export function useMissionTierPresets(workspaceId: string | null) {
  return useQuery({
    queryKey: missionPresetKeys.list(workspaceId),
    enabled: !!workspaceId,
    staleTime: 30_000,
    queryFn: async (): Promise<MissionTierPreset[]> => {
      const { data, error } = await untyped
        .from(PRESET_TABLE)
        .select("*")
        .eq("workspace_id", workspaceId!)
        .order("name", { ascending: true });
      if (error) throw error;
      return ((data ?? []) as Record<string, unknown>[]).map(normalizePreset);
    },
  });
}

export function useSaveMissionTierPreset(workspaceId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (preset: MissionTierPreset) => {
      if (!workspaceId) throw new Error("No active workspace is selected.");
      const invalid = validateTierPreset(preset);
      if (invalid) throw new Error(invalid);
      const payload = {
        workspace_id: workspaceId,
        name: preset.name.trim(),
        base_preset: preset.base_preset,
        mission_code: preset.mission_code?.trim() || null,
        tier_targets: preset.tier_targets,
        pulse_deltas: preset.pulse_deltas,
      };
      const query = preset.id
        ? untyped.from(PRESET_TABLE).update(payload).eq("id", preset.id).eq("workspace_id", workspaceId)
        : untyped.from(PRESET_TABLE).insert(payload);
      const { error } = await query;
      if (error) throw error;
      return preset;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: missionPresetKeys.list(workspaceId) });
    },
  });
}
