import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Target } from "lucide-react";
import { toast } from "sonner";

import { Section } from "@/components/cartel/Section";
import { StatusBadge } from "@/components/cartel/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useWorkspace } from "@/lib/workspace-context";
import {
  MILESTONE_LABELS,
  MILESTONE_TYPES,
  MISSION_PRESETS,
  MISSION_PRESET_SHAPE,
  validateMissionSettings,
  type MissionMilestoneType,
  type MissionPreset,
} from "@/lib/social-mission-settings";
import {
  getPartnerMissionState,
  partnerMissionErrorMessage,
  partnerMissionKeys,
  savePartnerMissionSettings,
  type PartnerMission,
  type PartnerMissionSettings,
} from "@/lib/partner-missions";

/**
 * SP-B6 V1 — partner Missions: read-only history + FUTURE mission defaults.
 * No start, close, end, cancel, resurface, Mission Control or X-connect controls.
 */

const fmt = (v: number | null | undefined) => (typeof v === "number" ? v.toLocaleString() : "—");
const when = (v: string | null | undefined) => (v ? new Date(v).toLocaleString() : "—");

function Toggle({ id, label, checked, onChange }: { id: string; label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-4">
      <Label htmlFor={id} className="text-sm">{label}</Label>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

function DefaultsEditor({ workspaceId, initial }: { workspaceId: string; initial: PartnerMissionSettings }) {
  const qc = useQueryClient();
  const [s, setS] = useState<PartnerMissionSettings>(initial);
  useEffect(() => setS(initial), [initial]);
  const invalid = validateMissionSettings({ ...s, workspace_id: workspaceId });
  const save = useMutation({
    mutationFn: () => savePartnerMissionSettings(workspaceId, s),
    onSuccess: () => {
      toast.success("Future mission defaults saved.");
      void qc.invalidateQueries({ queryKey: partnerMissionKeys.state(workspaceId) });
    },
    onError: (e) => toast.error(partnerMissionErrorMessage(e)),
  });
  return (
    <Section title="Future Mission Defaults" description="These defaults apply only to missions started after you save. Missions already running keep their own settings.">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label>Mission preset</Label>
          <Select value={s.default_preset} onValueChange={(v) => setS({ ...s, default_preset: v as MissionPreset })}>
            <SelectTrigger className="min-h-11"><SelectValue /></SelectTrigger>
            <SelectContent>
              {MISSION_PRESETS.map((p) => (
                <SelectItem key={p} value={p}>{MISSION_PRESET_SHAPE[p].label} — {MISSION_PRESET_SHAPE[p].durationMinutes} min</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label>Primary Goal</Label>
            <Select
              value={s.milestone_type}
              onValueChange={(v) => setS({ ...s, milestone_type: v as MissionMilestoneType, milestone_target: v === "NONE" ? null : s.milestone_target })}
            >
              <SelectTrigger className="min-h-11"><SelectValue /></SelectTrigger>
              <SelectContent>
                {MILESTONE_TYPES.map((m) => <SelectItem key={m} value={m}>{MILESTONE_LABELS[m]}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="pm-target">Goal target</Label>
            <Input
              id="pm-target"
              className="min-h-11"
              inputMode="numeric"
              disabled={s.milestone_type === "NONE"}
              value={s.milestone_target ?? ""}
              onChange={(e) => {
                const raw = e.target.value.trim();
                setS({ ...s, milestone_target: raw === "" ? null : Number(raw) });
              }}
            />
          </div>
        </div>
        <Toggle id="pm-live" label="Live metrics on the mission card" checked={s.live_metrics_enabled} onChange={(v) => setS({ ...s, live_metrics_enabled: v })} />
        <Toggle id="pm-finder" label="Offer to start a mission when an official X link is posted" checked={s.link_finder_enabled} onChange={(v) => setS({ ...s, link_finder_enabled: v })} />
        <Toggle id="pm-delete" label="Remove the /mission command after the card is sent" checked={s.delete_command_after_send} onChange={(v) => setS({ ...s, delete_command_after_send: v })} />
        <Toggle id="pm-pin" label="Pin the mission card" checked={s.auto_pin_mission} onChange={(v) => setS({ ...s, auto_pin_mission: v })} />
        {invalid ? <p className="text-sm text-destructive">{invalid}</p> : null}
        <Button className="min-h-11 self-start" disabled={!!invalid || save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Save defaults
        </Button>
      </div>
    </Section>
  );
}

function MissionCard({ m }: { m: PartnerMission }) {
  const metrics = m.latest_metrics;
  return (
    <div className="flex min-w-0 flex-col gap-3 rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{m.author_handle ? `@${m.author_handle}` : "X post"}</p>
          {m.canonical_url ? (
            <a href={m.canonical_url} target="_blank" rel="noreferrer noopener" className="block truncate text-xs text-primary underline-offset-2 hover:underline">
              {m.canonical_url}
            </a>
          ) : null}
        </div>
        <StatusBadge tone={m.status === "LIVE" ? "success" : "neutral"}>{m.status}</StatusBadge>
      </div>
      <dl className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-5">
        {(["views", "likes", "replies", "reposts", "bookmarks"] as const).map((k) => (
          <div key={k}><dt className="capitalize text-muted-foreground">{k}</dt><dd className="font-medium">{fmt(metrics?.[k])}</dd></div>
        ))}
      </dl>
      <p className="text-xs text-muted-foreground">
        Started {when(m.started_at)} · Ends {when(m.ends_at)}
        {m.goal.milestone_type !== "NONE" ? ` · Goal: ${fmt(m.goal.milestone_target)} ${m.goal.milestone_type.toLowerCase().replace("_", " ")}` : ""}
        {m.accomplished_at ? " · Goal reached" : ""}
      </p>
      {m.targets.length ? (
        <p className="text-xs text-muted-foreground">Groups: {m.targets.map((t) => t.group_title ?? "Community").join(", ")}</p>
      ) : null}
      {m.timeline.length ? (
        <details className="text-xs">
          <summary className="min-h-11 cursor-pointer py-3 text-muted-foreground">Timeline ({m.timeline.length})</summary>
          <ul className="flex flex-col gap-1">
            {m.timeline.map((e, i) => (
              <li key={i} className="flex justify-between gap-2">
                <span>{e.event_type} #{e.sequence_no}</span>
                <span className="text-muted-foreground">{e.state} · {when(e.finished_at ?? e.due_at)}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

export function PartnerMissionsPanel() {
  const { workspace } = useWorkspace();
  const workspaceId = workspace?.id ?? null;
  const q = useQuery({
    queryKey: partnerMissionKeys.state(workspaceId),
    enabled: !!workspaceId,
    queryFn: () => getPartnerMissionState(workspaceId!),
  });
  if (!workspaceId) return null;
  if (q.isLoading) return <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading missions…</div>;
  if (q.error) return <p className="text-sm text-destructive">{partnerMissionErrorMessage(q.error)}</p>;
  const data = q.data!;
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <DefaultsEditor workspaceId={workspaceId} initial={data.settings} />
      <Section title="Mission history" description="Missions are started and closed by the project team in Telegram. You can review results here.">
        {data.missions.length === 0 ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground"><Target className="h-4 w-4" /> No missions yet.</div>
        ) : (
          <div className="flex flex-col gap-3">{data.missions.map((m) => <MissionCard key={m.id} m={m} />)}</div>
        )}
      </Section>
    </div>
  );
}
