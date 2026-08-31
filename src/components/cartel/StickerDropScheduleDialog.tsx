import { useEffect, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, ShieldCheck, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DEFAULT_SCHEDULE_FORM,
  INTERVAL_PRESETS,
  MAX_DAILY_CAP,
  MAX_INTERVAL_MINUTES,
  MIN_DAILY_CAP,
  MIN_INTERVAL_MINUTES,
  browserTimezone,
  deleteDropSchedule,
  dropErrorMessage,
  saveDropSchedule,
  setDropScheduleEnabled,
  type DropGroup,
  type DropPack,
  type DropSchedule,
  type DropSticker,
} from "@/lib/sticker-drops";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  group: DropGroup | null;
  groups: DropGroup[];
  schedule: DropSchedule | null;
  packs: DropPack[];
  stickers: DropSticker[];
  canManage: boolean;
  onChanged: () => void;
  /**
   * Pack-specific context (Sticker Lab). When set, the pack picker is locked to
   * this pack so a community's automation can never be pointed elsewhere by
   * accident. The workspace-wide Distribution Center omits it and keeps the
   * full published-pack choice.
   */
  lockedPackId?: string;
};

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function StickerDropScheduleDialog({
  open,
  onOpenChange,
  workspaceId,
  group,
  groups,
  schedule,
  packs,
  stickers,
  canManage,
  onChanged,
  lockedPackId,
}: Props) {
  const [groupId, setGroupId] = useState("");
  const [packId, setPackId] = useState("");
  const [intervalMinutes, setIntervalMinutes] = useState<number>(
    DEFAULT_SCHEDULE_FORM.intervalMinutes,
  );
  const [customInterval, setCustomInterval] = useState(false);
  const [timezone, setTimezone] = useState(browserTimezone());
  const [activeStart, setActiveStart] = useState(DEFAULT_SCHEDULE_FORM.activeStart);
  const [activeEnd, setActiveEnd] = useState(DEFAULT_SCHEDULE_FORM.activeEnd);
  const [dailyCap, setDailyCap] = useState<number>(DEFAULT_SCHEDULE_FORM.dailyCap);
  const [silent, setSilent] = useState<boolean>(DEFAULT_SCHEDULE_FORM.silent);
  const [noImmediateRepeat, setNoImmediateRepeat] = useState<boolean>(
    DEFAULT_SCHEDULE_FORM.noImmediateRepeat,
  );
  const [limitStickers, setLimitStickers] = useState(false);
  const [selectedStickerIds, setSelectedStickerIds] = useState<string[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [savedScheduleId, setSavedScheduleId] = useState<string | null>(null);

  // Re-seed the form only when the dialog opens for a given target.
  useEffect(() => {
    if (!open) return;
    setConfirmDelete(false);
    setSavedScheduleId(schedule?.id ?? null);
    setGroupId(group?.id ?? schedule?.group_connection_id ?? "");
    setPackId(lockedPackId ?? schedule?.pack_id ?? packs[0]?.id ?? "");
    const interval = schedule?.interval_minutes ?? DEFAULT_SCHEDULE_FORM.intervalMinutes;
    setIntervalMinutes(interval);
    setCustomInterval(!(INTERVAL_PRESETS as readonly number[]).includes(interval));
    setTimezone(schedule?.timezone || browserTimezone());
    setActiveStart((schedule?.active_start ?? DEFAULT_SCHEDULE_FORM.activeStart).slice(0, 5));
    setActiveEnd((schedule?.active_end ?? DEFAULT_SCHEDULE_FORM.activeEnd).slice(0, 5));
    setDailyCap(schedule?.daily_cap ?? DEFAULT_SCHEDULE_FORM.dailyCap);
    setSilent(schedule?.silent ?? DEFAULT_SCHEDULE_FORM.silent);
    setNoImmediateRepeat(
      schedule?.no_immediate_repeat ?? DEFAULT_SCHEDULE_FORM.noImmediateRepeat,
    );
    // Switching an existing schedule onto a locked pack invalidates its saved
    // sticker selection, because those IDs belong to the previous pack.
    const switchingPack = !!lockedPackId && !!schedule && schedule.pack_id !== lockedPackId;
    const selected = switchingPack ? [] : (schedule?.selected_sticker_ids ?? []);
    setLimitStickers(!switchingPack && selected.length > 0);
    setSelectedStickerIds(selected);
  }, [open, group?.id, schedule, packs, lockedPackId]);

  const packStickers = useMemo(
    () => stickers.filter((s) => s.pack_id === packId),
    [stickers, packId],
  );

  const currentScheduleId = schedule?.id ?? savedScheduleId;
  const isEnabled = schedule?.enabled === true;

  const validationError = useMemo(() => {
    if (!groupId) return "Choose a connected Telegram group.";
    if (!packId) return "Choose a published Telegram pack.";
    if (!TIME_PATTERN.test(activeStart) || !TIME_PATTERN.test(activeEnd))
      return "Active hours must use 24-hour HH:MM values.";
    if (
      !Number.isInteger(intervalMinutes) ||
      intervalMinutes < MIN_INTERVAL_MINUTES ||
      intervalMinutes > MAX_INTERVAL_MINUTES
    )
      return `Frequency must be a whole number between ${MIN_INTERVAL_MINUTES} and ${MAX_INTERVAL_MINUTES} minutes.`;
    if (!Number.isInteger(dailyCap) || dailyCap < MIN_DAILY_CAP || dailyCap > MAX_DAILY_CAP)
      return `Daily cap must be between ${MIN_DAILY_CAP} and ${MAX_DAILY_CAP}.`;
    if (!timezone.trim()) return "A timezone is required.";
    if (limitStickers && selectedStickerIds.length === 0)
      return "Select at least one sticker, or switch back to the whole pack.";
    return null;
  }, [
    groupId,
    packId,
    activeStart,
    activeEnd,
    intervalMinutes,
    dailyCap,
    timezone,
    limitStickers,
    selectedStickerIds,
  ]);

  const saveMutation = useMutation({
    mutationFn: () =>
      saveDropSchedule(workspaceId, {
        ...(currentScheduleId ? { scheduleId: currentScheduleId } : {}),
        groupConnectionId: groupId,
        packId,
        intervalMinutes,
        timezone: timezone.trim(),
        activeStart,
        activeEnd,
        dailyCap,
        silent,
        noImmediateRepeat,
        selectedStickerIds: limitStickers ? selectedStickerIds : [],
      }),
    onSuccess: (result) => {
      if (result.schedule?.id) setSavedScheduleId(result.schedule.id);
      onChanged();
      toast.success(
        currentScheduleId
          ? "Schedule saved."
          : "Schedule saved. It stays disabled until you enable drops.",
      );
    },
    onError: (err) => toast.error(dropErrorMessage(err)),
  });

  const enableMutation = useMutation({
    mutationFn: (enabled: boolean) => {
      if (!currentScheduleId) throw new Error("Save the schedule first.");
      return setDropScheduleEnabled(workspaceId, currentScheduleId, enabled);
    },
    onSuccess: (_result, enabled) => {
      onChanged();
      toast.success(enabled ? "Sticker drops enabled." : "Sticker drops paused.");
      if (enabled) onOpenChange(false);
    },
    onError: (err) => toast.error(dropErrorMessage(err)),
  });

  const deleteMutation = useMutation({
    mutationFn: () => {
      if (!currentScheduleId) throw new Error("Nothing to delete.");
      return deleteDropSchedule(workspaceId, currentScheduleId);
    },
    onSuccess: () => {
      onChanged();
      toast.success("Schedule deleted.");
      onOpenChange(false);
    },
    onError: (err) => toast.error(dropErrorMessage(err)),
  });

  const busy = saveMutation.isPending || enableMutation.isPending || deleteMutation.isPending;
  const groupTitle = groups.find((g) => g.id === groupId)?.title ?? group?.title ?? "Group";

  function toggleSticker(id: string) {
    setSelectedStickerIds((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id],
    );
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (busy ? undefined : onOpenChange(next))}>
      <DialogContent className="flex max-h-[90vh] w-[calc(100vw-1.5rem)] max-w-lg flex-col gap-0 overflow-hidden p-0 sm:w-full">
        <DialogHeader className="min-w-0 border-b border-border px-4 py-3 text-left sm:px-5">
          <DialogTitle className="min-w-0 text-base [overflow-wrap:anywhere]">
            {schedule ? "Edit sticker drops" : "Configure sticker drops"}
          </DialogTitle>
          <DialogDescription className="min-w-0 text-xs [overflow-wrap:anywhere]">
            {groupTitle} · delivery is run server-side on a fixed schedule.
          </DialogDescription>
        </DialogHeader>

        <div className="min-w-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 sm:px-5">
          {!canManage ? (
            <p className="rounded-md border border-border bg-surface-raised/60 p-3 text-xs text-muted-foreground">
              You have read-only access. Only a project owner or admin can change drop settings.
            </p>
          ) : null}

          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-[0.14em]">Group</Label>
            <Select value={groupId} onValueChange={setGroupId} disabled={!canManage || !!group}>
              <SelectTrigger className="min-h-11 w-full min-w-0">
                <SelectValue placeholder="Choose a connected group" />
              </SelectTrigger>
              <SelectContent>
                {groups.map((g) => (
                  <SelectItem key={g.id} value={g.id}>
                    {g.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-[0.14em]">Published pack</Label>
            <Select
              value={packId}
              onValueChange={setPackId}
              disabled={!canManage || !!lockedPackId}
            >
              <SelectTrigger className="min-h-11 w-full min-w-0">
                <SelectValue placeholder="Choose a published Telegram pack" />
              </SelectTrigger>
              <SelectContent>
                {packs.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {lockedPackId && schedule && schedule.pack_id !== lockedPackId ? (
              <p className="rounded-md border border-gold/40 bg-gold/5 p-3 text-xs text-muted-foreground">
                This community currently drops{" "}
                <strong className="text-foreground">
                  {packs.find((p) => p.id === schedule.pack_id)?.title ?? "another pack"}
                </strong>
                . Saving switches its Sticker Drops to{" "}
                <strong className="text-foreground">
                  {packs.find((p) => p.id === lockedPackId)?.title ?? "this pack"}
                </strong>
                .{" "}
                {schedule.enabled
                  ? "This schedule is active right now, so saving switches its live Sticker Drops to this pack. Pause it first if you do not want that."
                  : ""}
              </p>
            ) : null}
            {packs.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No published Telegram packs yet. Publish a pack in Sticker Lab first.
              </p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-[0.14em]">Frequency</Label>
            <div className="flex flex-wrap gap-2">
              {INTERVAL_PRESETS.map((preset) => (
                <Button
                  key={preset}
                  type="button"
                  size="sm"
                  variant={!customInterval && intervalMinutes === preset ? "default" : "outline"}
                  className="min-h-10 min-w-0"
                  disabled={!canManage}
                  onClick={() => {
                    setCustomInterval(false);
                    setIntervalMinutes(preset);
                  }}
                >
                  {preset} min
                </Button>
              ))}
              <Button
                type="button"
                size="sm"
                variant={customInterval ? "default" : "outline"}
                className="min-h-10 min-w-0"
                disabled={!canManage}
                onClick={() => setCustomInterval(true)}
              >
                Custom
              </Button>
            </div>
            {customInterval ? (
              <Input
                type="number"
                inputMode="numeric"
                min={MIN_INTERVAL_MINUTES}
                max={MAX_INTERVAL_MINUTES}
                step={1}
                className="min-h-11"
                disabled={!canManage}
                value={intervalMinutes}
                onChange={(e) => setIntervalMinutes(Math.trunc(Number(e.target.value)) || 0)}
              />
            ) : null}
            <p className="text-[11px] text-muted-foreground">
              Between {MIN_INTERVAL_MINUTES} and {MAX_INTERVAL_MINUTES} minutes.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3 [&>*]:min-w-0">
            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-[0.14em]">Active from</Label>
              <Input
                type="time"
                className="min-h-11"
                disabled={!canManage}
                value={activeStart}
                onChange={(e) => setActiveStart(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-[0.14em]">Active until</Label>
              <Input
                type="time"
                className="min-h-11"
                disabled={!canManage}
                value={activeEnd}
                onChange={(e) => setActiveEnd(e.target.value)}
              />
            </div>
          </div>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Use the same start and end time for all-day delivery. The server scheduler checks due
            drops every 5 minutes, so a drop may arrive a few minutes after the displayed due time.
          </p>

          <div className="grid grid-cols-2 gap-3 [&>*]:min-w-0">
            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-[0.14em]">Daily cap</Label>
              <Input
                type="number"
                inputMode="numeric"
                min={MIN_DAILY_CAP}
                max={MAX_DAILY_CAP}
                step={1}
                className="min-h-11"
                disabled={!canManage}
                value={dailyCap}
                onChange={(e) => setDailyCap(Math.trunc(Number(e.target.value)) || 0)}
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-[0.14em]">Timezone</Label>
              <Input
                className="min-h-11"
                disabled={!canManage}
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                placeholder="Europe/London"
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex min-w-0 items-center justify-between gap-3 rounded-lg border border-border/60 bg-surface-raised/40 px-3 py-2.5">
              <span className="min-w-0">
                <span className="block text-sm font-medium text-foreground">Silent posting</span>
                <span className="block text-xs text-muted-foreground">
                  Delivers without a notification sound.
                </span>
              </span>
              <Switch checked={silent} disabled={!canManage} onCheckedChange={setSilent} />
            </div>
            <div className="flex min-w-0 items-center justify-between gap-3 rounded-lg border border-border/60 bg-surface-raised/40 px-3 py-2.5">
              <span className="min-w-0">
                <span className="block text-sm font-medium text-foreground">No immediate repeat</span>
                <span className="block text-xs text-muted-foreground">
                  Never sends the same sticker twice in a row.
                </span>
              </span>
              <Switch
                checked={noImmediateRepeat}
                disabled={!canManage}
                onCheckedChange={setNoImmediateRepeat}
              />
            </div>
            <div className="flex min-w-0 items-start gap-2 rounded-lg border border-pepe/30 bg-pepe/5 px-3 py-2.5">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-pepe" aria-hidden="true" />
              <span className="min-w-0 text-xs leading-relaxed text-muted-foreground">
                Only approved, published Telegram stickers are ever sent. This safety rule is
                enforced on the server and cannot be turned off.
              </span>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex min-w-0 items-center justify-between gap-3">
              <Label className="text-xs uppercase tracking-[0.14em]">Sticker source</Label>
              <Switch
                checked={limitStickers}
                disabled={!canManage}
                onCheckedChange={(next) => {
                  setLimitStickers(next);
                  if (!next) setSelectedStickerIds([]);
                }}
                aria-label="Selected stickers only"
              />
            </div>
            <p className="text-[11px] text-muted-foreground">
              {limitStickers
                ? "Selected stickers only."
                : "Whole pack — every approved published sticker."}
            </p>
            {limitStickers ? (
              packStickers.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No stickers reported for this pack yet.
                </p>
              ) : (
                <ul className="grid max-h-56 grid-cols-1 gap-2 overflow-y-auto pr-1 sm:grid-cols-2 [&>*]:min-w-0">
                  {packStickers.map((sticker) => (
                    <li key={sticker.id}>
                      <label className="flex min-h-11 min-w-0 items-center gap-2 rounded-lg border border-border/60 bg-surface-raised/40 px-3 py-2">
                        <Checkbox
                          checked={selectedStickerIds.includes(sticker.id)}
                          disabled={!canManage}
                          onCheckedChange={() => toggleSticker(sticker.id)}
                        />
                        <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                          {(sticker.emoji_list?.[0] ?? "") + " " + sticker.label}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              )
            ) : null}
          </div>

          {validationError ? (
            <p className="text-xs text-signal">{validationError}</p>
          ) : null}
        </div>

        <div className="min-w-0 space-y-2 border-t border-border bg-sidebar/60 px-4 py-3 sm:px-5">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              className="min-h-11 flex-1 min-w-0"
              disabled={!canManage || busy || !!validationError}
              onClick={() => saveMutation.mutate()}
            >
              {saveMutation.isPending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : null}
              Save schedule
            </Button>
            {currentScheduleId ? (
              <Button
                type="button"
                variant={isEnabled ? "outline" : "default"}
                className="min-h-11 flex-1 min-w-0"
                disabled={!canManage || busy || saveMutation.isPending}
                onClick={() => enableMutation.mutate(!isEnabled)}
              >
                {enableMutation.isPending ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : null}
                {isEnabled ? "Pause drops" : "Enable sticker drops"}
              </Button>
            ) : null}
          </div>
          {currentScheduleId && canManage ? (
            confirmDelete ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1 text-xs text-muted-foreground">
                  Delete this schedule permanently?
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="min-h-10"
                  disabled={busy}
                  onClick={() => setConfirmDelete(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  className="min-h-10"
                  disabled={busy}
                  onClick={() => deleteMutation.mutate()}
                >
                  Delete
                </Button>
              </div>
            ) : (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="min-h-10 text-muted-foreground"
                disabled={busy}
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 className="size-4" aria-hidden="true" />
                Delete schedule
              </Button>
            )
          ) : null}
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Saving never starts drops. A new schedule stays disabled until you enable it.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
