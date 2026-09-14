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
  defaultMissionSettings,
  useIsWorkspaceOperator,
  useMissionSettings,
  useSaveMissionSettings,
  validateMissionSettings,
  type MissionMilestoneType,
  type MissionPreset,
  type MissionSettings,
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
