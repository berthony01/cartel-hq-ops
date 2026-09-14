import { useEffect, useState } from "react";
import { Loader2, Settings2 } from "lucide-react";
import { Section } from "@/components/cartel/Section";
import { StatusBadge } from "@/components/cartel/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  MILESTONE_LABELS,
  MILESTONE_TYPES,
  MISSION_PRESETS,
  MISSION_PRESET_SHAPE,
  TIER_COUNT,
  blankTierPreset,
  defaultMissionSettings,
  tierSummaryChips,
  useIsWorkspaceOperator,
  useMissionSettings,
  useMissionTierPresets,
  useSaveMissionSettings,
  useSaveMissionTierPreset,
  validateMissionSettings,
  validateTierPreset,
  type MissionMilestoneType,
  type MissionPreset,
  type MissionSettings,
  type MissionTierPreset,
} from "@/lib/social-mission-settings";


/**
 * SE-5 — workspace mission defaults. Owner/admin can edit; other members see
 * the same values read-only. These are defaults for FUTURE missions only: a
 * mission already running keeps the configuration snapshotted at its launch.
 */

function ToggleRow({
  id,
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  checked: boolean;
  disabled: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex min-w-0 items-start justify-between gap-3 rounded-md border border-border/50 bg-background/30 px-3 py-2.5">
      <div className="min-w-0">
        <Label htmlFor={id} className="text-xs text-foreground">
          {label}
        </Label>
        <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{hint}</p>
      </div>
      <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onChange} />
    </div>
  );
}

export function MissionSettingsCard({ workspaceId }: { workspaceId: string | null }) {
  const settingsQuery = useMissionSettings(workspaceId);
  const operatorQuery = useIsWorkspaceOperator(workspaceId);
  const save = useSaveMissionSettings(workspaceId);
  const canEdit = operatorQuery.data === true;

  // SE-6 saved tier presets (requirement 6).
  const presetsQuery = useMissionTierPresets(workspaceId);
  const savePreset = useSaveMissionTierPreset(workspaceId);
  const [presetDraft, setPresetDraft] = useState<MissionTierPreset | null>(null);
  const [presetSaved, setPresetSaved] = useState(false);

  const [draft, setDraft] = useState<MissionSettings | null>(null);
  useEffect(() => {
    if (settingsQuery.data) setDraft(settingsQuery.data);
  }, [settingsQuery.data]);


  const current = draft ?? (workspaceId ? defaultMissionSettings(workspaceId) : null);
  if (!current) return null;

  const patch = (next: Partial<MissionSettings>) =>
    setDraft({ ...current, ...next } as MissionSettings);

  const shape = MISSION_PRESET_SHAPE[current.default_preset];
  const invalid = validateMissionSettings(current);

  const onSave = () => {
    save.mutate(current, {
      onSuccess: () => toast.success("Mission defaults saved."),
      onError: (error) =>
        toast.error(
          error instanceof Error ? error.message : "The mission defaults could not be saved.",
        ),
    });
  };

  const presets = presetsQuery.data ?? [];
  const editingPreset = presetDraft;
  const presetInvalid = editingPreset ? validateTierPreset(editingPreset) : null;

  const onSelectPreset = (value: string) => {
    setPresetSaved(false);
    if (value === "none") {
      patch({ active_preset_id: null });
      setPresetDraft(null);
      return;
    }
    if (value === "new") {
      setPresetDraft(workspaceId ? blankTierPreset(workspaceId) : null);
      return;
    }
    const found = presets.find((preset) => preset.id === value);
    patch({ active_preset_id: value });
    setPresetDraft(found ? { ...found } : null);
  };

  const onSavePreset = () => {
    if (!editingPreset) return;
    savePreset.mutate(editingPreset, {
      // SE-6 correction (F): use the PERSISTED row returned by the database, so
      // a brand new preset immediately carries its real id and becomes the
      // selected preset. It only reaches the next Telegram mission once the
      // mission defaults below are saved with it.
      onSuccess: (saved) => {
        setPresetDraft({ ...saved });
        patch({ active_preset_id: saved.id });
        setPresetSaved(true);
        toast.success("Preset saved. Save mission defaults to use it for the next mission.");
      },

      onError: (error) =>
        toast.error(error instanceof Error ? error.message : "The preset could not be saved."),
    });
  };


  return (
    <Section
      variant="surface"
      title="Mission defaults"
      leading={<Settings2 className="size-4" aria-hidden="true" />}
      description="Applied to the next mission you start in Telegram. A mission already running keeps the settings it launched with."
      actions={<StatusBadge tone={canEdit ? "gold" : "muted"}>{canEdit ? "Editable" : "Read-only"}</StatusBadge>}
    >
      {settingsQuery.isPending ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="size-4 animate-spin text-gold" aria-hidden="true" />
          Loading mission defaults…
        </p>
      ) : settingsQuery.isError ? (
        <p className="text-xs text-muted-foreground">
          Mission defaults could not be loaded right now. Nothing has been changed.
        </p>
      ) : (
        <div className="flex min-w-0 flex-col gap-3">
          <div className="grid min-w-0 gap-3 sm:grid-cols-2">
            <div className="min-w-0">
              <Label className="type-eyebrow text-muted-foreground">Mission length</Label>
              <Select
                value={current.default_preset}
                disabled={!canEdit}
                onValueChange={(value) => patch({ default_preset: value as MissionPreset })}
              >
                <SelectTrigger className="mt-1.5 min-h-11">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MISSION_PRESETS.map((preset) => (
                    <SelectItem key={preset} value={preset}>
                      {MISSION_PRESET_SHAPE[preset].label} ·{" "}
                      {MISSION_PRESET_SHAPE[preset].durationMinutes} min
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                {shape.durationMinutes} minutes · reminders at {shape.pulseOffsets.join(", ")} min
              </p>
            </div>

            <div className="min-w-0">
              <Label className="type-eyebrow text-muted-foreground">Milestone</Label>
              <Select
                value={current.milestone_type}
                disabled={!canEdit}
                onValueChange={(value) =>
                  patch({
                    milestone_type: value as MissionMilestoneType,
                    milestone_target: value === "NONE" ? null : (current.milestone_target ?? 100),
                  })
                }
              >
                <SelectTrigger className="mt-1.5 min-h-11">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MILESTONE_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>
                      {MILESTONE_LABELS[type]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {current.milestone_type !== "NONE" ? (
                <Input
                  type="number"
                  min={1}
                  step={1}
                  inputMode="numeric"
                  className="mt-2 min-h-11"
                  aria-label="Milestone target"
                  value={current.milestone_target ?? ""}
                  disabled={!canEdit}
                  onChange={(event) => {
                    const parsed = Number.parseInt(event.target.value, 10);
                    patch({ milestone_target: Number.isFinite(parsed) ? parsed : null });
                  }}
                />
              ) : null}
            </div>
          </div>

          {/* SE-6 — saved target presets. Read-only for non-operators. */}
          <div className="min-w-0 rounded-md border border-border/50 bg-background/30 px-3 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Label className="type-eyebrow text-muted-foreground">Saved preset</Label>
              {presetSaved ? <StatusBadge tone="gold">Saved</StatusBadge> : null}
            </div>
            <Select
              value={editingPreset && !editingPreset.id ? "new" : (current.active_preset_id ?? "none")}
              disabled={!canEdit}
              onValueChange={onSelectPreset}
            >
              <SelectTrigger className="mt-1.5 min-h-11">
                <SelectValue placeholder="No preset" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No preset</SelectItem>
                {presets.map((preset) => (
                  <SelectItem key={preset.id} value={preset.id}>
                    {preset.name}
                    {preset.mission_code ? ` · ${preset.mission_code}` : ""}
                  </SelectItem>
                ))}
                {canEdit ? <SelectItem value="new">Create a new preset…</SelectItem> : null}
              </SelectContent>
            </Select>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              Tier 1 to Tier {TIER_COUNT} targets applied to the next mission you start. A mission
              already running keeps the targets it launched with.
            </p>

            {editingPreset ? (
              <div className="mt-3 flex min-w-0 flex-col gap-2">
                <div className="grid min-w-0 gap-2 sm:grid-cols-2">
                  <Input
                    className="min-h-11"
                    aria-label="Preset name"
                    placeholder="Preset name"
                    value={editingPreset.name}
                    disabled={!canEdit}
                    onChange={(event) => {
                      setPresetSaved(false);
                      setPresetDraft({ ...editingPreset, name: event.target.value });
                    }}
                  />
                  <Input
                    className="min-h-11"
                    aria-label="Mission code (optional)"
                    placeholder="Mission code (optional)"
                    value={editingPreset.mission_code ?? ""}
                    disabled={!canEdit}
                    onChange={(event) => {
                      setPresetSaved(false);
                      setPresetDraft({
                        ...editingPreset,
                        mission_code: event.target.value || null,
                      });
                    }}
                  />
                </div>

                <div className="flex min-w-0 flex-col gap-1.5">
                  {editingPreset.tier_targets.map((target, index) => (
                    <div key={target.tier} className="flex min-w-0 items-center gap-2">
                      <span className="w-10 shrink-0 text-[11px] text-muted-foreground">
                        T{target.tier}
                      </span>
                      {(["views", "likes", "shares", "comments"] as const).map((metric) => (
                        <Input
                          key={metric}
                          type="number"
                          min={1}
                          step={1}
                          inputMode="numeric"
                          className="min-h-10 min-w-0 flex-1"
                          aria-label={`Tier ${target.tier} ${metric}`}
                          placeholder={metric}
                          value={target[metric] ?? ""}
                          disabled={!canEdit}
                          onChange={(event) => {
                            const parsed = Number.parseInt(event.target.value, 10);
                            const next = editingPreset.tier_targets.map((row, rowIndex) =>
                              rowIndex === index
                                ? { ...row, [metric]: Number.isFinite(parsed) ? parsed : null }
                                : row,
                            );
                            setPresetSaved(false);
                            setPresetDraft({ ...editingPreset, tier_targets: next });
                          }}
                        />
                      ))}
                    </div>
                  ))}
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {tierSummaryChips(editingPreset).map((chip) => (
                    <span
                      key={chip}
                      className="rounded-full border border-border/60 px-2 py-0.5 text-[10px] text-muted-foreground"
                    >
                      {chip}
                    </span>
                  ))}
                </div>

                {canEdit ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      className="min-h-11"
                      disabled={!!presetInvalid || savePreset.isPending}
                      onClick={onSavePreset}
                    >
                      {savePreset.isPending ? "Saving…" : "Save preset"}
                    </Button>
                    {presetInvalid ? (
                      <span className="text-xs text-muted-foreground">{presetInvalid}</span>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>



          <ToggleRow
            id="mission-live-metrics"
            label="Live results on the mission card"
            hint="Updates the same card in place while the mission runs. Unknown numbers stay blank, never zero."
            checked={current.live_metrics_enabled}
            disabled={!canEdit}
            onChange={(value) => patch({ live_metrics_enabled: value })}
          />
          <ToggleRow
            id="mission-link-finder"
            label="Suggest missions for official posts"
            hint="When a member shares one of your official X posts, admins get a private Start or Ignore prompt. It never starts on its own."
            checked={current.link_finder_enabled}
            disabled={!canEdit}
            onChange={(value) => patch({ link_finder_enabled: value })}
          />
          <ToggleRow
            id="mission-delete-command"
            label="Tidy up the command message"
            hint="Removes the typed /mission message once the card is confirmed sent. Member posts are never deleted."
            checked={current.delete_command_after_send}
            disabled={!canEdit}
            onChange={(value) => patch({ delete_command_after_send: value })}
          />
          <ToggleRow
            id="mission-auto-pin"
            label="Pin the mission card"
            hint="Pins the card while the mission runs and unpins it at the end. Only cards pinned by CARTEL HQ are unpinned."
            checked={current.auto_pin_mission}
            disabled={!canEdit}
            onChange={(value) => patch({ auto_pin_mission: value })}
          />

          {canEdit ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                className="min-h-11"
                disabled={!!invalid || save.isPending}
                onClick={onSave}
              >
                {save.isPending ? "Saving…" : "Save defaults"}
              </Button>
              {invalid ? <span className="text-xs text-muted-foreground">{invalid}</span> : null}
            </div>
          ) : (
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Only a workspace owner or admin can change these defaults.
            </p>
          )}
        </div>
      )}
    </Section>
  );
}
