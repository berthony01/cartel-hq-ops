import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Sticker } from "lucide-react";
import { toast } from "sonner";

import { Section } from "@/components/cartel/Section";
import { StatusBadge } from "@/components/cartel/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useWorkspace } from "@/lib/workspace-context";
import {
  DROP_DAILY_CAP_MAX,
  DROP_DAILY_CAP_MIN,
  DROP_INTERVAL_MAX,
  DROP_INTERVAL_MIN,
  deletePartnerDropSchedule,
  getPartnerDropState,
  listPartnerDropPacks,
  partnerStickerDropErrorMessage,
  partnerStickerDropKeys,
  savePartnerDropSchedule,
  setPartnerDropScheduleEnabled,
} from "@/lib/partner-sticker-drops";

type Draft = {
  interval: string;
  cap: string;
  timezone: string;
  activeStart: string;
  activeEnd: string;
  silent: boolean;
  noImmediateRepeat: boolean;
  packId: string;
  selected: string[];
};

const DEFAULT_DRAFT: Draft = { interval: "60", cap: "8", timezone: "UTC", activeStart: "08:00", activeEnd: "23:00", silent: true, noImmediateRepeat: true, packId: "", selected: [] };
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function validTz(tz: string) {
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }).format(new Date()); return true; } catch { return false; }
}

type Confirm = { kind: "enable" | "disable" | "delete"; scheduleId: string } | null;

/**
 * SP-B5 V1 — Service Partner Sticker Drops. Uses only partner_* reads and the
 * existing server schedule actions. Labels and emoji only: no images, no AI,
 * no pack publishing/upload, no test send and no kill-switch control.
 */
export function PartnerStickerDropsPanel() {
  const { workspaceId, workspace } = useWorkspace();
  const qc = useQueryClient();
  const [groupId, setGroupId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(DEFAULT_DRAFT);
  const [confirm, setConfirm] = useState<Confirm>(null);

  const packsQ = useQuery({ queryKey: partnerStickerDropKeys.packs(workspaceId), queryFn: () => listPartnerDropPacks(workspaceId as string), enabled: !!workspaceId });
  const stateQ = useQuery({ queryKey: partnerStickerDropKeys.state(workspaceId), queryFn: () => getPartnerDropState(workspaceId as string), enabled: !!workspaceId });
  const packs = useMemo(() => packsQ.data ?? [], [packsQ.data]);
  const groups = useMemo(() => stateQ.data?.groups ?? [], [stateQ.data]);
  const schedules = useMemo(() => stateQ.data?.schedules ?? [], [stateQ.data]);

  useEffect(() => {
    if (groups.length === 0) return;
    if (!groupId || !groups.some((g) => g.group_connection_id === groupId)) {
      const next = groups.find((g) => g.operational) ?? groups[0];
      if (next) setGroupId(next.group_connection_id);
    }
  }, [groups, groupId]);

  const selectedGroup = groups.find((g) => g.group_connection_id === groupId) ?? null;
  const schedule = schedules.find((s) => s.group_connection_id === groupId) ?? null;

  useEffect(() => {
    if (schedule) {
      setDraft({
        interval: String(schedule.interval_minutes),
        cap: String(schedule.daily_cap),
        timezone: schedule.timezone,
        activeStart: schedule.active_start,
        activeEnd: schedule.active_end,
        silent: schedule.silent,
        noImmediateRepeat: schedule.no_immediate_repeat,
        packId: schedule.pack_id,
        selected: schedule.selected_sticker_ids ?? [],
      });
    } else {
      setDraft({ ...DEFAULT_DRAFT, packId: packs[0]?.pack_id ?? "" });
    }
  }, [schedule, packs]);

  const pack = packs.find((p) => p.pack_id === draft.packId) ?? null;
  const interval = Number(draft.interval);
  const cap = Number(draft.cap);
  const intervalOk = Number.isInteger(interval) && interval >= DROP_INTERVAL_MIN && interval <= DROP_INTERVAL_MAX;
  const capOk = Number.isInteger(cap) && cap >= DROP_DAILY_CAP_MIN && cap <= DROP_DAILY_CAP_MAX;
  const tzOk = validTz(draft.timezone);
  const hoursOk = TIME_RE.test(draft.activeStart) && TIME_RE.test(draft.activeEnd);
  const canSave = !!groupId && !!pack && intervalOk && capOk && tzOk && hoursOk;

  const refresh = () => void qc.invalidateQueries({ queryKey: partnerStickerDropKeys.all });

  const save = useMutation({
    mutationFn: () =>
      savePartnerDropSchedule(workspaceId as string, {
        scheduleId: schedule?.id ?? null,
        groupConnectionId: groupId as string,
        packId: draft.packId,
        intervalMinutes: interval,
        timezone: draft.timezone,
        activeStart: draft.activeStart,
        activeEnd: draft.activeEnd,
        dailyCap: cap,
        silent: draft.silent,
        noImmediateRepeat: draft.noImmediateRepeat,
        selectedStickerIds: draft.selected.filter((id) => pack?.stickers.some((s) => s.sticker_id === id)),
      }),
    onSuccess: () => { toast.success(schedule ? "Schedule updated." : "Schedule saved. It stays off until you turn it on."); refresh(); },
    onError: (e) => toast.error(partnerStickerDropErrorMessage(e)),
  });

  const act = useMutation({
    mutationFn: async (c: NonNullable<Confirm>) => {
      if (c.kind === "delete") return deletePartnerDropSchedule(workspaceId as string, c.scheduleId);
      return setPartnerDropScheduleEnabled(workspaceId as string, c.scheduleId, c.kind === "enable");
    },
    onSuccess: (_r, c) => { setConfirm(null); toast.success(c.kind === "delete" ? "Schedule deleted." : c.kind === "enable" ? "Sticker Drops turned on." : "Sticker Drops turned off."); refresh(); },
    onError: (e) => { setConfirm(null); toast.error(partnerStickerDropErrorMessage(e)); },
  });

  const loadError = packsQ.error ?? stateQ.error;
  if (loadError) {
    return (
      <Section variant="primary" title="Sticker Drops" leading={<Sticker className="size-4" aria-hidden="true" />}>
        <p className="text-sm text-muted-foreground">{partnerStickerDropErrorMessage(loadError)}</p>
      </Section>
    );
  }
  const loading = packsQ.isLoading || stateQ.isLoading;
  const toggle = (id: string) => setDraft((d) => ({ ...d, selected: d.selected.includes(id) ? d.selected.filter((x) => x !== id) : [...d.selected, id] }));

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <Section
        variant="primary"
        title="Sticker Drops"
        leading={<Sticker className="size-4" aria-hidden="true" />}
        description={`Schedule ${workspace?.name ?? "the client"}'s published stickers into its connected Telegram communities.`}
      >
        {loading ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" aria-hidden="true" /> Loading Sticker Drops…</p>
        ) : groups.length === 0 ? (
          <p className="text-sm text-muted-foreground">No Telegram community is connected yet. The project owner connects communities.</p>
        ) : packs.length === 0 ? (
          <p className="text-sm text-muted-foreground">No sticker pack is published to Telegram yet. The project owner publishes packs.</p>
        ) : (
          <div className="flex flex-col gap-4">
            {stateQ.data?.kill_switch ? (
              <div className="rounded-md border border-border p-3 text-sm">
                <StatusBadge tone="gold">Paused by owner</StatusBadge>
                <p className="mt-1 text-muted-foreground">The project owner has paused all Sticker Drops. Schedules won't post until the owner resumes them.</p>
              </div>
            ) : null}

            <div className="grid gap-2">
              <Label htmlFor="partner-drop-group">Community</Label>
              <Select value={groupId ?? ""} onValueChange={(v) => setGroupId(v)}>
                <SelectTrigger id="partner-drop-group" className="min-h-11"><SelectValue placeholder="Choose a community" /></SelectTrigger>
                <SelectContent>
                  {groups.map((g) => (
                    <SelectItem key={g.group_connection_id} value={g.group_connection_id} className="min-h-11">
                      {g.title ?? "Community"}{g.operational ? "" : " (needs owner attention)"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedGroup && !selectedGroup.operational ? <p className="text-xs text-muted-foreground">The bot needs admin rights in this community. Ask the project owner to fix it.</p> : null}
            </div>

            {schedule ? (
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <StatusBadge tone={schedule.enabled ? "green" : "gold"}>{schedule.enabled ? "On" : "Off"}</StatusBadge>
                {schedule.paused_reason ? <span className="text-muted-foreground">{schedule.paused_reason}</span> : null}
                {schedule.enabled && schedule.next_run_at ? <span className="text-muted-foreground">Next drop {new Date(schedule.next_run_at).toLocaleString()}</span> : null}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No schedule for this community yet. New schedules start switched off.</p>
            )}

            <div className="grid gap-2">
              <Label htmlFor="partner-drop-pack">Sticker pack</Label>
              <Select value={draft.packId} onValueChange={(v) => setDraft({ ...draft, packId: v, selected: [] })}>
                <SelectTrigger id="partner-drop-pack" className="min-h-11"><SelectValue placeholder="Choose a pack" /></SelectTrigger>
                <SelectContent>
                  {packs.map((p) => (
                    <SelectItem key={p.pack_id} value={p.pack_id} className="min-h-11">{p.title} ({p.sticker_count})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {pack ? (
              <fieldset className="grid gap-2">
                <legend className="text-sm font-medium">Stickers to use <span className="font-normal text-muted-foreground">(none selected = all)</span></legend>
                <div className="flex flex-wrap gap-2">
                  {pack.stickers.map((s) => {
                    const on = draft.selected.includes(s.sticker_id);
                    return (
                      <Button key={s.sticker_id} type="button" variant={on ? "default" : "outline"} className="min-h-11" aria-pressed={on} onClick={() => toggle(s.sticker_id)}>
                        {(s.emoji_list ?? []).join(" ")} {s.label ?? "Sticker"}
                      </Button>
                    );
                  })}
                </div>
              </fieldset>
            ) : null}

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="partner-drop-interval">Minutes between drops ({DROP_INTERVAL_MIN}–{DROP_INTERVAL_MAX})</Label>
                <Input id="partner-drop-interval" type="number" inputMode="numeric" className="min-h-11" value={draft.interval} onChange={(e) => setDraft({ ...draft, interval: e.target.value })} aria-invalid={!intervalOk} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="partner-drop-cap">Daily cap ({DROP_DAILY_CAP_MIN}–{DROP_DAILY_CAP_MAX})</Label>
                <Input id="partner-drop-cap" type="number" inputMode="numeric" className="min-h-11" value={draft.cap} onChange={(e) => setDraft({ ...draft, cap: e.target.value })} aria-invalid={!capOk} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="partner-drop-tz">Timezone</Label>
                <Input id="partner-drop-tz" className="min-h-11" value={draft.timezone} onChange={(e) => setDraft({ ...draft, timezone: e.target.value })} aria-invalid={!tzOk} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="grid gap-2">
                  <Label htmlFor="partner-drop-start">Active from</Label>
                  <Input id="partner-drop-start" type="time" className="min-h-11" value={draft.activeStart} onChange={(e) => setDraft({ ...draft, activeStart: e.target.value })} />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="partner-drop-end">Active until</Label>
                  <Input id="partner-drop-end" type="time" className="min-h-11" value={draft.activeEnd} onChange={(e) => setDraft({ ...draft, activeEnd: e.target.value })} />
                </div>
              </div>
            </div>
            {!intervalOk || !capOk || !tzOk || !hoursOk ? <p className="text-xs text-destructive">Check the highlighted values before saving.</p> : null}

            <div className="flex min-h-11 items-center justify-between gap-3">
              <Label htmlFor="partner-drop-silent">Post silently (no notification sound)</Label>
              <Switch id="partner-drop-silent" checked={draft.silent} onCheckedChange={(v) => setDraft({ ...draft, silent: v })} />
            </div>
            <div className="flex min-h-11 items-center justify-between gap-3">
              <Label htmlFor="partner-drop-repeat">Never post the same sticker twice in a row</Label>
              <Switch id="partner-drop-repeat" checked={draft.noImmediateRepeat} onCheckedChange={(v) => setDraft({ ...draft, noImmediateRepeat: v })} />
            </div>

            <div className="flex flex-wrap gap-3">
              <Button className="min-h-11" disabled={!canSave || save.isPending} onClick={() => save.mutate()}>{save.isPending ? "Saving…" : "Save schedule"}</Button>
              {schedule ? (
                <>
                  <Button variant="outline" className="min-h-11" disabled={act.isPending} onClick={() => setConfirm({ kind: schedule.enabled ? "disable" : "enable", scheduleId: schedule.id })}>
                    {schedule.enabled ? "Turn off" : "Turn on"}
                  </Button>
                  <Button variant="outline" className="min-h-11" disabled={act.isPending} onClick={() => setConfirm({ kind: "delete", scheduleId: schedule.id })}>Delete schedule</Button>
                </>
              ) : null}
            </div>
          </div>
        )}
      </Section>

      <Section variant="secondary" title="Recent drops">
        {(stateQ.data?.events ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">No Sticker Drops have been posted yet.</p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {(stateQ.data?.events ?? []).map((e, i) => (
              <li key={`${e.created_at}-${i}`} className="flex flex-wrap items-center gap-2">
                <StatusBadge tone={e.status === "sent" ? "green" : "red"}>{e.status === "sent" ? "Sent" : "Failed"}</StatusBadge>
                <span>{e.sticker_label ?? "Sticker"} → {e.group_title ?? "Community"}</span>
                <span className="text-muted-foreground">{new Date(e.created_at).toLocaleString()}</span>
                {e.status !== "sent" && e.error_message ? <span className="text-muted-foreground">{e.error_message}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <AlertDialog open={!!confirm} onOpenChange={(o) => { if (!o) setConfirm(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm?.kind === "enable" ? "Turn on Sticker Drops?" : confirm?.kind === "disable" ? "Turn off Sticker Drops?" : "Delete this schedule?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm?.kind === "enable"
                ? `@PepeCartelHQBot will post stickers publicly in ${selectedGroup?.title ?? "the community"} on this schedule.`
                : confirm?.kind === "disable"
                  ? "No more stickers will be posted until the schedule is turned on again."
                  : "The schedule is removed. Past drop history stays."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11">Cancel</AlertDialogCancel>
            <AlertDialogAction className="min-h-11" disabled={act.isPending} onClick={(e) => { e.preventDefault(); if (confirm) act.mutate(confirm); }}>
              {act.isPending ? "Working…" : "Confirm"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
